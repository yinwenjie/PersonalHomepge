// Phase 1.18 admin-read request/response contract.
// Server-only module: it must never be imported by browser code in this repository.

export const ADMIN_API_VERSION = 1;

/** Maximum accepted request body, in bytes. */
export const MAX_REQUEST_BYTES = 8 * 1024;
/** Maximum serialized success response, in bytes. Larger results fail instead of being truncated. */
export const MAX_RESPONSE_BYTES = 256 * 1024;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;
export const MAX_CURSOR_LENGTH = 512;

export const ADMIN_ROLES = ["owner", "admin", "support"] as const;
export type AdminRole = typeof ADMIN_ROLES[number];

export const ADMIN_OPERATIONS = [
  "get-admin-context",
  "resolve-user",
  "list-home-spaces",
  "list-snapshots",
  "preview-snapshot",
  "list-home-audit-events",
  "list-admin-audit-events",
  "list-users",
  "get-stats",
] as const;
export type AdminOperation = typeof ADMIN_OPERATIONS[number];

/** Audit action written for each operation; mirrors admin_audit_events_action_valid. */
export const OPERATION_AUDIT_ACTIONS: Record<AdminOperation, AdminAuditAction> = {
  "get-admin-context": "admin.session.check",
  "resolve-user": "admin.user.resolve",
  "list-home-spaces": "admin.home_space.list",
  "list-snapshots": "admin.snapshot.list",
  "preview-snapshot": "admin.snapshot.preview",
  "list-home-audit-events": "admin.home_audit.list",
  "list-admin-audit-events": "admin.audit.list",
  "list-users": "admin.user.list",
  "get-stats": "admin.stats.read",
};

export type AdminAuditAction =
  | "admin.session.check"
  | "admin.user.resolve"
  | "admin.home_space.list"
  | "admin.snapshot.list"
  | "admin.snapshot.preview"
  | "admin.home_audit.list"
  | "admin.audit.list"
  | "admin.user.list"
  | "admin.stats.read";

/**
 * Role matrix from Phase1_18_Implement.md 1.18.3 (list-users and get-stats added
 * 2026-10-10). The role always comes from admin_users.
 */
export const OPERATION_ROLES: Record<AdminOperation, readonly AdminRole[]> = {
  "get-admin-context": ["owner", "admin", "support"],
  "resolve-user": ["owner", "admin", "support"],
  "list-home-spaces": ["owner", "admin", "support"],
  "list-snapshots": ["owner", "admin", "support"],
  "preview-snapshot": ["owner", "admin"],
  "list-home-audit-events": ["owner", "admin", "support"],
  "list-admin-audit-events": ["owner", "admin"],
  "list-users": ["owner", "admin"],
  "get-stats": ["owner", "admin", "support"],
};

export function isOperationAllowed(operation: AdminOperation, role: AdminRole): boolean {
  return OPERATION_ROLES[operation].includes(role);
}

/** Fixed reason recorded for get-admin-context; must equal the database constraint value. */
export const SESSION_CHECK_REASON = "System administrator context check.";

export const ADMIN_ERROR_STATUS = {
  invalid_request: 400,
  not_authenticated: 401,
  not_authorized: 403,
  not_found: 404,
  rate_limited: 429,
  audit_failed: 500,
  service_unavailable: 503,
} as const;
export type AdminErrorCode = keyof typeof ADMIN_ERROR_STATUS;

export interface AdminSuccessEnvelope<T> {
  ok: true;
  apiVersion: typeof ADMIN_API_VERSION;
  requestId: string;
  data: T;
  nextCursor: string | null;
}

export interface AdminErrorEnvelope {
  ok: false;
  apiVersion: typeof ADMIN_API_VERSION;
  requestId: string;
  error: AdminErrorCode;
}

export class AdminRequestError extends Error {
  constructor(readonly code: AdminErrorCode) {
    super(code);
    this.name = "AdminRequestError";
  }
}

export interface AdminReadRequest {
  operation: AdminOperation;
  /** Trimmed manual reason; null only for get-admin-context. */
  reason: string | null;
  filters: Record<string, unknown>;
  cursor: string | null;
}

const REQUEST_KEYS = new Set(["operation", "reason", "filters", "cursor"]);

/**
 * Strictly parses a request body. Unknown keys, unknown operations, a reason on
 * get-admin-context, or a missing/unsafe reason elsewhere are all invalid_request.
 * Operation-specific filter validation happens in the operation handler.
 */
export function parseAdminReadRequest(body: unknown): AdminReadRequest {
  if (!isPlainObject(body)) {
    throw new AdminRequestError("invalid_request");
  }

  for (const key of Object.keys(body)) {
    if (!REQUEST_KEYS.has(key)) {
      throw new AdminRequestError("invalid_request");
    }
  }

  const operation = body.operation;
  if (typeof operation !== "string" || !ADMIN_OPERATIONS.includes(operation as AdminOperation)) {
    throw new AdminRequestError("invalid_request");
  }

  const filters = body.filters ?? {};
  if (!isPlainObject(filters)) {
    throw new AdminRequestError("invalid_request");
  }

  const cursor = body.cursor ?? null;
  if (cursor !== null && (typeof cursor !== "string" || cursor.length > MAX_CURSOR_LENGTH)) {
    throw new AdminRequestError("invalid_request");
  }

  let reason: string | null = null;
  if (operation === "get-admin-context") {
    if (body.reason !== undefined) {
      throw new AdminRequestError("invalid_request");
    }
  } else {
    if (typeof body.reason !== "string") {
      throw new AdminRequestError("invalid_request");
    }
    reason = body.reason.trim();
    // The session reason is reserved for admin.session.check by the 019 constraint.
    if (!isSafeReason(reason) || reason === SESSION_CHECK_REASON) {
      throw new AdminRequestError("invalid_request");
    }
  }

  return { operation: operation as AdminOperation, reason, filters, cursor };
}

// These mirror admin_audit_events_reason_no_sensitive_shape in 019 so a bad reason is
// rejected before any data is read instead of failing at the audit insert.
const EMAIL_SHAPE = /[\p{L}\p{N}_.%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/iu;
const URL_SHAPE = /(https?:\/\/|www\.)/i;
const JWT_SHAPE =
  /(^|[^A-Za-z0-9_-])[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}([^A-Za-z0-9_-]|$)/;
const SYNC_CODE_SHAPE = /(^|[^\p{L}\p{N}_])hp1_\S+/iu;
const SECRET_ASSIGNMENT_SHAPE = /(bearer|token|secret|authorization|sync[ _-]?code)\s*[:=]\s*\S+/i;

/** Returns true when an already-trimmed reason is 8-500 characters and has no sensitive shape. */
export function isSafeReason(reason: string): boolean {
  const length = [...reason].length;
  if (length < 8 || length > 500) {
    return false;
  }

  return !EMAIL_SHAPE.test(reason) &&
    !URL_SHAPE.test(reason) &&
    !JWT_SHAPE.test(reason) &&
    !SYNC_CODE_SHAPE.test(reason) &&
    !SECRET_ASSIGNMENT_SHAPE.test(reason);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns the lowercase canonical UUID, or throws invalid_request. */
export function parseUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new AdminRequestError("invalid_request");
  }

  return value.toLowerCase();
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
