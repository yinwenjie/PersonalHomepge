"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createDefaultHomeDocument,
  createId,
  isUngroupedGroup,
  normalizeHomeDocument,
  normalizeSearchText,
  normalizeText,
  sortByOrder
} from "@/domain/home-document";
import { SYNC_BINDING_STORAGE_KEY } from "@/domain/sync-code";
import { HomeDocumentEditorModal } from "@/components/home-document-editor-modal";
import { SiteCollection } from "@/components/site-collection";
import { SyncPanel } from "@/components/sync-panel";
import { WidgetPanel } from "@/components/widget-panel";
import { useHomeDocumentController } from "@/hooks/use-home-document-controller";
import { useHomeDocumentEditor } from "@/hooks/use-home-document-editor";

const ONBOARDING_STORAGE_KEY = "homepage:onboarding:v1";

export function HomeDashboard() {
  const router = useRouter();
  const {
    homeDocument,
    storageReady,
    updatedLabel,
    hasStoredDocument,
    commitHomeDocument,
    replaceHomeDocument,
    updateSyncMeta
  } = useHomeDocumentController();
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

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      setTodayLabel(new Intl.DateTimeFormat("zh-CN", {
        weekday: "long",
        month: "long",
        day: "numeric"
      }).format(new Date()));
    }, 0);

    return () => window.clearTimeout(timerId);
  }, []);

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

      return { group, sites };
    }).filter(({ group, sites }) => isUngroupedGroup(group) || sites.length > 0);
  }, [activeQuery, homeDocument.groups]);

  const visibleCount = filteredGroups.reduce((sum, { sites }) => sum + sites.length, 0);
  const dragDisabled = Boolean(normalizeText(activeQuery));

  function completeOnboarding() {
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "complete");
    setShowWelcome(false);
  }

  function keepDefaultTemplate() {
    replaceHomeDocument(normalizeHomeDocument({
      ...homeDocument,
      updatedAt: new Date().toISOString()
    }), "已使用默认模板");
    completeOnboarding();
  }

  function openSyncCodeSetup() {
    completeOnboarding();
    router.push("/edit");
  }

  function startBlankHome() {
    const blankDocument = normalizeHomeDocument({
      ...createDefaultHomeDocument(),
      documentId: createId("home"),
      updatedAt: new Date().toISOString(),
      groups: [],
      widgets: []
    });

    replaceHomeDocument(blankDocument, "已从空白首页开始");
    completeOnboarding();
    router.push("/edit");
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

    window.open(`https://duckduckgo.com/?q=${encodeURIComponent(keyword)}`, "_blank", "noopener,noreferrer");
  }

  return (
    <main className="page">
      <header className="masthead">
        <div>
          <p className="eyebrow">{todayLabel || "Home"}</p>
          <h1>Home</h1>
        </div>
      </header>

      {showWelcome ? (
        <section className="welcome-strip" aria-label="新用户启动选项">
          <div className="welcome-copy">
            <strong>开始设置你的首页</strong>
            <span>使用通用效率模板，输入同步码恢复已有首页，或从空白开始。</span>
          </div>
          <div className="welcome-actions">
            <button className="utility-button" type="button" onClick={keepDefaultTemplate}>使用模板</button>
            <button className="utility-button" type="button" onClick={openSyncCodeSetup}>输入同步码</button>
            <button className="utility-button" type="button" onClick={startBlankHome}>空白开始</button>
            <button className="mini-button" type="button" onClick={dismissWelcome} aria-label="稍后再设置">稍后</button>
          </div>
        </section>
      ) : null}

      <section className="search-panel" aria-label="搜索和过滤">
        <form className="search-box" onSubmit={handleSearchSubmit}>
          <input
            ref={searchInputRef}
            className="search-input"
            type="search"
            placeholder="搜索网站，或直接输入关键词"
            aria-label="搜索网站或使用 DuckDuckGo 搜索"
            value={activeQuery}
            onChange={(event) => setActiveQuery(event.target.value)}
          />
          <button className="search-button" type="submit" aria-label="使用 DuckDuckGo 搜索">
            <span className="search-icon" aria-hidden="true" />
          </button>
        </form>
        <div className="search-meta">
          <span>DuckDuckGo Search</span>
          <span><span className="search-count">{visibleCount}</span> 个入口可用</span>
        </div>
      </section>

      <SyncPanel
        documentValue={homeDocument}
        editorOpen={Boolean(editor)}
        storageReady={storageReady}
        visible={false}
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

        <WidgetPanel documentValue={homeDocument} updatedLabel={updatedLabel} />
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
  );
}
