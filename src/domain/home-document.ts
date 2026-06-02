export const HOME_DOCUMENT_VERSION = 2;
export const V1_STORAGE_KEY = "homepage:data:v1";
export const V2_STORAGE_KEY = "homepage:document:v2";

export type SyncMode = "local";
export type SyncStatus = "local-only";
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
  config: Record<string, unknown>;
}

export interface HomeTheme {
  accent: string;
  bannerUrl: string | null;
  backgroundUrl: string | null;
}

export interface HomeSyncMeta {
  mode: SyncMode;
  status: SyncStatus;
  provider: null;
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
  provider: null
};

const DEFAULT_BILLING_META: HomeBillingMeta = {
  plan: "free",
  stripeCustomerId: null
};

export const WIDGET_REGISTRY: Record<HomeWidgetType, { title: string }> = {
  "calendar.month": { title: "月历" },
  "todo.list": { title: "Todo" }
};

export const DEFAULT_HOME_DOCUMENT_V2: HomeDocumentV2 = {
  version: HOME_DOCUMENT_VERSION,
  documentId: "local-default",
  updatedAt: "2026-06-02T00:00:00.000Z",
  revision: 0,
  theme: DEFAULT_THEME,
  syncMeta: DEFAULT_SYNC_META,
  billing: DEFAULT_BILLING_META,
  widgets: [],
  groups: [
    {
      id: "group-search-email",
      title: "搜索与邮箱",
      keywords: "搜索 引擎 邮箱 邮件",
      order: 1,
      sites: [
        { id: "site-google", name: "Google", mark: "G", url: "https://www.google.com.hk/", keywords: "", order: 1 },
        { id: "site-netease-mail", name: "网易邮箱", mark: "邮", url: "https://email.163.com/", keywords: "", order: 2 }
      ]
    },
    {
      id: "group-dev",
      title: "技术与开发",
      keywords: "代码 仓库 编程 开发 云服务",
      order: 2,
      sites: [
        { id: "site-github", name: "GitHub", mark: "GH", url: "https://github.com/", keywords: "git 代码 仓库", order: 1 },
        { id: "site-gitee", name: "Gitee", mark: "GE", url: "https://gitee.com/", keywords: "git 代码 仓库", order: 2 },
        { id: "site-bitbucket", name: "BitBucket", mark: "BB", url: "https://bitbucket.org/product", keywords: "git 代码 仓库", order: 3 },
        { id: "site-csdn", name: "CSDN", mark: "CS", url: "https://www.csdn.net/", keywords: "技术 开发 博客", order: 4 },
        { id: "site-aliyun-yq", name: "阿里云栖社区", mark: "云", url: "https://yq.aliyun.com/", keywords: "技术 开发 阿里云", order: 5 },
        { id: "site-aws", name: "AWS", mark: "AWS", url: "https://aws.amazon.com/cn/", keywords: "云服务 云计算", order: 6 },
        { id: "site-leetcode", name: "LeetCode", mark: "LC", url: "https://leetcode.com/", keywords: "算法 刷题 编程", order: 7 },
        { id: "site-v2ex", name: "V2EX", mark: "V2", url: "https://www.v2ex.com/", keywords: "社区 技术", order: 8 }
      ]
    },
    {
      id: "group-news",
      title: "新闻与阅读",
      keywords: "新闻 阅读 英语 杂志 报纸",
      order: 3,
      sites: [
        { id: "site-economist", name: "The Economist", mark: "TE", url: "https://www.economist.com/", keywords: "", order: 1 },
        { id: "site-fortune", name: "Fortune", mark: "FO", url: "https://fortune.com/", keywords: "", order: 2 },
        { id: "site-nytimes", name: "The New York Times", mark: "NY", url: "https://www.nytimes.com/", keywords: "", order: 3 },
        { id: "site-washington-post", name: "The Washington Post", mark: "WP", url: "https://www.washingtonpost.com/", keywords: "", order: 4 },
        { id: "site-latimes", name: "Los Angeles Times", mark: "LA", url: "https://www.latimes.com/", keywords: "", order: 5 },
        { id: "site-wsj", name: "The Wall Street Journal", mark: "WS", url: "https://www.wsj.com/", keywords: "", order: 6 },
        { id: "site-scientific-american", name: "Scientific American", mark: "SA", url: "https://www.scientificamerican.com/", keywords: "", order: 7 },
        { id: "site-shanbay", name: "扇贝", mark: "扇", url: "https://web.shanbay.com/web/main/index/", keywords: "", order: 8 }
      ]
    },
    {
      id: "group-learning",
      title: "学习",
      keywords: "课程 在线学习 mooc",
      order: 4,
      sites: [
        { id: "site-xuetangx", name: "学堂在线", mark: "学", url: "https://www.xuetangx.com/", keywords: "", order: 1 },
        { id: "site-coursera", name: "Coursera", mark: "C", url: "https://www.coursera.org/", keywords: "", order: 2 }
      ]
    },
    {
      id: "group-sports",
      title: "运动",
      keywords: "跑步 马拉松 体育 篮球 足球",
      order: 5,
      sites: [
        { id: "site-zhibo8", name: "直播吧", mark: "播", url: "https://www.zhibo8.cc/", keywords: "", order: 1 },
        { id: "site-marathon-tieba", name: "马拉松吧", mark: "马", url: "https://tieba.baidu.com/f?kw=%E9%A9%AC%E6%8B%89%E6%9D%BE&fr=wwwt", keywords: "", order: 2 },
        { id: "site-iranshao", name: "爱燃烧", mark: "燃", url: "https://iranshao.com/", keywords: "", order: 3 },
        { id: "site-nike", name: "Nike", mark: "NK", url: "https://www.nike.com/cn/zh_cn/", keywords: "", order: 4 }
      ]
    },
    {
      id: "group-life",
      title: "金融生活",
      keywords: "银行 金融 房产 汽车 日历 生活",
      order: 6,
      sites: [
        { id: "site-bankcomm", name: "交通银行", mark: "交", url: "https://www.bankcomm.com/BankCommSite/default.shtml", keywords: "", order: 1 },
        { id: "site-cmb", name: "招商银行", mark: "招", url: "https://www.cmbchina.com/", keywords: "", order: 2 },
        { id: "site-icbc", name: "工商银行", mark: "工", url: "https://www.icbc.com.cn/icbc/", keywords: "", order: 3 },
        { id: "site-lianjia", name: "链家", mark: "链", url: "https://sh.lianjia.com/", keywords: "", order: 4 },
        { id: "site-calendar", name: "万年历", mark: "历", url: "https://www.baidu.com/s?word=%E4%B8%87%E5%B9%B4%E5%8E%86&tn=sitehao123_pg&ie=utf-8", keywords: "", order: 5 }
      ]
    },
    {
      id: "group-social",
      title: "社交内容",
      keywords: "社交 内容 知识 社区",
      order: 7,
      sites: [
        { id: "site-zhihu", name: "知乎", mark: "知", url: "https://www.zhihu.com/", keywords: "", order: 1 },
        { id: "site-wechat-mp", name: "微信公众号", mark: "众", url: "https://mp.weixin.qq.com/", keywords: "", order: 2 }
      ]
    },
    {
      id: "group-entertain-shopping-jobs",
      title: "娱乐购物求职",
      keywords: "娱乐 视频 购物 招聘 求职 工作 美食",
      order: 8,
      sites: [
        { id: "site-douyu", name: "斗鱼", mark: "斗", url: "https://www.douyu.com/", keywords: "", order: 1 },
        { id: "site-huya", name: "虎牙", mark: "虎", url: "https://www.huya.com/", keywords: "", order: 2 }
      ]
    }
  ]
};

export function createDefaultHomeDocument(): HomeDocumentV2 {
  return clone(DEFAULT_HOME_DOCUMENT_V2);
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
  return sortByOrder(groups).map((group, groupIndex) => ({
    ...group,
    order: groupIndex + 1,
    sites: renumberSites(group.sites)
  }));
}

export function renumberSites(sites: HomeSite[]): HomeSite[] {
  return sortByOrder(sites).map((site, siteIndex) => ({
    ...site,
    order: siteIndex + 1
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

  const groups = input.groups.map(normalizeGroup).sort((a, b) => a.order - b.order)
    .map((group, groupIndex) => ({
      ...group,
      order: groupIndex + 1,
      sites: renumberSites(group.sites)
    }));

  return {
    version: HOME_DOCUMENT_VERSION,
    documentId: normalizeText(input.documentId) || createId("home"),
    updatedAt: normalizeText(input.updatedAt) || new Date().toISOString(),
    revision: Number.isFinite(Number(input.revision)) ? Number(input.revision) : 0,
    groups,
    widgets: normalizeWidgets(input.widgets),
    theme: normalizeTheme(input.theme),
    syncMeta: DEFAULT_SYNC_META,
    billing: DEFAULT_BILLING_META
  };
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

  return input
    .filter((widget): widget is Record<string, unknown> => isRecord(widget) && isWidgetType(widget.type))
    .map((widget, widgetIndex) => ({
      id: normalizeText(widget.id) || createId("widget"),
      type: widget.type as HomeWidgetType,
      title: normalizeText(widget.title) || WIDGET_REGISTRY[widget.type as HomeWidgetType].title,
      order: Number.isFinite(Number(widget.order)) ? Number(widget.order) : widgetIndex + 1,
      config: isRecord(widget.config) ? widget.config : {}
    }))
    .sort((a, b) => a.order - b.order)
    .map((widget, widgetIndex) => ({ ...widget, order: widgetIndex + 1 }));
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

function isWidgetType(value: unknown): value is HomeWidgetType {
  return value === "calendar.month" || value === "todo.list";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
