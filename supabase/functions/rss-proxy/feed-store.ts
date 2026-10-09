// Storage port for rss-proxy and its service-role Supabase implementation.
// Only this function reads or writes rss_feed_cache and rss_rate_limits.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import type { FeedItem, StoredFeedErrorCode } from "./contract.ts";

export interface CachedFeed {
  urlHash: string;
  feedUrl: string;
  status: "pending" | "ok" | "error";
  errorCode: StoredFeedErrorCode | null;
  title: string | null;
  siteUrl: string | null;
  items: FeedItem[];
  etag: string | null;
  lastModified: string | null;
  failureCount: number;
  /** Epoch ms of the last successful fetch, or null if there never was one. */
  fetchedAt: number | null;
  nextFetchAt: number;
}

export type FeedUpdate = Omit<CachedFeed, "urlHash" | "feedUrl">;

export interface FeedStore {
  getFeeds(urlHashes: string[]): Promise<Map<string, CachedFeed>>;
  /**
   * rss_claim_refresh: a lease token only for the one caller allowed to fetch a due feed
   * now, otherwise null.
   */
  claimRefresh(urlHash: string, feedUrl: string): Promise<string | null>;
  /** Writes a fetch result and clears the lease, only while `token` still holds it. */
  finishRefresh(urlHash: string, token: string, update: FeedUpdate): Promise<void>;
  /** Clears the lease, only while `token` still holds it. */
  releaseLease(urlHash: string, token: string): Promise<void>;
  /**
   * check mode: caches a feed found by checking a pasted URL when it has no row yet, or
   * replaces a failed row nobody is refreshing. Healthy or leased rows are left alone.
   */
  saveChecked(urlHash: string, feedUrl: string, update: FeedUpdate): Promise<void>;
  /** Bumps last_requested_at, at most once a day per feed, so cleanup keeps used feeds. */
  touch(urlHashes: string[], olderThan: number): Promise<void>;
  consumeRate(bucketKey: string, windowSeconds: number, limit: number): Promise<boolean>;
  deleteStale(): Promise<void>;
}

export class FeedStoreError extends Error {
  constructor(operation: string) {
    super(`rss feed store ${operation} failed`);
    this.name = "FeedStoreError";
  }
}

const COLUMNS =
  "url_hash, feed_url, status, error_code, title, site_url, items, etag, last_modified, failure_count, fetched_at, next_fetch_at";

interface CacheRow {
  url_hash: string;
  feed_url: string;
  status: CachedFeed["status"];
  error_code: StoredFeedErrorCode | null;
  title: string | null;
  site_url: string | null;
  items: FeedItem[] | null;
  etag: string | null;
  last_modified: string | null;
  failure_count: number;
  fetched_at: string | null;
  next_fetch_at: string;
}

export function createSupabaseFeedStore(client: SupabaseClient): FeedStore {
  const table = () => client.from("rss_feed_cache");

  return {
    async getFeeds(urlHashes) {
      const feeds = new Map<string, CachedFeed>();
      if (urlHashes.length === 0) {
        return feeds;
      }
      const { data, error } = await table().select(COLUMNS).in("url_hash", urlHashes);
      if (error) {
        throw new FeedStoreError("read");
      }
      for (const row of (data ?? []) as CacheRow[]) {
        feeds.set(row.url_hash, fromRow(row));
      }
      return feeds;
    },

    async claimRefresh(urlHash, feedUrl) {
      const { data, error } = await client.rpc("rss_claim_refresh", {
        p_url_hash: urlHash,
        p_feed_url: feedUrl,
        p_lease_seconds: 60,
      });
      if (error) {
        throw new FeedStoreError("claim");
      }
      return typeof data === "string" ? data : null;
    },

    async finishRefresh(urlHash, token, update) {
      // A holder whose lease expired and was taken over matches no row and writes nothing.
      const { error } = await table()
        .update({ ...toRow(update), refresh_lease_until: null, refresh_lease_token: null })
        .eq("url_hash", urlHash)
        .eq("refresh_lease_token", token);
      if (error) {
        throw new FeedStoreError("finish");
      }
    },

    async releaseLease(urlHash, token) {
      const { error } = await table()
        .update({ refresh_lease_until: null, refresh_lease_token: null })
        .eq("url_hash", urlHash)
        .eq("refresh_lease_token", token);
      if (error) {
        throw new FeedStoreError("release");
      }
    },

    async saveChecked(urlHash, feedUrl, update) {
      const row = { ...toRow(update), last_requested_at: new Date().toISOString() };
      // A new feed is inserted. An existing row belongs to read-mode refreshes, except one
      // stuck in failure backoff with nobody refreshing it: a successful check replaces that.
      const inserted = await table().upsert(
        { url_hash: urlHash, feed_url: feedUrl, ...row },
        { onConflict: "url_hash", ignoreDuplicates: true },
      );
      if (inserted.error) {
        throw new FeedStoreError("save");
      }
      // Clearing the token also stops a holder whose lease expired from overwriting this.
      const replaced = await table()
        .update({ ...row, refresh_lease_until: null, refresh_lease_token: null })
        .eq("url_hash", urlHash)
        .eq("status", "error")
        .or(`refresh_lease_until.is.null,refresh_lease_until.lt."${new Date().toISOString()}"`);
      if (replaced.error) {
        throw new FeedStoreError("save");
      }
    },

    async touch(urlHashes, olderThan) {
      if (urlHashes.length === 0) {
        return;
      }
      const { error } = await table()
        .update({ last_requested_at: new Date().toISOString() })
        .in("url_hash", urlHashes)
        .lt("last_requested_at", new Date(olderThan).toISOString());
      if (error) {
        throw new FeedStoreError("touch");
      }
    },

    async consumeRate(bucketKey, windowSeconds, limit) {
      const { data, error } = await client.rpc("rss_consume_rate", {
        p_bucket_key: bucketKey,
        p_window_seconds: windowSeconds,
        p_limit: limit,
      });
      if (error) {
        throw new FeedStoreError("rate");
      }
      return data === true;
    },

    async deleteStale() {
      const { error } = await client.rpc("delete_stale_rss_feed_cache", { p_unused_days: 30 });
      if (error) {
        throw new FeedStoreError("cleanup");
      }
    },
  };
}

function fromRow(row: CacheRow): CachedFeed {
  return {
    urlHash: row.url_hash,
    feedUrl: row.feed_url,
    status: row.status,
    errorCode: row.error_code,
    title: row.title,
    siteUrl: row.site_url,
    items: Array.isArray(row.items) ? row.items : [],
    etag: row.etag,
    lastModified: row.last_modified,
    failureCount: row.failure_count,
    fetchedAt: row.fetched_at === null ? null : Date.parse(row.fetched_at),
    nextFetchAt: Date.parse(row.next_fetch_at),
  };
}

function toRow(update: FeedUpdate) {
  return {
    status: update.status,
    error_code: update.errorCode,
    title: update.title,
    site_url: update.siteUrl,
    items: update.items,
    etag: update.etag,
    last_modified: update.lastModified,
    failure_count: update.failureCount,
    fetched_at: update.fetchedAt === null ? null : new Date(update.fetchedAt).toISOString(),
    next_fetch_at: new Date(update.nextFetchAt).toISOString(),
  };
}
