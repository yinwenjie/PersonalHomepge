import { assert, assertEquals, assertNotEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.117.3";
import type { AdminAuditEntry } from "../_shared/admin-audit.ts";
import { AdminBackendError, type AuthenticatedAdmin } from "../_shared/admin-auth.ts";
import { AdminRequestError } from "../_shared/admin-contract.ts";
import { encodeCursor } from "../_shared/admin-cursor.ts";
import {
  type AdminReadStore,
  createSupabaseAdminReadStore,
  type HomeAuditRow,
  type HomeSpaceRow,
  type PageQuery,
  type ProfileRow,
  type SnapshotRow,
  type UserDirectoryRow,
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

const SNAPSHOT_ID = "88888888-8888-4888-8888-888888888888";

const STORED_DOCUMENT = {
  version: 2,
  documentId: "doc-secret-id",
  documentTitle: "Team home",
  groups: [{ id: "g1", title: "Work", order: 1, sites: [] }],
  widgets: [],
  theme: { presetId: "classic", accent: "#246BFE" },
  syncMeta: { spaceId: SYNC_SPACE_ID, status: "synced" },
  billing: { plan: "free" },
};

function spaceRow(index: number): HomeSpaceRow {
  return {
    ...SPACE,
    id: `66666666-6666-4666-8666-00000000000${index}`,
    created_at: `2026-02-0${index}T00:00:00+00:00`,
  };
}

function directoryRow(index: number): UserDirectoryRow {
  return {
    id: `44444444-4444-4444-8444-00000000000${index}`,
    masked_email: "p***@example.com",
    created_at: `2026-01-0${index}T00:00:00+00:00`,
    last_sign_in_at: null,
    home_space_count: 2,
    account_managed_space_count: 1,
    sync_code_space_count: 1,
    snapshot_count: 4,
    last_snapshot_at: "2026-03-01T00:00:00+00:00",
  };
}

const STATS = {
  generatedAt: "2026-10-10T16:00:00.123456+00:00",
  users: { total: 9, new7d: 2, new30d: 5, signedIn7d: 3, signedIn30d: 6, emails: ["x@y.z"] },
  homeSpaces: { total: 7, accountManaged: 4, syncCode: 3, usersWithAccountManaged: 4 },
  snapshots: { total: 40, last7d: 6 },
  cloudSaves: { users7d: 2, users30d: 3 },
  visitors: { today: 1, last7d: 11, last30d: 30 },
  daily: [{ date: "2026-10-10", newUsers: 1, visitors: 4, extra: "dropped" }],
  rawRows: [{ email: "x@y.z" }],
};

interface Calls {
  pages: PageQuery[];
  emails: string[];
  adminFilters: unknown[];
  documentReads: number[];
}

function fakeStore(
  overrides: Partial<AdminReadStore> = {},
): { store: AdminReadStore; calls: Calls } {
  const calls: Calls = { pages: [], emails: [], adminFilters: [], documentReads: [] };
  const store: AdminReadStore = {
    findProfileById: (id) => Promise.resolve(id === USER_ID ? PROFILE : null),
    findAuthUserIdsByEmail: (email) => {
      calls.emails.push(email);
      return Promise.resolve(email === "person@example.com" ? [USER_ID] : []);
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
        fingerprint_digest: "0123456789ab",
        summary: FULL_SUMMARY,
        created_at: "2026-03-01T00:00:00+00:00",
      };
      return Promise.resolve([row]);
    },
    readSnapshotDocument: (userId, spaceId, snapshotId, maxBytes) => {
      calls.documentReads.push(maxBytes);
      if (userId !== USER_ID || spaceId !== SPACE_ID || snapshotId !== SNAPSHOT_ID) {
        return Promise.resolve(null);
      }
      return Promise.resolve({
        id: SNAPSHOT_ID,
        revision: 7,
        snapshot_source: "after-cloud-push",
        created_at: "2026-03-01T00:00:00+00:00",
        document_bytes: 512,
        document_json: STORED_DOCUMENT,
      });
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
    listUsers: (page) => {
      calls.pages.push(page);
      return Promise.resolve(
        [directoryRow(3), directoryRow(2), directoryRow(1)].slice(0, page.limit),
      );
    },
    readStats: () => Promise.resolve(STATS),
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

Deno.test("resolve-user takes emails from Auth, never the editable profile copy", async () => {
  const { store } = fakeStore({
    // A stray profile email column must never reach the DTO.
    findProfileById: () =>
      Promise.resolve({ ...PROFILE, email: "edited@example.com" } as ProfileRow),
  });
  const byId = await call(store, {
    operation: "resolve-user",
    reason: REASON,
    filters: { userId: USER_ID },
  });
  assertEquals(byId.body.data.users[0].email, "person@example.com");

  const gone = await call(store, {
    operation: "resolve-user",
    reason: REASON,
    filters: { userId: "12121212-1212-4212-8212-121212121212" },
  });
  assertEquals(gone.body.data, { users: [] });
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
    filters: { email: "nobody@example.com" },
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
  assertEquals(snapshot.fingerprintDigest, "0123456789ab");
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

Deno.test("preview-snapshot returns the projected document and audits it as a warning", async () => {
  const { store, calls } = fakeStore();
  const result = await call(store, {
    operation: "preview-snapshot",
    reason: REASON,
    filters: { userId: USER_ID, homeSpaceId: SPACE_ID, snapshotId: SNAPSHOT_ID },
  });

  assertEquals(result.status, 200);
  assertEquals(result.body.data.snapshot, {
    id: SNAPSHOT_ID,
    revision: 7,
    source: "after-cloud-push",
    createdAt: "2026-03-01T00:00:00+00:00",
  });
  assertEquals(result.body.data.status, "ok");
  assertEquals(result.body.data.document.documentTitle, "Team home");
  assertEquals(result.body.data.document.theme.accent, "#246bfe");
  const raw = JSON.stringify(result.body);
  assert(!raw.includes("doc-secret-id"));
  assert(!raw.includes("syncMeta"));
  assert(!raw.includes(SYNC_SPACE_ID));
  assertEquals(calls.documentReads, [1024 * 1024]);
  assertEquals(result.audits.length, 1);
  assertEquals(result.audits[0].action, "admin.snapshot.preview");
  assertEquals(result.audits[0].severity, "warning");
  assertEquals(result.audits[0].targetSnapshotId, SNAPSHOT_ID);
  assertEquals(result.audits[0].targetSyncSpaceId, SYNC_SPACE_ID);
  assertEquals(result.audits[0].resultCount, 1);
});

Deno.test("preview-snapshot needs every id, no cursor, and a matching chain", async () => {
  const { store } = fakeStore();
  for (
    const body of [
      { filters: { userId: USER_ID, homeSpaceId: SPACE_ID } },
      { filters: { userId: USER_ID, homeSpaceId: SPACE_ID, snapshotId: "not-a-uuid" } },
      {
        filters: { userId: USER_ID, homeSpaceId: SPACE_ID, snapshotId: SNAPSHOT_ID, x: 1 },
      },
      {
        filters: { userId: USER_ID, homeSpaceId: SPACE_ID, snapshotId: SNAPSHOT_ID },
        cursor: "abc",
      },
    ]
  ) {
    const result = await call(store, { operation: "preview-snapshot", reason: REASON, ...body });
    assertEquals(result.status, 400);
  }

  for (
    const filters of [
      { userId: OTHER_USER_ID, homeSpaceId: SPACE_ID, snapshotId: SNAPSHOT_ID },
      { userId: USER_ID, homeSpaceId: SPACE_ID, snapshotId: OTHER_USER_ID },
    ]
  ) {
    const result = await call(store, { operation: "preview-snapshot", reason: REASON, filters });
    assertEquals(result.status, 404);
    assertEquals(result.audits.length, 0);
  }

  const syncCode = fakeStore({
    findHomeSpace: () => Promise.resolve({ ...SPACE, access_mode: "sync-code" }),
  });
  const refused = await call(syncCode.store, {
    operation: "preview-snapshot",
    reason: REASON,
    filters: { userId: USER_ID, homeSpaceId: SPACE_ID, snapshotId: SNAPSHOT_ID },
  });
  assertEquals(refused.status, 404);
  assertEquals(syncCode.calls.documentReads, []);
});

Deno.test("preview-snapshot reports oversized and unsupported documents without content", async () => {
  const tooLarge = fakeStore({
    readSnapshotDocument: () =>
      Promise.resolve({
        id: SNAPSHOT_ID,
        revision: 7,
        snapshot_source: "cloud-baseline",
        created_at: "2026-03-01T00:00:00+00:00",
        document_bytes: 5_000_000,
        document_json: null,
      }),
  });
  const large = await call(tooLarge.store, {
    operation: "preview-snapshot",
    reason: REASON,
    filters: { userId: USER_ID, homeSpaceId: SPACE_ID, snapshotId: SNAPSHOT_ID },
  });
  assertEquals(large.status, 200);
  assertEquals(large.body.data.status, "too_large");
  assertEquals(large.body.data.document, null);
  assertEquals(large.audits[0].resultCount, 0);
  assertEquals(large.audits[0].metadata, {
    access_mode: "account-managed",
    result_status: "empty",
  });

  const legacy = fakeStore({
    readSnapshotDocument: () =>
      Promise.resolve({
        id: SNAPSHOT_ID,
        revision: 1,
        snapshot_source: "cloud-baseline",
        created_at: "2026-03-01T00:00:00+00:00",
        document_bytes: 40,
        document_json: { version: 1, sites: [] },
      }),
  });
  const unsupported = await call(legacy.store, {
    operation: "preview-snapshot",
    reason: REASON,
    filters: { userId: USER_ID, homeSpaceId: SPACE_ID, snapshotId: SNAPSHOT_ID },
  });
  assertEquals(unsupported.body.data.status, "unsupported");
  assertEquals(unsupported.body.data.document, null);
});

Deno.test("support cannot preview snapshots even with valid filters", async () => {
  const { store, calls } = fakeStore();
  const result = await call(
    store,
    {
      operation: "preview-snapshot",
      reason: REASON,
      filters: { userId: USER_ID, homeSpaceId: SPACE_ID, snapshotId: SNAPSHOT_ID },
    },
    { ...OWNER, role: "support" },
  );
  assertEquals(result.status, 403);
  assertEquals(calls.documentReads, []);
  assertEquals(result.audits.length, 0);
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
    rpc(name: string, args: unknown) {
      log.push(["rpc", name, args]);
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, log };
}

Deno.test("Auth rate limits during email checks stay rate_limited", async () => {
  const fakeClient = (status: number) =>
    ({
      auth: {
        admin: {
          getUserById: () => Promise.resolve({ data: { user: null }, error: { status } }),
        },
      },
    }) as unknown as SupabaseClient;

  await assertRejects(
    () => createSupabaseAdminReadStore(fakeClient(429)).getAuthEmail(USER_ID),
    AdminRequestError,
    "rate_limited",
  );
  assertEquals(await createSupabaseAdminReadStore(fakeClient(404)).getAuthEmail(USER_ID), null);
});

Deno.test("supabase store pages home spaces by created_at then id over fixed columns", async () => {
  const { client, log } = recordingClient();
  const store = createSupabaseAdminReadStore(client);
  await store.listHomeSpaces(USER_ID, {
    limit: 21,
    after: { createdAt: "2026-02-01T00:00:00.123456+00:00", id: SPACE_ID },
  });

  assertEquals(log, [
    ["from", "home_spaces"],
    [
      "select",
      "id, user_id, sync_space_id, name, access_mode, is_default, created_at, updated_at, last_used_at",
    ],
    ["eq", "user_id", USER_ID],
    [
      "or",
      `created_at.lt."2026-02-01T00:00:00.123456+00:00",and(created_at.eq."2026-02-01T00:00:00.123456+00:00",id.lt.${SPACE_ID})`,
    ],
    ["order", "created_at", { ascending: false }],
    ["order", "id", { ascending: false }],
    ["limit", 21],
  ]);
});

Deno.test("supabase store reads user-writable columns only through the database functions", async () => {
  const { client, log } = recordingClient();
  const store = createSupabaseAdminReadStore(client);
  const after = { createdAt: "2026-02-01T00:00:00.123456+00:00", id: SPACE_ID };
  await store.findProfileById(USER_ID);
  await store.listSnapshots(USER_ID, SPACE_ID, { limit: 21, after });
  await store.listHomeAuditEvents(USER_ID, null, { limit: 51, after: null });
  await store.readSnapshotDocument(USER_ID, SPACE_ID, SNAPSHOT_ID, 1024);

  assertEquals(log, [
    ["rpc", "admin_read_profile", { p_user_id: USER_ID }],
    ["rpc", "admin_list_snapshots", {
      p_user_id: USER_ID,
      p_home_space_id: SPACE_ID,
      p_after_created_at: after.createdAt,
      p_after_id: after.id,
      p_limit: 21,
    }],
    ["rpc", "admin_list_home_audit_events", {
      p_user_id: USER_ID,
      p_home_space_id: null,
      p_after_created_at: null,
      p_after_id: null,
      p_limit: 51,
    }],
    ["rpc", "admin_read_snapshot_document", {
      p_user_id: USER_ID,
      p_home_space_id: SPACE_ID,
      p_snapshot_id: SNAPSHOT_ID,
      p_max_bytes: 1024,
    }],
  ]);
  assert(!JSON.stringify(log).includes("content_fingerprint"));
});

Deno.test("list-users pages masked users for owner and admin and audits each page", async () => {
  const { store, calls } = fakeStore();
  const first = await call(store, {
    operation: "list-users",
    reason: REASON,
    filters: { pageSize: 2 },
  });

  assertEquals(first.status, 200);
  assertEquals(calls.pages[0], { limit: 3, after: null });
  assertEquals(first.body.data.users.length, 2);
  assertEquals(first.body.data.users[0], {
    userId: "44444444-4444-4444-8444-000000000003",
    maskedEmail: "p***@example.com",
    createdAt: "2026-01-03T00:00:00+00:00",
    lastSignInAt: null,
    homeSpaceCount: 2,
    accountManagedSpaceCount: 1,
    syncCodeSpaceCount: 1,
    snapshotCount: 4,
    lastSnapshotAt: "2026-03-01T00:00:00+00:00",
  });
  assertEquals(first.audits[0].action, "admin.user.list");
  assertEquals(first.audits[0].resultCount, 2);
  assertEquals(first.audits[0].targetUserId, undefined);
  assertNotEquals(first.body.nextCursor, null);

  const next = await call(store, {
    operation: "list-users",
    reason: REASON,
    filters: { pageSize: 2 },
    cursor: first.body.nextCursor,
  });
  assertEquals(next.status, 200);
  assertEquals(calls.pages[1].after, {
    createdAt: "2026-01-02T00:00:00+00:00",
    id: "44444444-4444-4444-8444-000000000002",
  });
  assertEquals(next.audits[0].metadata, { page_direction: "next", result_status: "ok" });

  const admin = await call(store, { operation: "list-users", reason: REASON, filters: {} }, {
    ...OWNER,
    role: "admin",
  });
  assertEquals(admin.status, 200);
});

Deno.test("list-users is denied to support and rejects unknown filters and foreign cursors", async () => {
  const { store } = fakeStore();
  const support = await call(store, { operation: "list-users", reason: REASON, filters: {} }, {
    ...OWNER,
    role: "support",
  });
  assertEquals(support.status, 403);
  assertEquals(support.body.error, "not_authorized");

  const badFilter = await call(store, {
    operation: "list-users",
    reason: REASON,
    filters: { email: "person@example.com" },
  });
  assertEquals(badFilter.status, 400);

  const foreign = await call(store, {
    operation: "list-users",
    reason: REASON,
    filters: {},
    cursor: encodeCursor(`list-home-spaces:${USER_ID}`, {
      createdAt: "2026-01-02T00:00:00+00:00",
      id: SPACE_ID,
    }),
  });
  assertEquals(foreign.status, 400);

  const noReason = await call(store, { operation: "list-users", filters: {} });
  assertEquals(noReason.status, 400);
});

Deno.test("list-users never passes on an email that is not masked", async () => {
  const { store } = fakeStore({
    listUsers: () =>
      Promise.resolve([
        { ...directoryRow(2), masked_email: "person@example.com" },
        { ...directoryRow(1), masked_email: "pe***@example.com" },
      ]),
  });
  const result = await call(store, { operation: "list-users", reason: REASON, filters: {} });
  assertEquals(result.status, 200);
  assertEquals(result.body.data.users.map((user: { maskedEmail: unknown }) => user.maskedEmail), [
    null,
    null,
  ]);
  assert(!JSON.stringify(result.body).includes("person@example.com"));
});

Deno.test("get-stats returns only the fixed counts, for every role", async () => {
  const { store } = fakeStore();
  for (const role of ["owner", "admin", "support"] as const) {
    const result = await call(store, { operation: "get-stats", reason: REASON, filters: {} }, {
      ...OWNER,
      role,
    });
    assertEquals(result.status, 200);
    assertEquals(result.body.data, {
      generatedAt: "2026-10-10T16:00:00.123456+00:00",
      users: { total: 9, new7d: 2, new30d: 5, signedIn7d: 3, signedIn30d: 6 },
      homeSpaces: { total: 7, accountManaged: 4, syncCode: 3, usersWithAccountManaged: 4 },
      snapshots: { total: 40, last7d: 6 },
      cloudSaves: { users7d: 2, users30d: 3 },
      visitors: { today: 1, last7d: 11, last30d: 30 },
      daily: [{ date: "2026-10-10", newUsers: 1, visitors: 4 }],
    });
    assertEquals(result.audits[0].action, "admin.stats.read");
    assertEquals(result.audits[0].resultCount, null);
  }
});

Deno.test("get-stats rejects filters and cursors and fails closed on a bad shape", async () => {
  const { store } = fakeStore();
  const withFilter = await call(store, {
    operation: "get-stats",
    reason: REASON,
    filters: { userId: USER_ID },
  });
  assertEquals(withFilter.status, 400);
  const withCursor = await call(store, {
    operation: "get-stats",
    reason: REASON,
    filters: {},
    cursor: "abc",
  });
  assertEquals(withCursor.status, 400);

  for (
    const broken of [
      null,
      { ...STATS, users: { ...STATS.users, total: -1 } },
      { ...STATS, visitors: { today: 1.5, last7d: 1, last30d: 1 } },
      { ...STATS, daily: [{ date: "yesterday", newUsers: 1, visitors: 1 }] },
      { ...STATS, generatedAt: "now" },
    ]
  ) {
    const { store: brokenStore } = fakeStore({ readStats: () => Promise.resolve(broken) });
    const result = await call(brokenStore, { operation: "get-stats", reason: REASON, filters: {} });
    assertEquals(result.status, 503);
    assertEquals(result.audits.length, 0);
  }
});

Deno.test("supabase store reads the user directory and statistics through the database functions", async () => {
  const { client, log } = recordingClient();
  const store = createSupabaseAdminReadStore(client);
  const after = { createdAt: "2026-02-01T00:00:00.123456+00:00", id: USER_ID };
  await store.listUsers({ limit: 21, after });
  await store.readStats();

  assertEquals(log, [
    ["rpc", "admin_list_users", {
      p_after_created_at: after.createdAt,
      p_after_id: after.id,
      p_limit: 21,
    }],
    ["rpc", "admin_read_stats", undefined],
  ]);
});
