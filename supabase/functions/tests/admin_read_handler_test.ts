import { assert, assertEquals } from "jsr:@std/assert@1.0.14";
import type { AdminAuditEntry } from "../_shared/admin-audit.ts";
import { AdminBackendError, type AuthenticatedAdmin } from "../_shared/admin-auth.ts";
import { resolveAllowedOrigins } from "../_shared/cors.ts";
import {
  type AdminReadDeps,
  BASE_OPERATIONS,
  handleAdminRead,
  type OperationHandler,
} from "../admin-read/handler.ts";

const ORIGIN = "https://admin.mylinker.net";
const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const OWNER: AuthenticatedAdmin = {
  adminId: "22222222-2222-4222-8222-222222222222",
  authUserId: "33333333-3333-4333-8333-333333333333",
  role: "owner",
};
const SUPPORT: AuthenticatedAdmin = { ...OWNER, role: "support" };

interface Harness {
  deps: AdminReadDeps;
  audits: AdminAuditEntry[];
  calls: string[];
}

function harness(options: {
  admin?: AuthenticatedAdmin | null;
  tokenValid?: boolean;
  authDown?: boolean;
  auditFails?: boolean;
  operations?: AdminReadDeps["operations"];
} = {}): Harness {
  const audits: AdminAuditEntry[] = [];
  const calls: string[] = [];
  const deps: AdminReadDeps = {
    allowedOrigins: resolveAllowedOrigins(undefined),
    newRequestId: () => REQUEST_ID,
    operations: options.operations ?? BASE_OPERATIONS,
    auth: {
      verifyAccessToken(token) {
        calls.push("verify");
        if (options.authDown) {
          return Promise.reject(new AdminBackendError("auth"));
        }
        return Promise.resolve(
          options.tokenValid === false || token !== "valid.jwt.token" ? null : OWNER.authUserId,
        );
      },
      findEnabledAdmin() {
        calls.push("admin");
        return Promise.resolve(options.admin === undefined ? OWNER : options.admin);
      },
    },
    audit: {
      record(entry) {
        calls.push("audit");
        if (options.auditFails) {
          return Promise.reject(new Error("insert failed"));
        }
        audits.push(entry);
        return Promise.resolve();
      },
    },
  };
  return { deps, audits, calls };
}

function post(body: unknown, init: { origin?: string | null; token?: string | null } = {}) {
  const headers = new Headers({ "Content-Type": "application/json" });
  const origin = init.origin === undefined ? ORIGIN : init.origin;
  if (origin) headers.set("Origin", origin);
  const token = init.token === undefined ? "valid.jwt.token" : init.token;
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return new Request("http://localhost/admin-read", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function expectError(response: Response, status: number, code: string) {
  assertEquals(response.status, status);
  const body = await response.json();
  assertEquals(body, { ok: false, apiVersion: 1, requestId: REQUEST_ID, error: code });
  assertEquals(response.headers.get("Cache-Control"), "no-store, private");
}

Deno.test("get-admin-context returns the server-side role and writes one session audit", async () => {
  const { deps, audits } = harness();
  const response = await handleAdminRead(post({ operation: "get-admin-context" }), deps);

  assertEquals(response.status, 200);
  assertEquals(response.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assertEquals(await response.json(), {
    ok: true,
    apiVersion: 1,
    requestId: REQUEST_ID,
    data: { role: "owner" },
    nextCursor: null,
  });
  assertEquals(audits.length, 1);
  assertEquals(audits[0].action, "admin.session.check");
  assertEquals(audits[0].reason, "System administrator context check.");
  assertEquals(audits[0].requestId, REQUEST_ID);
  assertEquals(audits[0].admin, OWNER);
});

Deno.test("preflight from an allowed origin gets CORS headers and no auth work", async () => {
  const { deps, calls } = harness();
  const response = await handleAdminRead(
    new Request("http://localhost/admin-read", { method: "OPTIONS", headers: { Origin: ORIGIN } }),
    deps,
  );

  assertEquals(response.status, 204);
  assertEquals(response.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assertEquals(response.headers.get("Access-Control-Allow-Methods"), "POST, OPTIONS");
  assertEquals(calls, []);
});

Deno.test("public product origins, unknown origins and missing origin are refused before auth", async () => {
  for (
    const origin of [
      "https://mylinker.net",
      "https://yinwenjie.github.io",
      "https://evil.example",
      null,
    ]
  ) {
    const { deps, calls } = harness();
    const response = await handleAdminRead(
      post({ operation: "get-admin-context" }, { origin }),
      deps,
    );
    await expectError(response, 403, "not_authorized");
    assertEquals(response.headers.get("Access-Control-Allow-Origin"), null);
    assertEquals(calls, []);
  }
});

Deno.test("non-POST methods are invalid_request", async () => {
  const { deps, calls } = harness();
  const response = await handleAdminRead(
    new Request("http://localhost/admin-read", { method: "GET", headers: { Origin: ORIGIN } }),
    deps,
  );
  await expectError(response, 400, "invalid_request");
  assertEquals(calls, []);
});

Deno.test("missing, malformed or rejected tokens are not_authenticated", async () => {
  for (const token of [null, "has spaces", "forged.jwt.token"]) {
    const { deps, audits } = harness();
    await expectError(
      await handleAdminRead(post({ operation: "get-admin-context" }, { token }), deps),
      401,
      "not_authenticated",
    );
    assertEquals(audits.length, 0);
  }
});

Deno.test("signed-in users without an enabled admin row are not_authorized", async () => {
  const { deps, audits, calls } = harness({ admin: null });
  await expectError(
    await handleAdminRead(post({ operation: "get-admin-context" }), deps),
    403,
    "not_authorized",
  );
  assertEquals(calls, ["verify", "admin"]);
  assertEquals(audits.length, 0);
});

Deno.test("auth outage is service_unavailable without leaking details", async () => {
  const { deps } = harness({ authDown: true });
  await expectError(
    await handleAdminRead(post({ operation: "get-admin-context" }), deps),
    503,
    "service_unavailable",
  );
});

Deno.test("strict body parsing rejects unknown fields, operations and bad bodies", async () => {
  const bodies: unknown[] = [
    { operation: "get-admin-context", role: "owner" },
    { operation: "get-admin-context", reason: "checking my own access" },
    { operation: "list-everything", reason: "checking a support ticket" },
    { operation: "get-admin-context", filters: [] },
    { operation: "get-admin-context", cursor: 5 },
    ["get-admin-context"],
    "{not json",
    JSON.stringify({ operation: "get-admin-context", padding: "x".repeat(9000) }),
  ];

  for (const body of bodies) {
    const { deps, audits } = harness();
    await expectError(await handleAdminRead(post(body), deps), 400, "invalid_request");
    assertEquals(audits.length, 0);
  }
});

Deno.test("non-JSON content type is invalid_request", async () => {
  const { deps } = harness();
  const request = new Request("http://localhost/admin-read", {
    method: "POST",
    headers: {
      Origin: ORIGIN,
      Authorization: "Bearer valid.jwt.token",
      "Content-Type": "text/plain",
    },
    body: JSON.stringify({ operation: "get-admin-context" }),
  });
  await expectError(await handleAdminRead(request, deps), 400, "invalid_request");
});

Deno.test("operations outside the role matrix are not_authorized even with a handler", async () => {
  let ran = false;
  const preview: OperationHandler = () => {
    ran = true;
    return Promise.resolve({ data: {}, audit: { severity: "danger" } });
  };
  const { deps, audits } = harness({ admin: SUPPORT, operations: { "preview-snapshot": preview } });
  await expectError(
    await handleAdminRead(
      post({ operation: "preview-snapshot", reason: "support ticket 4821 review", filters: {} }),
      deps,
    ),
    403,
    "not_authorized",
  );
  assertEquals(ran, false);
  assertEquals(audits.length, 0);
});

Deno.test("known operations without a handler yet are invalid_request", async () => {
  const { deps } = harness();
  await expectError(
    await handleAdminRead(
      post({ operation: "resolve-user", reason: "support ticket 4821 review", filters: {} }),
      deps,
    ),
    400,
    "invalid_request",
  );
});

Deno.test("audit failure fails closed and returns no data", async () => {
  const { deps } = harness({ auditFails: true });
  const response = await handleAdminRead(post({ operation: "get-admin-context" }), deps);
  await expectError(response, 500, "audit_failed");
});

Deno.test("oversized results are refused instead of truncated, and nothing is audited", async () => {
  const huge: OperationHandler = () =>
    Promise.resolve({ data: "x".repeat(300 * 1024), audit: { severity: "info" } });
  const { deps, audits } = harness({ operations: { "get-admin-context": huge } });
  await expectError(
    await handleAdminRead(post({ operation: "get-admin-context" }), deps),
    503,
    "service_unavailable",
  );
  assertEquals(audits.length, 0);
});

Deno.test("the log hook only ever sees request id, operation and outcome", async () => {
  const entries: Record<string, unknown>[] = [];
  const { deps } = harness();
  deps.log = (entry) => entries.push(entry);
  await handleAdminRead(post({ operation: "get-admin-context" }), deps);
  await handleAdminRead(
    post({ operation: "get-admin-context" }, { token: "forged.jwt.token" }),
    deps,
  );

  assertEquals(entries, [
    { requestId: REQUEST_ID, operation: "get-admin-context", outcome: "ok" },
    { requestId: REQUEST_ID, operation: null, outcome: "not_authenticated" },
  ]);
  assert(!JSON.stringify(entries).includes("jwt"));
});
