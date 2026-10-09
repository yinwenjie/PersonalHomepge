import { assert, assertEquals } from "jsr:@std/assert@1.0.14";
import {
  type CachedFeed,
  type FeedStore,
  FeedStoreError,
  type FeedUpdate,
} from "../rss-proxy/feed-store.ts";
import type { FetchLike } from "../rss-proxy/fetcher.ts";
import {
  handleRssProxy,
  isRssOriginAllowed,
  type RssLogEntry,
  type RssProxyDeps,
} from "../rss-proxy/handler.ts";
import { sha256Hex } from "../rss-proxy/service.ts";

const ORIGIN = "https://mylinker.net";
const FEED = "https://example.com/feed.xml";
const MINUTE = 60 * 1000;
const START = Date.UTC(2026, 9, 9, 8, 0, 0);

const RSS = (title: string) =>
  `<rss><channel><title>Example</title><link>https://example.com/</link>
   <item><title>${title}</title><link>https://example.com/post</link>
   <pubDate>Thu, 08 Oct 2026 12:00:00 GMT</pubDate></item></channel></rss>`;

class Clock {
  now = START;
  advance(ms: number) {
    this.now += ms;
  }
}

/** In-memory FeedStore with the same lease rules as rss_claim_refresh. */
class MemoryStore implements FeedStore {
  rows = new Map<string, CachedFeed & { leaseUntil: number | null; lastRequestedAt: number }>();
  rates = new Map<string, number>();
  rateLimits: Record<string, number> = {};
  failRate = false;
  /** Fail only the per-request global charge, after the client checks have passed. */
  failGlobalCharge = false;
  cleanups = 0;
  calls: string[] = [];

  constructor(private clock: Clock) {}

  getFeeds(hashes: string[]) {
    this.calls.push("get");
    return Promise.resolve(
      new Map(hashes.flatMap((hash) => {
        const row = this.rows.get(hash);
        return row ? [[hash, structuredClone(row)] as const] : [];
      })),
    );
  }

  claimRefresh(hash: string, feedUrl: string) {
    this.calls.push("claim");
    if (!this.rows.has(hash)) {
      this.rows.set(hash, {
        urlHash: hash,
        feedUrl,
        status: "pending",
        errorCode: null,
        title: null,
        siteUrl: null,
        items: [],
        etag: null,
        lastModified: null,
        failureCount: 0,
        fetchedAt: null,
        nextFetchAt: this.clock.now,
        leaseUntil: null,
        lastRequestedAt: this.clock.now,
      });
    }
    const row = this.rows.get(hash)!;
    if (
      row.nextFetchAt <= this.clock.now &&
      (row.leaseUntil === null || row.leaseUntil < this.clock.now)
    ) {
      row.leaseUntil = this.clock.now + 60_000;
      return Promise.resolve(true);
    }
    return Promise.resolve(false);
  }

  finishRefresh(hash: string, update: FeedUpdate) {
    this.calls.push("finish");
    const row = this.rows.get(hash)!;
    Object.assign(row, update, { leaseUntil: null });
    return Promise.resolve();
  }

  releaseLease(hash: string) {
    this.calls.push("release");
    this.rows.get(hash)!.leaseUntil = null;
    return Promise.resolve();
  }

  saveChecked(hash: string, feedUrl: string, update: FeedUpdate) {
    this.calls.push("save");
    const existing = this.rows.get(hash);
    if (
      existing && existing.status === "error" &&
      (existing.leaseUntil === null || existing.leaseUntil < this.clock.now)
    ) {
      Object.assign(existing, update, { lastRequestedAt: this.clock.now });
    } else if (!existing) {
      this.rows.set(hash, {
        urlHash: hash,
        feedUrl,
        ...update,
        leaseUntil: null,
        lastRequestedAt: this.clock.now,
      });
    }
    return Promise.resolve();
  }

  touch(hashes: string[], olderThan: number) {
    for (const hash of hashes) {
      const row = this.rows.get(hash);
      if (row && row.lastRequestedAt < olderThan) {
        row.lastRequestedAt = this.clock.now;
      }
    }
    return Promise.resolve();
  }

  consumeRate(key: string, _windowSeconds: number, limit: number) {
    if (this.failRate || (this.failGlobalCharge && key === "global-fetch")) {
      return Promise.reject(new FeedStoreError("rate"));
    }
    const bucket = key.split(":")[0];
    const count = (this.rates.get(key) ?? 0) + 1;
    this.rates.set(key, count);
    return Promise.resolve(count <= (this.rateLimits[bucket] ?? limit));
  }

  deleteStale() {
    this.cleanups += 1;
    return Promise.resolve();
  }
}

interface Harness {
  deps: RssProxyDeps;
  store: MemoryStore;
  clock: Clock;
  fetches: string[];
  logs: RssLogEntry[];
  setRoute: (url: string, response: (() => Response | Promise<Response>) | null) => void;
}

function harness(): Harness {
  const clock = new Clock();
  const store = new MemoryStore(clock);
  const fetches: string[] = [];
  const logs: RssLogEntry[] = [];
  const routes = new Map<string, () => Response | Promise<Response>>();
  const fetch: FetchLike = async (input) => {
    fetches.push(input);
    const route = routes.get(input);
    if (!route) {
      throw new TypeError("connection refused");
    }
    return await route();
  };
  const deps: RssProxyDeps = {
    store,
    fetcher: { fetch, resolve: () => Promise.resolve(["93.184.216.34"]) },
    now: () => clock.now,
    sleep: (ms) => {
      clock.advance(ms);
      return Promise.resolve();
    },
    random: () => 0.5,
    newBudget: () => ({ signal: new AbortController().signal, hops: 0 }),
    isAllowedOrigin: isRssOriginAllowed,
    clientKey: () => Promise.resolve("a".repeat(64)),
    newRequestId: () => "req-1",
    log: (entry) => logs.push(entry),
  };
  return {
    deps,
    store,
    clock,
    fetches,
    logs,
    setRoute: (url, response) => response ? routes.set(url, response) : routes.delete(url),
  };
}

function feedResponse(title: string, headers: Record<string, string> = {}) {
  return () =>
    new Response(RSS(title), { headers: { "Content-Type": "application/rss+xml", ...headers } });
}

function post(body: unknown, origin: string | null = ORIGIN, init: RequestInit = {}): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (origin) {
    headers.Origin = origin;
  }
  return new Request("https://project.supabase.co/functions/v1/rss-proxy", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...init,
  });
}

async function call(h: Harness, body: unknown, origin?: string | null) {
  const response = await handleRssProxy(post(body, origin), h.deps);
  return { status: response.status, headers: response.headers, body: await response.json() };
}

Deno.test("origin allowlist: product site, local dev and Pages previews only", () => {
  for (
    const origin of [
      "https://mylinker.net",
      "https://www.mylinker.net",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "https://feat-rss.personalhomepge.pages.dev",
    ]
  ) {
    assertEquals(isRssOriginAllowed(origin), true, origin);
  }
  for (
    const origin of [
      null,
      "https://yinwenjie.github.io",
      "https://admin.mylinker.net",
      "https://evil.com",
      "https://personalhomepge.pages.dev.evil.com",
      "https://a.b.personalhomepge.pages.dev",
      "http://feat.personalhomepge.pages.dev",
      "https://mylinker.net.evil.com",
    ]
  ) {
    assertEquals(isRssOriginAllowed(origin), false, String(origin));
  }
});

Deno.test("disallowed origins get 403 without CORS headers; preflight gets CORS", async () => {
  const h = harness();
  const rejected = await call(h, { mode: "read", feeds: [FEED] }, "https://evil.com");
  assertEquals(rejected.status, 403);
  assertEquals(rejected.headers.get("Access-Control-Allow-Origin"), null);
  assertEquals(h.fetches.length, 0);

  const preflight = await handleRssProxy(
    new Request("https://x/functions/v1/rss-proxy", {
      method: "OPTIONS",
      headers: { Origin: ORIGIN },
    }),
    h.deps,
  );
  assertEquals(preflight.status, 204);
  assertEquals(preflight.headers.get("Access-Control-Allow-Origin"), ORIGIN);
});

Deno.test("strict request validation", async () => {
  const h = harness();
  for (
    const body of [
      { mode: "read", feeds: [] },
      { mode: "read", feeds: [FEED, FEED, FEED, FEED, FEED, FEED] },
      { mode: "check", feeds: [FEED, FEED] },
      { mode: "read", feeds: [FEED], extra: true },
      { mode: "write", feeds: [FEED] },
      { mode: "read", feeds: [42] },
      { mode: "read", feeds: ["x".repeat(2049)] },
      [FEED],
      "not json",
      { mode: "read", feeds: ["x".repeat(9000)] },
    ]
  ) {
    const result = await call(h, body);
    assertEquals(result.status, 400, JSON.stringify(body).slice(0, 80));
    assertEquals(result.body, { error: "invalid_request" });
  }

  const wrongType = await handleRssProxy(
    new Request("https://x/", {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "text/plain" },
      body: JSON.stringify({ mode: "read", feeds: [FEED] }),
    }),
    h.deps,
  );
  assertEquals(wrongType.status, 400);

  const get = await handleRssProxy(
    new Request("https://x/", { method: "GET", headers: { Origin: ORIGIN } }),
    h.deps,
  );
  assertEquals(get.status, 400);
  assertEquals(h.fetches.length, 0);
});

Deno.test("read: first request fetches, later requests hit the cache until it expires", async () => {
  const h = harness();
  h.setRoute(FEED, feedResponse("First", { ETag: '"v1"' }));

  const first = await call(h, { mode: "read", feeds: [FEED] });
  assertEquals(first.status, 200);
  assertEquals(first.headers.get("Cache-Control"), "no-store, private");
  const feed = first.body.feeds[0];
  assertEquals(feed.url, FEED);
  assertEquals(feed.status, "ok");
  assertEquals(feed.title, "Example");
  assertEquals(feed.items[0].title, "First");
  assertEquals(h.fetches.length, 1);

  h.clock.advance(29 * MINUTE);
  const cached = await call(h, { mode: "read", feeds: [FEED] });
  assertEquals(cached.body.feeds[0].status, "ok");
  assertEquals(h.fetches.length, 1);
  assertEquals(h.logs.at(-1)?.cacheHits, 1);

  h.clock.advance(2 * MINUTE);
  h.setRoute(FEED, feedResponse("Second"));
  const refreshed = await call(h, { mode: "read", feeds: [FEED] });
  assertEquals(refreshed.body.feeds[0].items[0].title, "Second");
  assertEquals(h.fetches.length, 2);
});

Deno.test("read: a conditional 304 keeps the cached items and renews freshness", async () => {
  const h = harness();
  h.setRoute(FEED, feedResponse("Kept", { ETag: '"v1"' }));
  await call(h, { mode: "read", feeds: [FEED] });

  h.clock.advance(31 * MINUTE);
  h.setRoute(FEED, () => new Response(null, { status: 304 }));
  const result = await call(h, { mode: "read", feeds: [FEED] });
  assertEquals(result.body.feeds[0].status, "ok");
  assertEquals(result.body.feeds[0].items[0].title, "Kept");
  assertEquals(result.body.feeds[0].fetchedAt, new Date(h.clock.now).toISOString());
});

Deno.test("read: a failed refresh serves stale data, backs off, then gives up after 7 days", async () => {
  const h = harness();
  h.setRoute(FEED, feedResponse("Old"));
  await call(h, { mode: "read", feeds: [FEED] });

  h.clock.advance(31 * MINUTE);
  h.setRoute(FEED, null);
  const stale = await call(h, { mode: "read", feeds: [FEED] });
  assertEquals(stale.body.feeds[0].status, "stale");
  assertEquals(stale.body.feeds[0].errorCode, "fetch_failed");
  assertEquals(stale.body.feeds[0].items[0].title, "Old");
  assertEquals(h.fetches.length, 2);

  // First failure backs off 30 minutes: no new fetch inside that window.
  h.clock.advance(20 * MINUTE);
  await call(h, { mode: "read", feeds: [FEED] });
  assertEquals(h.fetches.length, 2);

  // Second failure backs off one hour.
  h.clock.advance(11 * MINUTE);
  await call(h, { mode: "read", feeds: [FEED] });
  assertEquals(h.fetches.length, 3);
  h.clock.advance(50 * MINUTE);
  await call(h, { mode: "read", feeds: [FEED] });
  assertEquals(h.fetches.length, 3);
  const row = [...h.store.rows.values()][0];
  assertEquals(row.failureCount, 2);
  assertEquals(row.nextFetchAt - (h.clock.now - 50 * MINUTE), 60 * MINUTE);

  h.clock.advance(8 * 24 * 60 * MINUTE);
  const expired = await call(h, { mode: "read", feeds: [FEED] });
  assertEquals(expired.body.feeds[0].status, "error");
  assertEquals(expired.body.feeds[0].items, []);
});

Deno.test("read: backoff is capped at six hours", async () => {
  const h = harness();
  for (let attempt = 0; attempt < 7; attempt += 1) {
    await call(h, { mode: "read", feeds: [FEED] });
    const row = [...h.store.rows.values()][0];
    h.clock.advance(row.nextFetchAt - h.clock.now);
  }
  const row = [...h.store.rows.values()][0];
  assertEquals(row.failureCount, 7);
  assertEquals(row.status, "error");
  assertEquals(row.fetchedAt, null);
  await call(h, { mode: "read", feeds: [FEED] });
  assertEquals([...h.store.rows.values()][0].nextFetchAt - h.clock.now, 6 * 60 * MINUTE);
});

Deno.test("read: one bad feed does not affect the others; invalid URLs are reported per feed", async () => {
  const h = harness();
  h.setRoute(FEED, feedResponse("Good"));
  h.setRoute(
    "https://broken.example.com/rss",
    () => new Response("<html/>", { headers: { "Content-Type": "text/html" } }),
  );
  const result = await call(h, {
    mode: "read",
    feeds: [FEED, "https://broken.example.com/rss", "http://localhost/feed", "ftp://x/y", FEED],
  });
  assertEquals(
    result.body.feeds.map((
      feed: { status: string; errorCode?: string },
    ) => [feed.status, feed.errorCode]),
    [["ok", undefined], ["error", "not_feed"], ["error", "blocked_address"], [
      "error",
      "invalid_url",
    ], [
      "ok",
      undefined,
    ]],
  );
  // The duplicate URL is fetched once.
  assertEquals(h.fetches.filter((url) => url === FEED).length, 1);
  assertEquals(h.logs.at(-1)?.errorCodes, ["not_feed", "blocked_address", "invalid_url"]);
});

Deno.test("read: concurrent requests for an expired feed fetch it only once", async () => {
  const h = harness();
  h.setRoute(FEED, feedResponse("v1"));
  await call(h, { mode: "read", feeds: [FEED] });
  h.clock.advance(31 * MINUTE);

  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  h.setRoute(FEED, async () => {
    await gate;
    return feedResponse("v2")();
  });

  const winner = call(h, { mode: "read", feeds: [FEED] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const loser = await call(h, { mode: "read", feeds: [FEED] });
  assertEquals(loser.body.feeds[0].status, "stale");
  assertEquals(loser.body.feeds[0].items[0].title, "v1");

  release();
  assertEquals((await winner).body.feeds[0].items[0].title, "v2");
  assertEquals(h.fetches.length, 2);
});

Deno.test("read: a new feed being fetched elsewhere is polled, then reported pending", async () => {
  const h = harness();
  const hash = await sha256Hex(FEED);
  await h.store.claimRefresh(hash, FEED); // someone else holds the first-fetch lease
  const pending = await call(h, { mode: "read", feeds: [FEED] });
  assertEquals(pending.body.feeds[0].status, "pending");
  assertEquals(h.fetches.length, 0);
  assertEquals(h.store.calls.filter((name) => name === "get").length, 1 + 17);
});

Deno.test("rate limits: per client, per client checks, and the global fetch budget", async () => {
  const h = harness();
  h.store.rateLimits = { ip: 1 };
  h.setRoute(FEED, feedResponse("x"));
  assertEquals((await call(h, { mode: "read", feeds: [FEED] })).status, 200);
  const limited = await call(h, { mode: "read", feeds: [FEED] });
  assertEquals(limited.status, 429);
  assertEquals(limited.body, { error: "rate_limited" });

  const checks = harness();
  checks.store.rateLimits = { check: 1 };
  checks.setRoute(FEED, feedResponse("x"));
  assertEquals((await call(checks, { mode: "check", feeds: [FEED] })).status, 200);
  assertEquals((await call(checks, { mode: "check", feeds: [FEED] })).status, 429);

  const global = harness();
  global.setRoute(FEED, feedResponse("cached"));
  await call(global, { mode: "read", feeds: [FEED] });
  global.store.rateLimits = { "global-fetch": 0 };
  global.clock.advance(31 * MINUTE);
  const stale = await call(global, { mode: "read", feeds: [FEED, "https://new.example.com/feed"] });
  assertEquals(stale.body.feeds[0].status, "stale");
  assertEquals(stale.body.feeds[0].errorCode, "rate_limited");
  assertEquals(stale.body.feeds[1].status, "error");
  assertEquals(stale.body.feeds[1].errorCode, "rate_limited");
  assertEquals(global.fetches.length, 1);
  assert(global.store.calls.includes("release"));
});

Deno.test("store failures surface as service_unavailable", async () => {
  const h = harness();
  h.store.failRate = true;
  const result = await call(h, { mode: "read", feeds: [FEED] });
  assertEquals(result.status, 503);
  assertEquals(result.body, { error: "service_unavailable" });
});

Deno.test("check: discovers a feed from an HTML page and caches it under the feed URL", async () => {
  const h = harness();
  h.setRoute("https://example.com/", () =>
    new Response(
      `<html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head></html>`,
      { headers: { "Content-Type": "text/html; charset=utf-8" } },
    ));
  h.setRoute(FEED, feedResponse("Found"));

  const result = await call(h, { mode: "check", feeds: ["https://example.com"] });
  assertEquals(result.status, 200);
  const feed = result.body.feeds[0];
  assertEquals(feed.url, FEED);
  assertEquals(feed.status, "ok");
  assertEquals(feed.discovered, true);
  assertEquals(feed.items[0].title, "Found");

  // A read right after is served from the cache the check filled.
  await call(h, { mode: "read", feeds: [FEED] });
  assertEquals(h.fetches.length, 2);
  assertEquals(h.logs.at(-1)?.cacheHits, 1);
});

Deno.test("check: pages without a feed, blocked targets and non-feeds report the reason", async () => {
  const h = harness();
  h.setRoute(
    "https://example.com/page",
    () => new Response("<html><p>nothing</p></html>", { headers: { "Content-Type": "text/html" } }),
  );
  const noFeed = await call(h, { mode: "check", feeds: ["https://example.com/page"] });
  assertEquals(noFeed.body.feeds[0].errorCode, "not_feed");
  assertEquals(noFeed.body.feeds[0].discovered, false);

  h.setRoute("https://example.com/sneaky", () =>
    new Response(
      `<link rel="alternate" type="application/rss+xml" href="http://169.254.169.254/latest">`,
      { headers: { "Content-Type": "text/html" } },
    ));
  const sneaky = await call(h, { mode: "check", feeds: ["https://example.com/sneaky"] });
  assertEquals(sneaky.body.feeds[0].errorCode, "blocked_address");

  const local = await call(h, { mode: "check", feeds: ["http://192.168.0.1/"] });
  assertEquals(local.body.feeds[0].errorCode, "blocked_address");
  assertEquals(h.store.calls.includes("save"), false);
});

Deno.test("logs carry counts and error codes only", async () => {
  const h = harness();
  h.setRoute(FEED, feedResponse("x"));
  await call(h, { mode: "read", feeds: [FEED] });
  const entry = h.logs.at(-1)!;
  assertEquals(Object.keys(entry).sort(), [
    "cacheHits",
    "errorCodes",
    "feedCount",
    "latencyMs",
    "mode",
    "outcome",
    "requestId",
  ]);
  assert(!JSON.stringify(h.logs).includes("example.com"));
});

Deno.test("cleanup runs on roughly one request in a hundred", async () => {
  const h = harness();
  h.setRoute(FEED, feedResponse("x"));
  await call(h, { mode: "read", feeds: [FEED] });
  assertEquals(h.store.cleanups, 0);
  h.deps.random = () => 0.001;
  await call(h, { mode: "read", feeds: [FEED] });
  assertEquals(h.store.cleanups, 1);
});

Deno.test("check: discovery charges the global limit for each request it makes", async () => {
  const h = harness();
  h.setRoute("https://example.com/", () =>
    new Response(
      `<link rel="alternate" type="application/rss+xml" href="/feed.xml">`,
      { headers: { "Content-Type": "text/html" } },
    ));
  h.setRoute(FEED, feedResponse("Found"));
  h.store.rateLimits = { "global-fetch": 1 };
  const result = await call(h, { mode: "check", feeds: ["https://example.com/"] });
  assertEquals(result.body.feeds[0].errorCode, "rate_limited");
  assertEquals(h.fetches, ["https://example.com/"]);
  assertEquals(h.store.rates.get("global-fetch"), 2);
});

Deno.test("check: saving a checked feed keeps a read refresh's lease", async () => {
  const h = harness();
  h.setRoute(FEED, feedResponse("v1"));
  await call(h, { mode: "read", feeds: [FEED] });
  h.clock.advance(31 * MINUTE);

  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  h.setRoute(FEED, async () => {
    await gate;
    return feedResponse("v2")();
  });
  const reader = call(h, { mode: "read", feeds: [FEED] });
  await new Promise((resolve) => setTimeout(resolve, 0));

  // The reader is now blocked inside its fetch, holding the lease; the check answers at once.
  h.setRoute(FEED, feedResponse("checked"));
  h.setRoute(
    "https://example.com/",
    () =>
      new Response(`<link rel="alternate" type="application/rss+xml" href="/feed.xml">`, {
        headers: { "Content-Type": "text/html" },
      }),
  );
  const checked = await call(h, { mode: "check", feeds: ["https://example.com/"] });
  assertEquals(checked.body.feeds[0].items[0].title, "checked");

  const hash = await sha256Hex(FEED);
  assert(h.store.rows.get(hash)!.leaseUntil !== null, "the check must not clear the lease");
  assertEquals(
    h.store.rows.get(hash)!.items[0].title,
    "v1",
    "the check must not overwrite the row",
  );
  release();
  await reader;
  assertEquals(h.store.rows.get(hash)!.items[0].title, "v2");
  assertEquals(h.store.rows.get(hash)!.leaseUntil, null);
});

Deno.test("a store outage during a fetch is a 503 and leaves the feed's health alone", async () => {
  const h = harness();
  h.setRoute(FEED, feedResponse("v1"));
  await call(h, { mode: "read", feeds: [FEED] });
  h.clock.advance(31 * MINUTE);
  h.store.failGlobalCharge = true;

  const read = await call(h, { mode: "read", feeds: [FEED] });
  assertEquals(read.status, 503);
  const check = await call(h, { mode: "check", feeds: ["https://other.example.com/feed"] });
  assertEquals(check.status, 503);

  const row = h.store.rows.get(await sha256Hex(FEED))!;
  assertEquals(row.status, "ok");
  assertEquals(row.failureCount, 0);
  assertEquals(h.fetches.length, 1);
});

Deno.test("validators from a redirected feed are not stored for the original URL", async () => {
  const h = harness();
  h.setRoute(
    FEED,
    () =>
      new Response(null, {
        status: 301,
        headers: { Location: "https://cdn.example.com/feed.xml" },
      }),
  );
  h.setRoute("https://cdn.example.com/feed.xml", feedResponse("moved", { ETag: '"cdn"' }));
  await call(h, { mode: "read", feeds: [FEED] });
  const row = h.store.rows.get(await sha256Hex(FEED))!;
  assertEquals(row.items[0].title, "moved");
  assertEquals(row.etag, null);
});

Deno.test("check: a successful check replaces a feed stuck in failure backoff", async () => {
  const h = harness();
  await call(h, { mode: "read", feeds: [FEED] }); // no route: fails, backs off 30 minutes
  const hash = await sha256Hex(FEED);
  assertEquals(h.store.rows.get(hash)!.status, "error");

  h.setRoute(FEED, feedResponse("back"));
  await call(h, { mode: "check", feeds: [FEED] });
  const read = await call(h, { mode: "read", feeds: [FEED] });
  assertEquals(read.body.feeds[0].status, "ok");
  assertEquals(read.body.feeds[0].items[0].title, "back");
});

Deno.test("a store outage after claiming releases the lease", async () => {
  const h = harness();
  h.store.failGlobalCharge = true;
  assertEquals((await call(h, { mode: "read", feeds: [FEED] })).status, 503);
  assertEquals(h.store.rows.get(await sha256Hex(FEED))!.leaseUntil, null);
});
