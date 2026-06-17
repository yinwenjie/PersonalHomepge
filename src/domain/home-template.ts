import {
  createDefaultHomeDocument,
  createId,
  generateMark,
  type HomeDocumentV2,
  normalizeHomeDocument
} from "@/domain/home-document";

export type HomeTemplateId =
  | "blank"
  | "minimal"
  | "general-productivity"
  | "work-office"
  | "developer-workbench"
  | "learning-research";

export interface HomeTemplateSiteSpec {
  name: string;
  url: string;
  keywords: string;
  mark?: string;
}

export interface HomeTemplateGroupSpec {
  title: string;
  keywords: string;
  sites: HomeTemplateSiteSpec[];
}

export interface HomeTemplate {
  id: HomeTemplateId;
  name: string;
  shortName: string;
  summary: string;
  recommendedSpaceName: string;
  accent: string;
  groups: HomeTemplateGroupSpec[];
}

export interface HomeTemplateSummary {
  groupCount: number;
  siteCount: number;
  sampleSites: string[];
}

export const HOME_TEMPLATES: HomeTemplate[] = [
  {
    id: "blank",
    name: "空白首页",
    shortName: "空白",
    summary: "不预设任何网站，只保留一个干净的编辑起点。",
    recommendedSpaceName: "空白首页",
    accent: "#64748b",
    groups: []
  },
  {
    id: "minimal",
    name: "极简起步",
    shortName: "极简",
    summary: "少量全球常用入口，适合想快速开始、之后慢慢整理的人。",
    recommendedSpaceName: "极简首页",
    accent: "#2563eb",
    groups: [
      {
        title: "搜索与知识",
        keywords: "search knowledge ai video encyclopedia",
        sites: [
          site("Google", "https://www.google.com/", "search web google", "G"),
          site("YouTube", "https://www.youtube.com/", "video learning entertainment", "YT"),
          site("Wikipedia", "https://www.wikipedia.org/", "encyclopedia knowledge reference", "W"),
          site("ChatGPT", "https://chatgpt.com/", "ai assistant openai", "CG")
        ]
      },
      {
        title: "常用工具",
        keywords: "email files calendar notes productivity",
        sites: [
          site("Gmail", "https://mail.google.com/", "email google mail", "GM"),
          site("Google Drive", "https://drive.google.com/", "files docs cloud", "GD"),
          site("Google Calendar", "https://calendar.google.com/", "calendar schedule", "GC"),
          site("Notion", "https://www.notion.so/", "notes docs workspace", "N")
        ]
      }
    ]
  },
  {
    id: "general-productivity",
    name: "通用效率",
    shortName: "效率",
    summary: "覆盖搜索、AI、社交、内容、购物和日常工具的通用起点。",
    recommendedSpaceName: "通用效率首页",
    accent: "#0f766e",
    groups: [
      {
        title: "搜索与 AI",
        keywords: "search ai knowledge video assistant",
        sites: [
          site("Google", "https://www.google.com/", "search web google", "G"),
          site("YouTube", "https://www.youtube.com/", "video learning entertainment", "YT"),
          site("ChatGPT", "https://chatgpt.com/", "ai assistant openai", "CG"),
          site("Wikipedia", "https://www.wikipedia.org/", "encyclopedia knowledge reference", "W")
        ]
      },
      {
        title: "社交与社区",
        keywords: "social community network discussion",
        sites: [
          site("Facebook", "https://www.facebook.com/", "social network", "FB"),
          site("Instagram", "https://www.instagram.com/", "social photos reels", "IG"),
          site("X", "https://x.com/", "social news twitter", "X"),
          site("Reddit", "https://www.reddit.com/", "community discussion forum", "R"),
          site("LinkedIn", "https://www.linkedin.com/", "professional network jobs", "IN")
        ]
      },
      {
        title: "工作效率",
        keywords: "email files calendar notes workspace productivity",
        sites: [
          site("Gmail", "https://mail.google.com/", "email google mail", "GM"),
          site("Google Drive", "https://drive.google.com/", "files docs cloud", "GD"),
          site("Google Calendar", "https://calendar.google.com/", "calendar schedule", "GC"),
          site("Notion", "https://www.notion.so/", "notes docs workspace", "N"),
          site("Dropbox", "https://www.dropbox.com/", "files cloud storage", "DB")
        ]
      },
      {
        title: "购物与生活",
        keywords: "shopping travel maps life",
        sites: [
          site("Amazon", "https://www.amazon.com/", "shopping ecommerce", "AZ"),
          site("eBay", "https://www.ebay.com/", "shopping marketplace auction", "EB"),
          site("Booking", "https://www.booking.com/", "travel hotel booking", "BK"),
          site("Google Maps", "https://www.google.com/maps", "maps navigation places", "GM")
        ]
      }
    ]
  },
  {
    id: "work-office",
    name: "工作办公",
    shortName: "办公",
    summary: "面向日常办公、协作、会议和项目管理的入口集合。",
    recommendedSpaceName: "工作办公首页",
    accent: "#7c3aed",
    groups: [
      {
        title: "邮件与日历",
        keywords: "email calendar schedule office",
        sites: [
          site("Gmail", "https://mail.google.com/", "email google mail", "GM"),
          site("Outlook", "https://outlook.live.com/", "email microsoft outlook", "OL"),
          site("Google Calendar", "https://calendar.google.com/", "calendar schedule", "GC")
        ]
      },
      {
        title: "文档与云盘",
        keywords: "docs cloud files office storage",
        sites: [
          site("Google Drive", "https://drive.google.com/", "files docs cloud", "GD"),
          site("Google Docs", "https://docs.google.com/", "documents editor google", "GD"),
          site("Microsoft 365", "https://www.microsoft365.com/", "office microsoft docs", "M365"),
          site("OneDrive", "https://onedrive.live.com/", "files microsoft cloud", "OD"),
          site("Dropbox", "https://www.dropbox.com/", "files cloud storage", "DB")
        ]
      },
      {
        title: "协作沟通",
        keywords: "chat meeting collaboration communication",
        sites: [
          site("Slack", "https://slack.com/", "team chat collaboration", "SL"),
          site("Microsoft Teams", "https://www.microsoft.com/en-us/microsoft-teams/group-chat-software", "team chat meeting microsoft", "MT"),
          site("Zoom", "https://zoom.us/", "meeting video conference", "Z"),
          site("Google Meet", "https://meet.google.com/", "meeting video google", "GM")
        ]
      },
      {
        title: "项目管理",
        keywords: "project task planning workspace",
        sites: [
          site("Notion", "https://www.notion.so/", "notes docs workspace", "N"),
          site("Trello", "https://trello.com/", "kanban project tasks", "TR"),
          site("Asana", "https://asana.com/", "project management tasks", "AS"),
          site("Jira", "https://www.atlassian.com/software/jira", "issue project agile", "J")
        ]
      },
      {
        title: "职业与业务",
        keywords: "career business crm professional",
        sites: [
          site("LinkedIn", "https://www.linkedin.com/", "professional network jobs", "IN"),
          site("Salesforce", "https://www.salesforce.com/", "crm sales business", "SF")
        ]
      }
    ]
  },
  {
    id: "developer-workbench",
    name: "开发者工作台",
    shortName: "开发",
    summary: "代码托管、问答学习、包管理、文档和云部署的开发入口。",
    recommendedSpaceName: "开发者首页",
    accent: "#0891b2",
    groups: [
      {
        title: "代码与协作",
        keywords: "code git repository collaboration",
        sites: [
          site("GitHub", "https://github.com/", "git code repository", "GH"),
          site("GitLab", "https://gitlab.com/", "git code devops", "GL"),
          site("Bitbucket", "https://bitbucket.org/", "git code atlassian", "BB")
        ]
      },
      {
        title: "问答与学习",
        keywords: "programming questions docs learning tutorial",
        sites: [
          site("Stack Overflow", "https://stackoverflow.com/", "programming questions answers", "SO"),
          site("W3Schools", "https://www.w3schools.com/", "web tutorial html css javascript", "W3"),
          site("MDN", "https://developer.mozilla.org/", "web docs javascript css html", "MDN"),
          site("freeCodeCamp", "https://www.freecodecamp.org/", "learn coding practice", "FCC"),
          site("DEV", "https://dev.to/", "developer community articles", "DEV")
        ]
      },
      {
        title: "包与文档",
        keywords: "package docs framework runtime",
        sites: [
          site("npm", "https://www.npmjs.com/", "node package registry", "npm"),
          site("Docker Hub", "https://hub.docker.com/", "container image registry", "DH"),
          site("React", "https://react.dev/", "react frontend docs", "R"),
          site("Next.js", "https://nextjs.org/", "nextjs react framework", "NX"),
          site("TypeScript", "https://www.typescriptlang.org/", "typescript docs language", "TS")
        ]
      },
      {
        title: "云与部署",
        keywords: "cloud deploy hosting database edge",
        sites: [
          site("Vercel", "https://vercel.com/", "deploy hosting frontend", "V"),
          site("Supabase", "https://supabase.com/", "database auth postgres", "SB"),
          site("Cloudflare", "https://www.cloudflare.com/", "cdn dns edge cloud", "CF"),
          site("AWS", "https://aws.amazon.com/", "cloud amazon", "AWS")
        ]
      }
    ]
  },
  {
    id: "learning-research",
    name: "学习研究",
    shortName: "学习",
    summary: "面向自学、课程、学术搜索、论文资料和阅读笔记。",
    recommendedSpaceName: "学习研究首页",
    accent: "#ca8a04",
    groups: [
      {
        title: "通用知识",
        keywords: "knowledge encyclopedia video learning",
        sites: [
          site("Wikipedia", "https://www.wikipedia.org/", "encyclopedia knowledge reference", "W"),
          site("YouTube", "https://www.youtube.com/", "video learning entertainment", "YT"),
          site("Khan Academy", "https://www.khanacademy.org/", "course math science learning", "KA")
        ]
      },
      {
        title: "在线课程",
        keywords: "course mooc education university",
        sites: [
          site("Coursera", "https://www.coursera.org/", "course mooc university", "C"),
          site("edX", "https://www.edx.org/", "course mooc university", "EDX"),
          site("Udemy", "https://www.udemy.com/", "course learning skills", "U"),
          site("MIT OpenCourseWare", "https://ocw.mit.edu/", "mit course university", "MIT")
        ]
      },
      {
        title: "学术研究",
        keywords: "academic papers research scholar",
        sites: [
          site("Google Scholar", "https://scholar.google.com/", "academic search papers citations", "GS"),
          site("arXiv", "https://arxiv.org/", "papers preprint research", "AX"),
          site("Semantic Scholar", "https://www.semanticscholar.org/", "academic search papers ai", "SS"),
          site("ResearchGate", "https://www.researchgate.net/", "research network papers", "RG"),
          site("JSTOR", "https://www.jstor.org/", "journal archive academic", "JS")
        ]
      },
      {
        title: "阅读与笔记",
        keywords: "reading notes files reference",
        sites: [
          site("Notion", "https://www.notion.so/", "notes docs workspace", "N"),
          site("Google Drive", "https://drive.google.com/", "files docs cloud", "GD"),
          site("Zotero", "https://www.zotero.org/", "reference manager citations", "ZT")
        ]
      }
    ]
  }
];

export function getHomeTemplate(templateId: HomeTemplateId): HomeTemplate {
  const template = HOME_TEMPLATES.find((item) => item.id === templateId);
  if (!template) {
    throw new Error(`Unknown home template: ${templateId}`);
  }

  return template;
}

export function summarizeHomeTemplate(template: HomeTemplate): HomeTemplateSummary {
  const siteNames = template.groups.flatMap((group) => group.sites.map((siteSpec) => siteSpec.name));

  return {
    groupCount: template.groups.length,
    siteCount: siteNames.length,
    sampleSites: siteNames.slice(0, 4)
  };
}

export function createHomeDocumentFromTemplate(templateId: HomeTemplateId): HomeDocumentV2 {
  const template = getHomeTemplate(templateId);
  const baseDocument = createDefaultHomeDocument();
  const now = new Date().toISOString();

  return normalizeHomeDocument({
    ...baseDocument,
    documentId: createId("home"),
    updatedAt: now,
    revision: 0,
    groups: template.groups.map((group, groupIndex) => ({
      id: createId("group"),
      title: group.title,
      keywords: group.keywords,
      order: groupIndex + 1,
      sites: group.sites.map((siteSpec, siteIndex) => ({
        id: createId("site"),
        name: siteSpec.name,
        url: siteSpec.url,
        keywords: siteSpec.keywords,
        mark: siteSpec.mark ?? generateMark(siteSpec.name),
        order: siteIndex + 1
      }))
    })),
    widgets: [],
    theme: {
      ...baseDocument.theme,
      accent: template.accent
    },
    syncMeta: baseDocument.syncMeta
  });
}

function site(name: string, url: string, keywords: string, mark?: string): HomeTemplateSiteSpec {
  return { name, url, keywords, mark };
}
