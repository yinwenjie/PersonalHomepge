import {
  isWidgetType,
  normalizeWidgetConfig,
  WIDGET_REGISTRY
} from "@/domain/widget-registry";

export const HOME_DOCUMENT_VERSION = 2;
export const SYNC_REVISION_MAX = 999;
export const V1_STORAGE_KEY = "homepage:data:v1";
export const V2_STORAGE_KEY = "homepage:document:v2";
export const RESET_BACKUP_STORAGE_KEY = "homepage:reset-backup:v1";
export const UNGROUPED_GROUP_ID = "group-ungrouped";

export type SyncMode = "local" | "sync-code";
export type SyncStatus =
  | "local-only"
  | "linked"
  | "syncing"
  | "synced"
  | "paused"
  | "offline"
  | "conflict"
  | "error";
export type HomeWidgetType = "calendar.month" | "todo.list";

export interface HomeSite {
  id: string;
  name: string;
  url: string;
  keywords: string;
  mark: string;
  order: number;
}

export interface HomeGroup {
  id: string;
  title: string;
  keywords: string;
  order: number;
  sites: HomeSite[];
}

export interface HomeWidget {
  id: string;
  type: HomeWidgetType;
  title: string;
  order: number;
  layout: HomeWidgetLayout;
  config: Record<string, unknown>;
}

export interface HomeWidgetLayout {
  collapsed: boolean;
}

export interface HomeTheme {
  accent: string;
  bannerUrl: string | null;
  backgroundUrl: string | null;
}

export interface HomeSyncMeta {
  mode: SyncMode;
  status: SyncStatus;
  provider: "supabase" | null;
  spaceId: string | null;
  remoteRevision: number | null;
  lastSyncedAt: string | null;
}

export interface HomeBillingMeta {
  plan: "free";
  stripeCustomerId: null;
}

export interface HomeDocumentV2 {
  version: typeof HOME_DOCUMENT_VERSION;
  documentId: string;
  updatedAt: string;
  revision: number;
  groups: HomeGroup[];
  widgets: HomeWidget[];
  theme: HomeTheme;
  syncMeta: HomeSyncMeta;
  billing: HomeBillingMeta;
}

const DEFAULT_THEME: HomeTheme = {
  accent: "#246bfe",
  bannerUrl: null,
  backgroundUrl: null
};

const DEFAULT_SYNC_META: HomeSyncMeta = {
  mode: "local",
  status: "local-only",
  provider: null,
  spaceId: null,
  remoteRevision: null,
  lastSyncedAt: null
};

const DEFAULT_BILLING_META: HomeBillingMeta = {
  plan: "free",
  stripeCustomerId: null
};

const DEFAULT_WIDGET_LAYOUT: HomeWidgetLayout = {
  collapsed: false
};

export const DEFAULT_HOME_DOCUMENT_V2: HomeDocumentV2 = {
  version: HOME_DOCUMENT_VERSION,
  documentId: "local-default",
  updatedAt: "2026-06-03T00:00:00.000Z",
  revision: 0,
  theme: DEFAULT_THEME,
  syncMeta: DEFAULT_SYNC_META,
  billing: DEFAULT_BILLING_META,
  widgets: [],
  groups: [
    {
      id: UNGROUPED_GROUP_ID,
      title: "未分组",
      keywords: "未分组 ungrouped uncategorized",
      order: 0,
      sites: []
    },
    {
      id: "group-search",
      title: "搜索",
      keywords: "搜索 引擎 web search",
      order: 1,
      sites: [
        { id: "site-google", name: "Google", mark: "G", url: "https://www.google.com/", keywords: "search", order: 1 },
        { id: "site-duckduckgo", name: "DuckDuckGo", mark: "DDG", url: "https://duckduckgo.com/", keywords: "search privacy", order: 2 },
        { id: "site-bing", name: "Bing", mark: "B", url: "https://www.bing.com/", keywords: "search", order: 3 }
      ]
    },
    {
      id: "group-ai",
      title: "AI",
      keywords: "ai assistant chatbot productivity",
      order: 2,
      sites: [
        { id: "site-chatgpt", name: "ChatGPT", mark: "CG", url: "https://chatgpt.com/", keywords: "openai ai assistant", order: 1 },
        { id: "site-claude", name: "Claude", mark: "CL", url: "https://claude.ai/", keywords: "ai assistant", order: 2 },
        { id: "site-gemini", name: "Gemini", mark: "GM", url: "https://gemini.google.com/", keywords: "google ai assistant", order: 3 },
        { id: "site-perplexity", name: "Perplexity", mark: "PX", url: "https://www.perplexity.ai/", keywords: "ai search", order: 4 }
      ]
    },
    {
      id: "group-development",
      title: "开发",
      keywords: "代码 编程 开发 文档 package",
      order: 3,
      sites: [
        { id: "site-github", name: "GitHub", mark: "GH", url: "https://github.com/", keywords: "git code repository", order: 1 },
        { id: "site-stack-overflow", name: "Stack Overflow", mark: "SO", url: "https://stackoverflow.com/", keywords: "programming questions", order: 2 },
        { id: "site-mdn", name: "MDN", mark: "MDN", url: "https://developer.mozilla.org/", keywords: "web docs javascript css html", order: 3 },
        { id: "site-npm", name: "npm", mark: "npm", url: "https://www.npmjs.com/", keywords: "node package", order: 4 }
      ]
    },
    {
      id: "group-learning",
      title: "学习",
      keywords: "课程 知识 视频 在线学习",
      order: 4,
      sites: [
        { id: "site-wikipedia", name: "Wikipedia", mark: "W", url: "https://www.wikipedia.org/", keywords: "encyclopedia knowledge", order: 1 },
        { id: "site-coursera", name: "Coursera", mark: "C", url: "https://www.coursera.org/", keywords: "course mooc", order: 2 },
        { id: "site-youtube", name: "YouTube", mark: "YT", url: "https://www.youtube.com/", keywords: "video learning", order: 3 },
        { id: "site-khan-academy", name: "Khan Academy", mark: "KA", url: "https://www.khanacademy.org/", keywords: "course math science", order: 4 }
      ]
    },
    {
      id: "group-productivity",
      title: "效率",
      keywords: "工作 文档 日历 文件 任务",
      order: 5,
      sites: [
        { id: "site-notion", name: "Notion", mark: "N", url: "https://www.notion.so/", keywords: "notes docs workspace", order: 1 },
        { id: "site-google-calendar", name: "Google Calendar", mark: "GC", url: "https://calendar.google.com/", keywords: "calendar schedule", order: 2 },
        { id: "site-google-drive", name: "Google Drive", mark: "GD", url: "https://drive.google.com/", keywords: "files cloud docs", order: 3 },
        { id: "site-todoist", name: "Todoist", mark: "TD", url: "https://todoist.com/", keywords: "todo tasks", order: 4 }
      ]
    },
    {
      id: "group-reading",
      title: "阅读",
      keywords: "新闻 阅读 资讯 文章",
      order: 6,
      sites: [
        { id: "site-reuters", name: "Reuters", mark: "RT", url: "https://www.reuters.com/", keywords: "news", order: 1 },
        { id: "site-bbc", name: "BBC", mark: "BBC", url: "https://www.bbc.com/", keywords: "news", order: 2 },
        { id: "site-hacker-news", name: "Hacker News", mark: "HN", url: "https://news.ycombinator.com/", keywords: "technology startup news", order: 3 },
        { id: "site-medium", name: "Medium", mark: "M", url: "https://medium.com/", keywords: "articles writing", order: 4 }
      ]
    },
    {
      id: "group-life",
      title: "生活",
      keywords: "地图 购物 社区 生活",
      order: 7,
      sites: [
        { id: "site-google-maps", name: "Google Maps", mark: "GM", url: "https://www.google.com/maps", keywords: "map navigation", order: 1 },
        { id: "site-amazon", name: "Amazon", mark: "AZ", url: "https://www.amazon.com/", keywords: "shopping", order: 2 },
        { id: "site-reddit", name: "Reddit", mark: "R", url: "https://www.reddit.com/", keywords: "community discussion", order: 3 }
      ]
    }
  ]
};

export function createDefaultHomeDocument(): HomeDocumentV2 {
  return clone(DEFAULT_HOME_DOCUMENT_V2);
}

export function isUngroupedGroup(group: Pick<HomeGroup, "id">): boolean {
  return group.id === UNGROUPED_GROUP_ID;
}

export function createUngroupedGroup(sites: HomeSite[] = []): HomeGroup {
  return {
    id: UNGROUPED_GROUP_ID,
    title: "未分组",
    keywords: "未分组 ungrouped uncategorized",
    order: 0,
    sites: renumberSites(sites)
  };
}

export function normalizeRevision(value: unknown): number {
  const revision = Math.trunc(Number(value));
  if (!Number.isFinite(revision) || revision < 0) {
    return 0;
  }

  return revision > SYNC_REVISION_MAX ? 0 : revision;
}

export function nextRevision(value: unknown): number {
  const revision = normalizeRevision(value);
  return revision >= SYNC_REVISION_MAX ? 0 : revision + 1;
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createId(prefix: string): string {
  const cryptoApi = globalThis.crypto;
  const randomPart = cryptoApi?.getRandomValues
    ? Array.from(cryptoApi.getRandomValues(new Uint32Array(2)), (value) => value.toString(36)).join("")
    : Math.random().toString(36).slice(2);

  return `${prefix}-${Date.now().toString(36)}-${randomPart}`;
}

export function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

export function normalizeSearchText(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

export function isValidUrl(value: unknown): boolean {
  try {
    const url = new URL(normalizeText(value));
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function normalizeUrl(value: unknown): string {
  return new URL(normalizeText(value)).href;
}

export function generateMark(name: string): string {
  const value = normalizeText(name);
  if (!value) {
    return "站";
  }

  const cjk = value.match(/[\u4e00-\u9fff]/);
  if (cjk) {
    return cjk[0];
  }

  const parts = value.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  const initials = parts.map((part) => part[0]).join("").slice(0, 3).toUpperCase();
  return initials || value.slice(0, 2).toUpperCase();
}

export function sortByOrder<T extends { order: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.order - b.order);
}

export function renumberGroups(groups: HomeGroup[]): HomeGroup[] {
  const sortedGroups = sortByOrder(groups);
  const existingUngrouped = sortedGroups.find(isUngroupedGroup);
  const regularGroups = sortedGroups.filter((group) => !isUngroupedGroup(group));

  return [
    createUngroupedGroup(existingUngrouped?.sites ?? []),
    ...regularGroups.map((group, groupIndex) => ({
      ...group,
      order: groupIndex + 1,
      sites: renumberSites(group.sites)
    }))
  ];
}

export function renumberSites(sites: HomeSite[]): HomeSite[] {
  return sortByOrder(sites).map((site, siteIndex) => ({
    ...site,
    order: siteIndex + 1
  }));
}

export function renumberWidgets(widgets: HomeWidget[]): HomeWidget[] {
  return sortByOrder(widgets).map((widget, widgetIndex) => ({
    ...widget,
    order: widgetIndex + 1
  }));
}

export function validateHomeDocument(input: unknown): input is HomeDocumentV2 {
  if (!isRecord(input)) {
    return false;
  }

  return input.version === HOME_DOCUMENT_VERSION && Array.isArray(input.groups);
}

export function normalizeHomeDocument(input: unknown): HomeDocumentV2 {
  if (!validateHomeDocument(input)) {
    throw new Error("Invalid HomeDocumentV2");
  }

  const groups = renumberGroups(input.groups.map(normalizeGroup));

  return {
    version: HOME_DOCUMENT_VERSION,
    documentId: normalizeText(input.documentId) || createId("home"),
    updatedAt: normalizeText(input.updatedAt) || new Date().toISOString(),
    revision: normalizeRevision(input.revision),
    groups,
    widgets: normalizeWidgets(input.widgets),
    theme: normalizeTheme(input.theme),
    syncMeta: normalizeSyncMeta(input.syncMeta),
    billing: DEFAULT_BILLING_META
  };
}

export function isDefaultHomeDocumentContent(documentValue: HomeDocumentV2): boolean {
  const current = toHomeDocumentContentSnapshot(normalizeHomeDocument(documentValue));
  const defaults = toHomeDocumentContentSnapshot(createDefaultHomeDocument());

  return JSON.stringify(current) === JSON.stringify(defaults);
}

export function migrateV1ToV2(input: unknown): HomeDocumentV2 {
  if (!isRecord(input) || input.version !== 1 || !Array.isArray(input.groups)) {
    throw new Error("Invalid legacy HomeDocument");
  }

  return normalizeHomeDocument({
    version: HOME_DOCUMENT_VERSION,
    documentId: "local-migrated",
    updatedAt: normalizeText(input.updatedAt) || new Date().toISOString(),
    revision: 1,
    groups: input.groups,
    widgets: Array.isArray(input.widgets) ? input.widgets : [],
    theme: isRecord(input.theme) ? input.theme : DEFAULT_THEME,
    syncMeta: DEFAULT_SYNC_META,
    billing: DEFAULT_BILLING_META
  });
}

function toHomeDocumentContentSnapshot(documentValue: HomeDocumentV2) {
  return {
    groups: documentValue.groups,
    widgets: documentValue.widgets,
    theme: documentValue.theme
  };
}

function normalizeGroup(input: unknown, groupIndex: number): HomeGroup {
  if (!isRecord(input)) {
    return {
      id: createId("group"),
      title: "未命名分组",
      keywords: "",
      order: groupIndex + 1,
      sites: []
    };
  }

  const title = normalizeText(input.title) || "未命名分组";
  const legacySites = Array.isArray(input.sites)
    ? input.sites
    : Array.isArray(input.items)
      ? input.items
      : [];

  return {
    id: normalizeText(input.id) || createId("group"),
    title,
    keywords: normalizeText(input.keywords),
    order: Number.isFinite(Number(input.order)) ? Number(input.order) : groupIndex + 1,
    sites: legacySites
      .filter((site) => isRecord(site) && normalizeText(site.name) && isValidUrl(site.url))
      .map(normalizeSite)
  };
}

function normalizeSite(input: unknown, siteIndex: number): HomeSite {
  if (!isRecord(input)) {
    throw new Error("Invalid site");
  }

  const name = normalizeText(input.name);
  const mark = normalizeText(input.mark || generateMark(name)).slice(0, 3) || generateMark(name);

  return {
    id: normalizeText(input.id) || createId("site"),
    name,
    url: normalizeUrl(input.url),
    keywords: normalizeText(input.keywords),
    mark,
    order: Number.isFinite(Number(input.order)) ? Number(input.order) : siteIndex + 1
  };
}

function normalizeWidgets(input: unknown): HomeWidget[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const normalizedWidgets = input
    .filter((widget): widget is Record<string, unknown> => isRecord(widget) && isWidgetType(widget.type))
    .map((widget, widgetIndex) => ({
      id: normalizeText(widget.id) || createId("widget"),
      type: widget.type as HomeWidgetType,
      title: normalizeText(widget.title) || WIDGET_REGISTRY[widget.type as HomeWidgetType].defaultTitle,
      order: Number.isFinite(Number(widget.order)) ? Number(widget.order) : widgetIndex + 1,
      layout: normalizeWidgetLayout(widget.layout),
      config: normalizeWidgetConfig(widget.type as HomeWidgetType, widget.config)
    }))
    .sort((a, b) => a.order - b.order);

  const seenSingletonTypes = new Set<HomeWidgetType>();

  return normalizedWidgets
    .filter((widget) => {
      const definition = WIDGET_REGISTRY[widget.type];

      if (definition.allowMultiple) {
        return true;
      }

      if (seenSingletonTypes.has(widget.type)) {
        return false;
      }

      seenSingletonTypes.add(widget.type);
      return true;
    })
    .map((widget, widgetIndex) => ({ ...widget, order: widgetIndex + 1 }));
}

function normalizeWidgetLayout(input: unknown): HomeWidgetLayout {
  if (!isRecord(input)) {
    return DEFAULT_WIDGET_LAYOUT;
  }

  return {
    collapsed: Boolean(input.collapsed)
  };
}

function normalizeTheme(input: unknown): HomeTheme {
  if (!isRecord(input)) {
    return DEFAULT_THEME;
  }

  return {
    accent: normalizeText(input.accent) || DEFAULT_THEME.accent,
    bannerUrl: isValidUrl(input.bannerUrl) ? normalizeUrl(input.bannerUrl) : null,
    backgroundUrl: isValidUrl(input.backgroundUrl) ? normalizeUrl(input.backgroundUrl) : null
  };
}

function normalizeSyncMeta(input: unknown): HomeSyncMeta {
  if (!isRecord(input)) {
    return DEFAULT_SYNC_META;
  }

  const mode = input.mode === "sync-code" ? "sync-code" : "local";
  const provider = mode === "sync-code" && input.provider === "supabase" ? "supabase" : null;
  const status = isSyncStatus(input.status)
    ? input.status
    : mode === "sync-code"
      ? "linked"
      : "local-only";

  return {
    mode,
    status: mode === "local" ? "local-only" : status,
    provider,
    spaceId: mode === "sync-code" ? normalizeText(input.spaceId) || null : null,
    remoteRevision: mode === "sync-code" && Number.isFinite(Number(input.remoteRevision))
      ? normalizeRevision(input.remoteRevision)
      : null,
    lastSyncedAt: mode === "sync-code" ? normalizeText(input.lastSyncedAt) || null : null
  };
}

function isSyncStatus(value: unknown): value is SyncStatus {
  return value === "local-only"
    || value === "linked"
    || value === "syncing"
    || value === "synced"
    || value === "paused"
    || value === "offline"
    || value === "conflict"
    || value === "error";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
