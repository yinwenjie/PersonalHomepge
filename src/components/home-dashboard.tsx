"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createDefaultHomeDocument,
  createId,
  generateMark,
  HomeDocumentV2,
  HomeGroup,
  HomeSite,
  HomeSyncMeta,
  isValidUrl,
  migrateV1ToV2,
  normalizeHomeDocument,
  normalizeSearchText,
  normalizeText,
  normalizeUrl,
  renumberGroups,
  renumberSites,
  sortByOrder
} from "@/domain/home-document";
import { LocalHomeRepository } from "@/infrastructure/home-repository";
import { SiteCollection } from "@/components/site-collection";
import { SyncPanel } from "@/components/sync-panel";
import { WidgetPanel } from "@/components/widget-panel";
import { SYNC_BINDING_STORAGE_KEY } from "@/domain/sync-code";

type EditorState =
  | { kind: "group"; mode: "add" }
  | { kind: "group"; mode: "edit"; groupId: string }
  | { kind: "site"; mode: "add"; groupId: string }
  | { kind: "site"; mode: "edit"; groupId: string; siteId: string };

interface FormValues {
  groupTitle: string;
  groupKeywords: string;
  siteName: string;
  siteUrl: string;
  siteKeywords: string;
  siteMark: string;
}

const EMPTY_FORM_VALUES: FormValues = {
  groupTitle: "",
  groupKeywords: "",
  siteName: "",
  siteUrl: "",
  siteKeywords: "",
  siteMark: ""
};
const ONBOARDING_STORAGE_KEY = "homepage:onboarding:v1";

export function HomeDashboard() {
  const [homeDocument, setHomeDocument] = useState<HomeDocumentV2>(() => createDefaultHomeDocument());
  const [editMode, setEditMode] = useState(false);
  const [activeQuery, setActiveQuery] = useState("");
  const [saveStatus, setSaveStatus] = useState("");
  const [todayLabel, setTodayLabel] = useState("");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [formValues, setFormValues] = useState<FormValues>(EMPTY_FORM_VALUES);
  const [formError, setFormError] = useState("");
  const [storageReady, setStorageReady] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const repositoryRef = useRef<LocalHomeRepository | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    repositoryRef.current = new LocalHomeRepository(window.localStorage);
    const hasStoredDocument = repositoryRef.current.hasStoredDocument();
    const hasSyncBinding = Boolean(window.localStorage.getItem(SYNC_BINDING_STORAGE_KEY));
    const onboardingDone = window.localStorage.getItem(ONBOARDING_STORAGE_KEY) === "complete";
    setHomeDocument(repositoryRef.current.load());
    setShowWelcome(!hasStoredDocument && !hasSyncBinding && !onboardingDone);
    setTodayLabel(new Intl.DateTimeFormat("zh-CN", {
      weekday: "long",
      month: "long",
      day: "numeric"
    }).format(new Date()));
    setStorageReady(true);
  }, []);

  const updatedLabel = useMemo(() => {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(homeDocument.updatedAt));
  }, [homeDocument.updatedAt]);

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
    }).filter(({ sites }) => editMode || sites.length > 0);
  }, [activeQuery, editMode, homeDocument.groups]);

  const visibleCount = filteredGroups.reduce((sum, { sites }) => sum + sites.length, 0);
  const dragDisabled = Boolean(normalizeText(activeQuery));

  function commitHomeDocument(nextDocument: HomeDocumentV2, message = "已保存") {
    const normalized = normalizeHomeDocument({
      ...nextDocument,
      revision: nextDocument.revision + 1,
      updatedAt: new Date().toISOString()
    });

    repositoryRef.current?.save(normalized);
    setHomeDocument(normalized);
    setSaveStatus(message);
  }

  const replaceHomeDocument = useCallback((nextDocument: HomeDocumentV2, message: string) => {
    const normalized = normalizeHomeDocument(nextDocument);
    repositoryRef.current?.save(normalized);
    setHomeDocument(normalized);
    setSaveStatus(message);
  }, []);

  const updateSyncMeta = useCallback((syncMeta: HomeSyncMeta, message: string) => {
    setHomeDocument((currentDocument) => {
      const normalized = normalizeHomeDocument({
        ...currentDocument,
        syncMeta,
        updatedAt: new Date().toISOString()
      });
      repositoryRef.current?.save(normalized);
      return normalized;
    });
    setSaveStatus(message);
  }, []);

  function openGroupEditor(groupId?: string) {
    const group = groupId ? findGroup(homeDocument, groupId) : undefined;
    setEditor(group ? { kind: "group", mode: "edit", groupId: group.id } : { kind: "group", mode: "add" });
    setFormValues({
      ...EMPTY_FORM_VALUES,
      groupTitle: group?.title ?? "",
      groupKeywords: group?.keywords ?? ""
    });
    setFormError("");
  }

  function openSiteEditor(groupId: string, siteId?: string) {
    const group = findGroup(homeDocument, groupId);
    const site = siteId ? findSite(group, siteId) : undefined;
    if (!group) {
      return;
    }

    setEditor(site
      ? { kind: "site", mode: "edit", groupId, siteId: site.id }
      : { kind: "site", mode: "add", groupId });
    setFormValues({
      ...EMPTY_FORM_VALUES,
      siteName: site?.name ?? "",
      siteUrl: site?.url ?? "",
      siteKeywords: site?.keywords ?? "",
      siteMark: site?.mark ?? ""
    });
    setFormError("");
  }

  function closeEditor() {
    setEditor(null);
    setFormError("");
  }

  function addGroup(title: string, keywords: string) {
    const groups = sortByOrder(homeDocument.groups);
    groups.push({
      id: createId("group"),
      title,
      keywords,
      order: groups.length + 1,
      sites: []
    });
    commitHomeDocument({ ...homeDocument, groups: renumberGroups(groups) }, "分组已保存");
  }

  function updateGroup(groupId: string, title: string, keywords: string) {
    const groups = homeDocument.groups.map((group) => group.id === groupId
      ? { ...group, title, keywords }
      : group);
    commitHomeDocument({ ...homeDocument, groups: renumberGroups(groups) }, "分组已保存");
  }

  function deleteGroup(groupId: string) {
    const group = findGroup(homeDocument, groupId);
    if (!group || !window.confirm(`删除分组“${group.title}”及其中 ${group.sites.length} 个网站？`)) {
      return;
    }

    commitHomeDocument({
      ...homeDocument,
      groups: renumberGroups(homeDocument.groups.filter((item) => item.id !== groupId))
    }, "分组已删除");
  }

  function addSite(groupId: string, values: Pick<HomeSite, "name" | "url" | "keywords" | "mark">) {
    const groups = homeDocument.groups.map((group) => {
      if (group.id !== groupId) {
        return group;
      }

      const sites = sortByOrder(group.sites);
      sites.push({
        id: createId("site"),
        ...values,
        order: sites.length + 1
      });
      return { ...group, sites: renumberSites(sites) };
    });

    commitHomeDocument({ ...homeDocument, groups: renumberGroups(groups) }, "网站已保存");
  }

  function updateSite(groupId: string, siteId: string, values: Pick<HomeSite, "name" | "url" | "keywords" | "mark">) {
    const groups = homeDocument.groups.map((group) => {
      if (group.id !== groupId) {
        return group;
      }

      return {
        ...group,
        sites: renumberSites(group.sites.map((site) => site.id === siteId ? { ...site, ...values } : site))
      };
    });

    commitHomeDocument({ ...homeDocument, groups: renumberGroups(groups) }, "网站已保存");
  }

  function deleteSite(groupId: string, siteId: string) {
    const group = findGroup(homeDocument, groupId);
    const site = findSite(group, siteId);
    if (!group || !site || !window.confirm(`删除网站“${site.name}”？`)) {
      return;
    }

    const groups = homeDocument.groups.map((item) => item.id === groupId
      ? { ...item, sites: renumberSites(item.sites.filter((candidate) => candidate.id !== siteId)) }
      : item);
    commitHomeDocument({ ...homeDocument, groups: renumberGroups(groups) }, "网站已删除");
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(homeDocument, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `homepage-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function importJson(file: File | undefined) {
    if (!file) {
      return;
    }

    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const imported = parseImportedDocument(parsed);
      if (!window.confirm("导入会覆盖当前本地首页，继续？")) {
        return;
      }

      commitHomeDocument(imported, "已导入");
    } catch {
      window.alert("导入失败：JSON 格式不正确。");
    } finally {
      if (importInputRef.current) {
        importInputRef.current.value = "";
      }
    }
  }

  function resetDefault() {
    if (!window.confirm("恢复默认会清除当前浏览器中的本地编辑，继续？")) {
      return;
    }

    repositoryRef.current?.reset();
    setHomeDocument(createDefaultHomeDocument());
    setSaveStatus("已恢复默认");
  }

  function completeOnboarding() {
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "complete");
    setShowWelcome(false);
  }

  function keepDefaultTemplate() {
    const normalized = normalizeHomeDocument({
      ...homeDocument,
      updatedAt: new Date().toISOString()
    });
    repositoryRef.current?.save(normalized);
    setHomeDocument(normalized);
    completeOnboarding();
    setSaveStatus("已使用默认模板");
  }

  function openSyncCodeSetup() {
    completeOnboarding();
    setEditMode(true);
    setSaveStatus("请在同步码面板输入同步码");
  }

  function startBlankHome() {
    const blankDocument = normalizeHomeDocument({
      ...createDefaultHomeDocument(),
      documentId: createId("home"),
      updatedAt: new Date().toISOString(),
      groups: [],
      widgets: []
    });
    repositoryRef.current?.save(blankDocument);
    setHomeDocument(blankDocument);
    completeOnboarding();
    setEditMode(true);
    setSaveStatus("已从空白首页开始");
  }

  function dismissWelcome() {
    completeOnboarding();
  }

  function handleEditorSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) {
      return;
    }

    if (editor.kind === "group") {
      const title = normalizeText(formValues.groupTitle);
      const keywords = normalizeText(formValues.groupKeywords);
      if (!title) {
        setFormError("请输入分组名称。");
        return;
      }

      if (editor.mode === "add") {
        addGroup(title, keywords);
      } else {
        updateGroup(editor.groupId, title, keywords);
      }
      closeEditor();
      return;
    }

    const name = normalizeText(formValues.siteName);
    const rawUrl = normalizeText(formValues.siteUrl);
    const keywords = normalizeText(formValues.siteKeywords);
    const mark = normalizeText(formValues.siteMark).slice(0, 3) || generateMark(name);

    if (!name) {
      setFormError("请输入网站名称。");
      return;
    }

    if (!isValidUrl(rawUrl)) {
      setFormError("URL 只支持 http:// 或 https://。");
      return;
    }

    const values = {
      name,
      url: normalizeUrl(rawUrl),
      keywords,
      mark
    };

    if (editor.mode === "add") {
      addSite(editor.groupId, values);
    } else {
      updateSite(editor.groupId, editor.siteId, values);
    }
    closeEditor();
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

  function updateFormValue(field: keyof FormValues, value: string) {
    setFormValues((current) => ({ ...current, [field]: value }));
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    importJson(event.target.files?.[0]);
  }

  return (
    <main className="page">
      <header className="masthead">
        <div>
          <p className="eyebrow">{todayLabel || "Home"}</p>
          <h1>Home</h1>
        </div>
        <div className="header-side">
          <span className="sync-pill">
            <span className="dot" />
            {formatSyncStatus(homeDocument.syncMeta)}
          </span>
          <button className="utility-button" type="button" onClick={() => {
            setEditMode((value) => !value);
            setSaveStatus(editMode ? "" : "本地编辑");
          }}>
            {editMode ? "完成" : "编辑"}
          </button>
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

      {editMode ? (
        <section className="edit-toolbar" aria-label="编辑工具">
          <div className="edit-actions-row">
            <button className="utility-button" type="button" onClick={() => openGroupEditor()}>新增分组</button>
            <button className="utility-button" type="button" onClick={exportJson}>导出 JSON</button>
            <label className="file-button" htmlFor="importInput">导入 JSON</label>
            <input ref={importInputRef} id="importInput" type="file" accept="application/json" hidden onChange={handleFileChange} />
            <button className="danger-button" type="button" onClick={resetDefault}>恢复默认</button>
          </div>
          <span className="save-status">{saveStatus}</span>
        </section>
      ) : null}

      <SyncPanel
        documentValue={homeDocument}
        editorOpen={Boolean(editor)}
        storageReady={storageReady}
        visible={editMode}
        onReplaceDocument={replaceHomeDocument}
        onSyncMetaChange={updateSyncMeta}
      />

      <div className="workspace">
        <SiteCollection
          documentValue={homeDocument}
          visibleGroups={filteredGroups}
          editMode={editMode}
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
        <div className="editor-modal">
          <form className="editor-card" onSubmit={handleEditorSubmit}>
            <div className="editor-header">
              <h2 className="editor-title">{editor.kind === "group" ? editor.mode === "add" ? "新增分组" : "编辑分组" : editor.mode === "add" ? "新增网站" : "编辑网站"}</h2>
              <button className="mini-button" type="button" onClick={closeEditor} aria-label="关闭">×</button>
            </div>
            <div className="editor-body">
              {editor.kind === "group" ? (
                <>
                  <label className="field">
                    <span>分组名称</span>
                    <input value={formValues.groupTitle} onChange={(event) => updateFormValue("groupTitle", event.target.value)} autoFocus />
                  </label>
                  <label className="field">
                    <span>分组关键词</span>
                    <input value={formValues.groupKeywords} onChange={(event) => updateFormValue("groupKeywords", event.target.value)} />
                  </label>
                </>
              ) : (
                <>
                  <label className="field">
                    <span>网站名称</span>
                    <input value={formValues.siteName} onChange={(event) => updateFormValue("siteName", event.target.value)} autoFocus />
                  </label>
                  <label className="field">
                    <span>网站 URL</span>
                    <input value={formValues.siteUrl} onChange={(event) => updateFormValue("siteUrl", event.target.value)} inputMode="url" />
                  </label>
                  <label className="field">
                    <span>网站关键词</span>
                    <input value={formValues.siteKeywords} onChange={(event) => updateFormValue("siteKeywords", event.target.value)} />
                  </label>
                  <label className="field">
                    <span>图标文字</span>
                    <input value={formValues.siteMark} onChange={(event) => updateFormValue("siteMark", event.target.value)} maxLength={3} />
                  </label>
                </>
              )}
              <p className="form-error">{formError}</p>
            </div>
            <div className="editor-footer">
              <button className="utility-button" type="button" onClick={closeEditor}>取消</button>
              <button className="utility-button" type="submit">保存</button>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}

function findGroup(documentValue: HomeDocumentV2, groupId: string): HomeGroup | undefined {
  return documentValue.groups.find((group) => group.id === groupId);
}

function findSite(group: HomeGroup | undefined, siteId: string): HomeSite | undefined {
  return group?.sites.find((site) => site.id === siteId);
}

function parseImportedDocument(input: unknown): HomeDocumentV2 {
  try {
    return normalizeHomeDocument(input);
  } catch {
    return migrateV1ToV2(input);
  }
}

function formatSyncStatus(syncMeta: HomeSyncMeta): string {
  if (syncMeta.mode === "local") {
    return "仅本地";
  }

  const labels: Record<HomeSyncMeta["status"], string> = {
    "local-only": "仅本地",
    linked: "已绑定",
    syncing: "同步中",
    synced: "已同步",
    offline: "离线",
    conflict: "有冲突",
    error: "同步失败"
  };

  return labels[syncMeta.status];
}
