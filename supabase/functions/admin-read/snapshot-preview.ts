// Phase 1.18.5 snapshot preview projection. Server-only.
// Turns one stored HomeDocumentV2 into AdminSnapshotPreviewDocument: a fixed whitelist of
// fields with bounded text, so the browser never receives the raw document_json. Not
// included: documentId, syncMeta, billing, item ids and timestamps, asset paths and URLs.
// Site URLs are returned as plain text for display; the Admin UI must not link or fetch them.

export const SNAPSHOT_PREVIEW_VERSION = 1;
/** Stored documents larger than this are not loaded at all (migration 024). */
export const MAX_PREVIEW_DOCUMENT_BYTES = 1024 * 1024;
/** UTF-8 budget for the serialized groups and widgets, well under MAX_RESPONSE_BYTES. */
export const PREVIEW_TEXT_BUDGET_BYTES = 160 * 1024;

const LIMITS = {
  documentTitle: 80,
  groups: 100,
  sitesPerGroup: 200,
  groupTitle: 80,
  siteName: 80,
  siteMark: 20,
  siteUrl: 2048,
  widgets: 50,
  widgetTitle: 80,
  countdownTitle: 80,
  notes: 20,
  noteText: 500,
  todoItems: 100,
  todoTitle: 120,
  clocks: 6,
  clockLabel: 40,
  timeZone: 64,
} as const;

const THEME_PRESET_IDS = new Set([
  "classic",
  "focus",
  "dense",
  "soft",
  "glass",
  "editorial",
  "terminal",
  "mono",
  "millennium",
  "slate",
  "mint",
  "indigo",
  "sunrise",
]);
const ASSET_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
]);
const ACCENT_PATTERN = /^#[0-9a-f]{6}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_ZONE_PATTERN = /^[A-Za-z0-9_+\-/]+$/;

export interface PreviewAssetStatus {
  configured: boolean;
  source: "storage" | "external" | null;
  contentType: string | null;
}

export interface PreviewSite {
  name: string;
  /** Plain text only; never a link and never fetched. */
  url: string;
  mark: string;
}

export interface PreviewGroup {
  title: string;
  sites: PreviewSite[];
}

export type PreviewWidget =
  | { type: "calendar.month"; title: string; collapsed: boolean; weekStartsOn: 0 | 1 }
  | {
    type: "countdown.timer";
    title: string;
    collapsed: boolean;
    eventTitle: string;
    targetDate: string;
    displayMode: "days" | "days-hours";
  }
  | { type: "notes.list"; title: string; collapsed: boolean; notes: string[] }
  | {
    type: "todo.list";
    title: string;
    collapsed: boolean;
    items: { title: string; completed: boolean }[];
  }
  | {
    type: "world-clock.list";
    title: string;
    collapsed: boolean;
    clocks: { label: string; timeZone: string }[];
  }
  | { type: "other"; title: string; collapsed: boolean };

export interface AdminSnapshotPreviewDocument {
  previewVersion: typeof SNAPSHOT_PREVIEW_VERSION;
  documentTitle: string;
  theme: {
    presetId: string | null;
    accent: string | null;
    banner: PreviewAssetStatus;
    background: PreviewAssetStatus;
  };
  /** Sorted by the stored order. */
  groups: PreviewGroup[];
  /** Sorted by the stored order. */
  widgets: PreviewWidget[];
}

export type SnapshotPreviewResult =
  | { status: "ok"; truncated: boolean; document: AdminSnapshotPreviewDocument }
  | { status: "unsupported" | "too_large"; truncated: false; document: null };

/** Tracks text cuts and the overall text budget while projecting. */
class Projector {
  truncated = false;
  private remaining = PREVIEW_TEXT_BUDGET_BYTES;
  private readonly encoder = new TextEncoder();

  /** A string field cut to `max` characters; non-strings become "". */
  text(value: unknown, max: number): string {
    if (typeof value !== "string") {
      return "";
    }
    const chars = [...value];
    if (chars.length > max) {
      this.truncated = true;
      return chars.slice(0, max).join("");
    }
    return value;
  }

  /**
   * Charges `value` as it will be serialized (escaping, keys and a separator included);
   * false (and truncated) once the budget is spent.
   */
  fits(value: unknown): boolean {
    const bytes = this.encoder.encode(JSON.stringify(value)).length + 1;
    if (bytes > this.remaining) {
      this.truncated = true;
      return false;
    }
    this.remaining -= bytes;
    return true;
  }

  /** Array items in stored order, at most `max` of them. */
  list(value: unknown, max: number): Record<string, unknown>[] {
    if (!Array.isArray(value)) {
      return [];
    }
    const sorted = value.filter(isRecord).sort((left, right) => orderOf(left) - orderOf(right));
    if (sorted.length > max) {
      this.truncated = true;
      return sorted.slice(0, max);
    }
    return sorted;
  }
}

export function projectSnapshotPreview(source: unknown): SnapshotPreviewResult {
  if (!isRecord(source) || source.version !== 2 || !Array.isArray(source.groups)) {
    return { status: "unsupported", truncated: false, document: null };
  }

  const p = new Projector();
  const documentTitle = p.text(source.documentTitle, LIMITS.documentTitle);
  p.fits(documentTitle);
  const theme = projectTheme(source.theme);

  const groups: PreviewGroup[] = [];
  for (const group of p.list(source.groups, LIMITS.groups)) {
    const title = p.text(group.title, LIMITS.groupTitle);
    if (!p.fits({ title, sites: [] })) {
      break;
    }
    const sites: PreviewSite[] = [];
    for (const site of p.list(group.sites, LIMITS.sitesPerGroup)) {
      const projected = {
        name: p.text(site.name, LIMITS.siteName),
        url: p.text(site.url, LIMITS.siteUrl),
        mark: p.text(site.mark, LIMITS.siteMark),
      };
      if (!p.fits(projected)) {
        break;
      }
      sites.push(projected);
    }
    groups.push({ title, sites });
  }

  const widgets: PreviewWidget[] = [];
  for (const widget of p.list(source.widgets, LIMITS.widgets)) {
    const projected = projectWidget(widget, p);
    if (!p.fits(projected)) {
      break;
    }
    widgets.push(projected);
  }

  return {
    status: "ok",
    truncated: p.truncated,
    document: {
      previewVersion: SNAPSHOT_PREVIEW_VERSION,
      documentTitle,
      theme,
      groups,
      widgets,
    },
  };
}

function projectTheme(value: unknown): AdminSnapshotPreviewDocument["theme"] {
  const theme = isRecord(value) ? value : {};
  const presetId = typeof theme.presetId === "string" && THEME_PRESET_IDS.has(theme.presetId)
    ? theme.presetId
    : null;
  const accent = typeof theme.accent === "string" && ACCENT_PATTERN.test(theme.accent)
    ? theme.accent.toLowerCase()
    : null;
  return {
    presetId,
    accent,
    banner: assetStatus(theme.bannerAsset, theme.bannerUrl),
    background: assetStatus(theme.backgroundAsset, theme.backgroundUrl),
  };
}

/** Whether an image is configured and where it comes from; never its path or URL. */
function assetStatus(asset: unknown, legacyUrl: unknown): PreviewAssetStatus {
  if (isRecord(asset)) {
    const source = asset.source === "storage" || asset.source === "external" ? asset.source : null;
    const contentType =
      typeof asset.contentType === "string" && ASSET_CONTENT_TYPES.has(asset.contentType)
        ? asset.contentType
        : null;
    return { configured: true, source, contentType };
  }
  if (typeof legacyUrl === "string" && legacyUrl.trim() !== "") {
    return { configured: true, source: "external", contentType: null };
  }
  return { configured: false, source: null, contentType: null };
}

function projectWidget(widget: Record<string, unknown>, p: Projector): PreviewWidget {
  const title = p.text(widget.title, LIMITS.widgetTitle);
  const collapsed = isRecord(widget.layout) && widget.layout.collapsed === true;
  const config = isRecord(widget.config) ? widget.config : {};

  switch (widget.type) {
    case "calendar.month":
      return {
        type: "calendar.month",
        title,
        collapsed,
        weekStartsOn: config.weekStartsOn === 0 ? 0 : 1,
      };
    case "countdown.timer":
      return {
        type: "countdown.timer",
        title,
        collapsed,
        eventTitle: p.text(config.eventTitle, LIMITS.countdownTitle),
        targetDate: typeof config.targetDate === "string" && DATE_PATTERN.test(config.targetDate)
          ? config.targetDate
          : "",
        displayMode: config.displayMode === "days-hours" ? "days-hours" : "days",
      };
    case "notes.list":
      return {
        type: "notes.list",
        title,
        collapsed,
        notes: p.list(config.notes, LIMITS.notes).map((note) => p.text(note.text, LIMITS.noteText)),
      };
    case "todo.list":
      return {
        type: "todo.list",
        title,
        collapsed,
        items: p.list(config.items, LIMITS.todoItems).map((item) => ({
          title: p.text(item.title, LIMITS.todoTitle),
          completed: item.completed === true,
        })),
      };
    case "world-clock.list":
      return {
        type: "world-clock.list",
        title,
        collapsed,
        clocks: p.list(config.clocks, LIMITS.clocks).map((clock) => ({
          label: p.text(clock.label, LIMITS.clockLabel),
          timeZone: typeof clock.timeZone === "string" &&
              clock.timeZone.length <= LIMITS.timeZone && TIME_ZONE_PATTERN.test(clock.timeZone)
            ? clock.timeZone
            : "",
        })),
      };
    default:
      return { type: "other", title, collapsed };
  }
}

function orderOf(item: Record<string, unknown>): number {
  // Items without a numeric order go last; the sort is stable, so they keep their position.
  return typeof item.order === "number" && Number.isFinite(item.order)
    ? item.order
    : Number.MAX_SAFE_INTEGER;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
