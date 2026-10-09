// Outbound fetch for rss-proxy: manual redirects with a fresh SSRF check per hop,
// one shared deadline, a streamed size cap and a content-type allowlist.
import {
  FeedError,
  FETCH_TIMEOUT_MS,
  MAX_REDIRECTS,
  MAX_RESPONSE_BODY_BYTES,
  USER_AGENT,
} from "./contract.ts";
import { decodeEntities } from "./feed-parser.ts";
import { checkFetchTarget, type DnsResolver, normalizeFeedUrl, withDeadline } from "./url-guard.ts";

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface FetcherDeps {
  fetch: FetchLike;
  resolve: DnsResolver;
}

export interface FetchBudget {
  /** Aborts every hop and body read once the request's total time is used up. */
  signal: AbortSignal;
  /** Redirects plus discovery hops already spent; shared across one feed request. */
  hops: number;
  /**
   * Called before every outbound request (first hop, each redirect, discovery) so the
   * global fetch limit counts network requests, not refreshes. Returns false when over.
   */
  charge?: () => Promise<boolean>;
}

/** The global outbound request budget ran out partway through a fetch. */
export class FetchRateLimited extends Error {
  constructor() {
    super("global fetch limit reached");
    this.name = "FetchRateLimited";
  }
}

export interface FetchOptions {
  allowHtml: boolean;
  etag?: string | null;
  lastModified?: string | null;
}

export type FetchedDocument =
  | { kind: "not_modified"; url: URL }
  | {
    kind: "document";
    url: URL;
    format: "xml" | "html";
    text: string;
    etag: string | null;
    lastModified: string | null;
  };

const XML_TYPES = new Set([
  "application/rss+xml",
  "application/atom+xml",
  "application/rdf+xml",
  "application/xml",
  "text/xml",
  "application/x-rss+xml",
  "application/feed+xml",
]);
const HTML_TYPES = new Set(["text/html", "application/xhtml+xml"]);
// Advertise every type the response check accepts, so strict content negotiation still works.
const FEED_ACCEPT = [...XML_TYPES].join(", ");
const DISCOVERY_ACCEPT = `${FEED_ACCEPT}, ${
  [...HTML_TYPES].map((type) => `${type};q=0.8`).join(", ")
}`;

export function newFetchBudget(): FetchBudget {
  return { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), hops: 0 };
}

export async function fetchDocument(
  start: URL,
  options: FetchOptions,
  budget: FetchBudget,
  deps: FetcherDeps,
): Promise<FetchedDocument> {
  let url = start;
  let conditional = true;

  while (true) {
    await checkFetchTarget(url, deps.resolve, budget.signal);
    if (budget.charge && !(await chargeWithinDeadline(budget))) {
      throw new FetchRateLimited();
    }

    const headers: Record<string, string> = {
      "User-Agent": USER_AGENT,
      "Accept": options.allowHtml ? DISCOVERY_ACCEPT : FEED_ACCEPT,
    };
    if (conditional && options.etag) {
      headers["If-None-Match"] = options.etag;
    }
    if (conditional && options.lastModified) {
      headers["If-Modified-Since"] = options.lastModified;
    }

    let response: Response;
    try {
      response = await deps.fetch(url.href, {
        method: "GET",
        headers,
        redirect: "manual",
        signal: budget.signal,
      });
    } catch (error) {
      throw fetchFailure(error, budget.signal);
    }

    if (response.status >= 300 && response.status < 400 && response.status !== 304) {
      await discard(response);
      const location = response.headers.get("Location");
      if (!location) {
        throw new FeedError("fetch_failed");
      }
      budget.hops += 1;
      if (budget.hops > MAX_REDIRECTS) {
        throw new FeedError("fetch_failed");
      }
      url = normalizeFeedUrl(location, url.href);
      // Validators belong to the original URL; a moved feed is fetched in full.
      conditional = false;
      continue;
    }

    if (response.status === 304 && conditional && (options.etag || options.lastModified)) {
      await discard(response);
      return { kind: "not_modified", url };
    }

    if (response.status < 200 || response.status >= 300) {
      await discard(response);
      throw new FeedError("fetch_failed");
    }

    const contentType = response.headers.get("Content-Type") ?? "";
    const mediaType = contentType.split(";")[0].trim().toLowerCase();
    let format: "xml" | "html";
    if (XML_TYPES.has(mediaType)) {
      format = "xml";
    } else if (options.allowHtml && HTML_TYPES.has(mediaType)) {
      format = "html";
    } else {
      await discard(response);
      throw new FeedError("not_feed");
    }

    const declared = Number(response.headers.get("Content-Length") ?? "0");
    if (declared > MAX_RESPONSE_BODY_BYTES) {
      await discard(response);
      throw new FeedError("too_large");
    }

    const bytes = await readCapped(response, budget.signal);
    return {
      kind: "document",
      url,
      format,
      text: decode(bytes, contentType),
      etag: limitHeader(response.headers.get("ETag"), 512),
      lastModified: limitHeader(response.headers.get("Last-Modified"), 128),
    };
  }
}

/** A charge that cannot finish in time is our outage, not the feed's: report it as unspendable. */
async function chargeWithinDeadline(budget: FetchBudget): Promise<boolean> {
  try {
    return await withDeadline(budget.charge!(), budget.signal);
  } catch (error) {
    if (error instanceof FeedError) {
      return false;
    }
    throw error;
  }
}

async function readCapped(response: Response, signal: AbortSignal): Promise<Uint8Array> {
  if (!response.body) {
    return new Uint8Array();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > MAX_RESPONSE_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        throw new FeedError("too_large");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof FeedError) {
      throw error;
    }
    await reader.cancel().catch(() => {});
    throw fetchFailure(error, signal);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Charset from the Content-Type header, then the XML declaration, then UTF-8. */
function decode(bytes: Uint8Array, contentType: string): string {
  const utf16 = detectUtf16(bytes);
  if (utf16) {
    return new TextDecoder(utf16).decode(bytes);
  }
  const headerCharset = /charset\s*=\s*"?([\w.:-]+)/i.exec(contentType)?.[1];
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 200));
  const declared = /^\s*<\?xml[^>]*encoding\s*=\s*["']([\w.:-]+)["']/i.exec(head)?.[1];
  for (const label of [headerCharset, declared, "utf-8"]) {
    if (!label) {
      continue;
    }
    try {
      return new TextDecoder(label).decode(bytes);
    } catch {
      // Unknown label: try the next one.
    }
  }
  return new TextDecoder().decode(bytes);
}

/** UTF-16 by BOM, or by a NUL-interleaved "<?" (XML 1.0 Appendix F); the BOM is dropped. */
function detectUtf16(bytes: Uint8Array): "utf-16le" | "utf-16be" | null {
  const [a, b, c, d] = bytes;
  if ((a === 0xff && b === 0xfe) || (a === 0x3c && b === 0x00 && c === 0x3f && d === 0x00)) {
    return "utf-16le";
  }
  if ((a === 0xfe && b === 0xff) || (a === 0x00 && b === 0x3c && c === 0x00 && d === 0x3f)) {
    return "utf-16be";
  }
  return null;
}

function limitHeader(value: string | null, max: number): string | null {
  return value && value.length <= max ? value : null;
}

async function discard(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => {});
}

function fetchFailure(error: unknown, signal: AbortSignal): FeedError {
  if (signal.aborted || (error instanceof DOMException && error.name === "TimeoutError")) {
    return new FeedError("timeout");
  }
  return new FeedError("fetch_failed");
}

/** Finds the first RSS or Atom alternate link in an HTML page. */
export function discoverFeedLink(html: string, pageUrl: URL): URL | null {
  // Links inside comments or raw-text elements are text, and links inside templates are
  // inert; none of them are document links.
  const markup = removeTemplates(
    html
      .slice(0, 512 * 1024)
      .replace(/<!--[\s\S]*?(?:-->|$)/g, " ")
      .replace(
        /<(script|style|noscript|textarea|title|xmp|iframe|noembed|noframes)\b[\s\S]*?(?:<\/\1\s*>|$)/gi,
        " ",
      ),
  );

  // The first <base> that has an href sets the URL that relative links resolve against;
  // <base> elements without one (such as <base target>) are skipped, as browsers do.
  let base = pageUrl.href;
  for (const baseTag of startTags(markup, "base")) {
    const baseHref = parseAttributes(baseTag).get("href");
    if (baseHref === undefined) {
      continue;
    }
    try {
      base = new URL(decodeAttribute(baseHref), pageUrl.href).href;
    } catch {
      // An unusable base is ignored, as browsers do.
    }
    break;
  }

  for (const tag of startTags(markup, "link")) {
    const attributes = parseAttributes(tag);
    const rel = (attributes.get("rel") ?? "").toLowerCase().split(/\s+/);
    const type = (attributes.get("type") ?? "").toLowerCase().trim();
    const href = attributes.get("href");
    if (
      !rel.includes("alternate") ||
      (type !== "application/rss+xml" && type !== "application/atom+xml") ||
      !href
    ) {
      continue;
    }
    try {
      return normalizeFeedUrl(decodeAttribute(href), base);
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Removes <template> elements, counting nesting so an inner </template> does not end the
 * outer one. An unclosed template runs to the end of the markup. One forward pass.
 */
function removeTemplates(markup: string): string {
  const tag = /<(\/?)template(?=[\s/>])/gi;
  let kept = "";
  let copied = 0;
  let depth = 0;
  let start = 0;
  for (let match = tag.exec(markup); match; match = tag.exec(markup)) {
    if (!match[1]) {
      if (depth === 0) {
        start = match.index;
      }
      depth += 1;
    } else if (depth > 0) {
      depth -= 1;
      if (depth === 0) {
        const end = markup.indexOf(">", tag.lastIndex);
        if (end < 0) {
          return kept + markup.slice(copied, start);
        }
        kept += markup.slice(copied, start) + " ";
        copied = end + 1;
        tag.lastIndex = copied;
      }
    }
  }
  return depth > 0 ? kept + markup.slice(copied, start) : kept + markup.slice(copied);
}

/**
 * Yields each <name ...> start tag. A ">" inside a quoted attribute value does not end the
 * tag, as in HTML. One forward pass: the search resumes after each tag, so hostile markup
 * cannot make this quadratic. An unterminated tag ends the scan, as browsers drop it.
 */
function* startTags(markup: string, name: string): Generator<string> {
  // Searched case-insensitively in place: lowercasing a copy can shift indexes for some
  // non-ASCII characters.
  const opener = new RegExp(`<${name}`, "gi");
  let from = 0;
  while (true) {
    opener.lastIndex = from;
    const start = opener.exec(markup)?.index ?? -1;
    if (start < 0) {
      return;
    }
    let index = start + name.length + 1;
    if (index < markup.length && !/[\s/>]/.test(markup[index])) {
      from = index; // a longer tag name such as <linker>
      continue;
    }
    let quote = "";
    for (; index < markup.length; index += 1) {
      const char = markup[index];
      if (quote) {
        if (char === quote) {
          quote = "";
        }
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === ">") {
        break;
      }
    }
    if (index >= markup.length) {
      return;
    }
    yield markup.slice(start, index + 1);
    from = index + 1;
  }
}

function parseAttributes(tag: string): Map<string, string> {
  const attributes = new Map<string, string>();
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  for (const match of tag.matchAll(pattern)) {
    const name = match[1].toLowerCase();
    if (!attributes.has(name)) {
      attributes.set(name, match[2] ?? match[3] ?? match[4] ?? "");
    }
  }
  return attributes;
}

/** Attribute values carry HTML character references (&amp;, &#038;, &#x26;, ...). */
function decodeAttribute(value: string): string {
  return decodeEntities(value).trim();
}
