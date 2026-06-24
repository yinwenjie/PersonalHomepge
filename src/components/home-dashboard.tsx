"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  buildSearchUrl,
  searchEngineLabel
} from "@/domain/ui-preferences";
import type { HomeDocumentV2 } from "@/domain/home-document";
import {
  isUngroupedGroup,
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
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const locale = preferences.locale;
  const searchEngine = preferences.defaultSearchEngine;
  const searchEngineName = searchEngineLabel(searchEngine);
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
    completeOnboarding();
    if (template.id === "blank") {
      router.push("/edit");
    }
  }

  function dismissWelcome() {
    completeOnboarding();
  }

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const keyword = normalizeText(activeQuery);
    if (!keyword) {
      searchInputRef.current?.focus();
      return;
    }

    window.open(buildSearchUrl(searchEngine, keyword), "_blank", "noopener,noreferrer");
  }

  return (
    <>
      <HomeThemeStyleBridge theme={homeDocument.theme} />
      <main className="page">
      <header className={`masthead${hasBannerImage ? " masthead-banner" : ""}`}>
        <div>
          <p className="eyebrow">{todayLabel || "Home"}</p>
          <h1>Home</h1>
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
      </main>
    </>
  );
}
