// Fixed, column-whitelisted reads for admin-read. Server-only.
// Table names, columns and ordering are constants here; nothing in a request can
// choose them. document_json is read only by readSnapshotDocument, for preview-snapshot,
// which projects it before anything is returned. Profiles, snapshots and user-side
// audit events are read through the migration 023 functions, which bound every
// user-writable column in the database before it reaches this function. The user
// directory and statistics come from the migration 025 functions, which mask emails and
// return counts only.
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
  /** At most 80 characters (migration 023). */
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
  /** First 12 hex characters of SHA-256 over content_fingerprint, computed in the database. */
  fingerprint_digest: string;
  /** Already reduced to the six summary fields by admin_project_snapshot_summary. */
  summary: unknown;
  created_at: string;
}

export interface SnapshotDocumentRow {
  id: string;
  revision: number;
  snapshot_source: string;
  created_at: string;
  document_bytes: number;
  /** Null when the stored document is larger than the requested maximum (migration 024). */
  document_json: unknown;
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

/** One row of the masked user directory (migration 025). */
export interface UserDirectoryRow {
  id: string;
  /** First character of the local part plus the domain; never the full address. */
  masked_email: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  home_space_count: number;
  account_managed_space_count: number;
  sync_code_space_count: number;
  snapshot_count: number;
  last_snapshot_at: string | null;
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
  /** Auth user ids whose Auth email equals an already-normalized email (migration 020). */
  findAuthUserIdsByEmail(email: string): Promise<string[]>;
  /**
   * Returns the Supabase Auth email for a user id, or null when the user does not exist.
   * profiles.email is user-editable, so this is the authoritative value.
   */
  getAuthEmail(userId: string): Promise<string | null>;
  findHomeSpace(homeSpaceId: string): Promise<HomeSpaceRow | null>;
  listHomeSpaces(userId: string, page: PageQuery): Promise<HomeSpaceRow[]>;
  listSnapshots(userId: string, homeSpaceId: string, page: PageQuery): Promise<SnapshotRow[]>;
  /**
   * One account-managed snapshot of the given user and space, or null. The document is
   * only loaded when it is at most maxBytes; the caller projects it and never returns it.
   */
  readSnapshotDocument(
    userId: string,
    homeSpaceId: string,
    snapshotId: string,
    maxBytes: number,
  ): Promise<SnapshotDocumentRow | null>;
  listHomeAuditEvents(
    userId: string,
    homeSpaceId: string | null,
    page: PageQuery,
  ): Promise<HomeAuditRow[]>;
  listAdminAuditEvents(filters: AdminAuditFilters, page: PageQuery): Promise<AdminAuditRow[]>;
  /** Users newest first with masked emails and counts only (migration 025). */
  listUsers(page: PageQuery): Promise<UserDirectoryRow[]>;
  /** Aggregate counts as built by admin_read_stats (migration 025); validated by the caller. */
  readStats(): Promise<unknown>;
}

const HOME_SPACE_COLUMNS =
  "id, user_id, sync_space_id, name, access_mode, is_default, created_at, updated_at, last_used_at";
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

/** Keyset arguments shared by the migration 023 list functions. */
function pageArgs(page: PageQuery) {
  return {
    p_after_created_at: page.after?.createdAt ?? null,
    p_after_id: page.after?.id ?? null,
    p_limit: page.limit,
  };
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
      const rows = rowsOrThrow<ProfileRow>(
        await client.rpc("admin_read_profile", { p_user_id: userId }),
      );
      return rows[0] ?? null;
    },

    async findAuthUserIdsByEmail(email) {
      const rows = rowsOrThrow<{ user_id: string }>(
        await client.rpc("admin_find_auth_user_ids_by_email", { p_email: email }),
      );
      return rows.map((row) => row.user_id);
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
        await client.rpc("admin_list_snapshots", {
          p_user_id: userId,
          p_home_space_id: homeSpaceId,
          ...pageArgs(page),
        }),
      );
    },

    async readSnapshotDocument(userId, homeSpaceId, snapshotId, maxBytes) {
      const rows = rowsOrThrow<SnapshotDocumentRow>(
        await client.rpc("admin_read_snapshot_document", {
          p_user_id: userId,
          p_home_space_id: homeSpaceId,
          p_snapshot_id: snapshotId,
          p_max_bytes: maxBytes,
        }),
      );
      return rows[0] ?? null;
    },

    async listHomeAuditEvents(userId, homeSpaceId, page) {
      return rowsOrThrow<HomeAuditRow>(
        await client.rpc("admin_list_home_audit_events", {
          p_user_id: userId,
          p_home_space_id: homeSpaceId,
          ...pageArgs(page),
        }),
      );
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

    async listUsers(page) {
      return rowsOrThrow<UserDirectoryRow>(await client.rpc("admin_list_users", pageArgs(page)));
    },

    async readStats() {
      const { data, error } = await client.rpc("admin_read_stats");
      if (error) {
        throw new AdminBackendError("query");
      }
      return data;
    },
  };
}
