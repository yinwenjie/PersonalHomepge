export type HomeThemePresetId =
  | "classic"
  | "slate"
  | "mint"
  | "indigo"
  | "sunrise"
  | "mono";

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
}

export interface HomeThemePreset {
  id: HomeThemePresetId;
  name: string;
  description: string;
  accent: string;
  preview: {
    bg: string;
    surface: string;
    accent: string;
  };
  tokens: Record<HomeThemeColorScheme, HomeThemeTokens>;
}

interface HomeThemeLike {
  accent?: unknown;
  presetId?: unknown;
}

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
  "--shadow"
] as const;

export const HOME_THEME_PRESETS: HomeThemePreset[] = [
  {
    id: "classic",
    name: "经典蓝",
    description: "干净中性的默认风格",
    accent: "#246bfe",
    preview: {
      bg: "#f6f7f9",
      surface: "#ffffff",
      accent: "#246bfe"
    },
    tokens: {
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
        shadow: "0 18px 48px rgba(0, 0, 0, 0.28)"
      }
    }
  },
  {
    id: "slate",
    name: "石墨灰",
    description: "低干扰的办公风格",
    accent: "#475569",
    preview: {
      bg: "#f7f8fa",
      surface: "#ffffff",
      accent: "#475569"
    },
    tokens: {
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
        shadow: "0 18px 48px rgba(24, 32, 42, 0.08)"
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
        shadow: "0 18px 48px rgba(0, 0, 0, 0.3)"
      }
    }
  },
  {
    id: "mint",
    name: "薄荷绿",
    description: "清爽柔和的学习风格",
    accent: "#0f766e",
    preview: {
      bg: "#f4faf8",
      surface: "#ffffff",
      accent: "#0f766e"
    },
    tokens: {
      light: {
        bg: "#f4faf8",
        surface: "#ffffff",
        surfaceSoft: "#e8f5f1",
        text: "#1c2a27",
        muted: "#5d716c",
        quiet: "#81938e",
        line: "#d4e5df",
        lineStrong: "#b8d2ca",
        accent: "#0f766e",
        accentSoft: "#dff6ef",
        pageOverlay: "linear-gradient(180deg, rgba(255, 255, 255, 0.88), rgba(244, 250, 248, 0) 220px)",
        glassBg: "rgba(255, 255, 255, 0.82)",
        glassBgSoft: "rgba(255, 255, 255, 0.74)",
        glassBgMuted: "rgba(248, 253, 251, 0.68)",
        infoLine: "#99f6e4",
        infoBg: "rgba(240, 253, 250, 0.8)",
        shadow: "0 18px 48px rgba(28, 42, 39, 0.08)"
      },
      dark: {
        bg: "#0f1917",
        surface: "#182522",
        surfaceSoft: "#20312d",
        text: "#eef8f5",
        muted: "#9fb9b2",
        quiet: "#78928b",
        line: "#2f4b45",
        lineStrong: "#426860",
        accent: "#5eead4",
        accentSoft: "#153d38",
        pageOverlay: "linear-gradient(180deg, rgba(24, 37, 34, 0.74), rgba(15, 25, 23, 0) 220px)",
        glassBg: "rgba(24, 37, 34, 0.86)",
        glassBgSoft: "rgba(24, 37, 34, 0.74)",
        glassBgMuted: "rgba(32, 49, 45, 0.78)",
        infoLine: "#2dd4bf",
        infoBg: "rgba(21, 61, 56, 0.66)",
        shadow: "0 18px 48px rgba(0, 0, 0, 0.28)"
      }
    }
  },
  {
    id: "indigo",
    name: "靛蓝",
    description: "稳定克制的深度工作风格",
    accent: "#4f46e5",
    preview: {
      bg: "#f7f7fc",
      surface: "#ffffff",
      accent: "#4f46e5"
    },
    tokens: {
      light: {
        bg: "#f7f7fc",
        surface: "#ffffff",
        surfaceSoft: "#eef0fb",
        text: "#202038",
        muted: "#626783",
        quiet: "#878aa8",
        line: "#dcdff0",
        lineStrong: "#c8cce4",
        accent: "#4f46e5",
        accentSoft: "#e8e7ff",
        pageOverlay: "linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(247, 247, 252, 0) 220px)",
        glassBg: "rgba(255, 255, 255, 0.82)",
        glassBgSoft: "rgba(255, 255, 255, 0.74)",
        glassBgMuted: "rgba(248, 248, 255, 0.68)",
        infoLine: "#c7d2fe",
        infoBg: "rgba(238, 242, 255, 0.8)",
        shadow: "0 18px 48px rgba(32, 32, 56, 0.08)"
      },
      dark: {
        bg: "#111225",
        surface: "#1b1d33",
        surfaceSoft: "#252847",
        text: "#f1f2ff",
        muted: "#aaaed0",
        quiet: "#8589ad",
        line: "#383d66",
        lineStrong: "#51578a",
        accent: "#a5b4fc",
        accentSoft: "#272b5a",
        pageOverlay: "linear-gradient(180deg, rgba(27, 29, 51, 0.74), rgba(17, 18, 37, 0) 220px)",
        glassBg: "rgba(27, 29, 51, 0.86)",
        glassBgSoft: "rgba(27, 29, 51, 0.74)",
        glassBgMuted: "rgba(37, 40, 71, 0.78)",
        infoLine: "#6366f1",
        infoBg: "rgba(39, 43, 90, 0.66)",
        shadow: "0 18px 48px rgba(0, 0, 0, 0.3)"
      }
    }
  },
  {
    id: "sunrise",
    name: "晨光",
    description: "温暖清晰的阅读风格",
    accent: "#c2410c",
    preview: {
      bg: "#fbf8f4",
      surface: "#ffffff",
      accent: "#c2410c"
    },
    tokens: {
      light: {
        bg: "#fbf8f4",
        surface: "#ffffff",
        surfaceSoft: "#f4eee7",
        text: "#2d241d",
        muted: "#796a5f",
        quiet: "#9c8c80",
        line: "#eadfd4",
        lineStrong: "#dac8b6",
        accent: "#c2410c",
        accentSoft: "#ffeadb",
        pageOverlay: "linear-gradient(180deg, rgba(255, 255, 255, 0.88), rgba(251, 248, 244, 0) 220px)",
        glassBg: "rgba(255, 255, 255, 0.82)",
        glassBgSoft: "rgba(255, 255, 255, 0.74)",
        glassBgMuted: "rgba(255, 250, 245, 0.68)",
        infoLine: "#fed7aa",
        infoBg: "rgba(255, 247, 237, 0.82)",
        shadow: "0 18px 48px rgba(45, 36, 29, 0.08)"
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
        shadow: "0 18px 48px rgba(0, 0, 0, 0.3)"
      }
    }
  },
  {
    id: "mono",
    name: "极简黑白",
    description: "低色彩的内容优先风格",
    accent: "#111827",
    preview: {
      bg: "#f8f8f8",
      surface: "#ffffff",
      accent: "#111827"
    },
    tokens: {
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
        shadow: "0 18px 48px rgba(17, 17, 17, 0.08)"
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
        shadow: "0 18px 48px rgba(0, 0, 0, 0.3)"
      }
    }
  }
];

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
    "--shadow": tokens.shadow
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
    return "slate";
  }

  if (normalizedAccent === "#2563eb") {
    return "classic";
  }

  if (normalizedAccent === "#0f766e") {
    return "mint";
  }

  if (normalizedAccent === "#7c3aed" || normalizedAccent === "#0891b2") {
    return "indigo";
  }

  if (normalizedAccent === "#ca8a04") {
    return "sunrise";
  }

  return null;
}
