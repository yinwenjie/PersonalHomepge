"use client";

import type { FormEvent, KeyboardEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { showAlert } from "@/components/confirm-dialog";
import {
  buildSearchUrl,
  getSearchEngineDefinition,
  searchEngineLabel
} from "@/domain/ui-preferences";
import { summarizeDocumentForAnalytics } from "@/domain/product-analytics";
import type { HomeDocumentV2 } from "@/domain/home-document";
import {
  HOME_DOCUMENT_TITLE_MAX_LENGTH,
  isUngroupedGroup,
  normalizeHomeDocumentTitle,
  normalizeSearchText,
  normalizeText,
  sortByOrder
} from "@/domain/home-document";
import { createHomeDocumentFromTemplate, type HomeTemplate } from "@/domain/home-template";
import { SYNC_BINDING_STORAGE_KEY } from "@/domain/sync-code";
import { HomeDocumentEditorModal } from "@/components/home-document-editor-modal";
import { HomeThemeStyleBridge } from "@/components/home-theme-style-bridge";
import { HomepageGuideTip } from "@/components/homepage-guide";
import { LegacySiteNotice } from "@/components/legacy-site-notice";
import { SiteCollection } from "@/components/site-collection";
import { TemplateLibraryPanel } from "@/components/template-library-panel";
import { WidgetPanel } from "@/components/widget-panel";
import { useHomeDocumentController } from "@/hooks/use-home-document-controller";
import { useHomeDocumentEditor } from "@/hooks/use-home-document-editor";
import { useSyncEngine } from "@/hooks/use-sync-engine";
import { useI18n } from "@/hooks/use-i18n";
import { useSupabaseAuth } from "@/hooks/use-supabase-auth";
import { useUiPreferences } from "@/hooks/use-ui-preferences";
import { formatHomeTemplateName } from "@/i18n/home-presentation";
import type { LocalHomeSnapshotSource } from "@/infrastructure/local-home-snapshot-repository";
import { trackProductEvent } from "@/infrastructure/product-analytics-repository";

const ONBOARDING_STORAGE_KEY = "homepage:onboarding:v1";

export function HomeDashboard() {
  const router = useRouter();
  const {
    homeDocument,
    storageReady,
    hasStoredDocument,
    commitHomeDocument,
    protectBeforeDangerousOverwrite,
    protectDocumentBeforeDangerousOverwrite,
    replaceHomeDocument,
    updateSyncMeta
  } = useHomeDocumentController();
  const { preferences } = useUiPreferences();
  const { user } = useSupabaseAuth();
  const {
    editor,
    formValues,
    formError,
    openGroupEditor,
    openSiteEditor,
    closeEditor,
    updateFormValue,
    handleEditorSubmit,
    deleteGroup,
    deleteSite
  } = useHomeDocumentEditor({ homeDocument, commitHomeDocument });
  const { t, format } = useI18n();
  const [activeQuery, setActiveQuery] = useState("");
  const [todayLabel, setTodayLabel] = useState("");
  const [showWelcome, setShowWelcome] = useState(false);
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [titlePendingConfirmation, setTitlePendingConfirmation] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const titleConfirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const titleCommitGuardRef = useRef(false);
  const homeViewedTrackedRef = useRef(false);
  const searchEngine = preferences.defaultSearchEngine;
  const searchEngineName = searchEngineLabel(searchEngine);
  const searchEngineDefinition = getSearchEngineDefinition(searchEngine);
  const documentTitle = homeDocument.documentTitle;
  const hasBannerImage = homeDocument.theme.bannerAsset?.source === "external"
    || (homeDocument.theme.bannerAsset?.source === "storage" && Boolean(user));

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      setTodayLabel(format.weekdayMonthDay(new Date()));
    }, 0);

    return () => window.clearTimeout(timerId);
  }, [format]);

  useEffect(() => {
    document.title = documentTitle;

    return () => {
      document.title = "Home";
    };
  }, [documentTitle]);

  useEffect(() => {
    if (!titleEditing) {
      return;
    }

    const timerId = window.setTimeout(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }, 0);

    return () => window.clearTimeout(timerId);
  }, [titleEditing]);

  useEffect(() => {
    if (!titlePendingConfirmation) {
      return;
    }

    const timerId = window.setTimeout(() => {
      titleConfirmButtonRef.current?.focus();
    }, 0);

    return () => window.clearTimeout(timerId);
  }, [titlePendingConfirmation]);

  const updatedLabel = useMemo(() => {
    return format.shortDateTime(new Date(homeDocument.updatedAt));
  }, [format, homeDocument.updatedAt]);

  useEffect(() => {
    if (!storageReady) {
      return;
    }

    const timerId = window.setTimeout(() => {
      const hasSyncBinding = Boolean(window.localStorage.getItem(SYNC_BINDING_STORAGE_KEY));
      const onboardingDone = window.localStorage.getItem(ONBOARDING_STORAGE_KEY) === "complete";
      setShowWelcome(!hasStoredDocument && !hasSyncBinding && !onboardingDone);
    }, 0);

    return () => window.clearTimeout(timerId);
  }, [hasStoredDocument, storageReady]);

  useEffect(() => {
    if (!storageReady || homeViewedTrackedRef.current) {
      return;
    }

    homeViewedTrackedRef.current = true;
    trackProductEvent("home.viewed", {
      ...summarizeDocumentForAnalytics(homeDocument),
      hasStoredDocument,
      hasSyncBinding: homeDocument.syncMeta.mode === "sync-code",
      signedIn: Boolean(user)
    });
  }, [hasStoredDocument, homeDocument, storageReady, user]);

  const filteredGroups = useMemo(() => {
    const keyword = normalizeSearchText(activeQuery);
    return sortByOrder(homeDocument.groups).map((group) => {
      const groupSearchText = normalizeSearchText(`${group.title} ${group.keywords}`);
      const groupMatches = Boolean(keyword && groupSearchText.includes(keyword));
      const sites = sortByOrder(group.sites).filter((site) => {
        const siteSearchText = normalizeSearchText(`${groupSearchText} ${site.name} ${site.mark} ${site.keywords}`);
        return !keyword || groupMatches || siteSearchText.includes(keyword);
      });

      return { group, groupMatches, sites };
    }).filter(({ group, groupMatches, sites }) => isUngroupedGroup(group) || sites.length > 0 || !keyword || groupMatches);
  }, [activeQuery, homeDocument.groups]);

  const visibleCount = filteredGroups.reduce((sum, { sites }) => sum + sites.length, 0);
  const dragDisabled = Boolean(normalizeText(activeQuery));
  const handleBeforeOverwrite = useCallback((source: LocalHomeSnapshotSource) => {
    return protectBeforeDangerousOverwrite(source).canContinue;
  }, [protectBeforeDangerousOverwrite]);
  const handleBeforeCloudOverwrite = useCallback((documentValue: HomeDocumentV2, source: LocalHomeSnapshotSource) => {
    return protectDocumentBeforeDangerousOverwrite(documentValue, source).canContinue;
  }, [protectDocumentBeforeDangerousOverwrite]);

  useSyncEngine({
    documentValue: homeDocument,
    editorOpen: Boolean(editor),
    storageReady,
    visible: false,
    onBeforeCloudOverwrite: handleBeforeCloudOverwrite,
    onBeforeOverwrite: handleBeforeOverwrite,
    onReplaceDocument: replaceHomeDocument,
    onSyncMetaChange: updateSyncMeta,
  });

  function completeOnboarding() {
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "complete");
    setShowWelcome(false);
  }

  function openSyncCodeSetup() {
    completeOnboarding();
    router.push("/edit");
  }

  function applyTemplate(template: HomeTemplate) {
    if (!protectBeforeDangerousOverwrite("before-template-apply").canContinue) {
      void showAlert(t("home.templateProtectFailed"));
      return;
    }

    replaceHomeDocument(createHomeDocumentFromTemplate(template.id), t("home.templateApplied", {
      template: formatHomeTemplateName(template.id, t)
    }));
    trackProductEvent("template.applied", {
      source: "welcome",
      templateId: template.id
    });
    completeOnboarding();
    if (template.id === "blank") {
      router.push("/edit");
    }
  }

  function dismissWelcome() {
    completeOnboarding();
  }

  function startTitleEditing() {
    if (titlePendingConfirmation) {
      return;
    }

    titleCommitGuardRef.current = false;
    setTitleDraft(documentTitle);
    setTitleEditing(true);
  }

  function cancelTitleEditing() {
    setTitleEditing(false);
    setTitleDraft("");
  }

  function completeTitleEditing() {
    if (titleCommitGuardRef.current) {
      return;
    }

    titleCommitGuardRef.current = true;
    const nextTitle = normalizeHomeDocumentTitle(titleDraft);
    if (!normalizeText(titleDraft)) {
      void showAlert(t("home.titleEmptyAlert"));
      cancelTitleEditing();
      window.setTimeout(() => {
        titleCommitGuardRef.current = false;
      }, 0);
      return;
    }

    if (nextTitle === documentTitle) {
      cancelTitleEditing();
      window.setTimeout(() => {
        titleCommitGuardRef.current = false;
      }, 0);
      return;
    }

    setTitleEditing(false);
    setTitlePendingConfirmation(nextTitle);
  }

  function handleTitleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    completeTitleEditing();
  }

  function handleTitleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelTitleEditing();
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      completeTitleEditing();
    }
  }

  function cancelTitleConfirmation() {
    setTitlePendingConfirmation(null);
    setTitleDraft("");
    titleCommitGuardRef.current = false;
  }

  function confirmTitleChange() {
    if (!titlePendingConfirmation) {
      return;
    }

    commitHomeDocument({
      ...homeDocument,
      documentTitle: titlePendingConfirmation
    }, t("home.titleUpdatedMessage"));
    setTitlePendingConfirmation(null);
    setTitleDraft("");
    titleCommitGuardRef.current = false;
  }

  function handleTitleConfirmationKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape") {
      return;
    }

    event.preventDefault();
    cancelTitleConfirmation();
  }

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const keyword = normalizeText(activeQuery);
    if (!keyword) {
      searchInputRef.current?.focus();
      return;
    }

    window.open(buildSearchUrl(searchEngine, keyword), "_blank", "noopener,noreferrer");
    trackProductEvent("search.submitted", {
      searchEngine
    });
  }

  return (
    <>
      <HomeThemeStyleBridge theme={homeDocument.theme} documentId={homeDocument.documentId} spaceId={homeDocument.syncMeta.spaceId} storageReady={storageReady} />
      <main className="page">
      <header className={`masthead${hasBannerImage ? " masthead-banner" : ""}`}>
        <div className="home-title-block">
          <p className="eyebrow">{todayLabel || "Home"}</p>
          <div className={`home-title-row${titleEditing ? " is-editing" : ""}`}>
            {titleEditing ? (
              <form className="home-title-inline-form" onSubmit={handleTitleSubmit}>
                <input
                  ref={titleInputRef}
                  className="home-title-input"
                  maxLength={HOME_DOCUMENT_TITLE_MAX_LENGTH}
                  value={titleDraft}
                  onBlur={completeTitleEditing}
                  onChange={(event) => setTitleDraft(event.target.value)}
                  onKeyDown={handleTitleKeyDown}
                  aria-label={t("home.titleInputAria")}
                />
              </form>
            ) : (
              <h1 className="home-title-display home-title-editable">
                <button
                  className="home-title-button"
                  type="button"
                  title={t("home.titleDisplayTitle")}
                  onClick={startTitleEditing}
                >
                  {documentTitle}
                </button>
              </h1>
            )}
          </div>
        </div>
      </header>

      <LegacySiteNotice />
      <HomepageGuideTip suppressed={showWelcome} />

      {showWelcome ? (
        <div className="welcome-template-shell">
          <section className="welcome-strip" aria-label={t("home.welcomeAria")}>
            <div className="welcome-copy">
              <strong>{t("home.welcomeTitle")}</strong>
              <span>{t("home.welcomeDescription")}</span>
            </div>
            <div className="welcome-actions">
              <button className="utility-button" type="button" onClick={openSyncCodeSetup}>{t("home.welcomeSyncCode")}</button>
              <button className="mini-button" type="button" onClick={dismissWelcome} aria-label={t("home.welcomeLater")}>{t("home.welcomeLater")}</button>
            </div>
          </section>
          <div className="welcome-template-panel">
            <TemplateLibraryPanel
              actionLabel={t("home.templateAction")}
              description={t("home.templateDescription")}
              title={t("home.templateTitle")}
              onApply={applyTemplate}
            />
          </div>
        </div>
      ) : null}

      <section className="search-panel" aria-label={t("home.searchSectionAria")}>
        <form className="search-box" onSubmit={handleSearchSubmit}>
          <span
            className={`search-engine-logo search-engine-logo-${searchEngineDefinition.id}`}
            aria-hidden="true"
            title={searchEngineDefinition.label}
          >
            {searchEngineDefinition.iconText}
          </span>
          <input
            ref={searchInputRef}
            className="search-input"
            type="search"
            placeholder={t("home.searchPlaceholder")}
            aria-label={t("home.searchInputAria", { engine: searchEngineName })}
            value={activeQuery}
            onChange={(event) => setActiveQuery(event.target.value)}
          />
          <button className="search-button" type="submit" aria-label={t("home.searchSubmitAria", { engine: searchEngineName })}>
            <span className="search-icon" aria-hidden="true" />
          </button>
        </form>
        <div className="search-meta">
          <span>{t("home.searchEngineMeta", { engine: searchEngineName })}</span>
          <span aria-live="polite"><span className="search-count">{format.number(visibleCount)}</span> {t("home.searchVisibleUnit")}</span>
        </div>
      </section>

      <div className="workspace">
        <SiteCollection
          documentValue={homeDocument}
          visibleGroups={filteredGroups}
          editMode={false}
          dragDisabled={dragDisabled}
          visibleCount={visibleCount}
          onCommitDocument={commitHomeDocument}
          onOpenGroupEditor={openGroupEditor}
          onOpenSiteEditor={openSiteEditor}
          onDeleteGroup={deleteGroup}
          onDeleteSite={deleteSite}
        />

        <WidgetPanel
          documentValue={homeDocument}
          updatedLabel={updatedLabel}
          onCommitDocument={commitHomeDocument}
        />
      </div>

      {editor ? (
        <HomeDocumentEditorModal
          editor={editor}
          formValues={formValues}
          formError={formError}
          onClose={closeEditor}
          onSubmit={handleEditorSubmit}
          onUpdateFormValue={updateFormValue}
          onDeleteSite={deleteSite}
        />
      ) : null}

      {titlePendingConfirmation ? (
        <div
          className="settings-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="homeTitleConfirmTitle"
          aria-describedby="homeTitleConfirmDescription"
          onKeyDown={handleTitleConfirmationKeyDown}
        >
          <section className="settings-dialog home-title-confirm-dialog">
            <header className="settings-dialog-header">
              <div>
                <h2 id="homeTitleConfirmTitle">{t("home.titleConfirmTitle")}</h2>
                <p id="homeTitleConfirmDescription">{t("home.titleConfirmDescription")}</p>
              </div>
              <button className="mini-button" type="button" onClick={cancelTitleConfirmation} aria-label={t("common.close")}>×</button>
            </header>
            <div className="settings-dialog-body">
              <p className="home-title-confirm-preview">{t("home.titleConfirmPreview", { title: titlePendingConfirmation })}</p>
            </div>
            <footer className="settings-dialog-footer">
              <button className="utility-button" type="button" onClick={cancelTitleConfirmation}>{t("common.cancel")}</button>
              <button ref={titleConfirmButtonRef} className="utility-button" type="button" onClick={confirmTitleChange}>{t("common.confirm")}</button>
            </footer>
          </section>
        </div>
      ) : null}

      </main>
    </>
  );
}
