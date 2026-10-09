// rss-proxy request pipeline: origin, method, client rate limit, strict body, per-feed work.
// Usable without sign-in (the anon key passes verify_jwt); the defenses are the rate limits,
// the shared cache and the fetch rules, not the caller's identity.
import {
  MAX_REQUEST_BYTES,
  parseRssRequest,
  REQUEST_ERROR_STATUS,
  type RequestErrorCode,
  RssRequestError,
} from "./contract.ts";
import {
  checkFeed,
  enforceCheckRate,
  enforceClientRate,
  maybeCleanup,
  readFeeds,
  type RssServiceDeps,
  type ServiceOutcome,
} from "./service.ts";
import { ipLiteral } from "./url-guard.ts";
import { corsHeaders } from "../_shared/cors.ts";

export interface RssLogEntry {
  requestId: string;
  mode: string | null;
  feedCount: number;
  cacheHits: number;
  errorCodes: string[];
  latencyMs: number;
  outcome: string;
}

export interface RssProxyDeps extends RssServiceDeps {
  isAllowedOrigin: (origin: string | null) => origin is string;
  /** Keyed hash of the caller's IP; never the IP itself. */
  clientKey: (request: Request) => Promise<string>;
  newRequestId?: () => string;
  /** Receives counts and error codes only: no URLs, IPs or feed identifiers. */
  log?: (entry: RssLogEntry) => void;
}

const PRODUCTION_ORIGINS = new Set([
  "https://mylinker.net",
  "https://www.mylinker.net",
  // The Cloudflare Pages production alias, also used as the documented fallback URL.
  "https://personalhomepge.pages.dev",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);
const PREVIEW_ORIGIN = /^https:\/\/[a-z0-9-]{1,63}\.personalhomepge\.pages\.dev$/;

/** The product site, its Cloudflare Pages alias and previews, and local dev. Not GitHub Pages. */
export function isRssOriginAllowed(origin: string | null): origin is string {
  return origin !== null && (PRODUCTION_ORIGINS.has(origin) || PREVIEW_ORIGIN.test(origin));
}

/**
 * The address the rate limits key on: CF-Connecting-IP, which Cloudflare (in front of the
 * Supabase gateway) sets to the caller's address. X-Forwarded-For is not used: the go-live
 * probe showed its last entry is a gateway hop, and other headers such as X-Client-IP pass a
 * forged value through. Anything that is not an IP literal shares one strict "unknown"
 * bucket. Phase2_2_RssWidgetDesign.md records the probe and the go-live check.
 */
export function clientAddress(request: Request): string {
  const value = (request.headers.get("CF-Connecting-IP") ?? "").trim();
  return ipLiteral(value) ? value.toLowerCase() : "unknown";
}

export async function handleRssProxy(request: Request, deps: RssProxyDeps): Promise<Response> {
  const started = performance.now();
  const requestId = (deps.newRequestId ?? (() => crypto.randomUUID()))();
  const log = (entry: Omit<RssLogEntry, "requestId" | "latencyMs">) =>
    deps.log?.({ requestId, latencyMs: Math.round(performance.now() - started), ...entry });
  let mode: string | null = null;

  const origin = request.headers.get("Origin");
  if (!deps.isAllowedOrigin(origin)) {
    log({ mode, feedCount: 0, cacheHits: 0, errorCodes: [], outcome: "origin_rejected" });
    return errorResponse("origin_rejected", null);
  }

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  try {
    if (request.method !== "POST") {
      throw new RssRequestError("invalid_request");
    }

    const clientKey = await deps.clientKey(request);
    await enforceClientRate(deps.store, clientKey);

    const parsed = parseRssRequest(await readJsonBody(request));
    mode = parsed.mode;
    if (parsed.mode === "check") {
      await enforceCheckRate(deps.store, clientKey);
    }

    const outcome: ServiceOutcome = parsed.mode === "read"
      ? await readFeeds(parsed.feeds, deps)
      : await checkFeed(parsed.feeds[0], deps);
    await maybeCleanup(deps);

    log({
      mode,
      feedCount: parsed.feeds.length,
      cacheHits: outcome.cacheHits,
      errorCodes: outcome.feeds.flatMap((feed) => feed.errorCode ? [feed.errorCode] : []),
      outcome: "ok",
    });
    return jsonResponse(JSON.stringify({ feeds: outcome.feeds }), 200, origin);
  } catch (error) {
    const code: RequestErrorCode = error instanceof RssRequestError
      ? error.code
      : "service_unavailable";
    log({ mode, feedCount: 0, cacheHits: 0, errorCodes: [], outcome: code });
    return errorResponse(code, origin);
  }
}

async function readJsonBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!/^application\/json(\s*;|$)/i.test(contentType)) {
    throw new RssRequestError("invalid_request");
  }

  const declaredLength = Number(request.headers.get("Content-Length") ?? "0");
  if (declaredLength > MAX_REQUEST_BYTES) {
    throw new RssRequestError("invalid_request");
  }

  const bytes = await readLimitedBody(request);
  if (bytes.byteLength === 0) {
    throw new RssRequestError("invalid_request");
  }

  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new RssRequestError("invalid_request");
  }
}

/** Reads at most MAX_REQUEST_BYTES, cancelling the stream as soon as it goes over. */
async function readLimitedBody(request: Request): Promise<Uint8Array> {
  if (!request.body) {
    return new Uint8Array();
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > MAX_REQUEST_BYTES) {
      await reader.cancel().catch(() => {});
      throw new RssRequestError("invalid_request");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function errorResponse(code: RequestErrorCode, origin: string | null): Response {
  return jsonResponse(JSON.stringify({ error: code }), REQUEST_ERROR_STATUS[code], origin);
}

function jsonResponse(body: string, status: number, origin: string | null): Response {
  return new Response(body, {
    status,
    headers: {
      ...(origin ? corsHeaders(origin) : {}),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
