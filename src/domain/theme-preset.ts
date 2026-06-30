export type HomeThemePresetId =
  | "classic"
  | "focus"
  | "dense"
  | "soft"
  | "glass"
  | "editorial"
  | "terminal"
  | "mono"
  | "millennium"
  | "slate"
  | "mint"
  | "indigo"
  | "sunrise";

export type HomeThemeColorScheme = "light" | "dark";

export interface HomeThemeTokens {
  bg: string;
  surface: string;
  surfaceSoft: string;
  text: string;
  muted: string;
  quiet: string;
  line: string;
  lineStrong: string;
  accent: string;
  accentSoft: string;
  pageOverlay: string;
  glassBg: string;
  glassBgSoft: string;
  glassBgMuted: string;
  infoLine: string;
  infoBg: string;
  shadow: string;
  appearance?: Partial<HomeThemeAppearanceTokens>;
}

export interface HomeThemeAppearanceTokens {
  buttonBg: string;
  buttonBorder: string;
  buttonHoverBg: string;
  buttonHoverBorder: string;
  buttonHoverShadow: string;
  buttonHoverText: string;
  buttonShadow: string;
  buttonText: string;
  controlHeight: string;
  fieldHeight: string;
  fontBody: string;
  hoverShadow: string;
  mastheadBg: string;
  mastheadBorder: string;
  mastheadShadow: string;
  modalShadow: string;
  panelPadding: string;
  radius: string;
  searchBg: string;
  searchBorder: string;
  searchShadow: string;
  siteIconBg: string;
  siteIconRadius: string;
  siteNameColor: string;
  siteNameDecoration: string;
  siteTileBg: string;
  siteTileHoverBg: string;
  siteTileShadow: string;
  stackGap: string;
  widgetCardBg: string;
  widgetPanelBg: string;
}

export interface HomeThemePreset {
  id: HomeThemePresetId;
  name: string;
  description: string;
  accent: string;
  family: "v2" | "legacy";
  preview: {
    bg: string;
    surface: string;
    accent: string;
    radius: string;
  };
  tokens: Record<HomeThemeColorScheme, HomeThemeTokens>;
}

interface HomeThemeLike {
  accent?: unknown;
  presetId?: unknown;
}

const SYSTEM_SANS_FONT = "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", \"PingFang SC\", \"Hiragino Sans GB\", \"Microsoft YaHei\", sans-serif";
const SYSTEM_SERIF_FONT = "Georgia, \"Times New Roman\", \"Songti SC\", \"SimSun\", serif";
const SYSTEM_MONO_FONT = "\"SFMono-Regular\", Consolas, \"Liberation Mono\", Menlo, monospace";

const DEFAULT_APPEARANCE_TOKENS: HomeThemeAppearanceTokens = {
  buttonBg: "var(--glass-bg)",
  buttonBorder: "1px solid var(--line)",
  buttonHoverBg: "var(--surface)",
  buttonHoverBorder: "1px solid var(--line-strong)",
  buttonHoverShadow: "none",
  buttonHoverText: "var(--accent)",
  buttonShadow: "none",
  buttonText: "var(--text)",
  controlHeight: "34px",
  fieldHeight: "42px",
  fontBody: SYSTEM_SANS_FONT,
  hoverShadow: "var(--shadow)",
  mastheadBg: "var(--glass-bg)",
  mastheadBorder: "1px solid var(--line)",
  mastheadShadow: "var(--shadow)",
  modalShadow: "0 28px 72px rgba(29, 38, 51, 0.2)",
  panelPadding: "14px",
  radius: "8px",
  searchBg: "var(--surface)",
  searchBorder: "1px solid var(--line)",
  searchShadow: "var(--shadow)",
  siteIconBg: "var(--accent-soft)",
  siteIconRadius: "var(--radius)",
  siteNameColor: "var(--text)",
  siteNameDecoration: "none",
  siteTileBg: "var(--glass-bg-soft)",
  siteTileHoverBg: "var(--surface)",
  siteTileShadow: "var(--hover-shadow)",
  stackGap: "14px",
  widgetCardBg: "var(--surface-soft)",
  widgetPanelBg: "var(--glass-bg)"
};

export const DEFAULT_HOME_THEME_PRESET_ID: HomeThemePresetId = "classic";

export const HOME_THEME_CSS_VARIABLE_NAMES = [
  "--bg",
  "--surface",
  "--surface-soft",
  "--text",
  "--muted",
  "--quiet",
  "--line",
  "--line-strong",
  "--accent",
  "--accent-soft",
  "--page-overlay",
  "--glass-bg",
  "--glass-bg-soft",
  "--glass-bg-muted",
  "--info-line",
  "--info-bg",
  "--shadow",
  "--hover-shadow",
  "--modal-shadow",
  "--font-body",
  "--radius",
  "--page-padding-y",
  "--panel-padding",
  "--stack-gap",
  "--control-height",
  "--field-height",
  "--button-bg",
  "--button-border",
  "--button-hover-bg",
  "--button-hover-border",
  "--button-hover-shadow",
  "--button-hover-text",
  "--button-shadow",
  "--button-text",
  "--masthead-bg",
  "--masthead-border",
  "--masthead-shadow",
  "--search-bg",
  "--search-border",
  "--search-shadow",
  "--site-icon-bg",
  "--site-icon-radius",
  "--site-name-color",
  "--site-name-decoration",
  "--site-tile-bg",
  "--site-tile-hover-bg",
  "--site-tile-shadow",
  "--widget-card-bg",
  "--widget-panel-bg"
] as const;

const V2_HOME_THEME_PRESETS: HomeThemePreset[] = [
  createPreset({
    id: "classic",
    name: "Classic",
    description: "稳定的默认首页风格",
    accent: "#246bfe",
    family: "v2",
    light: {
      bg: "#f6f7f9",
      surface: "#ffffff",
      surfaceSoft: "#f0f4f8",
      text: "#1d2633",
      muted: "#657181",
      quiet: "#8a95a5",
      line: "#dfe5ec",
      lineStrong: "#c9d3df",
      accent: "#246bfe",
      accentSoft: "#e8f0ff",
      pageOverlay: "linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(246, 247, 249, 0) 220px)",
      glassBg: "rgba(255, 255, 255, 0.82)",
      glassBgSoft: "rgba(255, 255, 255, 0.74)",
      glassBgMuted: "rgba(255, 255, 255, 0.68)",
      infoLine: "#bfdbfe",
      infoBg: "rgba(239, 246, 255, 0.78)",
      shadow: "0 18px 48px rgba(29, 38, 51, 0.08)"
    },
    dark: {
      bg: "#121820",
      surface: "#1b2430",
      surfaceSoft: "#202c3a",
      text: "#edf2f7",
      muted: "#aab6c4",
      quiet: "#7d8b9d",
      line: "#344255",
      lineStrong: "#4a5c73",
      accent: "#8fb4ff",
      accentSoft: "#1e3357",
      pageOverlay: "linear-gradient(180deg, rgba(27, 36, 48, 0.72), rgba(18, 24, 32, 0) 220px)",
      glassBg: "rgba(27, 36, 48, 0.86)",
      glassBgSoft: "rgba(27, 36, 48, 0.74)",
      glassBgMuted: "rgba(32, 44, 58, 0.78)",
      infoLine: "#395a88",
      infoBg: "rgba(30, 51, 87, 0.62)",
      shadow: "0 18px 48px rgba(0, 0, 0, 0.28)",
      appearance: {
        modalShadow: "0 28px 72px rgba(0, 0, 0, 0.42)"
      }
    }
  }),
  createPreset({
    id: "focus",
    name: "Focus",
    description: "清晰安静的现代工作台",
    accent: "#1f6feb",
    family: "v2",
    light: {
      bg: "#f6f8fb",
      surface: "#ffffff",
      surfaceSoft: "#eef3f8",
      text: "#172033",
      muted: "#617086",
      quiet: "#8b98aa",
      line: "#d9e3ef",
      lineStrong: "#c0cedf",
      accent: "#1f6feb",
      accentSoft: "#e7f0ff",
      pageOverlay: "linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(246, 248, 251, 0) 220px)",
      glassBg: "rgba(255, 255, 255, 0.88)",
      glassBgSoft: "rgba(255, 255, 255, 0.8)",
      glassBgMuted: "rgba(247, 250, 253, 0.74)",
      infoLine: "#bfdbfe",
      infoBg: "rgba(239, 246, 255, 0.86)",
      shadow: "0 12px 34px rgba(19, 31, 46, 0.06)",
      appearance: {
        hoverShadow: "0 14px 34px rgba(19, 31, 46, 0.08)",
        mastheadShadow: "0 14px 34px rgba(19, 31, 46, 0.06)",
        searchShadow: "0 14px 34px rgba(19, 31, 46, 0.06)"
      }
    },
    dark: {
      bg: "#0f1722",
      surface: "#172130",
      surfaceSoft: "#202d3f",
      text: "#eef5ff",
      muted: "#a8b6c9",
      quiet: "#8090a7",
      line: "#304258",
      lineStrong: "#465e78",
      accent: "#8db8ff",
      accentSoft: "#1d3558",
      pageOverlay: "linear-gradient(180deg, rgba(23, 33, 48, 0.76), rgba(15, 23, 34, 0) 220px)",
      glassBg: "rgba(23, 33, 48, 0.9)",
      glassBgSoft: "rgba(23, 33, 48, 0.78)",
      glassBgMuted: "rgba(32, 45, 63, 0.78)",
      infoLine: "#365f92",
      infoBg: "rgba(29, 53, 88, 0.68)",
      shadow: "0 16px 44px rgba(0, 0, 0, 0.32)",
      appearance: {
        modalShadow: "0 28px 72px rgba(0, 0, 0, 0.42)"
      }
    }
  }),
  createPreset({
    id: "dense",
    name: "Dense",
    description: "紧凑高效的信息密度",
    accent: "#475569",
    family: "v2",
    light: {
      bg: "#f7f8fa",
      surface: "#ffffff",
      surfaceSoft: "#eef1f4",
      text: "#18202a",
      muted: "#64707f",
      quiet: "#8a96a3",
      line: "#d9e0e7",
      lineStrong: "#c3ced8",
      accent: "#475569",
      accentSoft: "#e8edf2",
      pageOverlay: "linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(247, 248, 250, 0) 220px)",
      glassBg: "rgba(255, 255, 255, 0.84)",
      glassBgSoft: "rgba(255, 255, 255, 0.76)",
      glassBgMuted: "rgba(248, 250, 252, 0.7)",
      infoLine: "#cbd5e1",
      infoBg: "rgba(241, 245, 249, 0.82)",
      shadow: "none",
      appearance: denseAppearance()
    },
    dark: {
      bg: "#101417",
      surface: "#1a2026",
      surfaceSoft: "#222a32",
      text: "#eef2f6",
      muted: "#a8b2bd",
      quiet: "#7f8b98",
      line: "#34404b",
      lineStrong: "#495867",
      accent: "#cbd5e1",
      accentSoft: "#2a3440",
      pageOverlay: "linear-gradient(180deg, rgba(26, 32, 38, 0.74), rgba(16, 20, 23, 0) 220px)",
      glassBg: "rgba(26, 32, 38, 0.86)",
      glassBgSoft: "rgba(26, 32, 38, 0.74)",
      glassBgMuted: "rgba(34, 42, 50, 0.78)",
      infoLine: "#475569",
      infoBg: "rgba(42, 52, 64, 0.66)",
      shadow: "none",
      appearance: {
        ...denseAppearance(),
        modalShadow: "0 28px 72px rgba(0, 0, 0, 0.42)"
      }
    }
  }),
  createPreset({
    id: "soft",
    name: "Soft",
    description: "柔和轻量的个人空间",
    accent: "#4f8a77",
    family: "v2",
    light: {
      bg: "#f7faf8",
      surface: "#ffffff",
      surfaceSoft: "#edf6f1",
      text: "#1d2a25",
      muted: "#63776e",
      quiet: "#879891",
      line: "#d8e8df",
      lineStrong: "#bed6ca",
      accent: "#4f8a77",
      accentSoft: "#e5f4ed",
      pageOverlay: "linear-gradient(180deg, rgba(255, 255, 255, 0.88), rgba(247, 250, 248, 0) 220px)",
      glassBg: "rgba(255, 255, 255, 0.8)",
      glassBgSoft: "rgba(255, 255, 255, 0.72)",
      glassBgMuted: "rgba(248, 253, 250, 0.68)",
      infoLine: "#b7e4d0",
      infoBg: "rgba(237, 246, 241, 0.82)",
      shadow: "0 18px 44px rgba(79, 138, 119, 0.1)",
      appearance: {
        buttonBg: "rgba(255, 255, 255, 0.78)",
        buttonHoverShadow: "0 12px 28px rgba(79, 138, 119, 0.12)",
        buttonShadow: "0 8px 22px rgba(79, 138, 119, 0.08)",
        radius: "14px",
        searchShadow: "0 18px 44px rgba(79, 138, 119, 0.1)",
        siteIconRadius: "999px"
      }
    },
    dark: {
      bg: "#101a17",
      surface: "#192622",
      surfaceSoft: "#21332e",
      text: "#eff8f4",
      muted: "#a7bbb3",
      quiet: "#829891",
      line: "#334d44",
      lineStrong: "#48695e",
      accent: "#94d6bd",
      accentSoft: "#1d4338",
      pageOverlay: "linear-gradient(180deg, rgba(25, 38, 34, 0.74), rgba(16, 26, 23, 0) 220px)",
      glassBg: "rgba(25, 38, 34, 0.84)",
      glassBgSoft: "rgba(25, 38, 34, 0.72)",
      glassBgMuted: "rgba(33, 51, 46, 0.76)",
      infoLine: "#3e826c",
      infoBg: "rgba(29, 67, 56, 0.66)",
      shadow: "0 18px 44px rgba(0, 0, 0, 0.28)",
      appearance: {
        modalShadow: "0 28px 72px rgba(0, 0, 0, 0.42)",
        radius: "14px",
        siteIconRadius: "999px"
      }
    }
  }),
  createPreset({
    id: "glass",
    name: "Glass",
    description: "适合背景图的半透明层次",
    accent: "#2563eb",
    family: "v2",
    light: {
      bg: "#eef6ff",
      surface: "#ffffff",
      surfaceSoft: "#edf5ff",
      text: "#172033",
      muted: "#607086",
      quiet: "#8796aa",
      line: "rgba(148, 163, 184, 0.42)",
      lineStrong: "rgba(100, 116, 139, 0.58)",
      accent: "#2563eb",
      accentSoft: "rgba(219, 234, 254, 0.88)",
      pageOverlay: "linear-gradient(180deg, rgba(255, 255, 255, 0.72), rgba(238, 246, 255, 0) 260px)",
      glassBg: "rgba(255, 255, 255, 0.68)",
      glassBgSoft: "rgba(255, 255, 255, 0.58)",
      glassBgMuted: "rgba(255, 255, 255, 0.48)",
      infoLine: "rgba(147, 197, 253, 0.58)",
      infoBg: "rgba(239, 246, 255, 0.62)",
      shadow: "0 22px 56px rgba(37, 99, 235, 0.14)",
      appearance: {
        buttonBg: "rgba(255, 255, 255, 0.66)",
        buttonHoverBg: "rgba(255, 255, 255, 0.88)",
        buttonHoverShadow: "0 14px 34px rgba(37, 99, 235, 0.14)",
        buttonShadow: "0 10px 28px rgba(37, 99, 235, 0.1)",
        radius: "14px",
        searchBg: "rgba(255, 255, 255, 0.7)",
        searchShadow: "0 22px 56px rgba(37, 99, 235, 0.14)",
        siteIconRadius: "999px"
      }
    },
    dark: {
      bg: "#0d1625",
      surface: "#172235",
      surfaceSoft: "#1f2f49",
      text: "#edf5ff",
      muted: "#aab8cc",
      quiet: "#8494ab",
      line: "rgba(96, 125, 164, 0.56)",
      lineStrong: "rgba(132, 162, 202, 0.64)",
      accent: "#93c5fd",
      accentSoft: "rgba(30, 64, 118, 0.78)",
      pageOverlay: "linear-gradient(180deg, rgba(13, 22, 37, 0.64), rgba(13, 22, 37, 0) 260px)",
      glassBg: "rgba(23, 34, 53, 0.72)",
      glassBgSoft: "rgba(23, 34, 53, 0.6)",
      glassBgMuted: "rgba(31, 47, 73, 0.58)",
      infoLine: "rgba(96, 165, 250, 0.58)",
      infoBg: "rgba(30, 64, 118, 0.6)",
      shadow: "0 22px 56px rgba(0, 0, 0, 0.34)",
      appearance: {
        buttonBg: "rgba(23, 34, 53, 0.72)",
        buttonHoverBg: "rgba(31, 47, 73, 0.86)",
        modalShadow: "0 28px 72px rgba(0, 0, 0, 0.48)",
        radius: "14px",
        searchBg: "rgba(23, 34, 53, 0.72)",
        siteIconRadius: "999px"
      }
    }
  }),
  createPreset({
    id: "editorial",
    name: "Editorial",
    description: "偏阅读和研究的杂志感",
    accent: "#9a3412",
    family: "v2",
    light: {
      bg: "#fbfaf8",
      surface: "#fffdf9",
      surfaceSoft: "#f4efe7",
      text: "#2a2119",
      muted: "#806f60",
      quiet: "#9c8c80",
      line: "#eadfd2",
      lineStrong: "#d8c4b1",
      accent: "#9a3412",
      accentSoft: "#ffedd5",
      pageOverlay: "linear-gradient(180deg, rgba(255, 253, 249, 0.9), rgba(251, 250, 248, 0) 240px)",
      glassBg: "rgba(255, 253, 249, 0.84)",
      glassBgSoft: "rgba(255, 253, 249, 0.76)",
      glassBgMuted: "rgba(250, 246, 240, 0.72)",
      infoLine: "#fed7aa",
      infoBg: "rgba(255, 247, 237, 0.84)",
      shadow: "0 18px 42px rgba(42, 33, 25, 0.08)",
      appearance: {
        fontBody: SYSTEM_SERIF_FONT,
        radius: "6px",
        siteIconRadius: "4px"
      }
    },
    dark: {
      bg: "#1b1511",
      surface: "#271f1a",
      surfaceSoft: "#342920",
      text: "#fbf3ec",
      muted: "#c5aa98",
      quiet: "#9c8170",
      line: "#4d3b2f",
      lineStrong: "#6b5140",
      accent: "#fdba74",
      accentSoft: "#4a2a16",
      pageOverlay: "linear-gradient(180deg, rgba(39, 31, 26, 0.74), rgba(27, 21, 17, 0) 220px)",
      glassBg: "rgba(39, 31, 26, 0.86)",
      glassBgSoft: "rgba(39, 31, 26, 0.74)",
      glassBgMuted: "rgba(52, 41, 32, 0.78)",
      infoLine: "#9a5a2e",
      infoBg: "rgba(74, 42, 22, 0.66)",
      shadow: "0 18px 48px rgba(0, 0, 0, 0.3)",
      appearance: {
        fontBody: SYSTEM_SERIF_FONT,
        modalShadow: "0 28px 72px rgba(0, 0, 0, 0.42)",
        radius: "6px",
        siteIconRadius: "4px"
      }
    }
  }),
  createPreset({
    id: "terminal",
    name: "Terminal",
    description: "面向开发者的暗色命令行感",
    accent: "#57f287",
    family: "v2",
    light: {
      bg: "#f3f7f4",
      surface: "#ffffff",
      surfaceSoft: "#e9f1ec",
      text: "#102015",
      muted: "#53665a",
      quiet: "#79887f",
      line: "#cfded4",
      lineStrong: "#abc2b3",
      accent: "#15803d",
      accentSoft: "#dcfce7",
      pageOverlay: "linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(243, 247, 244, 0) 220px)",
      glassBg: "rgba(255, 255, 255, 0.84)",
      glassBgSoft: "rgba(255, 255, 255, 0.76)",
      glassBgMuted: "rgba(249, 253, 250, 0.72)",
      infoLine: "#bbf7d0",
      infoBg: "rgba(240, 253, 244, 0.82)",
      shadow: "0 14px 36px rgba(16, 32, 21, 0.08)",
      appearance: terminalAppearance(false)
    },
    dark: {
      bg: "#080d0b",
      surface: "#101713",
      surfaceSoft: "#17221d",
      text: "#d8ffe6",
      muted: "#76a88a",
      quiet: "#5e856d",
      line: "#234033",
      lineStrong: "#35654c",
      accent: "#57f287",
      accentSoft: "#143622",
      pageOverlay: "linear-gradient(180deg, rgba(16, 23, 19, 0.82), rgba(8, 13, 11, 0) 220px)",
      glassBg: "rgba(16, 23, 19, 0.9)",
      glassBgSoft: "rgba(16, 23, 19, 0.78)",
      glassBgMuted: "rgba(23, 34, 29, 0.78)",
      infoLine: "#2f7c50",
      infoBg: "rgba(20, 54, 34, 0.7)",
      shadow: "0 18px 48px rgba(0, 0, 0, 0.32)",
      appearance: terminalAppearance(true)
    }
  }),
  createPreset({
    id: "mono",
    name: "Minimal Mono",
    description: "低色彩的内容优先风格",
    accent: "#111827",
    family: "v2",
    light: {
      bg: "#f8f8f8",
      surface: "#ffffff",
      surfaceSoft: "#eeeeee",
      text: "#111111",
      muted: "#666666",
      quiet: "#8a8a8a",
      line: "#dddddd",
      lineStrong: "#c9c9c9",
      accent: "#111827",
      accentSoft: "#e5e7eb",
      pageOverlay: "linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(248, 248, 248, 0) 220px)",
      glassBg: "rgba(255, 255, 255, 0.84)",
      glassBgSoft: "rgba(255, 255, 255, 0.76)",
      glassBgMuted: "rgba(250, 250, 250, 0.7)",
      infoLine: "#d4d4d4",
      infoBg: "rgba(245, 245, 245, 0.82)",
      shadow: "0 18px 48px rgba(17, 17, 17, 0.08)",
      appearance: {
        fontBody: SYSTEM_MONO_FONT,
        radius: "6px",
        siteIconRadius: "4px"
      }
    },
    dark: {
      bg: "#0d0d0d",
      surface: "#181818",
      surfaceSoft: "#242424",
      text: "#f5f5f5",
      muted: "#aaaaaa",
      quiet: "#838383",
      line: "#333333",
      lineStrong: "#4a4a4a",
      accent: "#f5f5f5",
      accentSoft: "#2b2b2b",
      pageOverlay: "linear-gradient(180deg, rgba(24, 24, 24, 0.74), rgba(13, 13, 13, 0) 220px)",
      glassBg: "rgba(24, 24, 24, 0.86)",
      glassBgSoft: "rgba(24, 24, 24, 0.74)",
      glassBgMuted: "rgba(36, 36, 36, 0.78)",
      infoLine: "#525252",
      infoBg: "rgba(43, 43, 43, 0.66)",
      shadow: "0 18px 48px rgba(0, 0, 0, 0.3)",
      appearance: {
        fontBody: SYSTEM_MONO_FONT,
        modalShadow: "0 28px 72px rgba(0, 0, 0, 0.42)",
        radius: "6px",
        siteIconRadius: "4px"
      }
    }
  }),
  createPreset({
    id: "millennium",
    name: "Millennium",
    description: "蓝色下划线与立体按钮的门户目录风",
    accent: "#0000ee",
    family: "v2",
    light: {
      bg: "#f2f2f2",
      surface: "#ffffff",
      surfaceSoft: "#e6e6e6",
      text: "#111111",
      muted: "#555555",
      quiet: "#777777",
      line: "#9a9a9a",
      lineStrong: "#666666",
      accent: "#0000ee",
      accentSoft: "#d9e8ff",
      pageOverlay: "linear-gradient(180deg, rgba(255, 255, 255, 0.74), rgba(242, 242, 242, 0) 180px)",
      glassBg: "#ffffff",
      glassBgSoft: "#f7f7f7",
      glassBgMuted: "#eeeeee",
      infoLine: "#9999cc",
      infoBg: "#eeeeff",
      shadow: "3px 3px 0 #b8b8b8",
      appearance: millenniumAppearance(false)
    },
    dark: {
      bg: "#111111",
      surface: "#1b1b1b",
      surfaceSoft: "#252525",
      text: "#eeeeee",
      muted: "#b8b8b8",
      quiet: "#8f8f8f",
      line: "#666666",
      lineStrong: "#9a9a9a",
      accent: "#8ab4ff",
      accentSoft: "#162b4f",
      pageOverlay: "linear-gradient(180deg, rgba(27, 27, 27, 0.74), rgba(17, 17, 17, 0) 180px)",
      glassBg: "#1b1b1b",
      glassBgSoft: "#252525",
      glassBgMuted: "#2d2d2d",
      infoLine: "#4a6fa9",
      infoBg: "#18263c",
      shadow: "3px 3px 0 #000000",
      appearance: millenniumAppearance(true)
    }
  }),
];

export const HOME_THEME_PRESETS: HomeThemePreset[] = [
  ...V2_HOME_THEME_PRESETS,
  createLegacyPreset("slate", "石墨灰", "旧版低干扰办公配色", "#475569", "dense"),
  createLegacyPreset("mint", "薄荷绿", "旧版清爽学习配色", "#0f766e", "soft"),
  createLegacyPreset("indigo", "靛蓝", "旧版深度工作配色", "#4f46e5", "focus"),
  createLegacyPreset("sunrise", "晨光", "旧版温暖阅读配色", "#c2410c", "editorial")
];

export const VISIBLE_HOME_THEME_PRESETS = V2_HOME_THEME_PRESETS;

export function getHomeThemePreset(presetId: HomeThemePresetId): HomeThemePreset {
  return HOME_THEME_PRESETS.find((preset) => preset.id === presetId) ?? HOME_THEME_PRESETS[0]!;
}

export function isHomeThemePresetId(value: unknown): value is HomeThemePresetId {
  return typeof value === "string" && HOME_THEME_PRESETS.some((preset) => preset.id === value);
}

export function normalizeHomeThemePresetId(value: unknown, accent?: unknown): HomeThemePresetId {
  if (isHomeThemePresetId(value)) {
    return value;
  }

  return getPresetIdByAccent(accent) ?? DEFAULT_HOME_THEME_PRESET_ID;
}

export function normalizeThemeAccent(value: unknown): string | null {
  const text = String(value ?? "").trim();

  if (/^#[0-9a-f]{6}$/i.test(text)) {
    return text.toLowerCase();
  }

  return null;
}

export function getHomeThemeCssVariables(theme: HomeThemeLike, scheme: HomeThemeColorScheme): Record<string, string> {
  const preset = getHomeThemePreset(normalizeHomeThemePresetId(theme.presetId, theme.accent));
  const tokens = preset.tokens[scheme];
  const appearance = normalizeAppearanceTokens(tokens.appearance);
  const accent = normalizeThemeAccent(theme.accent) ?? tokens.accent;

  return {
    "--bg": tokens.bg,
    "--surface": tokens.surface,
    "--surface-soft": tokens.surfaceSoft,
    "--text": tokens.text,
    "--muted": tokens.muted,
    "--quiet": tokens.quiet,
    "--line": tokens.line,
    "--line-strong": tokens.lineStrong,
    "--accent": accent,
    "--accent-soft": tokens.accentSoft,
    "--page-overlay": tokens.pageOverlay,
    "--glass-bg": tokens.glassBg,
    "--glass-bg-soft": tokens.glassBgSoft,
    "--glass-bg-muted": tokens.glassBgMuted,
    "--info-line": tokens.infoLine,
    "--info-bg": tokens.infoBg,
    "--shadow": tokens.shadow,
    "--hover-shadow": appearance.hoverShadow,
    "--modal-shadow": appearance.modalShadow,
    "--font-body": appearance.fontBody,
    "--radius": appearance.radius,
    "--panel-padding": appearance.panelPadding,
    "--stack-gap": appearance.stackGap,
    "--control-height": appearance.controlHeight,
    "--field-height": appearance.fieldHeight,
    "--button-bg": appearance.buttonBg,
    "--button-border": appearance.buttonBorder,
    "--button-hover-bg": appearance.buttonHoverBg,
    "--button-hover-border": appearance.buttonHoverBorder,
    "--button-hover-shadow": appearance.buttonHoverShadow,
    "--button-hover-text": appearance.buttonHoverText,
    "--button-shadow": appearance.buttonShadow,
    "--button-text": appearance.buttonText,
    "--masthead-bg": appearance.mastheadBg,
    "--masthead-border": appearance.mastheadBorder,
    "--masthead-shadow": appearance.mastheadShadow,
    "--search-bg": appearance.searchBg,
    "--search-border": appearance.searchBorder,
    "--search-shadow": appearance.searchShadow,
    "--site-icon-bg": appearance.siteIconBg,
    "--site-icon-radius": appearance.siteIconRadius,
    "--site-name-color": appearance.siteNameColor,
    "--site-name-decoration": appearance.siteNameDecoration,
    "--site-tile-bg": appearance.siteTileBg,
    "--site-tile-hover-bg": appearance.siteTileHoverBg,
    "--site-tile-shadow": appearance.siteTileShadow,
    "--widget-card-bg": appearance.widgetCardBg,
    "--widget-panel-bg": appearance.widgetPanelBg
  };
}

export function getHomeThemeAppearanceAttribute(theme: HomeThemeLike): HomeThemePresetId {
  return normalizeHomeThemePresetId(theme.presetId, theme.accent);
}

function createPreset(input: {
  accent: string;
  dark: HomeThemeTokens;
  description: string;
  family: HomeThemePreset["family"];
  id: HomeThemePresetId;
  light: HomeThemeTokens;
  name: string;
}): HomeThemePreset {
  const lightAppearance = normalizeAppearanceTokens(input.light.appearance);

  return {
    id: input.id,
    name: input.name,
    description: input.description,
    accent: input.accent,
    family: input.family,
    preview: {
      bg: input.light.bg,
      surface: input.light.surface,
      accent: input.accent,
      radius: lightAppearance.radius
    },
    tokens: {
      light: input.light,
      dark: input.dark
    }
  };
}

function createLegacyPreset(
  id: Extract<HomeThemePresetId, "slate" | "mint" | "indigo" | "sunrise">,
  name: string,
  description: string,
  accent: string,
  basePresetId: HomeThemePresetId
): HomeThemePreset {
  const basePreset = V2_HOME_THEME_PRESETS.find((preset) => preset.id === basePresetId);
  if (!basePreset) {
    throw new Error(`Missing base theme preset ${basePresetId}`);
  }

  return createPreset({
    id,
    name,
    description,
    accent,
    family: "legacy",
    light: {
      ...basePreset.tokens.light,
      accent
    },
    dark: basePreset.tokens.dark
  });
}

function normalizeAppearanceTokens(input: Partial<HomeThemeAppearanceTokens> | undefined): HomeThemeAppearanceTokens {
  return {
    ...DEFAULT_APPEARANCE_TOKENS,
    ...input
  };
}

function denseAppearance(): Partial<HomeThemeAppearanceTokens> {
  return {
    controlHeight: "30px",
    fieldHeight: "36px",
    hoverShadow: "none",
    mastheadShadow: "none",
    modalShadow: "0 18px 46px rgba(29, 38, 51, 0.16)",
    panelPadding: "10px",
    radius: "6px",
    searchShadow: "none",
    stackGap: "10px",
    widgetPanelBg: "var(--glass-bg-soft)"
  };
}

function terminalAppearance(isDark: boolean): Partial<HomeThemeAppearanceTokens> {
  return {
    buttonBg: "var(--surface-soft)",
    buttonHoverBg: "var(--accent-soft)",
    buttonHoverText: "var(--accent)",
    fontBody: SYSTEM_MONO_FONT,
    mastheadBg: "var(--surface)",
    modalShadow: isDark ? "0 28px 72px rgba(0, 0, 0, 0.46)" : "0 18px 46px rgba(16, 32, 21, 0.16)",
    radius: "4px",
    siteIconRadius: "4px",
    widgetCardBg: "var(--surface)"
  };
}

function millenniumAppearance(isDark: boolean): Partial<HomeThemeAppearanceTokens> {
  return {
    buttonBg: isDark ? "#2d2d2d" : "#dcdcdc",
    buttonBorder: isDark
      ? "1px solid #8f8f8f"
      : "1px solid #808080",
    buttonHoverBg: isDark ? "#363636" : "#eeeeee",
    buttonHoverBorder: isDark
      ? "1px solid #b8b8b8"
      : "1px solid #606060",
    buttonHoverShadow: isDark ? "1px 1px 0 #000000" : "1px 1px 0 #808080",
    buttonHoverText: isDark ? "#ffffff" : "#000000",
    buttonShadow: isDark ? "1px 1px 0 #000000" : "1px 1px 0 #808080",
    buttonText: isDark ? "#eeeeee" : "#000000",
    controlHeight: "32px",
    fieldHeight: "36px",
    fontBody: "Arial, Helvetica, \"Microsoft YaHei\", sans-serif",
    hoverShadow: "none",
    mastheadBg: isDark
      ? "linear-gradient(180deg, #1b1b1b, #111111)"
      : "linear-gradient(180deg, #ffffff, #eeeeee)",
    mastheadBorder: isDark ? "1px solid #666666" : "1px solid #808080",
    mastheadShadow: isDark ? "3px 3px 0 #000000" : "3px 3px 0 #b8b8b8",
    modalShadow: isDark ? "4px 4px 0 #000000" : "4px 4px 0 #9a9a9a",
    panelPadding: "10px",
    radius: "0",
    searchBg: isDark ? "#252525" : "#eeeeee",
    searchBorder: isDark ? "1px solid #666666" : "1px solid #808080",
    searchShadow: isDark
      ? "inset 1px 1px 0 #444444, inset -1px -1px 0 #000000"
      : "inset 1px 1px 0 #ffffff, inset -1px -1px 0 #808080",
    siteIconBg: "transparent",
    siteIconRadius: "0",
    siteNameColor: "var(--accent)",
    siteNameDecoration: "underline",
    siteTileBg: "transparent",
    siteTileHoverBg: "transparent",
    siteTileShadow: "none",
    stackGap: "10px",
    widgetCardBg: isDark ? "#252525" : "#f7f7f7",
    widgetPanelBg: isDark ? "#1b1b1b" : "#ffffff"
  };
}

function getPresetIdByAccent(accent: unknown): HomeThemePresetId | null {
  const normalizedAccent = normalizeThemeAccent(accent);

  if (!normalizedAccent) {
    return null;
  }

  const exactPreset = HOME_THEME_PRESETS.find((preset) => preset.accent.toLowerCase() === normalizedAccent);
  if (exactPreset) {
    return exactPreset.id;
  }

  if (normalizedAccent === "#64748b") {
    return "dense";
  }

  if (normalizedAccent === "#2563eb") {
    return "classic";
  }

  if (normalizedAccent === "#0f766e") {
    return "soft";
  }

  if (normalizedAccent === "#7c3aed") {
    return "terminal";
  }

  if (normalizedAccent === "#0891b2") {
    return "glass";
  }

  if (normalizedAccent === "#ca8a04") {
    return "editorial";
  }

  return null;
}
