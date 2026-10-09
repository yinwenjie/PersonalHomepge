import { assert, assertEquals } from "jsr:@std/assert@1.0.14";
import { MAX_RESPONSE_BYTES } from "../_shared/admin-contract.ts";
import { projectSnapshotPreview } from "../admin-read/snapshot-preview.ts";

const DOCUMENT = {
  version: 2,
  documentId: "doc-secret-id",
  documentTitle: "Team home",
  updatedAt: "2026-03-01T00:00:00Z",
  revision: 4,
  groups: [
    {
      id: "g2",
      title: "Second",
      keywords: "private keywords",
      order: 2,
      sites: [{ id: "s3", name: "C", url: "https://c.example/", mark: "C", order: 1 }],
    },
    {
      id: "g1",
      title: "First",
      keywords: "",
      order: 1,
      sites: [
        { id: "s2", name: "B", url: "https://b.example/?token=x", mark: "B", order: 2 },
        { id: "s1", name: "A", url: "javascript:alert(1)", mark: "A", order: 1 },
      ],
    },
  ],
  widgets: [
    {
      id: "w2",
      type: "notes.list",
      title: "Notes",
      order: 2,
      layout: { collapsed: true },
      config: {
        notes: [
          { id: "n2", text: "second", order: 2, createdAt: "x", updatedAt: "x" },
          { id: "n1", text: "first", order: 1, createdAt: "x", updatedAt: "x" },
        ],
      },
    },
    {
      id: "w1",
      type: "todo.list",
      title: "Todo",
      order: 1,
      layout: { collapsed: false },
      config: { items: [{ id: "t1", title: "ship", completed: true, order: 1 }] },
    },
    {
      id: "w3",
      type: "countdown.timer",
      title: "Launch",
      order: 3,
      layout: {},
      config: { eventTitle: "Launch day", targetDate: "2026-12-01", displayMode: "days-hours" },
    },
    {
      id: "w4",
      type: "world-clock.list",
      title: "Clocks",
      order: 4,
      layout: {},
      config: {
        clocks: [
          { id: "c1", label: "Tokyo", timeZone: "Asia/Tokyo", order: 1 },
          { id: "c2", label: "Bad", timeZone: "<script>", order: 2 },
        ],
      },
    },
    {
      id: "w5",
      type: "calendar.month",
      title: "Cal",
      order: 5,
      layout: {},
      config: { weekStartsOn: 0 },
    },
    {
      id: "w6",
      type: "rss.feed",
      title: "Future",
      order: 6,
      layout: {},
      config: { url: "https://x" },
    },
  ],
  theme: {
    presetId: "classic",
    accent: "#246BFE",
    bannerUrl: null,
    backgroundUrl: "https://images.example/bg.png",
    bannerAsset: {
      source: "storage",
      bucket: "home-assets",
      path: "user-id/banner.png",
      url: null,
      contentType: "image/png",
      width: 10,
      height: 10,
      updatedAt: "x",
    },
    backgroundAsset: null,
  },
  syncMeta: { mode: "sync-code", spaceId: "space-secret", status: "synced" },
  billing: { plan: "free", stripeCustomerId: null },
};

Deno.test("preview keeps the whitelisted fields in stored order", () => {
  const result = projectSnapshotPreview(DOCUMENT);
  assertEquals(result.status, "ok");
  assertEquals(result.truncated, false);
  const document = result.document!;

  assertEquals(document.previewVersion, 1);
  assertEquals(document.documentTitle, "Team home");
  assertEquals(document.groups.map((group) => group.title), ["First", "Second"]);
  assertEquals(document.groups[0].sites, [
    { name: "A", url: "javascript:alert(1)", mark: "A" },
    { name: "B", url: "https://b.example/?token=x", mark: "B" },
  ]);
  assertEquals(document.widgets.map((widget) => widget.type), [
    "todo.list",
    "notes.list",
    "countdown.timer",
    "world-clock.list",
    "calendar.month",
    "other",
  ]);
  assertEquals(document.widgets[0], {
    type: "todo.list",
    title: "Todo",
    collapsed: false,
    items: [{ title: "ship", completed: true }],
  });
  assertEquals(document.widgets[1], {
    type: "notes.list",
    title: "Notes",
    collapsed: true,
    notes: ["first", "second"],
  });
  assertEquals(document.widgets[2], {
    type: "countdown.timer",
    title: "Launch",
    collapsed: false,
    eventTitle: "Launch day",
    targetDate: "2026-12-01",
    displayMode: "days-hours",
  });
  assertEquals(document.widgets[3], {
    type: "world-clock.list",
    title: "Clocks",
    collapsed: false,
    clocks: [{ label: "Tokyo", timeZone: "Asia/Tokyo" }, { label: "Bad", timeZone: "" }],
  });
  assertEquals(document.widgets[4], {
    type: "calendar.month",
    title: "Cal",
    collapsed: false,
    weekStartsOn: 0,
  });
  assertEquals(document.widgets[5], { type: "other", title: "Future", collapsed: false });
});

Deno.test("preview reports image status but never paths or URLs", () => {
  const { theme } = projectSnapshotPreview(DOCUMENT).document!;
  assertEquals(theme, {
    presetId: "classic",
    accent: "#246bfe",
    banner: { configured: true, source: "storage", contentType: "image/png" },
    background: { configured: true, source: "external", contentType: null },
  });
});

Deno.test("preview drops ids, keywords, sync, billing and asset locations", () => {
  const raw = JSON.stringify(projectSnapshotPreview(DOCUMENT));
  for (
    const secret of [
      "doc-secret-id",
      "space-secret",
      "private keywords",
      "user-id/banner.png",
      "images.example",
      "stripeCustomerId",
      "syncMeta",
      '"s1"',
      '"n1"',
      "https://x",
    ]
  ) {
    assert(!raw.includes(secret), `preview leaked ${secret}`);
  }
});

Deno.test("preview rejects anything but a version 2 document", () => {
  for (
    const source of [null, "text", [], { version: 1, groups: [] }, { version: 2 }, {
      version: 2,
      groups: {},
    }]
  ) {
    assertEquals(projectSnapshotPreview(source), {
      status: "unsupported",
      truncated: false,
      document: null,
    });
  }
});

Deno.test("preview cuts over-long text and over-long lists and says so", () => {
  const result = projectSnapshotPreview({
    version: 2,
    documentTitle: "t".repeat(500),
    groups: [{
      title: "g",
      order: 1,
      sites: Array.from(
        { length: 300 },
        (_, i) => ({ name: `s${i}`, url: "u", mark: "m", order: i }),
      ),
    }],
    widgets: [{
      type: "notes.list",
      title: "n",
      order: 1,
      config: {
        notes: Array.from({ length: 30 }, (_, i) => ({ text: "x".repeat(900), order: i })),
      },
    }],
    theme: { presetId: "unknown", accent: "red" },
  });
  assertEquals(result.status, "ok");
  assertEquals(result.truncated, true);
  const document = result.document!;
  assertEquals(document.documentTitle.length, 80);
  assertEquals(document.groups[0].sites.length, 200);
  const notes = document.widgets[0];
  assert(notes.type === "notes.list");
  assertEquals(notes.notes.length, 20);
  assertEquals(notes.notes[0].length, 500);
  assertEquals(document.theme.presetId, null);
  assertEquals(document.theme.accent, null);
});

Deno.test("preview stays under the response limit for the largest documents", () => {
  const longUrl = `https://example.com/${"p".repeat(2100)}`;
  const result = projectSnapshotPreview({
    version: 2,
    documentTitle: "Big",
    groups: Array.from({ length: 120 }, (_, g) => ({
      title: "標題".repeat(50),
      order: g,
      sites: Array.from({ length: 250 }, (_, s) => ({
        name: "名前".repeat(50),
        url: longUrl,
        mark: "m",
        order: s,
      })),
    })),
    widgets: [],
  });
  assertEquals(result.truncated, true);
  const bytes = new TextEncoder().encode(JSON.stringify(result)).length;
  assert(bytes < MAX_RESPONSE_BYTES - 16 * 1024, `preview is ${bytes} bytes`);
});
