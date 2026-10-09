// admin-read request pipeline (Phase 1.18.2). The order of steps is fixed by
// docs/implementation/phase-1/Phase1_18_Implement.md and must not be rearranged.
import {
  ADMIN_API_VERSION,
  ADMIN_ERROR_STATUS,
  type AdminErrorCode,
  type AdminErrorEnvelope,
  type AdminOperation,
  type AdminReadRequest,
  AdminRequestError,
  type AdminSuccessEnvelope,
  isOperationAllowed,
  MAX_REQUEST_BYTES,
  MAX_RESPONSE_BYTES,
  OPERATION_AUDIT_ACTIONS,
  parseAdminReadRequest,
  SESSION_CHECK_REASON,
} from "../_shared/admin-contract.ts";
import {
  type AdminAuthPort,
  type AuthenticatedAdmin,
  readBearerToken,
} from "../_shared/admin-auth.ts";
import type { AdminAuditEntry, AdminAuditPort } from "../_shared/admin-audit.ts";
import { corsHeaders, isAllowedOrigin } from "../_shared/cors.ts";

export interface OperationContext {
  requestId: string;
  admin: AuthenticatedAdmin;
  request: AdminReadRequest;
}

export interface OperationResult {
  data: unknown;
  nextCursor?: string | null;
  /** Audit row written before the result is returned; requestId and admin are filled in. */
  audit: Omit<AdminAuditEntry, "requestId" | "admin" | "action" | "reason">;
}

export type OperationHandler = (context: OperationContext) => Promise<OperationResult>;

export interface AdminReadDeps {
  allowedOrigins: ReadonlySet<string>;
  auth: AdminAuthPort;
  audit: AdminAuditPort;
  operations: Partial<Record<AdminOperation, OperationHandler>>;
  newRequestId?: () => string;
  /** Receives only request id, operation and outcome; never request or response content. */
  log?: (entry: { requestId: string; operation: string | null; outcome: string }) => void;
}

/** Operations that need no data store. operations.ts adds the read-only queries. */
export const BASE_OPERATIONS: Partial<Record<AdminOperation, OperationHandler>> = {
  "get-admin-context": getAdminContext,
};

function getAdminContext({ admin }: OperationContext): Promise<OperationResult> {
  return Promise.resolve({
    data: { role: admin.role },
    audit: { severity: "info", resultCount: null, metadata: { result_status: "ok" } },
  });
}

export async function handleAdminRead(request: Request, deps: AdminReadDeps): Promise<Response> {
  const requestId = (deps.newRequestId ?? (() => crypto.randomUUID()))();
  const log = deps.log ?? (() => {});
  let operation: string | null = null;

  // 1-2. Method and origin. Disallowed origins get no CORS headers at all.
  const origin = request.headers.get("Origin");
  if (!isAllowedOrigin(origin, deps.allowedOrigins)) {
    log({ requestId, operation, outcome: "origin_rejected" });
    return errorResponse(requestId, "not_authorized", null);
  }

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (request.method !== "POST") {
    log({ requestId, operation, outcome: "method_rejected" });
    return errorResponse(requestId, "invalid_request", origin);
  }

  try {
    // 3. Supabase session from the Authorization header only.
    const accessToken = readBearerToken(request.headers.get("Authorization"));
    if (!accessToken) {
      throw new AdminRequestError("not_authenticated");
    }

    const authUserId = await deps.auth.verifyAccessToken(accessToken);
    if (!authUserId) {
      throw new AdminRequestError("not_authenticated");
    }

    // 4. Enabled administrator, looked up server-side.
    const admin = await deps.auth.findEnabledAdmin(authUserId);
    if (!admin) {
      throw new AdminRequestError("not_authorized");
    }

    // 5. Strict body parsing.
    const parsed = parseAdminReadRequest(await readJsonBody(request));
    operation = parsed.operation;

    // 6. Role matrix with the server-side role.
    if (!isOperationAllowed(parsed.operation, admin.role)) {
      throw new AdminRequestError("not_authorized");
    }

    const handler = deps.operations[parsed.operation];
    if (!handler) {
      throw new AdminRequestError("invalid_request");
    }

    // 7. Whitelisted query and DTO.
    const result = await handler({ requestId, admin, request: parsed });
    const body: AdminSuccessEnvelope<unknown> = {
      ok: true,
      apiVersion: ADMIN_API_VERSION,
      requestId,
      data: result.data,
      nextCursor: result.nextCursor ?? null,
    };
    const serialized = JSON.stringify(body);
    if (new TextEncoder().encode(serialized).byteLength > MAX_RESPONSE_BYTES) {
      throw new AdminRequestError("service_unavailable");
    }

    // 8. Audit before returning anything; failure means no data leaves the function.
    try {
      await deps.audit.record({
        ...result.audit,
        requestId,
        admin,
        action: OPERATION_AUDIT_ACTIONS[parsed.operation],
        reason: parsed.reason ?? SESSION_CHECK_REASON,
      });
    } catch {
      throw new AdminRequestError("audit_failed");
    }

    // 9. Safe envelope.
    log({ requestId, operation, outcome: "ok" });
    return jsonResponse(serialized, 200, origin);
  } catch (error) {
    // AdminBackendError and anything unexpected surface only as service_unavailable.
    const code: AdminErrorCode = error instanceof AdminRequestError
      ? error.code
      : "service_unavailable";
    log({ requestId, operation, outcome: code });
    return errorResponse(requestId, code, origin);
  }
}

async function readJsonBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!/^application\/json(\s*;|$)/i.test(contentType)) {
    throw new AdminRequestError("invalid_request");
  }

  const declaredLength = Number(request.headers.get("Content-Length") ?? "0");
  if (declaredLength > MAX_REQUEST_BYTES) {
    throw new AdminRequestError("invalid_request");
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_REQUEST_BYTES) {
    throw new AdminRequestError("invalid_request");
  }

  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new AdminRequestError("invalid_request");
  }
}

function errorResponse(requestId: string, code: AdminErrorCode, origin: string | null): Response {
  const body: AdminErrorEnvelope = {
    ok: false,
    apiVersion: ADMIN_API_VERSION,
    requestId,
    error: code,
  };
  return jsonResponse(JSON.stringify(body), ADMIN_ERROR_STATUS[code], origin);
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
