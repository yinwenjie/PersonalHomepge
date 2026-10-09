import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import { FeedError } from "../rss-proxy/contract.ts";
import {
  discoverFeedLink,
  type FetchBudget,
  fetchDocument,
  type FetcherDeps,
} from "../rss-proxy/fetcher.ts";
import { normalizeFeedUrl } from "../rss-proxy/url-guard.ts";

const PUBLIC_DNS = (host: string) =>
  Promise.resolve(host === "rebind.example" ? ["10.0.0.7"] : ["93.184.216.34"]);

function budget(): FetchBudget {
  return { signal: new AbortController().signal, hops: 0 };
}

function deps(
  routes: Record<string, () => Response>,
  seen: Array<{ url: string; init: RequestInit }> = [],
): FetcherDeps {
  return {
    resolve: PUBLIC_DNS,
    fetch: (input, init) => {
      seen.push({ url: input, init });
      const route = routes[input];
      return route ? Promise.resolve(route()) : Promise.reject(new TypeError("connection refused"));
    },
  };
}

const xml = (body = "<rss/>", headers: Record<string, string> = {}) => () =>
  new Response(body, { headers: { "Content-Type": "application/rss+xml", ...headers } });

async function failure(promise: Promise<unknown>): Promise<string> {
  const error = await assertRejects(() => promise, FeedError);
  return error.code;
}

Deno.test("fetches with the fetcher user agent, manual redirects and validators", async () => {
  const seen: Array<{ url: string; init: RequestInit }> = [];
  const result = await fetchDocument(
    normalizeFeedUrl("https://example.com/feed"),
    { allowHtml: false, etag: '"v1"', lastModified: "Tue, 06 Oct 2026 00:00:00 GMT" },
    budget(),
    deps({ "https://example.com/feed": xml("<rss/>", { ETag: '"v2"' }) }, seen),
  );
  assertEquals(result.kind, "document");
  if (result.kind === "document") {
    assertEquals(result.etag, '"v2"');
    assertEquals(result.text, "<rss/>");
  }
  const headers = seen[0].init.headers as Record<string, string>;
  assertEquals(headers["User-Agent"], "MyLinkerFeedFetcher/1.0 (+https://mylinker.net)");
  assertEquals(headers["If-None-Match"], '"v1"');
  assertEquals(seen[0].init.redirect, "manual");
});

Deno.test("returns not_modified on 304 to a conditional request", async () => {
  const result = await fetchDocument(
    normalizeFeedUrl("https://example.com/feed"),
    { allowHtml: false, etag: '"v1"' },
    budget(),
    deps({ "https://example.com/feed": () => new Response(null, { status: 304 }) }),
  );
  assertEquals(result.kind, "not_modified");
});

Deno.test("follows up to three redirects and re-checks every hop", async () => {
  const redirect = (location: string) => () =>
    new Response(null, { status: 301, headers: { Location: location } });
  const ok = await fetchDocument(
    normalizeFeedUrl("https://example.com/a"),
    { allowHtml: false },
    budget(),
    deps({
      "https://example.com/a": redirect("/b"),
      "https://example.com/b": redirect("https://cdn.example.com/c"),
      "https://cdn.example.com/c": xml(),
    }),
  );
  assertEquals(ok.url.href, "https://cdn.example.com/c");

  assertEquals(
    await failure(fetchDocument(
      normalizeFeedUrl("https://example.com/1"),
      { allowHtml: false },
      budget(),
      deps({
        "https://example.com/1": redirect("/2"),
        "https://example.com/2": redirect("/3"),
        "https://example.com/3": redirect("/4"),
        "https://example.com/4": redirect("/5"),
      }),
    )),
    "fetch_failed",
  );

  for (
    const target of ["http://127.0.0.1/admin", "http://169.254.169.254/", "https://rebind.example/"]
  ) {
    assertEquals(
      await failure(fetchDocument(
        normalizeFeedUrl("https://example.com/feed"),
        { allowHtml: false },
        budget(),
        deps({ "https://example.com/feed": redirect(target) }),
      )),
      "blocked_address",
      target,
    );
  }
});

Deno.test("rejects non-feed content types, oversized bodies and failed responses", async () => {
  const url = normalizeFeedUrl("https://example.com/feed");
  const html = () => new Response("<html></html>", { headers: { "Content-Type": "text/html" } });
  assertEquals(
    await failure(fetchDocument(url, { allowHtml: false }, budget(), deps({ [url.href]: html }))),
    "not_feed",
  );
  const htmlAllowed = await fetchDocument(
    url,
    { allowHtml: true },
    budget(),
    deps({ [url.href]: html }),
  );
  assertEquals(htmlAllowed.kind === "document" && htmlAllowed.format, "html");

  const huge = () =>
    new Response(
      new ReadableStream({
        pull(controller) {
          controller.enqueue(new Uint8Array(256 * 1024));
        },
      }),
      { headers: { "Content-Type": "application/xml" } },
    );
  assertEquals(
    await failure(fetchDocument(url, { allowHtml: false }, budget(), deps({ [url.href]: huge }))),
    "too_large",
  );

  const declaredHuge = xml("<rss/>", { "Content-Length": String(2 * 1024 * 1024) });
  assertEquals(
    await failure(
      fetchDocument(url, { allowHtml: false }, budget(), deps({ [url.href]: declaredHuge })),
    ),
    "too_large",
  );

  const notFound = () =>
    new Response("missing", { status: 404, headers: { "Content-Type": "text/xml" } });
  assertEquals(
    await failure(
      fetchDocument(url, { allowHtml: false }, budget(), deps({ [url.href]: notFound })),
    ),
    "fetch_failed",
  );

  assertEquals(
    await failure(fetchDocument(url, { allowHtml: false }, budget(), deps({}))),
    "fetch_failed",
  );
});

Deno.test("maps an expired budget to timeout", async () => {
  const controller = new AbortController();
  controller.abort(new DOMException("time is up", "TimeoutError"));
  const slow: FetcherDeps = {
    resolve: PUBLIC_DNS,
    fetch: (_input, init) =>
      Promise.reject(init.signal?.reason ?? new DOMException("aborted", "AbortError")),
  };
  assertEquals(
    await failure(fetchDocument(
      normalizeFeedUrl("https://example.com/feed"),
      { allowHtml: false },
      { signal: controller.signal, hops: 0 },
      slow,
    )),
    "timeout",
  );
});

Deno.test("decodes using the declared charset", async () => {
  const bytes = new Uint8Array([0x3c, 0x61, 0x3e, 0xe9, 0x3c, 0x2f, 0x61, 0x3e]); // <a>é</a> in latin1
  const result = await fetchDocument(
    normalizeFeedUrl("https://example.com/feed"),
    { allowHtml: false },
    budget(),
    deps({
      "https://example.com/feed": () =>
        new Response(bytes, { headers: { "Content-Type": "text/xml; charset=iso-8859-1" } }),
    }),
  );
  assertEquals(result.kind === "document" && result.text, "<a>é</a>");
});

Deno.test("discoverFeedLink finds RSS or Atom alternates and ignores others", () => {
  const page = new URL("https://example.com/blog/");
  assertEquals(
    discoverFeedLink(
      `<head><link rel="stylesheet" href="/a.css">
       <link type="application/json" rel="alternate" href="/feed.json">
       <link rel='alternate' type='application/atom+xml' href='atom.xml?a=1&amp;b=2'></head>`,
      page,
    )?.href,
    "https://example.com/blog/atom.xml?a=1&b=2",
  );
  assertEquals(
    discoverFeedLink(`<link rel="alternate" type="application/rss+xml" href="javascript:x">`, page),
    null,
  );
  assertEquals(discoverFeedLink("<p>no feed</p>", page), null);
});
