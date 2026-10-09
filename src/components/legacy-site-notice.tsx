"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/hooks/use-i18n";

const LEGACY_NOTICE_STORAGE_KEY = "homepage:legacy-notice:v1";
const LEGACY_HOST_SUFFIX = ".github.io";
const MAIN_SITE_URL = "https://mylinker.net/";

export function LegacySiteNotice() {
  const router = useRouter();
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      if (!window.location.hostname.endsWith(LEGACY_HOST_SUFFIX)) {
        return;
      }

      try {
        setVisible(window.localStorage.getItem(LEGACY_NOTICE_STORAGE_KEY) !== "dismissed");
      } catch {
        setVisible(true);
      }
    }, 0);

    return () => window.clearTimeout(timerId);
  }, []);

  if (!visible) {
    return null;
  }

  function dismiss() {
    try {
      window.localStorage.setItem(LEGACY_NOTICE_STORAGE_KEY, "dismissed");
    } catch {
      // Hiding for this page view is enough when storage is unavailable.
    }
    setVisible(false);
  }

  return (
    <section className="welcome-strip legacy-site-notice" aria-label={t("legacyNotice.aria")}>
      <div className="welcome-copy">
        <strong>{t("legacyNotice.title")}</strong>
        <span>{t("legacyNotice.description")}</span>
      </div>
      <div className="welcome-actions">
        <a className="utility-button" href={MAIN_SITE_URL}>{t("legacyNotice.openMainSite")}</a>
        <button className="utility-button" type="button" onClick={() => router.push("/edit")}>{t("legacyNotice.exportData")}</button>
        <button className="utility-button" type="button" onClick={dismiss}>{t("legacyNotice.dismiss")}</button>
      </div>
    </section>
  );
}
