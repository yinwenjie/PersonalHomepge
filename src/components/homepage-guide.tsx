"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  type BrowserFamily,
  detectBrowserFamily,
  getHomepageGuideAddress,
  HOMEPAGE_GUIDE_BROWSERS,
  HOMEPAGE_GUIDE_STORAGE_KEY,
  type HomepageGuideBrowser,
  type HomepageGuideSource,
  type HomepageGuideState,
  isMobileDevice,
  normalizeHomepageGuideState,
  shouldShowHomepageTip,
  toGuideBrowser,
  toLocalDayKey
} from "@/domain/homepage-guide";
import type { I18nMessageKey } from "@/i18n/messages";
import { trackProductEvent } from "@/infrastructure/product-analytics-repository";
import { useI18n } from "@/hooks/use-i18n";

const LEGACY_HOST_SUFFIX = ".github.io";

const BROWSER_LABELS: Record<HomepageGuideBrowser, string> = {
  chrome: "Chrome",
  edge: "Edge",
  firefox: "Firefox",
  safari: "Safari"
};

const BROWSER_MESSAGE_KEYS: Record<HomepageGuideBrowser, { steps: I18nMessageKey[]; note: I18nMessageKey }> = {
  chrome: {
    steps: ["homepageGuide.chrome.step1", "homepageGuide.chrome.step2", "homepageGuide.chrome.step3"],
    note: "homepageGuide.chrome.note"
  },
  edge: {
    steps: ["homepageGuide.edge.step1", "homepageGuide.edge.step2", "homepageGuide.edge.step3"],
    note: "homepageGuide.edge.note"
  },
  firefox: {
    steps: ["homepageGuide.firefox.step1", "homepageGuide.firefox.step2", "homepageGuide.firefox.step3"],
    note: "homepageGuide.firefox.note"
  },
  safari: {
    steps: ["homepageGuide.safari.step1", "homepageGuide.safari.step2", "homepageGuide.safari.step3"],
    note: "homepageGuide.safari.note"
  }
};

function isGuideSupported(): boolean {
  return !isMobileDevice(window.navigator.userAgent, window.navigator.maxTouchPoints ?? 0);
}

function isLegacyHost(): boolean {
  return window.location.hostname.endsWith(LEGACY_HOST_SUFFIX);
}

function readGuideState(): HomepageGuideState {
  try {
    const raw = window.localStorage.getItem(HOMEPAGE_GUIDE_STORAGE_KEY);
    return normalizeHomepageGuideState(raw ? JSON.parse(raw) : null);
  } catch {
    return normalizeHomepageGuideState(null);
  }
}

function writeGuideState(state: HomepageGuideState) {
  try {
    window.localStorage.setItem(HOMEPAGE_GUIDE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // The tip simply shows again next time when storage is unavailable.
  }
}

/** Home page strip asking returning visitors to make MyLinker their browser homepage. */
export function HomepageGuideTip({ suppressed }: { suppressed: boolean }) {
  const { t } = useI18n();
  const [tipVisible, setTipVisible] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      if (isLegacyHost() || !isGuideSupported()) {
        return;
      }

      const today = toLocalDayKey(new Date());
      const state = readGuideState();
      if (state.firstSeenDay === null) {
        writeGuideState({ ...state, firstSeenDay: today });
        return;
      }
      setTipVisible(shouldShowHomepageTip(state, today));
    }, 0);

    return () => window.clearTimeout(timerId);
  }, []);

  function hideTip() {
    writeGuideState({ ...readGuideState(), dismissed: true });
    setTipVisible(false);
  }

  function openGuide() {
    // Opening the guide answers the tip; it stays reachable from Settings.
    hideTip();
    setDialogOpen(true);
  }

  function dismissTip() {
    hideTip();
    trackProductEvent("homepage_guide.tip_dismissed");
  }

  return (
    <>
      {tipVisible && !suppressed ? (
        <section className="welcome-strip homepage-guide-tip" aria-label={t("homepageGuide.tipAria")}>
          <div className="welcome-copy">
            <strong>{t("homepageGuide.tipTitle")}</strong>
            <span>{t("homepageGuide.tipDescription")}</span>
          </div>
          <div className="welcome-actions">
            <button className="utility-button" type="button" onClick={openGuide}>{t("homepageGuide.tipOpen")}</button>
            <button className="utility-button" type="button" onClick={dismissTip}>{t("homepageGuide.tipDismiss")}</button>
          </div>
        </section>
      ) : null}
      {dialogOpen ? <HomepageGuideDialog source="home_tip" onClose={() => setDialogOpen(false)} /> : null}
    </>
  );
}

/** Settings entry point; always available, unlike the dismissible home tip. */
export function HomepageGuideButton() {
  const { t } = useI18n();
  const [supported, setSupported] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    const timerId = window.setTimeout(() => setSupported(isGuideSupported()), 0);
    return () => window.clearTimeout(timerId);
  }, []);

  if (!supported) {
    return null;
  }

  function openGuide() {
    // Whoever has seen the guide here should not be asked again by the home tip.
    writeGuideState({ ...readGuideState(), dismissed: true });
    setDialogOpen(true);
  }

  return (
    <>
      <button className="utility-button" type="button" onClick={openGuide}>
        {t("homepageGuide.settingsButton")}
      </button>
      {dialogOpen ? <HomepageGuideDialog source="settings" onClose={() => setDialogOpen(false)} /> : null}
    </>
  );
}

function HomepageGuideDialog({ source, onClose }: { source: HomepageGuideSource; onClose: () => void }) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const addressId = useId();
  const panelId = useId();
  const [detected] = useState<BrowserFamily>(() => detectBrowserFamily(window.navigator.userAgent));
  const [browser, setBrowser] = useState<HomepageGuideBrowser>(() => toGuideBrowser(detected));
  const [address] = useState(() => getHomepageGuideAddress(window.location.origin));
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    const element = dialogRef.current;
    if (!element || element.open) {
      return;
    }

    // Unmounting skips the native close steps, so restore focus ourselves (same as ConfirmDialog).
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (typeof element.showModal === "function") {
      element.showModal();
    } else {
      element.setAttribute("open", "");
    }

    trackProductEvent("homepage_guide.opened", { source, browserFamily: detected });

    return () => {
      if (previousFocus?.isConnected) {
        previousFocus.focus();
      }
    };
  }, [detected, source]);

  async function copyAddress() {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard unavailable");
      }
      await navigator.clipboard.writeText(address);
      setCopyStatus("copied");
      // Same browserFamily as the open event, so the funnel query pairs them per browser.
      trackProductEvent("homepage_guide.address_copied", { source, browserFamily: detected });
    } catch {
      setCopyStatus("failed");
    }
  }

  const messages = BROWSER_MESSAGE_KEYS[browser];

  return (
    <dialog
      ref={dialogRef}
      className="confirm-dialog homepage-guide-dialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="editor-card confirm-dialog-card">
        <div className="editor-body">
          <h2 className="editor-title" id={titleId}>{t("homepageGuide.dialogTitle")}</h2>
          <p className="confirm-dialog-message" id={descriptionId}>{t("homepageGuide.dialogDescription")}</p>

          <div className="homepage-guide-address">
            <label className="field" htmlFor={addressId}>
              <span>{t("homepageGuide.addressLabel")}</span>
            </label>
            <div className="homepage-guide-address-row">
              <input
                id={addressId}
                className="homepage-guide-address-input"
                type="text"
                readOnly
                value={address}
                onFocus={(event) => event.currentTarget.select()}
              />
              <button className="utility-button" type="button" onClick={copyAddress}>{t("homepageGuide.copy")}</button>
            </div>
            <p className="homepage-guide-copy-status" aria-live="polite">
              {copyStatus === "copied" ? t("homepageGuide.copied") : copyStatus === "failed" ? t("homepageGuide.copyFailed") : ""}
            </p>
          </div>

          <div className="bookmark-import-source-tabs" role="tablist" aria-label={t("homepageGuide.browserTabsAria")}>
            {HOMEPAGE_GUIDE_BROWSERS.map((option) => (
              <button
                key={option}
                className={option === browser ? "is-active" : ""}
                type="button"
                role="tab"
                aria-selected={option === browser}
                aria-controls={panelId}
                onClick={() => setBrowser(option)}
              >
                {BROWSER_LABELS[option]}
                {option === detected ? (
                  <>
                    <span className="homepage-guide-detected" aria-hidden="true" title={t("homepageGuide.detected")} />
                    <span className="visually-hidden">{t("homepageGuide.detected")}</span>
                  </>
                ) : null}
              </button>
            ))}
          </div>

          <div className="homepage-guide-panel" id={panelId} role="tabpanel">
            <ol className="homepage-guide-steps">
              {messages.steps.map((key) => <li key={key}>{t(key)}</li>)}
            </ol>
            <p className="homepage-guide-note">{t(messages.note)}</p>
          </div>
        </div>
        <div className="editor-footer confirm-dialog-actions">
          <button className="utility-button" type="button" onClick={onClose}>{t("common.close")}</button>
        </div>
      </div>
    </dialog>
  );
}
