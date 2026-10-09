// Read-only admin-read operations (Phase 1.18.3). Every handler validates its own
// strict filters, reads through the fixed AdminReadStore, and projects rows into
// whitelisted DTOs. preview-snapshot projects one stored document through
// snapshot-preview.ts (Phase 1.18.5).
import type { AdminAuditMetadata } from "../_shared/admin-audit.ts";
import {
  ADMIN_OPERATIONS,
  type AdminAuditAction,
  type AdminOperation,
  AdminRequestError,
  DEFAULT_PAGE_SIZE,
  isPlainObject,
  MAX_PAGE_SIZE,
  OPERATION_AUDIT_ACTIONS,
  parseUuid,
} from "../_shared/admin-contract.ts";
import {
  decodeCursor,
  encodeCursor,
  isTimestamp,
  type PagePosition,
} from "../_shared/admin-cursor.ts";
import type {
  AdminAuditFilters,
  AdminAuditRow,
  AdminReadStore,
  HomeAuditRow,
  HomeSpaceRow,
  ProfileRow,
  SnapshotRow,
} from "../_shared/admin-read-store.ts";
import type { OperationContext, OperationHandler, OperationResult } from "./handler.ts";
import {
  type AdminSnapshotPreviewDocument,
  MAX_PREVIEW_DOCUMENT_BYTES,
  projectSnapshotPreview,
  type SnapshotPreviewResult,
} from "./snapshot-preview.ts";

export const MAX_RESOLVED_USERS = 20;
const MAX_EMAIL_LENGTH = 320;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ResolvedUserDto {
  userId: string;
  email: string | null;
  displayName: string | null;
  /** Profile creation time; null when the user has no profile row. */
  createdAt: string | null;
}

export interface HomeSpaceDto {
  id: string;
  userId: string;
  name: string;
  accessMode: string;
  syncSpaceId: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
}

/** Counts and flags only; the document title and timestamps inside the stored summary are dropped. */
export interface SnapshotSummaryDto {
  groupCount: number | null;
  siteCount: number | null;
  widgetCount: number | null;
  themePresetId: string | null;
  hasBanner: boolean | null;
  hasBackground: boolean | null;
}

export interface SnapshotDto {
  id: string;
  revision: number;
  source: string;
  summary: SnapshotSummaryDto;
  /**
   * First 12 hex characters of SHA-256 over the stored fingerprint, never the fingerprint
   * itself; computed in the database by migration 023.
   */
  fingerprintDigest: string;
  createdAt: string;
}

export interface SnapshotPreviewDto {
  snapshot: { id: string; revision: number; source: string; createdAt: string };
  /** ok: document is set. unsupported: not a version 2 document. too_large: not loaded. */
  status: SnapshotPreviewResult["status"];
  /** Some text, items or groups were cut to the preview limits. */
  truncated: boolean;
  document: AdminSnapshotPreviewDocument | null;
}

export interface HomeAuditEventDto {
  id: string;
  homeSpaceId: string | null;
  eventType: string;
  severity: string;
  beforeRevision: number | null;
  afterRevision: number | null;
  snapshotId: string | null;
  summaryBefore: SnapshotSummaryDto | null;
  summaryAfter: SnapshotSummaryDto | null;
  metadata: { snapshotSource?: string; snapshotSaved?: boolean };
  createdAt: string;
}

export interface AdminAuditEventDto {
  id: string;
  requestId: string;
  adminUserId: string | null;
  adminAuthUserId: string;
  adminRole: string;
  action: string;
  severity: string;
  reason: string;
  targetUserId: string | null;
  targetHomeSpaceId: string | null;
  targetSnapshotId: string | null;
  resultCount: number | null;
  createdAt: string;
}

const SNAPSHOT_SOURCES = new Set([
  "account-managed-created",
  "cloud-baseline",
  "after-cloud-push",
  "after-cloud-force-push",
]);

// home_space_audit_events.event_type has no database constraint (the browser inserts
// some rows), so only the values its producers write pass through: the 013 RPCs and
// src/infrastructure/cloud-home-snapshot-repository.ts.
const HOME_AUDIT_EVENT_TYPES = new Set([
  "account_managed.created",
  "account_managed.migrated",
  "cloud_snapshot.baseline_created",
  "cloud_snapshot.restored_to_local",
  "sync.account_managed_force_push",
  "sync.account_managed_push",
  "sync.account_managed_push_conflict",
]);

const ADMIN_AUDIT_ACTIONS = new Set<string>(
  ADMIN_OPERATIONS.map((operation) => OPERATION_AUDIT_ACTIONS[operation]),
);

export function createReadOperations(
  store: AdminReadStore,
): Partial<Record<AdminOperation, OperationHandler>> {
  return {
    "resolve-user": (context) => resolveUser(store, context),
    "list-home-spaces": (context) => listHomeSpaces(store, context),
    "list-snapshots": (context) => listSnapshots(store, context),
    "preview-snapshot": (context) => previewSnapshot(store, context),
    "list-home-audit-events": (context) => listHomeAuditEvents(store, context),
    "list-admin-audit-events": (context) => listAdminAuditEvents(store, context),
  };
}

async function resolveUser(
  store: AdminReadStore,
  { request }: OperationContext,
): Promise<OperationResult> {
  const filters = readFilters(request.filters, ["userId", "email", "homeSpaceId"], []);
  const given = Object.keys(filters);
  if (given.length !== 1 || request.cursor !== null) {
    throw new AdminRequestError("invalid_request");
  }

  // profiles.email is editable by its owner, so email search runs against auth.users
  // (migration 020) and every DTO email comes from Auth, never the profile copy.
  let userIds: string[];
  let knownEmail: string | null = null;
  if (filters.userId !== undefined) {
    userIds = [parseUuid(filters.userId)];
  } else if (filters.email !== undefined) {
    knownEmail = parseEmail(filters.email);
    userIds = await store.findAuthUserIdsByEmail(knownEmail);
  } else {
    const space = await store.findHomeSpace(parseUuid(filters.homeSpaceId));
    userIds = space ? [space.user_id] : [];
  }

  const users: ResolvedUserDto[] = [];
  for (const userId of userIds.slice(0, MAX_RESOLVED_USERS)) {
    const authEmail = knownEmail ?? await store.getAuthEmail(userId);
    if (knownEmail === null && authEmail === null) {
      continue;
    }
    const profile = await store.findProfileById(userId);
    users.push(toResolvedUser(userId, authEmail, profile));
  }
  return {
    data: { users },
    audit: {
      severity: "info",
      targetUserId: users.length === 1 ? users[0].userId : null,
      resultCount: users.length,
      metadata: { result_status: users.length ? "ok" : "empty" },
    },
  };
}

async function listHomeSpaces(
  store: AdminReadStore,
  { request }: OperationContext,
): Promise<OperationResult> {
  const filters = readFilters(request.filters, ["userId", "pageSize"], ["userId"]);
  const userId = parseUuid(filters.userId);
  const scope = `list-home-spaces:${userId}`;
  const page = readPage(filters.pageSize, request.cursor, scope);

  const rows = await store.listHomeSpaces(userId, { limit: page.size + 1, after: page.after });
  const { items, nextCursor } = paginate(rows, page.size, scope);
  return {
    data: { homeSpaces: items.map(toHomeSpace) },
    nextCursor,
    audit: {
      severity: "info",
      targetUserId: userId,
      resultCount: items.length,
      metadata: pageMetadata(page.after, items.length),
    },
  };
}

async function listSnapshots(
  store: AdminReadStore,
  { request }: OperationContext,
): Promise<OperationResult> {
  const filters = readFilters(
    request.filters,
    ["userId", "homeSpaceId", "pageSize"],
    ["userId", "homeSpaceId"],
  );
  const userId = parseUuid(filters.userId);
  const homeSpaceId = parseUuid(filters.homeSpaceId);
  const scope = `list-snapshots:${userId}:${homeSpaceId}`;
  const page = readPage(filters.pageSize, request.cursor, scope);

  // The space must belong to the target user and be account-managed; anything else is
  // indistinguishable from a space that does not exist.
  const space = await store.findHomeSpace(homeSpaceId);
  if (!space || space.user_id !== userId || space.access_mode !== "account-managed") {
    throw new AdminRequestError("not_found");
  }

  const rows = await store.listSnapshots(userId, homeSpaceId, {
    limit: page.size + 1,
    after: page.after,
  });
  const { items, nextCursor } = paginate(rows, page.size, scope);
  return {
    data: { snapshots: items.map(toSnapshot) },
    nextCursor,
    audit: {
      severity: "info",
      targetUserId: userId,
      targetHomeSpaceId: homeSpaceId,
      targetSyncSpaceId: space.sync_space_id,
      resultCount: items.length,
      metadata: { ...pageMetadata(page.after, items.length), access_mode: "account-managed" },
    },
  };
}

async function previewSnapshot(
  store: AdminReadStore,
  { request }: OperationContext,
): Promise<OperationResult> {
  const filters = readFilters(
    request.filters,
    ["userId", "homeSpaceId", "snapshotId"],
    ["userId", "homeSpaceId", "snapshotId"],
  );
  if (request.cursor !== null) {
    throw new AdminRequestError("invalid_request");
  }
  const userId = parseUuid(filters.userId);
  const homeSpaceId = parseUuid(filters.homeSpaceId);
  const snapshotId = parseUuid(filters.snapshotId);

  // Re-verify the whole chain on the server; the client's earlier list result proves nothing.
  const space = await store.findHomeSpace(homeSpaceId);
  if (!space || space.user_id !== userId || space.access_mode !== "account-managed") {
    throw new AdminRequestError("not_found");
  }
  const row = await store.readSnapshotDocument(
    userId,
    homeSpaceId,
    snapshotId,
    MAX_PREVIEW_DOCUMENT_BYTES,
  );
  if (!row) {
    throw new AdminRequestError("not_found");
  }

  const preview: SnapshotPreviewResult = row.document_json === null
    ? { status: "too_large", truncated: false, document: null }
    : projectSnapshotPreview(row.document_json);
  const data: SnapshotPreviewDto = {
    snapshot: {
      id: row.id,
      revision: row.revision,
      source: SNAPSHOT_SOURCES.has(row.snapshot_source) ? row.snapshot_source : "other",
      createdAt: row.created_at,
    },
    status: preview.status,
    truncated: preview.truncated,
    document: preview.document,
  };
  return {
    data,
    audit: {
      // Reading a user's full home content is the most sensitive admin action.
      severity: "warning",
      targetUserId: userId,
      targetHomeSpaceId: homeSpaceId,
      targetSyncSpaceId: space.sync_space_id,
      targetSnapshotId: snapshotId,
      resultCount: preview.document ? 1 : 0,
      metadata: {
        access_mode: "account-managed",
        result_status: preview.document ? "ok" : "empty",
      },
    },
  };
}

async function listHomeAuditEvents(
  store: AdminReadStore,
  { request }: OperationContext,
): Promise<OperationResult> {
  const filters = readFilters(request.filters, ["userId", "homeSpaceId", "pageSize"], ["userId"]);
  const userId = parseUuid(filters.userId);
  const homeSpaceId = filters.homeSpaceId === undefined ? null : parseUuid(filters.homeSpaceId);
  const scope = `list-home-audit-events:${userId}:${homeSpaceId ?? "*"}`;
  const page = readPage(filters.pageSize, request.cursor, scope);

  const rows = await store.listHomeAuditEvents(userId, homeSpaceId, {
    limit: page.size + 1,
    after: page.after,
  });
  const { items, nextCursor } = paginate(rows, page.size, scope);
  return {
    data: { events: items.map(toHomeAuditEvent) },
    nextCursor,
    audit: {
      severity: "info",
      targetUserId: userId,
      targetHomeSpaceId: homeSpaceId,
      resultCount: items.length,
      metadata: pageMetadata(page.after, items.length),
    },
  };
}

async function listAdminAuditEvents(
  store: AdminReadStore,
  { request }: OperationContext,
): Promise<OperationResult> {
  const filters = readFilters(
    request.filters,
    [
      "adminAuthUserId",
      "targetUserId",
      "targetHomeSpaceId",
      "action",
      "createdFrom",
      "createdTo",
      "pageSize",
    ],
    [],
  );

  const query: AdminAuditFilters = {};
  if (filters.adminAuthUserId !== undefined) {
    query.adminAuthUserId = parseUuid(filters.adminAuthUserId);
  }
  if (filters.targetUserId !== undefined) query.targetUserId = parseUuid(filters.targetUserId);
  if (filters.targetHomeSpaceId !== undefined) {
    query.targetHomeSpaceId = parseUuid(filters.targetHomeSpaceId);
  }
  if (filters.action !== undefined) {
    if (typeof filters.action !== "string" || !ADMIN_AUDIT_ACTIONS.has(filters.action)) {
      throw new AdminRequestError("invalid_request");
    }
    query.action = filters.action as AdminAuditAction;
  }
  if (filters.createdFrom !== undefined) query.createdFrom = parseTimestamp(filters.createdFrom);
  if (filters.createdTo !== undefined) query.createdTo = parseTimestamp(filters.createdTo);
  if (
    query.createdFrom && query.createdTo &&
    toEpochMicros(query.createdFrom) >= toEpochMicros(query.createdTo)
  ) {
    throw new AdminRequestError("invalid_request");
  }

  // Cursors are bound to a digest of the exact filter set so a page cannot be continued under
  // other filters, while the cursor stays well under MAX_CURSOR_LENGTH.
  const scope = `list-admin-audit-events:${await sha256Hex(JSON.stringify(query), 16)}`;
  const page = readPage(filters.pageSize, request.cursor, scope);
  const rows = await store.listAdminAuditEvents(query, {
    limit: page.size + 1,
    after: page.after,
  });
  const { items, nextCursor } = paginate(rows, page.size, scope);
  return {
    data: { events: items.map(toAdminAuditEvent) },
    nextCursor,
    audit: {
      severity: "info",
      targetUserId: query.targetUserId ?? null,
      targetHomeSpaceId: query.targetHomeSpaceId ?? null,
      resultCount: items.length,
      metadata: pageMetadata(page.after, items.length),
    },
  };
}

function readFilters(
  filters: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
): Record<string, unknown> {
  for (const key of Object.keys(filters)) {
    if (!allowed.includes(key)) {
      throw new AdminRequestError("invalid_request");
    }
  }
  for (const key of required) {
    if (filters[key] === undefined) {
      throw new AdminRequestError("invalid_request");
    }
  }
  return filters;
}

function readPage(
  pageSize: unknown,
  cursor: string | null,
  scope: string,
): { size: number; after: PagePosition | null } {
  let size = DEFAULT_PAGE_SIZE;
  if (pageSize !== undefined) {
    if (
      typeof pageSize !== "number" || !Number.isInteger(pageSize) || pageSize < 1 ||
      pageSize > MAX_PAGE_SIZE
    ) {
      throw new AdminRequestError("invalid_request");
    }
    size = pageSize;
  }
  return { size, after: decodeCursor(cursor, scope) };
}

function paginate<T extends { id: string; created_at: string }>(
  rows: T[],
  size: number,
  scope: string,
): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, size);
  const last = items[items.length - 1];
  const nextCursor = rows.length > size && last
    ? encodeCursor(scope, { createdAt: last.created_at, id: last.id })
    : null;
  return { items, nextCursor };
}

function pageMetadata(after: PagePosition | null, count: number): AdminAuditMetadata {
  return { page_direction: after ? "next" : "initial", result_status: count ? "ok" : "empty" };
}

function parseEmail(value: unknown): string {
  if (typeof value !== "string") {
    throw new AdminRequestError("invalid_request");
  }
  const email = value.trim().toLowerCase();
  if (email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    throw new AdminRequestError("invalid_request");
  }
  return email;
}

/** Microseconds since the epoch, keeping the full fraction that Date.parse would round off. */
function toEpochMicros(timestamp: string): number {
  const fraction = /\.(\d{1,6})/.exec(timestamp)?.[1] ?? "";
  const millis = Date.parse(timestamp.replace(/\.\d{1,6}/, ""));
  return millis * 1000 + Number(fraction.padEnd(6, "0"));
}

function parseTimestamp(value: unknown): string {
  if (!isTimestamp(value)) {
    throw new AdminRequestError("invalid_request");
  }
  return value;
}

function toResolvedUser(
  userId: string,
  authEmail: string | null,
  profile: ProfileRow | null,
): ResolvedUserDto {
  return {
    userId,
    email: authEmail,
    displayName: profile?.display_name ?? null,
    createdAt: profile?.created_at ?? null,
  };
}

function toHomeSpace(row: HomeSpaceRow): HomeSpaceDto {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    accessMode: row.access_mode,
    syncSpaceId: row.sync_space_id,
    isDefault: row.is_default,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at,
  };
}

function toSnapshot(row: SnapshotRow): SnapshotDto {
  return {
    id: row.id,
    revision: row.revision,
    source: SNAPSHOT_SOURCES.has(row.snapshot_source) ? row.snapshot_source : "other",
    summary: toSummary(row.summary) ?? emptySummary(),
    fingerprintDigest: FINGERPRINT_DIGEST_PATTERN.test(row.fingerprint_digest)
      ? row.fingerprint_digest
      : "",
    createdAt: row.created_at,
  };
}

function toHomeAuditEvent(row: HomeAuditRow): HomeAuditEventDto {
  const metadata: HomeAuditEventDto["metadata"] = {};
  if (isPlainObject(row.metadata)) {
    // RPC rows use snapshotSource; browser-written rows use source.
    const source = row.metadata.snapshotSource ?? row.metadata.source;
    if (typeof source === "string" && SNAPSHOT_SOURCES.has(source)) {
      metadata.snapshotSource = source;
    }
    if (typeof row.metadata.snapshotSaved === "boolean") {
      metadata.snapshotSaved = row.metadata.snapshotSaved;
    }
  }

  return {
    id: row.id,
    homeSpaceId: row.home_space_id,
    eventType: HOME_AUDIT_EVENT_TYPES.has(row.event_type) ? row.event_type : "other",
    severity: row.severity,
    beforeRevision: row.before_revision,
    afterRevision: row.after_revision,
    snapshotId: row.snapshot_id,
    summaryBefore: toSummary(row.summary_before),
    summaryAfter: toSummary(row.summary_after),
    metadata,
    createdAt: row.created_at,
  };
}

function toAdminAuditEvent(row: AdminAuditRow): AdminAuditEventDto {
  return {
    id: row.id,
    requestId: row.request_id,
    adminUserId: row.admin_user_id,
    adminAuthUserId: row.admin_auth_user_id,
    adminRole: row.admin_role,
    action: row.action,
    severity: row.severity,
    reason: row.reason,
    targetUserId: row.target_user_id,
    targetHomeSpaceId: row.target_home_space_id,
    targetSnapshotId: row.target_snapshot_id,
    resultCount: row.result_count,
    createdAt: row.created_at,
  };
}

const THEME_PRESET_PATTERN = /^[a-z0-9-]{1,40}$/;
const FINGERPRINT_DIGEST_PATTERN = /^[0-9a-f]{12}$/;

function toSummary(value: unknown): SnapshotSummaryDto | null {
  if (!isPlainObject(value)) {
    return null;
  }
  const count = (key: string) => {
    const n = value[key];
    return typeof n === "number" && Number.isInteger(n) && n >= 0 ? n : null;
  };
  const flag = (key: string) => typeof value[key] === "boolean" ? value[key] as boolean : null;
  const theme = value.themePresetId;
  return {
    groupCount: count("groupCount"),
    siteCount: count("siteCount"),
    widgetCount: count("widgetCount"),
    themePresetId: typeof theme === "string" && THEME_PRESET_PATTERN.test(theme) ? theme : null,
    hasBanner: flag("hasBanner"),
    hasBackground: flag("hasBackground"),
  };
}

function emptySummary(): SnapshotSummaryDto {
  return {
    groupCount: null,
    siteCount: null,
    widgetCount: null,
    themePresetId: null,
    hasBanner: null,
    hasBackground: null,
  };
}

async function sha256Hex(value: string, bytes: number): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(hash).slice(0, bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
