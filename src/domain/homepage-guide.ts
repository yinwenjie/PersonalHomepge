export const HOMEPAGE_GUIDE_STORAGE_KEY = "homepage:homepage-guide:v1";
export const HOMEPAGE_GUIDE_CANONICAL_URL = "https://mylinker.net/";

export const HOMEPAGE_GUIDE_BROWSERS = ["chrome", "edge", "firefox", "safari"] as const;

export type HomepageGuideBrowser = typeof HOMEPAGE_GUIDE_BROWSERS[number];

/** Browser family for analytics; "other" falls back to the Chrome steps in the guide. */
export type BrowserFamily = HomepageGuideBrowser | "other";

export type HomepageGuideSource = "home_tip" | "settings";

export interface HomepageGuideState {
  /** Local calendar day (YYYY-MM-DD) the home page was first seen with this tip enabled. */
  firstSeenDay: string | null;
  dismissed: boolean;
}

export const DEFAULT_HOMEPAGE_GUIDE_STATE: HomepageGuideState = {
  firstSeenDay: null,
  dismissed: false
};

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Order matters: Edge and Chrome-based browsers also report "Chrome" and "Safari". */
export function detectBrowserFamily(userAgent: string): BrowserFamily {
  if (/\bEdg(e|A|iOS)?\//.test(userAgent)) {
    return "edge";
  }
  if (/\b(Firefox|FxiOS)\//.test(userAgent)) {
    return "firefox";
  }
  if (/\b(OPR|Opera|SamsungBrowser|YaBrowser|Vivaldi)\//.test(userAgent)) {
    return "other";
  }
  if (/\b(Chrome|Chromium|CriOS)\//.test(userAgent)) {
    return "chrome";
  }
  if (/\bSafari\//.test(userAgent) && /\bVersion\//.test(userAgent)) {
    return "safari";
  }
  return "other";
}

/**
 * Phones and tablets have no startup-page or Home-button settings like the desktop steps
 * describe (Chrome on iOS cannot set a homepage at all), so the guide is desktop-only.
 * iPadOS reports a Mac user agent, so touch support on "Macintosh" also counts.
 */
export function isMobileDevice(userAgent: string, maxTouchPoints: number): boolean {
  return /\b(iPhone|iPad|iPod|Android|Mobile)\b/.test(userAgent) ||
    (/\bMacintosh\b/.test(userAgent) && maxTouchPoints > 1);
}

/**
 * The address people paste into browser settings must outlive this deployment, so every
 * hosted copy (Pages previews, the GitHub Pages legacy site) points at the main domain,
 * the same rule as public share links. Only local development keeps its own origin.
 */
export function getHomepageGuideAddress(runtimeOrigin: string): string {
  try {
    const origin = new URL(runtimeOrigin);
    const loopbackHost = origin.hostname === "localhost"
      || origin.hostname === "127.0.0.1"
      || origin.hostname === "[::1]";
    if (loopbackHost && (origin.protocol === "http:" || origin.protocol === "https:")) {
      return `${origin.origin}/`;
    }
  } catch {
    // Fall through to the canonical address.
  }
  return HOMEPAGE_GUIDE_CANONICAL_URL;
}

export function toGuideBrowser(family: BrowserFamily): HomepageGuideBrowser {
  return family === "other" ? "chrome" : family;
}

export function toLocalDayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function normalizeHomepageGuideState(input: unknown): HomepageGuideState {
  if (!input || typeof input !== "object") {
    return DEFAULT_HOMEPAGE_GUIDE_STATE;
  }

  const value = input as Partial<Record<keyof HomepageGuideState, unknown>>;
  return {
    firstSeenDay: typeof value.firstSeenDay === "string" && DAY_PATTERN.test(value.firstSeenDay)
      ? value.firstSeenDay
      : null,
    dismissed: value.dismissed === true
  };
}

/**
 * The tip waits for a return visit on a later day: someone who comes back is the person
 * worth asking to make MyLinker their browser homepage, and first-time visitors already
 * see the welcome strip.
 */
export function shouldShowHomepageTip(state: HomepageGuideState, today: string): boolean {
  return !state.dismissed && state.firstSeenDay !== null && state.firstSeenDay < today;
}
