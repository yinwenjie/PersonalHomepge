"use client";

import type { FormEvent, KeyboardEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  buildSearchUrl,
  getSearchEngineDefinition,
  resolveLocalePreference,
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
import { SiteCollection } from "@/components/site-collection";
import { SyncPanel } from "@/components/sync-panel";
import { TemplateLibraryPanel } from "@/components/template-library-panel";
import { WidgetPanel } from "@/components/widget-panel";
import { useHomeDocumentController } from "@/hooks/use-home-document-controller";
import { useHomeDocumentEditor } from "@/hooks/use-home-document-editor";
import { useSupabaseAuth } from "@/hooks/use-supabase-auth";
import { useUiPreferences } from "@/hooks/use-ui-preferences";
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
  const locale = resolveLocalePreference(preferences.locale);
  const searchEngine = preferences.defaultSearchEngine;
  const searchEngineName = searchEngineLabel(searchEngine);
  const searchEngineDefinition = getSearchEngineDefinition(searchEngine);
  const documentTitle = homeDocument.documentTitle;
  const hasBannerImage = homeDocument.theme.bannerAsset?.source === "external"
    || (homeDocument.theme.bannerAsset?.source === "storage" && Boolean(user));

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      setTodayLabel(new Intl.DateTimeFormat(locale, {
        weekday: "long",
        month: "long",
        day: "numeric"
      }).format(new Date()));
    }, 0);

    return () => window.clearTimeout(timerId);
  }, [locale]);

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
    return new Intl.DateTimeFormat(locale, {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(homeDocument.updatedAt));
  }, [homeDocument.updatedAt, locale]);

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
      window.alert("未能保存当前首页，已取消应用模板。");
      return;
    }

    replaceHomeDocument(createHomeDocumentFromTemplate(template.id), `已使用${template.name}`);
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
      window.alert("首页标题不能为空，已保留原标题。");
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

  function handleTitleDisplayKeyDown(event: KeyboardEvent<HTMLHeadingElement>) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    startTitleEditing();
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
    }, "首页标题已更新");
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
      <HomeThemeStyleBridge theme={homeDocument.theme} />
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
                  aria-label="首页标题"
                />
              </form>
            ) : (
              <h1
                className="home-title-display"
                title="单击编辑首页标题"
                role="button"
                tabIndex={0}
                onClick={startTitleEditing}
                onKeyDown={handleTitleDisplayKeyDown}
              >
                {documentTitle}
              </h1>
            )}
          </div>
        </div>
      </header>

      {showWelcome ? (
        <div className="welcome-template-shell">
          <section className="welcome-strip" aria-label="新用户启动选项">
            <div className="welcome-copy">
              <strong>开始设置你的首页</strong>
              <span>选择模板生成一个可编辑首页，或输入同步码恢复已有首页。</span>
            </div>
            <div className="welcome-actions">
              <button className="utility-button" type="button" onClick={openSyncCodeSetup}>输入同步码</button>
              <button className="mini-button" type="button" onClick={dismissWelcome} aria-label="稍后再设置">稍后</button>
            </div>
          </section>
          <div className="welcome-template-panel">
            <TemplateLibraryPanel
              actionLabel="使用模板"
              description="先选一个接近的起点，之后可以在首页直接删改、拖动和添加网站。"
              title="选择首页模板"
              onApply={applyTemplate}
            />
          </div>
        </div>
      ) : null}

      <section className="search-panel" aria-label="搜索和过滤">
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
            placeholder="搜索网站，或直接输入关键词"
            aria-label={`搜索网站或使用 ${searchEngineName} 搜索`}
            value={activeQuery}
            onChange={(event) => setActiveQuery(event.target.value)}
          />
          <button className="search-button" type="submit" aria-label={`使用 ${searchEngineName} 搜索`}>
            <span className="search-icon" aria-hidden="true" />
          </button>
        </form>
        <div className="search-meta">
          <span>{searchEngineName} Search</span>
          <span><span className="search-count">{visibleCount}</span> 个入口可用</span>
        </div>
      </section>

      <SyncPanel
        documentValue={homeDocument}
        editorOpen={Boolean(editor)}
        storageReady={storageReady}
        visible={false}
        onBeforeCloudOverwrite={handleBeforeCloudOverwrite}
        onBeforeOverwrite={handleBeforeOverwrite}
        onReplaceDocument={replaceHomeDocument}
        onSyncMetaChange={updateSyncMeta}
      />

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
                <h2 id="homeTitleConfirmTitle">确认修改首页标题</h2>
                <p id="homeTitleConfirmDescription">修改后会保存到当前首页空间，并参与后续同步和历史版本。</p>
              </div>
              <button className="mini-button" type="button" onClick={cancelTitleConfirmation} aria-label="关闭">×</button>
            </header>
            <div className="settings-dialog-body">
              <p className="home-title-confirm-preview">将首页标题改为“{titlePendingConfirmation}”？</p>
            </div>
            <footer className="settings-dialog-footer">
              <button className="utility-button" type="button" onClick={cancelTitleConfirmation}>取消</button>
              <button ref={titleConfirmButtonRef} className="utility-button" type="button" onClick={confirmTitleChange}>确认</button>
            </footer>
          </section>
        </div>
      ) : null}

      </main>
    </>
  );
}
