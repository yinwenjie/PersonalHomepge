// Fixed, column-whitelisted reads for admin-read. Server-only.
// Table names, columns and ordering are constants here; nothing in a request can
// choose them. document_json is never selected.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import { AdminBackendError } from "./admin-auth.ts";
import { type AdminAuditAction, AdminRequestError } from "./admin-contract.ts";
import type { PagePosition } from "./admin-cursor.ts";

export interface PageQuery {
  /** Rows to fetch; callers ask for one more than the page size to detect a next page. */
  limit: number;
  after: PagePosition | null;
}

export interface ProfileRow {
  id: string;
  email: string | null;
  display_name: string | null;
  created_at: string;
}

export interface HomeSpaceRow {
  id: string;
  user_id: string;
  sync_space_id: string;
  name: string;
  access_mode: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
}

export interface SnapshotRow {
  id: string;
  revision: number;
  snapshot_source: string;
  content_fingerprint: string;
  summary: unknown;
  created_at: string;
}

export interface HomeAuditRow {
  id: string;
  home_space_id: string | null;
  event_type: string;
  severity: string;
  before_revision: number | null;
  after_revision: number | null;
  snapshot_id: string | null;
  summary_before: unknown;
  summary_after: unknown;
  metadata: unknown;
  created_at: string;
}

export interface AdminAuditRow {
  id: string;
  request_id: string;
  admin_user_id: string | null;
  admin_auth_user_id: string;
  admin_role: string;
  action: string;
  severity: string;
  reason: string;
  target_user_id: string | null;
  target_home_space_id: string | null;
  target_snapshot_id: string | null;
  result_count: number | null;
  created_at: string;
}

export interface AdminAuditFilters {
  /** Matches the retained admin_auth_user_id, which survives deletion of the admin_users row. */
  adminAuthUserId?: string;
  targetUserId?: string;
  targetHomeSpaceId?: string;
  action?: AdminAuditAction;
  createdFrom?: string;
  createdTo?: string;
}

export interface AdminReadStore {
  findProfileById(userId: string): Promise<ProfileRow | null>;
  findProfilesByEmail(email: string, limit: number): Promise<ProfileRow[]>;
  /**
   * Returns the Supabase Auth email for a user id, or null when the user does not exist.
   * profiles.email is user-editable, so this is the authoritative value.
   */
  getAuthEmail(userId: string): Promise<string | null>;
  findHomeSpace(homeSpaceId: string): Promise<HomeSpaceRow | null>;
  listHomeSpaces(userId: string, page: PageQuery): Promise<HomeSpaceRow[]>;
  listSnapshots(userId: string, homeSpaceId: string, page: PageQuery): Promise<SnapshotRow[]>;
  listHomeAuditEvents(
    userId: string,
    homeSpaceId: string | null,
    page: PageQuery,
  ): Promise<HomeAuditRow[]>;
  listAdminAuditEvents(filters: AdminAuditFilters, page: PageQuery): Promise<AdminAuditRow[]>;
}

const PROFILE_COLUMNS = "id, email, display_name, created_at";
const HOME_SPACE_COLUMNS =
  "id, user_id, sync_space_id, name, access_mode, is_default, created_at, updated_at, last_used_at";
const SNAPSHOT_COLUMNS = "id, revision, snapshot_source, content_fingerprint, summary, created_at";
const HOME_AUDIT_COLUMNS =
  "id, home_space_id, event_type, severity, before_revision, after_revision, snapshot_id, summary_before, summary_after, metadata, created_at";
const ADMIN_AUDIT_COLUMNS =
  "id, request_id, admin_user_id, admin_auth_user_id, admin_role, action, severity, reason, target_user_id, target_home_space_id, target_snapshot_id, result_count, created_at";

// Minimal structural view of a PostgREST filter builder, so keyset paging is written once.
interface Pageable<T> {
  or(filter: string): T;
  order(column: string, options: { ascending: boolean }): T;
  limit(count: number): T;
}

function applyPage<T extends Pageable<T>>(query: T, page: PageQuery): T {
  let next = query;
  if (page.after) {
    // Values are validated timestamp/UUID strings from decodeCursor; quoting keeps
    // the timestamp's ':' and '+' literal inside the PostgREST logic tree.
    const t = `"${page.after.createdAt}"`;
    next = next.or(`created_at.lt.${t},and(created_at.eq.${t},id.lt.${page.after.id})`);
  }
  return next.order("created_at", { ascending: false }).order("id", { ascending: false })
    .limit(page.limit);
}

function rowsOrThrow<T>(result: { data: unknown; error: unknown }): T[] {
  if (result.error) {
    throw new AdminBackendError("query");
  }
  return (result.data ?? []) as T[];
}

function rowOrThrow<T>(result: { data: unknown; error: unknown }): T | null {
  if (result.error) {
    throw new AdminBackendError("query");
  }
  return (result.data ?? null) as T | null;
}

export function createSupabaseAdminReadStore(client: SupabaseClient): AdminReadStore {
  return {
    async findProfileById(userId) {
      return rowOrThrow<ProfileRow>(
        await client.from("profiles").select(PROFILE_COLUMNS).eq("id", userId).maybeSingle(),
      );
    },

    async findProfilesByEmail(email, limit) {
      return rowsOrThrow<ProfileRow>(
        await client.from("profiles").select(PROFILE_COLUMNS).eq("email", email)
          .order("created_at", { ascending: false }).limit(limit),
      );
    },

    async getAuthEmail(userId) {
      const { data, error } = await client.auth.admin.getUserById(userId);
      if (error) {
        if (error.status === 404) {
          return null;
        }
        if (error.status === 429) {
          throw new AdminRequestError("rate_limited");
        }
        throw new AdminBackendError("query");
      }
      return data.user?.email?.toLowerCase() ?? null;
    },

    async findHomeSpace(homeSpaceId) {
      return rowOrThrow<HomeSpaceRow>(
        await client.from("home_spaces").select(HOME_SPACE_COLUMNS).eq("id", homeSpaceId)
          .maybeSingle(),
      );
    },

    async listHomeSpaces(userId, page) {
      return rowsOrThrow<HomeSpaceRow>(
        await applyPage(
          client.from("home_spaces").select(HOME_SPACE_COLUMNS).eq("user_id", userId),
          page,
        ),
      );
    },

    async listSnapshots(userId, homeSpaceId, page) {
      return rowsOrThrow<SnapshotRow>(
        await applyPage(
          client.from("home_space_snapshots").select(SNAPSHOT_COLUMNS)
            .eq("user_id", userId).eq("home_space_id", homeSpaceId),
          page,
        ),
      );
    },

    async listHomeAuditEvents(userId, homeSpaceId, page) {
      let query = client.from("home_space_audit_events").select(HOME_AUDIT_COLUMNS)
        .eq("user_id", userId);
      if (homeSpaceId) {
        query = query.eq("home_space_id", homeSpaceId);
      }
      return rowsOrThrow<HomeAuditRow>(await applyPage(query, page));
    },

    async listAdminAuditEvents(filters, page) {
      let query = client.from("admin_audit_events").select(ADMIN_AUDIT_COLUMNS);
      if (filters.adminAuthUserId) {
        query = query.eq("admin_auth_user_id", filters.adminAuthUserId);
      }
      if (filters.targetUserId) query = query.eq("target_user_id", filters.targetUserId);
      if (filters.targetHomeSpaceId) {
        query = query.eq("target_home_space_id", filters.targetHomeSpaceId);
      }
      if (filters.action) query = query.eq("action", filters.action);
      if (filters.createdFrom) query = query.gte("created_at", filters.createdFrom);
      if (filters.createdTo) query = query.lt("created_at", filters.createdTo);
      return rowsOrThrow<AdminAuditRow>(await applyPage(query, page));
    },
  };
}
