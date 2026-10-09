// Per-feed cache, refresh lease, backoff and rate limit logic for rss-proxy.
import {
  BACKOFF_MS,
  FeedError,
  type FeedErrorCode,
  type FeedResult,
  FRESH_MS,
  MAX_REDIRECTS,
  PENDING_POLL_MS,
  PENDING_WAIT_MS,
  RATE_LIMITS,
  RssRequestError,
  STALE_LIMIT_MS,
  type StoredFeedErrorCode,
} from "./contract.ts";
import { parseFeed } from "./feed-parser.ts";
import { type CachedFeed, type FeedStore, FeedStoreError, type FeedUpdate } from "./feed-store.ts";
import {
  discoverFeedLink,
  type FetchBudget,
  fetchDocument,
  type FetcherDeps,
  FetchRateLimited,
  newFetchBudget,
} from "./fetcher.ts";
import { assertHostAllowed, normalizeFeedUrl } from "./url-guard.ts";

export interface RssServiceDeps {
  store: FeedStore;
  fetcher: FetcherDeps;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  newBudget?: () => FetchBudget;
}

export interface ServiceOutcome {
  feeds: FeedResult[];
  cacheHits: number;
}

const TOUCH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const CLEANUP_PROBABILITY = 0.01;

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

/** Per-client limits; clientKey is already a keyed hash of the IP. */
export async function enforceRequestRate(
  store: FeedStore,
  mode: "read" | "check",
  clientKey: string,
): Promise<void> {
  const { perIp, perIpCheck } = RATE_LIMITS;
  if (!(await store.consumeRate(`ip:${clientKey}`, perIp.windowSeconds, perIp.limit))) {
    throw new RssRequestError("rate_limited");
  }
  if (
    mode === "check" &&
    !(await store.consumeRate(`check:${clientKey}`, perIpCheck.windowSeconds, perIpCheck.limit))
  ) {
    throw new RssRequestError("rate_limited");
  }
}

export async function maybeCleanup(deps: RssServiceDeps): Promise<void> {
  if ((deps.random ?? Math.random)() < CLEANUP_PROBABILITY) {
    await deps.store.deleteStale().catch(() => {});
  }
}

export async function readFeeds(urls: string[], deps: RssServiceDeps): Promise<ServiceOutcome> {
  const now = deps.now ?? Date.now;
  type Target =
    | { raw: string; url: URL; hash: string }
    | { raw: string; url: null; error: FeedErrorCode };
  const targets = await Promise.all(urls.map(async (raw): Promise<Target> => {
    try {
      const url = normalizeFeedUrl(raw);
      assertHostAllowed(url);
      return { raw, url, hash: await sha256Hex(url.href) };
    } catch (error) {
      return { raw, url: null, error: feedErrorCode(error, "invalid_url") };
    }
  }));

  const hashes = [
    ...new Set(targets.flatMap((target) => target.url === null ? [] : [target.hash])),
  ];
  const cached = await deps.store.getFeeds(hashes);

  // Duplicate URLs in one request share one lookup and at most one fetch.
  const work = new Map<string, Promise<{ result: CachedView; cacheHit: boolean }>>();
  let cacheHits = 0;
  const feeds = await Promise.all(targets.map(async (target): Promise<FeedResult> => {
    if (target.url === null) {
      return errorResult(target.raw, target.error);
    }
    let pending = work.get(target.hash);
    if (!pending) {
      pending = readOne(target.url, target.hash, cached.get(target.hash) ?? null, deps);
      work.set(target.hash, pending);
    }
    const { result, cacheHit } = await pending;
    if (cacheHit) {
      cacheHits += 1;
    }
    return { ...result, url: target.raw };
  }));

  await deps.store.touch(hashes, now() - TOUCH_INTERVAL_MS);
  return { feeds, cacheHits };
}

type CachedView = Omit<FeedResult, "url">;

async function readOne(
  url: URL,
  hash: string,
  row: CachedFeed | null,
  deps: RssServiceDeps,
): Promise<{ result: CachedView; cacheHit: boolean }> {
  const now = deps.now ?? Date.now;
  if (row && now() < row.nextFetchAt) {
    return { result: present(row, now()), cacheHit: true };
  }

  if (!(await deps.store.claimRefresh(hash, url.href))) {
    return { result: await waitForOtherRefresh(hash, deps), cacheHit: true };
  }

  let update: FeedUpdate;
  try {
    update = await refresh(url, row, deps);
  } catch (error) {
    if (!(error instanceof FetchRateLimited)) {
      throw error;
    }
    // Over the global request budget: leave the row as it was so the next caller retries.
    await deps.store.releaseLease(hash);
    if (row && row.fetchedAt !== null && now() - row.fetchedAt <= STALE_LIMIT_MS) {
      return {
        result: { ...present(row, now()), status: "stale", errorCode: "rate_limited" },
        cacheHit: true,
      };
    }
    return { result: errorView("rate_limited"), cacheHit: false };
  }
  await deps.store.finishRefresh(hash, update);
  return {
    result: present({ ...update, urlHash: hash, feedUrl: url.href }, now()),
    cacheHit: false,
  };
}

/** Another request holds the lease: serve its cache, or wait briefly for a first fetch. */
async function waitForOtherRefresh(hash: string, deps: RssServiceDeps): Promise<CachedView> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + PENDING_WAIT_MS;
  while (true) {
    const row = (await deps.store.getFeeds([hash])).get(hash);
    if (row && (row.fetchedAt !== null || row.status !== "pending")) {
      return present(row, now());
    }
    if (now() >= deadline) {
      return pendingView();
    }
    await sleep(PENDING_POLL_MS);
  }
}

async function refresh(
  url: URL,
  row: CachedFeed | null,
  deps: RssServiceDeps,
): Promise<FeedUpdate> {
  const now = (deps.now ?? Date.now)();
  const budget = chargedBudget(deps);
  try {
    const document = await fetchDocument(
      url,
      { allowHtml: false, etag: row?.etag, lastModified: row?.lastModified },
      budget,
      deps.fetcher,
    );

    if (document.kind === "not_modified") {
      if (!row || row.fetchedAt === null) {
        throw new FeedError("fetch_failed");
      }
      return {
        ...rowData(row),
        status: "ok",
        errorCode: null,
        failureCount: 0,
        fetchedAt: now,
        nextFetchAt: now + FRESH_MS,
      };
    }

    const parsed = await parseFeed(document.text, document.url);
    return {
      status: "ok",
      errorCode: null,
      title: parsed.title,
      siteUrl: parsed.siteUrl,
      items: parsed.items,
      // Validators belong to the URL that answered; after a redirect they would be sent to
      // the wrong URL next time, so keep them only when the feed answered directly.
      etag: document.url.href === url.href ? document.etag : null,
      lastModified: document.url.href === url.href ? document.lastModified : null,
      failureCount: 0,
      fetchedAt: now,
      nextFetchAt: now + FRESH_MS,
    };
  } catch (error) {
    // Our own outages (rate RPC, store) say nothing about the feed's health.
    if (error instanceof FetchRateLimited || error instanceof FeedStoreError) {
      throw error;
    }
    const failureCount = (row?.failureCount ?? 0) + 1;
    const base = row ? rowData(row) : emptyData();
    return {
      ...base,
      status: "error",
      errorCode: storedErrorCode(error),
      failureCount,
      nextFetchAt: now + BACKOFF_MS[Math.min(failureCount, BACKOFF_MS.length) - 1],
    };
  }
}

/** check mode: fetch now (HTML allowed for discovery) and cache the feed it finds. */
export async function checkFeed(raw: string, deps: RssServiceDeps): Promise<ServiceOutcome> {
  const now = deps.now ?? Date.now;
  let url: URL;
  try {
    url = normalizeFeedUrl(raw);
    assertHostAllowed(url);
  } catch (error) {
    return { feeds: [checkError(raw, feedErrorCode(error, "invalid_url"))], cacheHits: 0 };
  }

  const hash = await sha256Hex(url.href);
  const row = (await deps.store.getFeeds([hash])).get(hash);
  if (row && row.status === "ok" && row.fetchedAt !== null && now() < row.nextFetchAt) {
    return {
      feeds: [{ ...present(row, now()), url: url.href, discovered: false }],
      cacheHits: 1,
    };
  }

  const budget = chargedBudget(deps);
  let feedUrl: URL;
  let update: FeedUpdate;
  let discovered = false;
  try {
    let document = await fetchDocument(url, { allowHtml: true }, budget, deps.fetcher);
    if (document.kind === "document" && document.format === "html") {
      const link = discoverFeedLink(document.text, document.url);
      if (!link) {
        throw new FeedError("not_feed");
      }
      budget.hops += 1;
      if (budget.hops > MAX_REDIRECTS) {
        throw new FeedError("fetch_failed");
      }
      document = await fetchDocument(link, { allowHtml: false }, budget, deps.fetcher);
      discovered = true;
    }
    if (document.kind !== "document") {
      throw new FeedError("fetch_failed");
    }

    const parsed = await parseFeed(document.text, document.url);
    const fetchedAt = now();
    feedUrl = document.url;
    update = {
      status: "ok",
      errorCode: null,
      title: parsed.title,
      siteUrl: parsed.siteUrl,
      items: parsed.items,
      etag: document.etag,
      lastModified: document.lastModified,
      failureCount: 0,
      fetchedAt,
      nextFetchAt: fetchedAt + FRESH_MS,
    };
  } catch (error) {
    if (error instanceof FeedStoreError) {
      throw error;
    }
    if (error instanceof FetchRateLimited) {
      return { feeds: [checkError(raw, "rate_limited")], cacheHits: 0 };
    }
    return { feeds: [checkError(raw, storedErrorCode(error))], cacheHits: 0 };
  }

  await deps.store.saveChecked(await sha256Hex(feedUrl.href), feedUrl.href, update);
  return {
    feeds: [{
      ...present({ ...update, urlHash: "", feedUrl: feedUrl.href }, now()),
      url: feedUrl.href,
      discovered,
    }],
    cacheHits: 0,
  };
}

/** A fetch budget whose every outbound request is counted against the global limit. */
function chargedBudget(deps: RssServiceDeps): FetchBudget {
  const { globalFetch } = RATE_LIMITS;
  return {
    ...(deps.newBudget ?? newFetchBudget)(),
    charge: () =>
      deps.store.consumeRate("global-fetch", globalFetch.windowSeconds, globalFetch.limit),
  };
}

/** What a client sees for a cache row at time `now`. */
export function present(row: CachedFeed, now: number): CachedView {
  if (row.fetchedAt === null) {
    return row.status === "error" ? errorView(row.errorCode ?? "fetch_failed") : pendingView();
  }

  const view = {
    fetchedAt: new Date(row.fetchedAt).toISOString(),
    title: row.title,
    siteUrl: row.siteUrl,
    items: row.items,
  };
  if (row.status === "ok" && now < row.nextFetchAt) {
    return { ...view, status: "ok" };
  }
  if (now - row.fetchedAt <= STALE_LIMIT_MS) {
    return row.status === "error" && row.errorCode
      ? { ...view, status: "stale", errorCode: row.errorCode }
      : { ...view, status: "stale" };
  }
  return errorView(row.errorCode ?? "fetch_failed");
}

function rowData(row: CachedFeed) {
  return {
    title: row.title,
    siteUrl: row.siteUrl,
    items: row.items,
    etag: row.etag,
    lastModified: row.lastModified,
    fetchedAt: row.fetchedAt,
  };
}

function emptyData() {
  return {
    title: null,
    siteUrl: null,
    items: [],
    etag: null,
    lastModified: null,
    fetchedAt: null,
  };
}

function storedErrorCode(error: unknown): StoredFeedErrorCode {
  // A redirect to an unusable URL is the site's failure, not the user's input.
  if (error instanceof FeedError && error.code !== "invalid_url") {
    return error.code;
  }
  return "fetch_failed";
}

function feedErrorCode(error: unknown, fallback: FeedErrorCode): FeedErrorCode {
  return error instanceof FeedError ? error.code : fallback;
}

function errorView(code: FeedErrorCode): CachedView {
  return {
    status: "error",
    errorCode: code,
    fetchedAt: null,
    title: null,
    siteUrl: null,
    items: [],
  };
}

function pendingView(): CachedView {
  return { status: "pending", fetchedAt: null, title: null, siteUrl: null, items: [] };
}

function errorResult(url: string, code: FeedErrorCode): FeedResult {
  return { ...errorView(code), url };
}

function checkError(url: string, code: FeedErrorCode): FeedResult {
  return { ...errorView(code), url, discovered: false };
}
