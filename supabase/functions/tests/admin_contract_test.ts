import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.14";
import { toAuditRow } from "../_shared/admin-audit.ts";
import { readBearerToken } from "../_shared/admin-auth.ts";
import {
  AdminRequestError,
  isOperationAllowed,
  isSafeReason,
  parseAdminReadRequest,
  parseUuid,
} from "../_shared/admin-contract.ts";
import { resolveAllowedOrigins } from "../_shared/cors.ts";

Deno.test("reason rules mirror the admin_audit_events constraint", () => {
  for (
    const reason of [
      "support ticket 4821 review",
      "用户反馈同步失败，排查空间状态",
      "x".repeat(500),
    ]
  ) {
    assertEquals(isSafeReason(reason), true, reason);
  }

  for (
    const reason of [
      "short",
      "x".repeat(501),
      "user wrote from someone@example.com",
      "see https://example.com/page",
      "see www.example.com",
      "eyJhbGciOi.eyJzdWIiOiIx.c2lnbmF0dXJl",
      "code hp1_0123456789abcdef",
      "token: abcdef123456",
      "sync code = abcdef",
    ]
  ) {
    assertEquals(isSafeReason(reason), false, reason);
  }
});

Deno.test("reason is trimmed before validation", () => {
  const parsed = parseAdminReadRequest({
    operation: "resolve-user",
    reason: "   support ticket 4821 review  ",
    filters: { email: "x" },
  });
  assertEquals(parsed.reason, "support ticket 4821 review");
  assertThrows(
    () => parseAdminReadRequest({ operation: "resolve-user", reason: "   short   " }),
    AdminRequestError,
  );
  assertThrows(() => parseAdminReadRequest({ operation: "resolve-user" }), AdminRequestError);
  assertThrows(
    () =>
      parseAdminReadRequest({
        operation: "resolve-user",
        reason: " System administrator context check. ",
      }),
    AdminRequestError,
  );
});

Deno.test("role matrix limits snapshot preview and admin audit to owner/admin", () => {
  assertEquals(isOperationAllowed("preview-snapshot", "support"), false);
  assertEquals(isOperationAllowed("list-admin-audit-events", "support"), false);
  assertEquals(isOperationAllowed("list-home-audit-events", "support"), true);
  assertEquals(isOperationAllowed("preview-snapshot", "admin"), true);
  assertEquals(isOperationAllowed("list-admin-audit-events", "owner"), true);
});

Deno.test("parseUuid lowercases canonical UUIDs and rejects anything else", () => {
  assertEquals(
    parseUuid("AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE"),
    "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  );
  for (const value of ["", "not-a-uuid", 42, null, "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee"]) {
    assertThrows(() => parseUuid(value), AdminRequestError);
  }
});

Deno.test("only plain Bearer headers yield a token", () => {
  assertEquals(readBearerToken("Bearer a.b.c"), "a.b.c");
  assertEquals(readBearerToken("bearer a.b.c"), null);
  assertEquals(readBearerToken("Basic abc"), null);
  assertEquals(readBearerToken("Bearer a b"), null);
  assertEquals(readBearerToken(null), null);
});

Deno.test("extra allowed origins must be exact https origins outside the public sites", () => {
  const origins = resolveAllowedOrigins(
    [
      "https://abc123.mylinker-admin.pages.dev",
      "https://*.mylinker-admin.pages.dev",
      "http://preview.example.com",
      "https://mylinker.net",
      "https://yinwenjie.github.io",
      "https://preview.example.com/path",
      "",
    ].join(","),
  );

  assertEquals([...origins].sort(), [
    "http://127.0.0.1:3000",
    "http://localhost:3000",
    "https://abc123.mylinker-admin.pages.dev",
    "https://admin.mylinker.net",
  ]);
});

Deno.test("audit rows always carry api_version and never extra metadata keys", () => {
  const row = toAuditRow({
    requestId: "11111111-1111-4111-8111-111111111111",
    admin: {
      adminId: "22222222-2222-4222-8222-222222222222",
      authUserId: "33333333-3333-4333-8333-333333333333",
      role: "support",
    },
    action: "admin.home_space.list",
    severity: "info",
    reason: "support ticket 4821 review",
    targetUserId: "44444444-4444-4444-8444-444444444444",
    resultCount: 2,
    metadata: { result_status: "ok", page_direction: "initial" },
  });

  assertEquals(row.metadata, { api_version: 1, result_status: "ok", page_direction: "initial" });
  assertEquals(row.admin_role, "support");
  assertEquals(row.target_home_space_id, null);
  assertEquals(row.result_count, 2);
});
