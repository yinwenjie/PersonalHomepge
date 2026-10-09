// rss-proxy request and response contract (Phase 2.2).
// docs/implementation/phase-2/Phase2_2_RssWidgetDesign.md section 4 is the source of truth.

export const MAX_REQUEST_BYTES = 8 * 1024;
export const MAX_READ_FEEDS = 5;
export const MAX_URL_LENGTH = 2048;

export const MAX_ITEMS_PER_FEED = 20;
export const MAX_ITEMS_BYTES = 64 * 1024;
export const MAX_TITLE_LENGTH = 200;
export const MAX_SUMMARY_LENGTH = 240;

export const MAX_RESPONSE_BODY_BYTES = 1024 * 1024;
export const FETCH_TIMEOUT_MS = 8_000;
export const MAX_REDIRECTS = 3;
export const USER_AGENT = "MyLinkerFeedFetcher/1.0 (+https://mylinker.net)";

export const FRESH_MS = 30 * 60 * 1000;
export const STALE_LIMIT_MS = 7 * 24 * 60 * 60 * 1000;
export const BACKOFF_MS = [30, 60, 120, 240, 360].map((minutes) => minutes * 60 * 1000);
export const LEASE_SECONDS = 60;
export const PENDING_POLL_MS = 500;
export const PENDING_WAIT_MS = 8_000;

export const RATE_LIMITS = {
  perIp: { windowSeconds: 600, limit: 60 },
  perIpCheck: { windowSeconds: 600, limit: 20 },
  globalFetch: { windowSeconds: 60, limit: 300 },
} as const;

export type RssMode = "read" | "check";

export type FeedErrorCode =
  | "invalid_url"
  | "blocked_address"
  | "not_feed"
  | "fetch_failed"
  | "timeout"
  | "too_large"
  | "rate_limited";

/** Error codes a fetch attempt can leave in rss_feed_cache.error_code. */
export type StoredFeedErrorCode = Exclude<FeedErrorCode, "invalid_url" | "rate_limited">;

export type FeedStatus = "ok" | "stale" | "pending" | "error";

export type RequestErrorCode =
  | "invalid_request"
  | "origin_rejected"
  | "rate_limited"
  | "service_unavailable";

export const REQUEST_ERROR_STATUS: Record<RequestErrorCode, number> = {
  invalid_request: 400,
  origin_rejected: 403,
  rate_limited: 429,
  service_unavailable: 503,
};

export interface FeedItem {
  id: string;
  title: string;
  link: string;
  publishedAt: string | null;
  summary: string;
}

export interface ParsedFeed {
  title: string | null;
  siteUrl: string | null;
  items: FeedItem[];
}

export interface FeedResult {
  /** read: the URL exactly as requested. check: the feed URL the client should save. */
  url: string;
  status: FeedStatus;
  errorCode?: FeedErrorCode;
  fetchedAt: string | null;
  title: string | null;
  siteUrl: string | null;
  items: FeedItem[];
  /** check only: the feed was found through an HTML page's alternate link. */
  discovered?: boolean;
}

export interface RssRequest {
  mode: RssMode;
  feeds: string[];
}

export class FeedError extends Error {
  constructor(readonly code: StoredFeedErrorCode | "invalid_url") {
    super(code);
    this.name = "FeedError";
  }
}

export class RssRequestError extends Error {
  constructor(readonly code: RequestErrorCode) {
    super(code);
    this.name = "RssRequestError";
  }
}

/** Strict body validation: exactly { mode, feeds }, nothing else. */
export function parseRssRequest(body: unknown): RssRequest {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new RssRequestError("invalid_request");
  }

  const record = body as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 2 || !keys.includes("mode") || !keys.includes("feeds")) {
    throw new RssRequestError("invalid_request");
  }

  const { mode, feeds } = record;
  if (mode !== "read" && mode !== "check") {
    throw new RssRequestError("invalid_request");
  }

  if (!Array.isArray(feeds)) {
    throw new RssRequestError("invalid_request");
  }

  const max = mode === "read" ? MAX_READ_FEEDS : 1;
  if (feeds.length < 1 || feeds.length > max) {
    throw new RssRequestError("invalid_request");
  }

  for (const feed of feeds) {
    if (typeof feed !== "string" || feed.trim().length === 0 || feed.length > MAX_URL_LENGTH) {
      throw new RssRequestError("invalid_request");
    }
  }

  return { mode, feeds: feeds as string[] };
}
