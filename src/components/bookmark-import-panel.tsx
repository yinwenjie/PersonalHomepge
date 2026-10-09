"use client";

import type { ChangeEvent, RefObject } from "react";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { requestConfirm } from "@/components/confirm-dialog";
import { StatusMessage, type StatusTone } from "@/components/status-message";
import {
  applyBookmarkImportDraft,
  applyBookmarkImportUndo,
  calculateBookmarkImportGroupStats,
  createBookmarkImportDraft,
  filterBookmarkImportItems,
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
import { useI18n } from "@/hooks/use-i18n";
import type { I18nTranslate } from "@/i18n/messages";

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
  const { t } = useI18n();
  const storageRepositoryRef = useRef<BookmarkImportStorageRepository | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<BookmarkImportDraft | null>(null);
  const [step, setStep] = useState<ImportDialogStep>("source");
  const [storageRefreshKey, setStorageRefreshKey] = useState(0);
  const [message, setMessage] = useState("");
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
    setMessage(t("settings.import.chooseSource"));
    setMessageTone("neutral");
    trackProductEvent("bookmark_import.opened", {
      source: "settings"
    });
  }

  function continueSavedDraft() {
    const savedDraft = getStorageRepository()?.loadDraft(documentValue.documentId);
    if (!savedDraft) {
      setMessage(t("settings.import.noDraft"));
      setMessageTone("warning");
      refreshSavedState();
      return;
    }

    setDraft(savedDraft);
    setStep("summary");
    setDialogOpen(true);
    setMessage(t("settings.import.draftRestored"));
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
      setMessage(t("settings.import.draftSaveFailed"));
      setMessageTone("warning");
    }
  }

  function closeDialog() {
    if (draft) {
      setMessage(t("settings.import.draftKept"));
      setMessageTone("neutral");
    }
    setDialogOpen(false);
    refreshSavedState();
  }

  function discardDraft() {
    persistDraft(null);
    setStep("source");
    setMessage(t("settings.import.draftDiscarded"));
    setMessageTone("neutral");
  }

  function commitDraft() {
    if (!draft) {
      return;
    }

    const result = applyBookmarkImportDraft(documentValue, draft);
    if (result.addedSiteCount === 0) {
      setMessage(t("settings.import.noSelectedSites"));
      setMessageTone("warning");
      return;
    }

    if (!onBeforeOverwrite("before-bookmark-import")) {
      setMessage(t("settings.import.protectFailed"));
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

    onCommitDocument(result.document, t("settings.import.commitMessage", { count: result.addedSiteCount }));
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
      ? t("settings.import.imported", { count: result.addedSiteCount })
      : t("settings.import.importedUndoFailed", { count: result.addedSiteCount }));
    setMessageTone(undoSaved ? "success" : "warning");
  }

  async function undoLastImport() {
    const undo = getStorageRepository()?.loadUndo(documentValue.documentId);
    if (!undo) {
      setMessage(t("settings.import.noUndo"));
      setMessageTone("warning");
      refreshSavedState();
      return;
    }

    if (!(await requestConfirm(t("settings.import.undoConfirm")))) {
      return;
    }

    if (!onBeforeOverwrite("before-bookmark-import-undo")) {
      setMessage(t("settings.import.undoProtectFailed"));
      setMessageTone("danger");
      return;
    }

    onCommitDocument(applyBookmarkImportUndo(documentValue, undo), t("settings.import.undoCommitMessage"));
    getStorageRepository()?.clearUndo();
    refreshSavedState();
    setMessage(t("settings.import.undoDone"));
    setMessageTone("success");
  }

  return (
    <>
      <div className="advanced-operation-block">
        <div className="advanced-operation-head">
          <h3>{t("settings.import.title")}</h3>
          <span>{t("settings.import.kicker")}</span>
        </div>
        <div className="settings-actions">
          <button
            className="utility-button"
            type="button"
            disabled={!storageReady}
            title={storageReady ? t("settings.import.openTitle") : t("settings.common.storageNotReady")}
            onClick={openNewImportDialog}
          >
            {t("settings.import.open")}
          </button>
          {hasSavedDraft ? (
            <button className="utility-button" type="button" onClick={continueSavedDraft}>
              {t("settings.import.continueDraft")}
            </button>
          ) : null}
          {hasUndo ? (
            <button className="utility-button" type="button" onClick={undoLastImport}>
              {t("settings.import.undo")}
            </button>
          ) : null}
        </div>
        <StatusMessage tone={messageTone}>
          {message || t("settings.import.panelDefault")}
        </StatusMessage>
      </div>

      {dialogOpen ? (
        <BookmarkImportDialog
          documentValue={documentValue}
          draft={draft}
          step={step}
          t={t}
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
  onDiscardDraft,
  t
}: {
  documentValue: HomeDocumentV2;
  draft: BookmarkImportDraft | null;
  step: ImportDialogStep;
  t: I18nTranslate;
  onChangeDraft: (draft: BookmarkImportDraft | null) => void;
  onChangeStep: (step: ImportDialogStep) => void;
  onClose: () => void;
  onCommit: () => void;
  onDiscardDraft: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [sourceKind, setSourceKind] = useState<BookmarkImportSourceKind>("bookmark-html");
  const [urlListText, setUrlListText] = useState("");
  const [dialogMessage, setDialogMessage] = useState(() => t("settings.import.dialogDefault"));
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
        throw new Error(t("settings.import.htmlTooLarge"));
      }

      const sourceItems = parseBookmarkHtml(await file.text());
      if (sourceItems.length === 0) {
        throw new Error(t("settings.import.noLinksInFile"));
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
      setDialogMessage(t("settings.import.parsedBookmarks", { count: nextDraft.stats.totalItems }));
      setDialogTone("success");
      trackProductEvent("bookmark_import.parsed", {
        groupCountBucket: bucketCount(nextDraft.stats.candidateGroups),
        siteCountBucket: bucketCount(nextDraft.stats.validItems),
        sourceKind: "bookmark-html"
      });
    } catch (error) {
      setDialogMessage(error instanceof Error ? error.message : t("settings.import.htmlParseFailed"));
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
        throw new Error(t("settings.import.urlListTooLarge"));
      }

      const sourceItems = parseUrlList(urlListText);
      if (sourceItems.length === 0) {
        throw new Error(t("settings.import.noUrls"));
      }

      const nextDraft = createBookmarkImportDraft({
        documentValue,
        sourceItems,
        sourceKind: "url-list",
        sourceName: t("settings.import.source.urlList")
      });
      onChangeDraft(nextDraft);
      onChangeStep("summary");
      resetPreviewFilters();
      setDialogMessage(t("settings.import.parsedUrls", { count: nextDraft.stats.totalItems }));
      setDialogTone("success");
      trackProductEvent("bookmark_import.parsed", {
        groupCountBucket: bucketCount(nextDraft.stats.candidateGroups),
        siteCountBucket: bucketCount(nextDraft.stats.validItems),
        sourceKind: "url-list"
      });
    } catch (error) {
      setDialogMessage(error instanceof Error ? error.message : t("settings.import.urlParseFailed"));
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
    setDialogMessage(t("settings.import.draftDiscarded"));
    setDialogTone("neutral");
  }

  function updateGroupMode(group: BookmarkImportDraftGroup, mode: string) {
    const nextMode = mode as BookmarkImportDraftGroup["mode"];
    const targetGroup = existingGroups.find((candidate) => candidate.id === group.targetGroupId) ?? existingGroups[0];
    updateDraft(setBookmarkImportGroupMapping(draftRequired(draft), group.id, {
      mode: nextMode,
      targetGroupId: nextMode === "merge" ? targetGroup?.id ?? null : nextMode === "ungrouped" ? UNGROUPED_GROUP_ID : null,
      targetGroupTitle: nextMode === "merge" ? targetGroup?.title ?? group.targetGroupTitle : nextMode === "ungrouped" ? t("settings.import.ungrouped") : nextMode === "skip" ? t("settings.import.mode.skip") : group.suggestedTitle
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
            <h2 id="bookmarkImportTitle">{t("settings.import.dialogTitle")}</h2>
            <p>{t("settings.import.dialogDescription")}</p>
          </div>
          <button className="mini-button" type="button" onClick={onClose} aria-label={t("settings.common.close")}>×</button>
        </div>

        <div className="bookmark-import-stepper" aria-label={t("settings.import.stepsAria")}>
          {(["source", "summary", "groups", "preview", "confirm"] as const).map((item, index) => (
            <button
              key={item}
              className={step === item ? "is-active" : ""}
              type="button"
              disabled={item !== "source" && !draft}
              onClick={() => onChangeStep(item)}
            >
              <span>{index + 1}</span>
              {getStepLabel(item, t)}
            </button>
          ))}
        </div>

        <div className="settings-dialog-body bookmark-import-body">
          {step === "source" ? (
            <BookmarkImportSourceStep
              fileInputRef={fileInputRef}
              sourceKind={sourceKind}
              t={t}
              urlListText={urlListText}
              onBookmarkFileChange={handleBookmarkFileChange}
              onChangeSourceKind={setSourceKind}
              onChangeUrlListText={setUrlListText}
              onSubmitUrlList={handleUrlListSubmit}
            />
          ) : null}

          {draft && step === "summary" ? <BookmarkImportSummaryStep draft={draft} t={t} /> : null}

          {draft && step === "groups" ? (
            <BookmarkImportGroupsStep
              draft={draft}
              existingGroups={existingGroups}
              t={t}
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
              t={t}
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

          {draft && step === "confirm" ? <BookmarkImportConfirmStep documentValue={documentValue} draft={draft} t={t} /> : null}

          <StatusMessage role={dialogTone === "danger" ? "alert" : "status"} tone={dialogTone}>
            {dialogMessage}
          </StatusMessage>
        </div>

        <div className="settings-dialog-footer bookmark-import-footer">
          {draft ? (
            <button className="utility-button" type="button" onClick={handleDiscardDraft}>
              {t("settings.import.discardDraft")}
            </button>
          ) : null}
          <span className="bookmark-import-footer-spacer" />
          <button className="utility-button" type="button" onClick={onClose}>{t("settings.common.close")}</button>
          {step !== "source" ? (
            <button className="utility-button" type="button" onClick={() => onChangeStep(getPreviousStep(step))}>{t("settings.import.previous")}</button>
          ) : null}
          {step !== "confirm" ? (
            <button className="utility-button" type="button" disabled={!canGoNext} onClick={() => onChangeStep(getNextStep(step))}>{t("settings.import.next")}</button>
          ) : (
            <button className="utility-button" type="button" disabled={!draft || draft.stats.selectedItems === 0} onClick={onCommit}>
              {t("settings.import.confirmImport", { count: draft?.stats.selectedItems ?? 0 })}
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
  t,
  urlListText,
  onBookmarkFileChange,
  onChangeSourceKind,
  onChangeUrlListText,
  onSubmitUrlList
}: {
  fileInputRef: RefObject<HTMLInputElement | null>;
  sourceKind: BookmarkImportSourceKind;
  t: I18nTranslate;
  urlListText: string;
  onBookmarkFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onChangeSourceKind: (sourceKind: BookmarkImportSourceKind) => void;
  onChangeUrlListText: (value: string) => void;
  onSubmitUrlList: () => void;
}) {
  return (
    <div className="bookmark-import-source">
      <div className="bookmark-import-source-tabs" role="tablist" aria-label={t("settings.import.sourceAria")}>
        <button className={sourceKind === "bookmark-html" ? "is-active" : ""} type="button" onClick={() => onChangeSourceKind("bookmark-html")}>
          {t("settings.import.source.bookmarkHtml")}
        </button>
        <button className={sourceKind === "url-list" ? "is-active" : ""} type="button" onClick={() => onChangeSourceKind("url-list")}>
          {t("settings.import.source.urlList")}
        </button>
      </div>

      {sourceKind === "bookmark-html" ? (
        <div className="bookmark-import-source-card">
          <strong>{t("settings.import.htmlTitle")}</strong>
          <p>{t("settings.import.htmlDescription")}</p>
          <div className="settings-actions">
            <label className="file-button" htmlFor="bookmarkImportHtmlInput">{t("settings.import.chooseHtml")}</label>
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
            <span>{t("settings.import.source.urlList")}</span>
            <textarea
              value={urlListText}
              placeholder={"https://example.com/\n[OpenAI](https://openai.com/)"}
              onChange={(event) => onChangeUrlListText(event.target.value)}
            />
          </label>
          <div className="settings-actions">
            <button className="utility-button" type="button" disabled={!urlListText.trim()} onClick={onSubmitUrlList}>
              {t("settings.import.parseUrls")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function BookmarkImportSummaryStep({ draft, t }: { draft: BookmarkImportDraft; t: I18nTranslate }) {
  return (
    <div className="bookmark-import-summary">
      <BookmarkImportStatsGrid draft={draft} t={t} />
      <div className="bookmark-import-notes">
        {draft.stats.selectedItems > 500 ? <StatusMessage tone="warning">{t("settings.import.noteManySites", { count: draft.stats.selectedItems })}</StatusMessage> : null}
        {draft.stats.newGroupCount > 30 ? <StatusMessage tone="warning">{t("settings.import.noteManyGroups", { count: draft.stats.newGroupCount })}</StatusMessage> : null}
        {draft.stats.invalidItems > 0 ? <StatusMessage tone="warning">{t("settings.import.noteInvalid", { count: draft.stats.invalidItems })}</StatusMessage> : null}
      </div>
    </div>
  );
}

function BookmarkImportStatsGrid({ draft, t }: { draft: BookmarkImportDraft; t: I18nTranslate }) {
  const stats = draft.stats;

  return (
    <div className="bookmark-import-stats">
      <Stat label={t("settings.import.stat.total")} value={stats.totalItems} />
      <Stat label={t("settings.import.stat.valid")} value={stats.validItems} />
      <Stat label={t("settings.import.stat.selected")} value={stats.selectedItems} />
      <Stat label={t("settings.import.stat.currentDuplicates")} value={stats.currentDuplicateItems} />
      <Stat label={t("settings.import.stat.importDuplicates")} value={stats.importDuplicateItems} />
      <Stat label={t("settings.import.stat.hostMatches")} value={stats.hostMatchItems} />
      <Stat label={t("settings.import.stat.invalid")} value={stats.invalidItems} />
      <Stat label={t("settings.import.stat.candidateGroups")} value={stats.candidateGroups} />
      <Stat label={t("settings.import.stat.newGroups")} value={stats.newGroupCount} />
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
  t,
  onChangeGroupMode,
  onChangeGroupTarget,
  onChangeGroupTitle
}: {
  draft: BookmarkImportDraft;
  existingGroups: HomeGroup[];
  t: I18nTranslate;
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
                <span>{group.sourcePath.length > 0 ? group.sourcePath.join(" / ") : t("settings.import.ungroupedSource")}</span>
              </div>
              <em>{t("settings.import.groupSelected", { selected: stats.selectedItems, total: stats.totalItems })}</em>
            </div>
            <div className="bookmark-import-group-controls">
              <label className="field">
                <span>{t("settings.import.mappingMode")}</span>
                <select value={group.mode} onChange={(event) => onChangeGroupMode(group, event.target.value)}>
                  <option value="create">{t("settings.import.mode.create")}</option>
                  <option value="ungrouped">{t("settings.import.mode.ungrouped")}</option>
                  <option value="skip">{t("settings.import.mode.skip")}</option>
                  {existingGroups.length > 0 ? <option value="merge">{t("settings.import.mode.merge")}</option> : null}
                </select>
              </label>

              {group.mode === "create" ? (
                <label className="field">
                  <span>{t("settings.import.newGroupName")}</span>
                  <input value={group.targetGroupTitle} maxLength={80} onChange={(event) => onChangeGroupTitle(group, event.target.value)} />
                </label>
              ) : null}

              {group.mode === "merge" ? (
                <label className="field">
                  <span>{t("settings.import.targetGroup")}</span>
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
  t,
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
  t: I18nTranslate;
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
          <span>{t("settings.import.search")}</span>
          <input value={query} placeholder={t("settings.import.searchPlaceholder")} onChange={(event) => onChangeQuery(event.target.value)} />
        </label>
        <label className="field">
          <span>{t("settings.import.status")}</span>
          <select value={statusFilter} onChange={(event) => onChangeStatusFilter(event.target.value as BookmarkImportStatusFilter)}>
            <option value="all">{t("settings.import.filter.all")}</option>
            <option value="selected">{t("settings.import.filter.selected")}</option>
            <option value="unselected">{t("settings.import.filter.unselected")}</option>
            <option value="new">{t("settings.import.status.new")}</option>
            <option value="duplicate-current-url">{t("settings.import.status.duplicateCurrentUrl")}</option>
            <option value="duplicate-import-url">{t("settings.import.status.duplicateImportUrl")}</option>
            <option value="duplicate-current-host">{t("settings.import.status.duplicateCurrentHost")}</option>
            <option value="invalid-url">{t("settings.import.status.invalidUrl")}</option>
          </select>
        </label>
        <label className="field">
          <span>{t("settings.import.group")}</span>
          <select value={groupFilter} onChange={(event) => onChangeGroupFilter(event.target.value)}>
            <option value="all">{t("settings.import.allGroups")}</option>
            {draft.groups.map((group) => (
              <option key={group.id} value={group.id}>{group.targetGroupTitle}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="bookmark-import-bulk-actions">
        <span>{t("settings.import.resultSummary", { results: filteredItems.length, selected: draft.stats.selectedItems })}</span>
        <button className="utility-button" type="button" onClick={() => onBulkSelect(true)}>{t("settings.import.selectCurrent")}</button>
        <button className="utility-button" type="button" onClick={() => onBulkSelect(false)}>{t("settings.import.unselectCurrent")}</button>
        <button className="utility-button" type="button" onClick={onOnlySelectNewLinks}>{t("settings.import.onlyNew")}</button>
        <button className="utility-button" type="button" onClick={onResetSelection}>{t("settings.import.resetSelection")}</button>
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
                <em>{item.sourceFolderPath.length > 0 ? item.sourceFolderPath.join(" / ") : t("settings.import.ungrouped")}{" -> "}{item.targetGroupTitle}</em>
              </span>
              <span className={`bookmark-import-status status-${item.duplicateStatus}`}>{getBookmarkImportStatusLabel(item.duplicateStatus, t)}</span>
              {item.reason ? <span className="bookmark-import-reason">{getBookmarkImportReason(item.duplicateStatus, t)}</span> : null}
            </label>
          );
        })}
      </div>

      <div className="bookmark-import-pagination">
        <button className="utility-button" type="button" disabled={currentPage <= 1} onClick={() => onChangePage(currentPage - 1)}>{t("settings.import.previousPage")}</button>
        <span>{t("settings.import.pageSummary", { current: currentPage, total: totalPages })}</span>
        <button className="utility-button" type="button" disabled={currentPage >= totalPages} onClick={() => onChangePage(currentPage + 1)}>{t("settings.import.nextPage")}</button>
        <label>
          {t("settings.import.pageSize")}
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
  draft,
  t
}: {
  documentValue: HomeDocumentV2;
  draft: BookmarkImportDraft;
  t: I18nTranslate;
}) {
  const currentSiteCount = documentValue.groups.reduce((sum, group) => sum + group.sites.length, 0);
  const nextSiteCount = currentSiteCount + draft.stats.selectedItems;

  return (
    <div className="bookmark-import-confirm">
      <BookmarkImportStatsGrid draft={draft} t={t} />
      <StatusMessage tone={draft.stats.selectedItems > 500 ? "warning" : "neutral"}>
        {t("settings.import.confirmSummary", {
          current: currentSiteCount,
          groups: draft.stats.newGroupCount,
          next: nextSiteCount,
          sites: draft.stats.selectedItems
        })}
      </StatusMessage>
      <StatusMessage tone="neutral">
        {t("settings.import.confirmSyncNote")}
      </StatusMessage>
    </div>
  );
}

function getStepLabel(step: ImportDialogStep, t: I18nTranslate): string {
  if (step === "source") {
    return t("settings.import.step.source");
  }

  if (step === "summary") {
    return t("settings.import.step.summary");
  }

  if (step === "groups") {
    return t("settings.import.step.groups");
  }

  if (step === "preview") {
    return t("settings.import.step.preview");
  }

  return t("settings.import.step.confirm");
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

function getBookmarkImportStatusLabel(status: BookmarkImportDraftItem["duplicateStatus"], t: I18nTranslate): string {
  switch (status) {
    case "duplicate-current-url":
      return t("settings.import.status.duplicateCurrentUrl");
    case "duplicate-current-host":
      return t("settings.import.status.duplicateCurrentHost");
    case "duplicate-import-url":
      return t("settings.import.status.duplicateImportUrl");
    case "invalid-url":
      return t("settings.import.status.invalidUrl");
    case "new":
      return t("settings.import.status.new");
  }
}

function getBookmarkImportReason(status: BookmarkImportDraftItem["duplicateStatus"], t: I18nTranslate): string | null {
  switch (status) {
    case "duplicate-current-url":
      return t("settings.import.reason.duplicateCurrentUrl");
    case "duplicate-current-host":
      return t("settings.import.reason.duplicateCurrentHost");
    case "duplicate-import-url":
      return t("settings.import.reason.duplicateImportUrl");
    case "invalid-url":
      return t("settings.import.reason.invalidUrl");
    case "new":
      return null;
  }
}

function draftRequired(draft: BookmarkImportDraft | null): BookmarkImportDraft {
  if (!draft) {
    throw new Error("Import draft is missing.");
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

  if (/no|empty|not found/i.test(error.message)) {
    return "empty";
  }

  return "parse-failed";
}
