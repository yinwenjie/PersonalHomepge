import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert@1.0.14";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import type { AdminAuditEntry } from "../_shared/admin-audit.ts";
import { AdminBackendError, type AuthenticatedAdmin } from "../_shared/admin-auth.ts";
import { encodeCursor } from "../_shared/admin-cursor.ts";
import {
  type AdminReadStore,
  createSupabaseAdminReadStore,
  type HomeAuditRow,
  type HomeSpaceRow,
  type PageQuery,
  type ProfileRow,
  type SnapshotRow,
} from "../_shared/admin-read-store.ts";
import { resolveAllowedOrigins } from "../_shared/cors.ts";
import { BASE_OPERATIONS, handleAdminRead } from "../admin-read/handler.ts";
import { createReadOperations } from "../admin-read/operations.ts";

const ORIGIN = "https://admin.mylinker.net";
const REASON = "support ticket 4821 review";
const OWNER: AuthenticatedAdmin = {
  adminId: "22222222-2222-4222-8222-222222222222",
  authUserId: "33333333-3333-4333-8333-333333333333",
  role: "owner",
};
const USER_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_USER_ID = "55555555-5555-4555-8555-555555555555";
const SPACE_ID = "66666666-6666-4666-8666-666666666666";
const SYNC_SPACE_ID = "77777777-7777-4777-8777-777777777777";

const PROFILE: ProfileRow = {
  id: USER_ID,
  email: "person@example.com",
  display_name: "Person",
  created_at: "2026-01-01T00:00:00+00:00",
};

const SPACE: HomeSpaceRow = {
  id: SPACE_ID,
  user_id: USER_ID,
  sync_space_id: SYNC_SPACE_ID,
  name: "Work",
  access_mode: "account-managed",
  is_default: true,
  created_at: "2026-02-01T00:00:00.123456+00:00",
  updated_at: "2026-02-02T00:00:00+00:00",
  last_used_at: null,
};

const FULL_SUMMARY = {
  documentTitle: "My private title",
  groupCount: 3,
  siteCount: 12,
  widgetCount: 2,
  themePresetId: "classic",
  hasBanner: false,
  hasBackground: true,
  updatedAt: "2026-02-02T00:00:00Z",
  syncStatus: "synced",
};

function spaceRow(index: number): HomeSpaceRow {
  return {
    ...SPACE,
    id: `66666666-6666-4666-8666-00000000000${index}`,
    created_at: `2026-02-0${index}T00:00:00+00:00`,
  };
}

interface Calls {
  pages: PageQuery[];
  emails: string[];
  adminFilters: unknown[];
}

function fakeStore(
  overrides: Partial<AdminReadStore> = {},
): { store: AdminReadStore; calls: Calls } {
  const calls: Calls = { pages: [], emails: [], adminFilters: [] };
  const store: AdminReadStore = {
    findProfileById: (id) => Promise.resolve(id === USER_ID ? PROFILE : null),
    findProfilesByEmail: (email) => {
      calls.emails.push(email);
      return Promise.resolve(email === PROFILE.email ? [PROFILE] : []);
    },
    getAuthEmail: (id) =>
      Promise.resolve(
        id === USER_ID ? "person@example.com" : id === OTHER_USER_ID ? "other@example.com" : null,
      ),
    findHomeSpace: (id) => Promise.resolve(id === SPACE_ID ? SPACE : null),
    listHomeSpaces: (_userId, page) => {
      calls.pages.push(page);
      return Promise.resolve([spaceRow(3), spaceRow(2), spaceRow(1)].slice(0, page.limit));
    },
    listSnapshots: (_userId, _spaceId, page) => {
      calls.pages.push(page);
      const row: SnapshotRow = {
        id: "88888888-8888-4888-8888-888888888888",
        revision: 7,
        snapshot_source: "after-cloud-push",
        content_fingerprint: '{"documentTitle":"My private title","groups":[]}',
        summary: FULL_SUMMARY,
        created_at: "2026-03-01T00:00:00+00:00",
      };
      return Promise.resolve([row]);
    },
    listHomeAuditEvents: (_userId, _spaceId, page) => {
      calls.pages.push(page);
      const row: HomeAuditRow = {
        id: "99999999-9999-4999-8999-999999999999",
        home_space_id: SPACE_ID,
        event_type: "custom <script>",
        severity: "info",
        before_revision: 1,
        after_revision: 2,
        snapshot_id: null,
        summary_before: null,
        summary_after: FULL_SUMMARY,
        metadata: { snapshotSource: "cloud-baseline", snapshotSaved: true, url: "https://x" },
        created_at: "2026-03-01T00:00:00+00:00",
      };
      return Promise.resolve([row, {
        ...row,
        id: "99999999-9999-4999-8999-999999999998",
        event_type: "sync.account_managed_push",
        metadata: { source: "after-cloud-push" },
      }]);
    },
    listAdminAuditEvents: (filters, page) => {
      calls.adminFilters.push(filters);
      calls.pages.push(page);
      return Promise.resolve([]);
    },
    ...overrides,
  };
  return { store, calls };
}

async function call(
  store: AdminReadStore,
  body: Record<string, unknown>,
  admin: AuthenticatedAdmin = OWNER,
) {
  const audits: AdminAuditEntry[] = [];
  const response = await handleAdminRead(
    new Request("http://localhost/admin-read", {
      method: "POST",
      headers: {
        Origin: ORIGIN,
        Authorization: "Bearer valid.jwt.token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    {
      allowedOrigins: resolveAllowedOrigins(undefined),
      auth: {
        verifyAccessToken: () => Promise.resolve(admin.authUserId),
        findEnabledAdmin: () => Promise.resolve(admin),
      },
      audit: {
        record(entry) {
          audits.push(entry);
          return Promise.resolve();
        },
      },
      operations: { ...BASE_OPERATIONS, ...createReadOperations(store) },
    },
  );
  return { status: response.status, body: await response.json(), audits };
}

Deno.test("resolve-user finds an exact, normalized email and audits the target", async () => {
  const { store, calls } = fakeStore();
  const result = await call(store, {
    operation: "resolve-user",
    reason: REASON,
    filters: { email: "  Person@Example.COM " },
  });

  assertEquals(result.status, 200);
  assertEquals(calls.emails, ["person@example.com"]);
  assertEquals(result.body.data, {
    users: [{
      userId: USER_ID,
      email: "person@example.com",
      displayName: "Person",
      createdAt: "2026-01-01T00:00:00+00:00",
    }],
  });
  assertEquals(result.audits[0].action, "admin.user.resolve");
  assertEquals(result.audits[0].targetUserId, USER_ID);
  assertEquals(result.audits[0].resultCount, 1);
});

Deno.test("resolve-user ignores profiles whose editable email does not match Auth", async () => {
  const impostor: ProfileRow = { ...PROFILE, id: OTHER_USER_ID, display_name: "Impostor" };
  const { store } = fakeStore({
    findProfilesByEmail: () => Promise.resolve([impostor, PROFILE]),
  });
  const result = await call(store, {
    operation: "resolve-user",
    reason: REASON,
    filters: { email: "person@example.com" },
  });
  assertEquals(result.body.data.users.map((u: { userId: string }) => u.userId), [USER_ID]);

  const byId = await call(
    fakeStore({
      findProfileById: () => Promise.resolve({ ...PROFILE, email: "edited@example.com" }),
    }).store,
    { operation: "resolve-user", reason: REASON, filters: { userId: USER_ID } },
  );
  assertEquals(byId.body.data.users[0].email, "person@example.com");
});

Deno.test("resolve-user resolves through a home space id and reports empty results", async () => {
  const { store } = fakeStore();
  const bySpace = await call(store, {
    operation: "resolve-user",
    reason: REASON,
    filters: { homeSpaceId: SPACE_ID.toUpperCase() },
  });
  assertEquals(bySpace.body.data.users[0].userId, USER_ID);

  const missing = await call(store, {
    operation: "resolve-user",
    reason: REASON,
    filters: { userId: OTHER_USER_ID },
  });
  assertEquals(missing.status, 200);
  assertEquals(missing.body.data, { users: [] });
  assertEquals(missing.audits[0].metadata, { result_status: "empty" });
  assertEquals(missing.audits[0].targetUserId, null);
});

Deno.test("resolve-user refuses empty, combined, partial and paged searches", async () => {
  const { store } = fakeStore();
  for (
    const extra of [
      { filters: {} },
      { filters: { userId: USER_ID, email: "person@example.com" } },
      { filters: { email: "person@" } },
      { filters: { email: "%@example.com" + "x".repeat(320) } },
      { filters: { userId: "4444" } },
      { filters: { name: "Person" } },
      { filters: { userId: USER_ID }, cursor: "abc" },
    ]
  ) {
    const result = await call(store, { operation: "resolve-user", reason: REASON, ...extra });
    assertEquals(result.status, 400, JSON.stringify(extra));
    assertEquals(result.audits.length, 0);
  }
});

Deno.test("list-home-spaces pages with a cursor bound to the target user", async () => {
  const { store, calls } = fakeStore();
  const first = await call(store, {
    operation: "list-home-spaces",
    reason: REASON,
    filters: { userId: USER_ID, pageSize: 2 },
  });

  assertEquals(first.status, 200);
  assertEquals(calls.pages[0], { limit: 3, after: null });
  assertEquals(first.body.data.homeSpaces.length, 2);
  assertEquals(Object.keys(first.body.data.homeSpaces[0]).sort(), [
    "accessMode",
    "createdAt",
    "id",
    "isDefault",
    "lastUsedAt",
    "name",
    "syncSpaceId",
    "updatedAt",
    "userId",
  ]);
  assertNotEquals(first.body.nextCursor, null);
  assertEquals(first.audits[0].metadata, { page_direction: "initial", result_status: "ok" });

  const second = await call(store, {
    operation: "list-home-spaces",
    reason: REASON,
    filters: { userId: USER_ID, pageSize: 2 },
    cursor: first.body.nextCursor,
  });
  assertEquals(second.status, 200);
  assertEquals(calls.pages[1].after, { createdAt: spaceRow(2).created_at, id: spaceRow(2).id });
  assertEquals(second.audits[0].metadata?.page_direction, "next");

  const replayed = await call(store, {
    operation: "list-home-spaces",
    reason: REASON,
    filters: { userId: OTHER_USER_ID },
    cursor: first.body.nextCursor,
  });
  assertEquals(replayed.status, 400);
});

Deno.test("page size and cursor shape are validated", async () => {
  const { store } = fakeStore();
  for (
    const extra of [
      { filters: { userId: USER_ID, pageSize: 51 } },
      { filters: { userId: USER_ID, pageSize: 0 } },
      { filters: { userId: USER_ID, pageSize: 1.5 } },
      { filters: { userId: USER_ID }, cursor: "not base64!" },
      {
        filters: { userId: USER_ID },
        cursor: encodeCursor(`list-home-spaces:${USER_ID}`, {
          createdAt: "yesterday",
          id: SPACE_ID,
        }),
      },
    ]
  ) {
    const result = await call(store, { operation: "list-home-spaces", reason: REASON, ...extra });
    assertEquals(result.status, 400, JSON.stringify(extra));
  }
});

Deno.test("list-snapshots only lists account-managed spaces owned by the target user", async () => {
  const syncCodeSpace = { ...SPACE, access_mode: "sync-code" };
  for (
    const [store, userId] of [
      [fakeStore().store, OTHER_USER_ID],
      [fakeStore({ findHomeSpace: () => Promise.resolve(syncCodeSpace) }).store, USER_ID],
      [fakeStore({ findHomeSpace: () => Promise.resolve(null) }).store, USER_ID],
    ] as const
  ) {
    const result = await call(store, {
      operation: "list-snapshots",
      reason: REASON,
      filters: { userId, homeSpaceId: SPACE_ID },
    });
    assertEquals(result.status, 404);
    assertEquals(result.body.error, "not_found");
    assertEquals(result.audits.length, 0);
  }
});

Deno.test("snapshot list returns a fingerprint digest and summary counts, never content", async () => {
  const { store } = fakeStore();
  const result = await call(store, {
    operation: "list-snapshots",
    reason: REASON,
    filters: { userId: USER_ID, homeSpaceId: SPACE_ID },
  });

  assertEquals(result.status, 200);
  const [snapshot] = result.body.data.snapshots;
  assert(/^[0-9a-f]{12}$/.test(snapshot.fingerprintDigest));
  assertEquals(snapshot.summary, {
    groupCount: 3,
    siteCount: 12,
    widgetCount: 2,
    themePresetId: "classic",
    hasBanner: false,
    hasBackground: true,
  });
  assert(!JSON.stringify(result.body).includes("My private title"));
  assertEquals(result.audits[0].action, "admin.snapshot.list");
  assertEquals(result.audits[0].targetSyncSpaceId, SYNC_SPACE_ID);
  assertEquals(result.audits[0].metadata, {
    page_direction: "initial",
    result_status: "ok",
    access_mode: "account-managed",
  });
});

Deno.test("home audit events pass only known event types and whitelisted metadata", async () => {
  const { store } = fakeStore();
  const result = await call(store, {
    operation: "list-home-audit-events",
    reason: REASON,
    filters: { userId: USER_ID },
  });

  assertEquals(result.status, 200);
  const [event] = result.body.data.events;
  assertEquals(event.eventType, "other");
  assertEquals(result.body.data.events[1].eventType, "sync.account_managed_push");
  assertEquals(result.body.data.events[1].metadata, { snapshotSource: "after-cloud-push" });
  assertEquals(event.metadata, { snapshotSource: "cloud-baseline", snapshotSaved: true });
  assertEquals(event.summaryBefore, null);
  assertEquals(event.summaryAfter.siteCount, 12);
  assert(!JSON.stringify(result.body).includes("My private title"));
});

Deno.test("admin audit list validates filters and binds the cursor to them", async () => {
  const { store, calls } = fakeStore();
  const ok = await call(store, {
    operation: "list-admin-audit-events",
    reason: REASON,
    filters: {
      targetUserId: USER_ID,
      action: "admin.snapshot.list",
      createdFrom: "2026-10-01T00:00:00Z",
      createdTo: "2026-10-09T00:00:00Z",
    },
  });
  assertEquals(ok.status, 200);
  assertEquals(calls.adminFilters[0], {
    targetUserId: USER_ID,
    action: "admin.snapshot.list",
    createdFrom: "2026-10-01T00:00:00Z",
    createdTo: "2026-10-09T00:00:00Z",
  });
  assertEquals(ok.audits[0].action, "admin.audit.list");

  const microRange = await call(store, {
    operation: "list-admin-audit-events",
    reason: REASON,
    filters: {
      createdFrom: "2026-10-09T00:00:00.000001Z",
      createdTo: "2026-10-09T00:00:00.000002Z",
    },
  });
  assertEquals(microRange.status, 200);

  for (
    const filters of [
      { action: "admin.user.delete" },
      { createdFrom: "2026-10-09T00:00:00Z", createdTo: "2026-10-01T00:00:00Z" },
      { createdFrom: "2026-10-09T00:00:00.000002Z", createdTo: "2026-10-09T00:00:00.000001Z" },
      { createdFrom: "last week" },
      { createdFrom: "2026-02-31T00:00:00Z" },
      { createdTo: "2026-10-09T24:00:00Z" },
      { createdTo: "2026-10-09T00:00:00+25:00" },
      { createdTo: "2026-10-09T00:00:00+16:00" },
      { createdTo: "2026-10-09T00:00:00-16:00" },
      { adminUserId: USER_ID },
      { reason: "anything" },
    ]
  ) {
    const result = await call(store, {
      operation: "list-admin-audit-events",
      reason: REASON,
      filters,
    });
    assertEquals(result.status, 400, JSON.stringify(filters));
  }

  const support = await call(
    store,
    { operation: "list-admin-audit-events", reason: REASON, filters: {} },
    { ...OWNER, role: "support" },
  );
  assertEquals(support.status, 403);
});

Deno.test("fully filtered admin audit cursors round-trip under the cursor limit", async () => {
  const rows = [3, 2, 1].map((n) => ({
    id: `aaaaaaaa-aaaa-4aaa-8aaa-00000000000${n}`,
    request_id: `bbbbbbbb-bbbb-4bbb-8bbb-00000000000${n}`,
    admin_user_id: null,
    admin_auth_user_id: OWNER.authUserId,
    admin_role: "owner",
    action: "admin.snapshot.list",
    severity: "info",
    reason: REASON,
    target_user_id: USER_ID,
    target_home_space_id: SPACE_ID,
    target_snapshot_id: null,
    result_count: 1,
    created_at: `2026-10-0${n}T12:34:56.123456+00:00`,
  }));
  const { store, calls } = fakeStore({
    listAdminAuditEvents: (filters, page) => {
      calls.adminFilters.push(filters);
      calls.pages.push(page);
      return Promise.resolve(rows.slice(0, page.limit));
    },
  });
  const filters = {
    adminAuthUserId: OWNER.authUserId,
    targetUserId: USER_ID,
    targetHomeSpaceId: SPACE_ID,
    action: "admin.snapshot.list",
    createdFrom: "2026-01-01T00:00:00.000000+08:00",
    createdTo: "2026-12-31T23:59:59.999999+08:00",
    pageSize: 1,
  };

  const first = await call(store, {
    operation: "list-admin-audit-events",
    reason: REASON,
    filters,
  });
  assertEquals(first.status, 200);
  assertEquals(first.body.data.events[0].adminUserId, null);
  assertEquals(first.body.data.events[0].adminAuthUserId, OWNER.authUserId);
  assert(first.body.nextCursor.length <= 512, `cursor is ${first.body.nextCursor.length}`);
  assertEquals(
    (calls.adminFilters[0] as Record<string, unknown>).adminAuthUserId,
    OWNER.authUserId,
  );

  const second = await call(store, {
    operation: "list-admin-audit-events",
    reason: REASON,
    filters,
    cursor: first.body.nextCursor,
  });
  assertEquals(second.status, 200);
  assertEquals(calls.pages[1].after?.id, rows[0].id);

  const otherFilters = await call(store, {
    operation: "list-admin-audit-events",
    reason: REASON,
    filters: { ...filters, targetUserId: OTHER_USER_ID },
    cursor: first.body.nextCursor,
  });
  assertEquals(otherFilters.status, 400);
});

Deno.test("preview-snapshot stays unavailable until 1.18.5", async () => {
  const { store } = fakeStore();
  const result = await call(store, {
    operation: "preview-snapshot",
    reason: REASON,
    filters: { userId: USER_ID, homeSpaceId: SPACE_ID },
  });
  assertEquals(result.status, 400);
});

Deno.test("store failures surface only as service_unavailable", async () => {
  const { store } = fakeStore({
    listHomeSpaces: () => Promise.reject(new AdminBackendError("query")),
  });
  const result = await call(store, {
    operation: "list-home-spaces",
    reason: REASON,
    filters: { userId: USER_ID },
  });
  assertEquals(result.status, 503);
  assertEquals(result.body.error, "service_unavailable");
  assertEquals(result.audits.length, 0);
});

// Records the PostgREST builder calls the Supabase store makes, without a network.
function recordingClient(): { client: SupabaseClient; log: unknown[][] } {
  const log: unknown[][] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "or", "order", "limit", "gte", "lt", "maybeSingle"]) {
    builder[method] = (...args: unknown[]) => {
      log.push([method, ...args]);
      return builder;
    };
  }
  builder.then = (resolve: (value: unknown) => void) => resolve({ data: [], error: null });
  const client = {
    from(table: string) {
      log.push(["from", table]);
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, log };
}

Deno.test("supabase store selects fixed columns and pages by created_at then id", async () => {
  const { client, log } = recordingClient();
  const store = createSupabaseAdminReadStore(client);
  await store.listSnapshots(USER_ID, SPACE_ID, {
    limit: 21,
    after: { createdAt: "2026-02-01T00:00:00.123456+00:00", id: SPACE_ID },
  });

  assertEquals(log, [
    ["from", "home_space_snapshots"],
    ["select", "id, revision, snapshot_source, content_fingerprint, summary, created_at"],
    ["eq", "user_id", USER_ID],
    ["eq", "home_space_id", SPACE_ID],
    [
      "or",
      `created_at.lt."2026-02-01T00:00:00.123456+00:00",and(created_at.eq."2026-02-01T00:00:00.123456+00:00",id.lt.${SPACE_ID})`,
    ],
    ["order", "created_at", { ascending: false }],
    ["order", "id", { ascending: false }],
    ["limit", 21],
  ]);
  assert(!JSON.stringify(log).includes("document_json"));
});
