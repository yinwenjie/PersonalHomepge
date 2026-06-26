"use client";

import type { ChangeEvent, RefObject } from "react";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { StatusMessage, type StatusTone } from "@/components/status-message";
import {
  applyBookmarkImportDraft,
  applyBookmarkImportUndo,
  calculateBookmarkImportGroupStats,
  createBookmarkImportDraft,
  filterBookmarkImportItems,
  getBookmarkImportStatusLabel,
  isBookmarkImportItemSelectable,
  resetBookmarkImportDefaultSelection,
  setBookmarkImportGroupMapping,
  setBookmarkImportItemsSelected,
  setBookmarkImportItemSelected,
  type BookmarkImportDraft,
  type BookmarkImportDraftGroup,
  type BookmarkImportDraftItem,
  type BookmarkImportSourceKind,
  type BookmarkImportStatusFilter
} from "@/domain/bookmark-import";
import { parseBookmarkHtml } from "@/domain/bookmark-html-parser";
import {
  isUngroupedGroup,
  sortByOrder,
  UNGROUPED_GROUP_ID
} from "@/domain/home-document";
import { bucketCount } from "@/domain/product-analytics";
import type { HomeDocumentV2, HomeGroup } from "@/domain/home-document";
import { parseUrlList } from "@/domain/url-list-import";
import { captureClientError } from "@/infrastructure/error-monitoring-repository";
import { BookmarkImportStorageRepository } from "@/infrastructure/bookmark-import-storage";
import type { LocalHomeSnapshotSource } from "@/infrastructure/local-home-snapshot-repository";
import { trackProductEvent } from "@/infrastructure/product-analytics-repository";

interface BookmarkImportPanelProps {
  documentValue: HomeDocumentV2;
  storageReady: boolean;
  onBeforeOverwrite: (source: LocalHomeSnapshotSource) => boolean;
  onCommitDocument: (documentValue: HomeDocumentV2, message?: string) => void;
}

type ImportDialogStep = "source" | "summary" | "groups" | "preview" | "confirm";

const BOOKMARK_HTML_MAX_BYTES = 10 * 1024 * 1024;
const URL_LIST_MAX_LINES = 5000;
const PREVIEW_PAGE_SIZE_OPTIONS = [50, 100, 200] as const;
const EMPTY_IMPORT_STORAGE_STATE = "0:0:0";

function subscribeBookmarkImportStorage(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handleStorageChange = (event: StorageEvent) => {
    if (!event.storageArea || event.storageArea === window.localStorage) {
      onStoreChange();
    }
  };

  window.addEventListener("storage", handleStorageChange);
  return () => window.removeEventListener("storage", handleStorageChange);
}

function getBookmarkImportStorageState(storageReady: boolean, homeDocumentId: string, refreshKey: number): string {
  if (!storageReady || typeof window === "undefined") {
    return EMPTY_IMPORT_STORAGE_STATE;
  }

  try {
    const repository = new BookmarkImportStorageRepository(window.localStorage);
    return `${repository.hasDraft(homeDocumentId) ? 1 : 0}:${repository.hasUndo(homeDocumentId) ? 1 : 0}:${refreshKey}`;
  } catch {
    return `0:0:${refreshKey}`;
  }
}

export function BookmarkImportPanel({
  documentValue,
  storageReady,
  onBeforeOverwrite,
  onCommitDocument
}: BookmarkImportPanelProps) {
  const storageRepositoryRef = useRef<BookmarkImportStorageRepository | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<BookmarkImportDraft | null>(null);
  const [step, setStep] = useState<ImportDialogStep>("source");
  const [storageRefreshKey, setStorageRefreshKey] = useState(0);
  const [message, setMessage] = useState("书签文件和 URL 列表只在当前浏览器本地解析。");
  const [messageTone, setMessageTone] = useState<StatusTone>("neutral");
  const storageState = useSyncExternalStore(
    subscribeBookmarkImportStorage,
    () => getBookmarkImportStorageState(storageReady, documentValue.documentId, storageRefreshKey),
    () => EMPTY_IMPORT_STORAGE_STATE
  );
  const hasSavedDraft = storageState.startsWith("1:");
  const hasUndo = storageState.charAt(2) === "1";

  function getStorageRepository(): BookmarkImportStorageRepository | null {
    if (!storageReady || typeof window === "undefined") {
      return null;
    }

    storageRepositoryRef.current ??= new BookmarkImportStorageRepository(window.localStorage);
    return storageRepositoryRef.current;
  }

  function refreshSavedState() {
    setStorageRefreshKey((value) => value + 1);
  }

  function openNewImportDialog() {
    setDraft(null);
    setStep("source");
    setDialogOpen(true);
    setMessage("请选择书签 HTML 文件，或粘贴一组 URL。");
    setMessageTone("neutral");
    trackProductEvent("bookmark_import.opened", {
      source: "settings"
    });
  }

  function continueSavedDraft() {
    const savedDraft = getStorageRepository()?.loadDraft(documentValue.documentId);
    if (!savedDraft) {
      setMessage("没有可继续的导入草稿，或草稿已过期。");
      setMessageTone("warning");
      refreshSavedState();
      return;
    }

    setDraft(savedDraft);
    setStep("summary");
    setDialogOpen(true);
    setMessage("已恢复上次导入草稿。");
    setMessageTone("success");
  }

  function persistDraft(nextDraft: BookmarkImportDraft | null) {
    setDraft(nextDraft);

    if (!nextDraft) {
      getStorageRepository()?.clearDraft();
      refreshSavedState();
      return;
    }

    try {
      getStorageRepository()?.saveDraft(nextDraft, documentValue.documentId, documentValue.revision);
      refreshSavedState();
    } catch (error) {
      console.warn(error);
      captureClientError(error, {
        eventType: "async_operation_failed",
        operation: "bookmark_import.draft_save",
        properties: {
          source: "bookmark-import-panel",
          sourceKind: nextDraft.sourceKind
        },
        severity: "warning"
      });
      setMessage("导入草稿无法写入 localStorage；刷新页面后草稿可能丢失。");
      setMessageTone("warning");
    }
  }

  function closeDialog() {
    if (draft) {
      setMessage("导入草稿已保留 24 小时。");
      setMessageTone("neutral");
    }
    setDialogOpen(false);
    refreshSavedState();
  }

  function discardDraft() {
    persistDraft(null);
    setStep("source");
    setMessage("导入草稿已丢弃。");
    setMessageTone("neutral");
  }

  function commitDraft() {
    if (!draft) {
      return;
    }

    const result = applyBookmarkImportDraft(documentValue, draft);
    if (result.addedSiteCount === 0) {
      setMessage("没有选中可导入的网站。");
      setMessageTone("warning");
      return;
    }

    if (!onBeforeOverwrite("before-bookmark-import")) {
      setMessage("未能保存当前首页，已取消导入。");
      setMessageTone("danger");
      return;
    }

    let undoSaved = true;
    try {
      getStorageRepository()?.saveUndo({
        importBatchId: draft.id,
        homeDocumentId: documentValue.documentId,
        beforeDocument: documentValue,
        addedGroupIds: result.addedGroupIds,
        addedSiteIdsByGroupId: result.addedSiteIdsByGroupId
      });
      refreshSavedState();
    } catch (error) {
      console.warn(error);
      captureClientError(error, {
        eventType: "async_operation_failed",
        operation: "bookmark_import.undo_save",
        properties: {
          source: "bookmark-import-panel",
          sourceKind: draft.sourceKind
        },
        severity: "warning"
      });
      undoSaved = false;
    }

    onCommitDocument(result.document, `已导入 ${result.addedSiteCount} 个网站`);
    trackProductEvent("bookmark_import.completed", {
      groupCountBucket: bucketCount(result.addedGroupIds.length),
      siteCountBucket: bucketCount(result.addedSiteCount),
      sourceKind: draft.sourceKind
    });
    getStorageRepository()?.clearDraft();
    setDraft(null);
    setDialogOpen(false);
    refreshSavedState();
    setMessage(undoSaved
      ? `已导入 ${result.addedSiteCount} 个网站。`
      : `已导入 ${result.addedSiteCount} 个网站，但撤销记录无法写入 localStorage。`);
    setMessageTone(undoSaved ? "success" : "warning");
  }

  function undoLastImport() {
    const undo = getStorageRepository()?.loadUndo(documentValue.documentId);
    if (!undo) {
      setMessage("没有可撤销的最近一次导入，或撤销记录已过期。");
      setMessageTone("warning");
      refreshSavedState();
      return;
    }

    if (!window.confirm("撤销会移除最近一次导入新增的网站；如果之后移动过这些网站，会尽量按网站 ID 清理。继续？")) {
      return;
    }

    if (!onBeforeOverwrite("before-bookmark-import-undo")) {
      setMessage("未能保存当前首页，已取消撤销。");
      setMessageTone("danger");
      return;
    }

    onCommitDocument(applyBookmarkImportUndo(documentValue, undo), "已撤销最近一次导入");
    getStorageRepository()?.clearUndo();
    refreshSavedState();
    setMessage("已撤销最近一次导入。");
    setMessageTone("success");
  }

  return (
    <>
      <div className="advanced-operation-block">
        <div className="advanced-operation-head">
          <h3>收藏 / 链接导入</h3>
          <span>Import</span>
        </div>
        <div className="settings-actions">
          <button
            className="utility-button"
            type="button"
            disabled={!storageReady}
            title={storageReady ? "导入浏览器书签 HTML 或 URL 列表" : "本地存储尚未就绪，请稍后重试。"}
            onClick={openNewImportDialog}
          >
            导入收藏/链接
          </button>
          {hasSavedDraft ? (
            <button className="utility-button" type="button" onClick={continueSavedDraft}>
              继续上次导入
            </button>
          ) : null}
          {hasUndo ? (
            <button className="utility-button" type="button" onClick={undoLastImport}>
              撤销最近一次导入
            </button>
          ) : null}
        </div>
        <StatusMessage tone={messageTone}>
          {message}
        </StatusMessage>
      </div>

      {dialogOpen ? (
        <BookmarkImportDialog
          documentValue={documentValue}
          draft={draft}
          step={step}
          onChangeDraft={persistDraft}
          onChangeStep={setStep}
          onClose={closeDialog}
          onCommit={commitDraft}
          onDiscardDraft={discardDraft}
        />
      ) : null}
    </>
  );
}

function BookmarkImportDialog({
  documentValue,
  draft,
  step,
  onChangeDraft,
  onChangeStep,
  onClose,
  onCommit,
  onDiscardDraft
}: {
  documentValue: HomeDocumentV2;
  draft: BookmarkImportDraft | null;
  step: ImportDialogStep;
  onChangeDraft: (draft: BookmarkImportDraft | null) => void;
  onChangeStep: (step: ImportDialogStep) => void;
  onClose: () => void;
  onCommit: () => void;
  onDiscardDraft: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [sourceKind, setSourceKind] = useState<BookmarkImportSourceKind>("bookmark-html");
  const [urlListText, setUrlListText] = useState("");
  const [dialogMessage, setDialogMessage] = useState("选择导入来源后，会先生成可预览的本地草稿。");
  const [dialogTone, setDialogTone] = useState<StatusTone>("neutral");
  const [statusFilter, setStatusFilter] = useState<BookmarkImportStatusFilter>("all");
  const [groupFilter, setGroupFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [pageSize, setPageSize] = useState<number>(100);
  const [page, setPage] = useState(1);

  const existingGroups = useMemo(() => {
    return sortByOrder(documentValue.groups).filter((group) => !isUngroupedGroup(group));
  }, [documentValue.groups]);
  const filteredItems = useMemo(() => {
    return draft
      ? filterBookmarkImportItems({ draft, groupId: groupFilter, query, status: statusFilter })
      : [];
  }, [draft, groupFilter, query, statusFilter]);
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedItems = filteredItems.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  async function handleBookmarkFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) {
      return;
    }

    try {
      if (file.size > BOOKMARK_HTML_MAX_BYTES) {
        throw new Error("书签 HTML 文件不能超过 10MB。");
      }

      const sourceItems = parseBookmarkHtml(await file.text());
      if (sourceItems.length === 0) {
        throw new Error("没有在文件中找到可导入的链接。");
      }

      const nextDraft = createBookmarkImportDraft({
        documentValue,
        sourceItems,
        sourceKind: "bookmark-html",
        sourceName: file.name
      });
      onChangeDraft(nextDraft);
      onChangeStep("summary");
      resetPreviewFilters();
      setDialogMessage(`已解析 ${nextDraft.stats.totalItems} 条书签。`);
      setDialogTone("success");
      trackProductEvent("bookmark_import.parsed", {
        groupCountBucket: bucketCount(nextDraft.stats.candidateGroups),
        siteCountBucket: bucketCount(nextDraft.stats.validItems),
        sourceKind: "bookmark-html"
      });
    } catch (error) {
      setDialogMessage(error instanceof Error ? error.message : "书签 HTML 解析失败。");
      setDialogTone("danger");
      trackProductEvent("bookmark_import.failed", {
        reasonCode: getImportFailureReason(error),
        sourceKind: "bookmark-html"
      });
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  function handleUrlListSubmit() {
    try {
      const lineCount = urlListText.split(/\r?\n/).length;
      if (lineCount > URL_LIST_MAX_LINES) {
        throw new Error("URL 列表不能超过 5000 行。");
      }

      const sourceItems = parseUrlList(urlListText);
      if (sourceItems.length === 0) {
        throw new Error("没有找到可导入的 URL。");
      }

      const nextDraft = createBookmarkImportDraft({
        documentValue,
        sourceItems,
        sourceKind: "url-list",
        sourceName: "URL 列表"
      });
      onChangeDraft(nextDraft);
      onChangeStep("summary");
      resetPreviewFilters();
      setDialogMessage(`已解析 ${nextDraft.stats.totalItems} 条 URL。`);
      setDialogTone("success");
      trackProductEvent("bookmark_import.parsed", {
        groupCountBucket: bucketCount(nextDraft.stats.candidateGroups),
        siteCountBucket: bucketCount(nextDraft.stats.validItems),
        sourceKind: "url-list"
      });
    } catch (error) {
      setDialogMessage(error instanceof Error ? error.message : "URL 列表解析失败。");
      setDialogTone("danger");
      trackProductEvent("bookmark_import.failed", {
        reasonCode: getImportFailureReason(error),
        sourceKind: "url-list"
      });
    }
  }

  function updateDraft(nextDraft: BookmarkImportDraft) {
    onChangeDraft(nextDraft);
    setPage(1);
  }

  function resetPreviewFilters() {
    setStatusFilter("all");
    setGroupFilter("all");
    setQuery("");
    setPage(1);
  }

  function handleDiscardDraft() {
    onDiscardDraft();
    resetPreviewFilters();
    setDialogMessage("导入草稿已丢弃。");
    setDialogTone("neutral");
  }

  function updateGroupMode(group: BookmarkImportDraftGroup, mode: string) {
    const nextMode = mode as BookmarkImportDraftGroup["mode"];
    const targetGroup = existingGroups.find((candidate) => candidate.id === group.targetGroupId) ?? existingGroups[0];
    updateDraft(setBookmarkImportGroupMapping(draftRequired(draft), group.id, {
      mode: nextMode,
      targetGroupId: nextMode === "merge" ? targetGroup?.id ?? null : nextMode === "ungrouped" ? UNGROUPED_GROUP_ID : null,
      targetGroupTitle: nextMode === "merge" ? targetGroup?.title ?? group.targetGroupTitle : nextMode === "ungrouped" ? "未分组" : nextMode === "skip" ? "跳过" : group.suggestedTitle
    }));
  }

  function updateGroupTarget(group: BookmarkImportDraftGroup, targetGroupId: string) {
    const targetGroup = existingGroups.find((candidate) => candidate.id === targetGroupId);
    updateDraft(setBookmarkImportGroupMapping(draftRequired(draft), group.id, {
      mode: "merge",
      targetGroupId: targetGroup?.id ?? null,
      targetGroupTitle: targetGroup?.title ?? group.targetGroupTitle
    }));
  }

  function updateGroupTitle(group: BookmarkImportDraftGroup, targetGroupTitle: string) {
    updateDraft(setBookmarkImportGroupMapping(draftRequired(draft), group.id, {
      mode: "create",
      targetGroupId: null,
      targetGroupTitle
    }));
  }

  function bulkSelect(selected: boolean) {
    const ids = new Set(filteredItems.map((item) => item.id));
    updateDraft(setBookmarkImportItemsSelected(draftRequired(draft), (item) => ids.has(item.id), selected));
  }

  function onlySelectNewLinks() {
    const currentDraft = draftRequired(draft);
    const ids = new Set(filteredItems.filter((item) => item.duplicateStatus === "new").map((item) => item.id));
    const clearedDraft = setBookmarkImportItemsSelected(currentDraft, () => true, false);
    updateDraft(setBookmarkImportItemsSelected(clearedDraft, (item) => ids.has(item.id), true));
  }

  const canGoNext = step === "source" ? Boolean(draft) : true;

  return (
    <div className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="bookmarkImportTitle">
      <section className="settings-dialog settings-dialog-wide bookmark-import-dialog">
        <div className="settings-dialog-header">
          <div>
            <h2 id="bookmarkImportTitle">导入收藏 / 链接</h2>
            <p>普通网页不能自动读取浏览器收藏夹；这里只处理你主动提供的文件或 URL。</p>
          </div>
          <button className="mini-button" type="button" onClick={onClose} aria-label="关闭">×</button>
        </div>

        <div className="bookmark-import-stepper" aria-label="导入步骤">
          {(["source", "summary", "groups", "preview", "confirm"] as const).map((item, index) => (
            <button
              key={item}
              className={step === item ? "is-active" : ""}
              type="button"
              disabled={item !== "source" && !draft}
              onClick={() => onChangeStep(item)}
            >
              <span>{index + 1}</span>
              {getStepLabel(item)}
            </button>
          ))}
        </div>

        <div className="settings-dialog-body bookmark-import-body">
          {step === "source" ? (
            <BookmarkImportSourceStep
              fileInputRef={fileInputRef}
              sourceKind={sourceKind}
              urlListText={urlListText}
              onBookmarkFileChange={handleBookmarkFileChange}
              onChangeSourceKind={setSourceKind}
              onChangeUrlListText={setUrlListText}
              onSubmitUrlList={handleUrlListSubmit}
            />
          ) : null}

          {draft && step === "summary" ? <BookmarkImportSummaryStep draft={draft} /> : null}

          {draft && step === "groups" ? (
            <BookmarkImportGroupsStep
              draft={draft}
              existingGroups={existingGroups}
              onChangeGroupMode={updateGroupMode}
              onChangeGroupTarget={updateGroupTarget}
              onChangeGroupTitle={updateGroupTitle}
            />
          ) : null}

          {draft && step === "preview" ? (
            <BookmarkImportPreviewStep
              currentPage={currentPage}
              draft={draft}
              filteredItems={filteredItems}
              groupFilter={groupFilter}
              pageSize={pageSize}
              pagedItems={pagedItems}
              query={query}
              statusFilter={statusFilter}
              totalPages={totalPages}
              onBulkSelect={bulkSelect}
              onChangeGroupFilter={(value) => {
                setGroupFilter(value);
                setPage(1);
              }}
              onChangeItemSelected={(itemId, selected) => updateDraft(setBookmarkImportItemSelected(draft, itemId, selected))}
              onChangePage={setPage}
              onChangePageSize={(value) => {
                setPageSize(value);
                setPage(1);
              }}
              onChangeQuery={(value) => {
                setQuery(value);
                setPage(1);
              }}
              onChangeStatusFilter={(value) => {
                setStatusFilter(value);
                setPage(1);
              }}
              onOnlySelectNewLinks={onlySelectNewLinks}
              onResetSelection={() => updateDraft(resetBookmarkImportDefaultSelection(draft))}
            />
          ) : null}

          {draft && step === "confirm" ? <BookmarkImportConfirmStep documentValue={documentValue} draft={draft} /> : null}

          <StatusMessage role={dialogTone === "danger" ? "alert" : "status"} tone={dialogTone}>
            {dialogMessage}
          </StatusMessage>
        </div>

        <div className="settings-dialog-footer bookmark-import-footer">
          {draft ? (
            <button className="utility-button" type="button" onClick={handleDiscardDraft}>
              丢弃草稿
            </button>
          ) : null}
          <span className="bookmark-import-footer-spacer" />
          <button className="utility-button" type="button" onClick={onClose}>关闭</button>
          {step !== "source" ? (
            <button className="utility-button" type="button" onClick={() => onChangeStep(getPreviousStep(step))}>上一步</button>
          ) : null}
          {step !== "confirm" ? (
            <button className="utility-button" type="button" disabled={!canGoNext} onClick={() => onChangeStep(getNextStep(step))}>下一步</button>
          ) : (
            <button className="utility-button" type="button" disabled={!draft || draft.stats.selectedItems === 0} onClick={onCommit}>
              确认导入 {draft?.stats.selectedItems ?? 0} 个网站
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

function BookmarkImportSourceStep({
  fileInputRef,
  sourceKind,
  urlListText,
  onBookmarkFileChange,
  onChangeSourceKind,
  onChangeUrlListText,
  onSubmitUrlList
}: {
  fileInputRef: RefObject<HTMLInputElement | null>;
  sourceKind: BookmarkImportSourceKind;
  urlListText: string;
  onBookmarkFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onChangeSourceKind: (sourceKind: BookmarkImportSourceKind) => void;
  onChangeUrlListText: (value: string) => void;
  onSubmitUrlList: () => void;
}) {
  return (
    <div className="bookmark-import-source">
      <div className="bookmark-import-source-tabs" role="tablist" aria-label="导入来源">
        <button className={sourceKind === "bookmark-html" ? "is-active" : ""} type="button" onClick={() => onChangeSourceKind("bookmark-html")}>
          书签 HTML
        </button>
        <button className={sourceKind === "url-list" ? "is-active" : ""} type="button" onClick={() => onChangeSourceKind("url-list")}>
          URL 列表
        </button>
      </div>

      {sourceKind === "bookmark-html" ? (
        <div className="bookmark-import-source-card">
          <strong>导入浏览器导出的书签文件</strong>
          <p>支持 Chrome、Edge、Firefox、Safari 常见的 bookmarks HTML。文件只在本浏览器本地解析，不会上传原始文件。</p>
          <div className="settings-actions">
            <label className="file-button" htmlFor="bookmarkImportHtmlInput">选择 HTML 文件</label>
            <input
              ref={fileInputRef}
              id="bookmarkImportHtmlInput"
              type="file"
              accept=".html,.htm,text/html"
              hidden
              onChange={onBookmarkFileChange}
            />
          </div>
        </div>
      ) : (
        <div className="bookmark-import-source-card">
          <label className="field">
            <span>URL 列表</span>
            <textarea
              value={urlListText}
              placeholder={"https://example.com/\n[OpenAI](https://openai.com/)"}
              onChange={(event) => onChangeUrlListText(event.target.value)}
            />
          </label>
          <div className="settings-actions">
            <button className="utility-button" type="button" disabled={!urlListText.trim()} onClick={onSubmitUrlList}>
              解析 URL 列表
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function BookmarkImportSummaryStep({ draft }: { draft: BookmarkImportDraft }) {
  return (
    <div className="bookmark-import-summary">
      <BookmarkImportStatsGrid draft={draft} />
      <div className="bookmark-import-notes">
        {draft.stats.selectedItems > 500 ? <StatusMessage tone="warning">本次默认选中 {draft.stats.selectedItems} 个网站，建议先按分组分批导入。</StatusMessage> : null}
        {draft.stats.newGroupCount > 30 ? <StatusMessage tone="warning">预计新建 {draft.stats.newGroupCount} 个分组，建议先检查分组映射。</StatusMessage> : null}
        {draft.stats.invalidItems > 0 ? <StatusMessage tone="warning">有 {draft.stats.invalidItems} 条无效链接，确认时会跳过。</StatusMessage> : null}
      </div>
    </div>
  );
}

function BookmarkImportStatsGrid({ draft }: { draft: BookmarkImportDraft }) {
  const stats = draft.stats;

  return (
    <div className="bookmark-import-stats">
      <Stat label="总条目" value={stats.totalItems} />
      <Stat label="有效 URL" value={stats.validItems} />
      <Stat label="默认选中" value={stats.selectedItems} />
      <Stat label="当前重复" value={stats.currentDuplicateItems} />
      <Stat label="批次重复" value={stats.importDuplicateItems} />
      <Stat label="同域名提示" value={stats.hostMatchItems} />
      <Stat label="无效 URL" value={stats.invalidItems} />
      <Stat label="候选分组" value={stats.candidateGroups} />
      <Stat label="预计新分组" value={stats.newGroupCount} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bookmark-import-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function BookmarkImportGroupsStep({
  draft,
  existingGroups,
  onChangeGroupMode,
  onChangeGroupTarget,
  onChangeGroupTitle
}: {
  draft: BookmarkImportDraft;
  existingGroups: HomeGroup[];
  onChangeGroupMode: (group: BookmarkImportDraftGroup, mode: string) => void;
  onChangeGroupTarget: (group: BookmarkImportDraftGroup, targetGroupId: string) => void;
  onChangeGroupTitle: (group: BookmarkImportDraftGroup, targetGroupTitle: string) => void;
}) {
  return (
    <div className="bookmark-import-group-list">
      {draft.groups.map((group) => {
        const stats = calculateBookmarkImportGroupStats(draft, group.id);
        const samples = draft.items.filter((item) => item.draftGroupId === group.id).slice(0, 3);

        return (
          <article className="bookmark-import-group-card" key={group.id}>
            <div className="bookmark-import-group-head">
              <div>
                <strong>{group.suggestedTitle}</strong>
                <span>{group.sourcePath.length > 0 ? group.sourcePath.join(" / ") : "未分组来源"}</span>
              </div>
              <em>{stats.selectedItems}/{stats.totalItems} 已选</em>
            </div>
            <div className="bookmark-import-group-controls">
              <label className="field">
                <span>映射方式</span>
                <select value={group.mode} onChange={(event) => onChangeGroupMode(group, event.target.value)}>
                  <option value="create">创建新分组</option>
                  <option value="ungrouped">导入到未分组</option>
                  <option value="skip">跳过该分组</option>
                  {existingGroups.length > 0 ? <option value="merge">合并到现有分组</option> : null}
                </select>
              </label>

              {group.mode === "create" ? (
                <label className="field">
                  <span>新分组名称</span>
                  <input value={group.targetGroupTitle} maxLength={80} onChange={(event) => onChangeGroupTitle(group, event.target.value)} />
                </label>
              ) : null}

              {group.mode === "merge" ? (
                <label className="field">
                  <span>目标分组</span>
                  <select value={group.targetGroupId ?? ""} onChange={(event) => onChangeGroupTarget(group, event.target.value)}>
                    {existingGroups.map((existingGroup) => (
                      <option key={existingGroup.id} value={existingGroup.id}>{existingGroup.title}</option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
            <div className="bookmark-import-group-samples">
              {samples.map((item) => <span key={item.id}>{item.suggestedName}</span>)}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function BookmarkImportPreviewStep({
  currentPage,
  draft,
  filteredItems,
  groupFilter,
  pageSize,
  pagedItems,
  query,
  statusFilter,
  totalPages,
  onBulkSelect,
  onChangeGroupFilter,
  onChangeItemSelected,
  onChangePage,
  onChangePageSize,
  onChangeQuery,
  onChangeStatusFilter,
  onOnlySelectNewLinks,
  onResetSelection
}: {
  currentPage: number;
  draft: BookmarkImportDraft;
  filteredItems: BookmarkImportDraftItem[];
  groupFilter: string;
  pageSize: number;
  pagedItems: BookmarkImportDraftItem[];
  query: string;
  statusFilter: BookmarkImportStatusFilter;
  totalPages: number;
  onBulkSelect: (selected: boolean) => void;
  onChangeGroupFilter: (groupId: string) => void;
  onChangeItemSelected: (itemId: string, selected: boolean) => void;
  onChangePage: (page: number) => void;
  onChangePageSize: (pageSize: number) => void;
  onChangeQuery: (query: string) => void;
  onChangeStatusFilter: (status: BookmarkImportStatusFilter) => void;
  onOnlySelectNewLinks: () => void;
  onResetSelection: () => void;
}) {
  const groupsById = new Map(draft.groups.map((group) => [group.id, group]));

  return (
    <div className="bookmark-import-preview">
      <div className="bookmark-import-preview-toolbar">
        <label className="field">
          <span>搜索</span>
          <input value={query} placeholder="标题、URL、分组" onChange={(event) => onChangeQuery(event.target.value)} />
        </label>
        <label className="field">
          <span>状态</span>
          <select value={statusFilter} onChange={(event) => onChangeStatusFilter(event.target.value as BookmarkImportStatusFilter)}>
            <option value="all">全部</option>
            <option value="selected">已选</option>
            <option value="unselected">未选</option>
            <option value="new">新链接</option>
            <option value="duplicate-current-url">当前重复</option>
            <option value="duplicate-import-url">批次重复</option>
            <option value="duplicate-current-host">同域名</option>
            <option value="invalid-url">无效 URL</option>
          </select>
        </label>
        <label className="field">
          <span>分组</span>
          <select value={groupFilter} onChange={(event) => onChangeGroupFilter(event.target.value)}>
            <option value="all">全部分组</option>
            {draft.groups.map((group) => (
              <option key={group.id} value={group.id}>{group.targetGroupTitle}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="bookmark-import-bulk-actions">
        <span>{filteredItems.length} 条结果 · {draft.stats.selectedItems} 条已选</span>
        <button className="utility-button" type="button" onClick={() => onBulkSelect(true)}>选择当前结果</button>
        <button className="utility-button" type="button" onClick={() => onBulkSelect(false)}>取消当前结果</button>
        <button className="utility-button" type="button" onClick={onOnlySelectNewLinks}>只保留新链接</button>
        <button className="utility-button" type="button" onClick={onResetSelection}>恢复默认选择</button>
      </div>

      <div className="bookmark-import-item-list">
        {pagedItems.map((item) => {
          const group = groupsById.get(item.draftGroupId);
          const selectable = isBookmarkImportItemSelectable(item, group);
          return (
            <label className={`bookmark-import-item${item.selected ? " is-selected" : ""}`} key={item.id}>
              <input
                type="checkbox"
                checked={item.selected}
                disabled={!selectable}
                onChange={(event) => onChangeItemSelected(item.id, event.target.checked)}
              />
              <span className="bookmark-import-item-main">
                <strong>{item.suggestedName}</strong>
                <small>{item.normalizedUrl || item.rawUrl}</small>
                <em>{item.sourceFolderPath.length > 0 ? item.sourceFolderPath.join(" / ") : "未分组"}{" -> "}{item.targetGroupTitle}</em>
              </span>
              <span className={`bookmark-import-status status-${item.duplicateStatus}`}>{getBookmarkImportStatusLabel(item.duplicateStatus)}</span>
              {item.reason ? <span className="bookmark-import-reason">{item.reason}</span> : null}
            </label>
          );
        })}
      </div>

      <div className="bookmark-import-pagination">
        <button className="utility-button" type="button" disabled={currentPage <= 1} onClick={() => onChangePage(currentPage - 1)}>上一页</button>
        <span>第 {currentPage} / {totalPages} 页</span>
        <button className="utility-button" type="button" disabled={currentPage >= totalPages} onClick={() => onChangePage(currentPage + 1)}>下一页</button>
        <label>
          每页
          <select value={pageSize} onChange={(event) => onChangePageSize(Number(event.target.value))}>
            {PREVIEW_PAGE_SIZE_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
      </div>
    </div>
  );
}

function BookmarkImportConfirmStep({
  documentValue,
  draft
}: {
  documentValue: HomeDocumentV2;
  draft: BookmarkImportDraft;
}) {
  const currentSiteCount = documentValue.groups.reduce((sum, group) => sum + group.sites.length, 0);
  const nextSiteCount = currentSiteCount + draft.stats.selectedItems;

  return (
    <div className="bookmark-import-confirm">
      <BookmarkImportStatsGrid draft={draft} />
      <StatusMessage tone={draft.stats.selectedItems > 500 ? "warning" : "neutral"}>
        将导入 {draft.stats.selectedItems} 个网站，预计新建 {draft.stats.newGroupCount} 个分组。当前首页有 {currentSiteCount} 个网站，导入后约 {nextSiteCount} 个网站。
      </StatusMessage>
      <StatusMessage tone="neutral">
        导入会作为一次普通首页编辑保存；若当前首页已绑定同步空间，之后会沿用现有同步流程上传。
      </StatusMessage>
    </div>
  );
}

function getStepLabel(step: ImportDialogStep): string {
  if (step === "source") {
    return "来源";
  }

  if (step === "summary") {
    return "摘要";
  }

  if (step === "groups") {
    return "分组";
  }

  if (step === "preview") {
    return "预览";
  }

  return "确认";
}

function getNextStep(step: ImportDialogStep): ImportDialogStep {
  if (step === "source") {
    return "summary";
  }

  if (step === "summary") {
    return "groups";
  }

  if (step === "groups") {
    return "preview";
  }

  return "confirm";
}

function getPreviousStep(step: ImportDialogStep): ImportDialogStep {
  if (step === "confirm") {
    return "preview";
  }

  if (step === "preview") {
    return "groups";
  }

  if (step === "groups") {
    return "summary";
  }

  return "source";
}

function draftRequired(draft: BookmarkImportDraft | null): BookmarkImportDraft {
  if (!draft) {
    throw new Error("导入草稿不存在。");
  }

  return draft;
}

function getImportFailureReason(error: unknown): string {
  if (!(error instanceof Error)) {
    return "unknown";
  }

  if (/10MB|5000/.test(error.message)) {
    return "too-large";
  }

  if (/没有/.test(error.message)) {
    return "empty";
  }

  return "parse-failed";
}
