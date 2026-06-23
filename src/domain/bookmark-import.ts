import {
  createId,
  generateMark,
  isUngroupedGroup,
  normalizeText,
  renumberGroups,
  UNGROUPED_GROUP_ID
} from "@/domain/home-document";
import type { HomeDocumentV2, HomeGroup, HomeSite } from "@/domain/home-document";

export type BookmarkImportSourceKind = "bookmark-html" | "url-list";

export type BookmarkImportDuplicateStatus =
  | "new"
  | "duplicate-current-url"
  | "duplicate-current-host"
  | "duplicate-import-url"
  | "invalid-url";

export type BookmarkImportGroupMode = "create" | "merge" | "ungrouped" | "skip";

export type BookmarkImportStatusFilter =
  | "all"
  | "selected"
  | "unselected"
  | BookmarkImportDuplicateStatus;

export interface BookmarkImportSourceItem {
  title: string;
  url: string;
  folderPath: string[];
}

export interface BookmarkImportDraft {
  id: string;
  sourceKind: BookmarkImportSourceKind;
  sourceName: string;
  createdAt: string;
  stats: BookmarkImportStats;
  groups: BookmarkImportDraftGroup[];
  items: BookmarkImportDraftItem[];
}

export interface BookmarkImportStats {
  totalItems: number;
  validItems: number;
  selectedItems: number;
  duplicateItems: number;
  currentDuplicateItems: number;
  importDuplicateItems: number;
  hostMatchItems: number;
  invalidItems: number;
  candidateGroups: number;
  selectedGroups: number;
  newGroupCount: number;
}

export interface BookmarkImportDraftGroup {
  id: string;
  sourcePath: string[];
  suggestedTitle: string;
  targetGroupId: string | null;
  targetGroupTitle: string;
  mode: BookmarkImportGroupMode;
}

export interface BookmarkImportDraftItem {
  id: string;
  sourceKind: BookmarkImportSourceKind;
  rawTitle: string;
  rawUrl: string;
  normalizedUrl: string;
  duplicateKey: string;
  hostname: string;
  suggestedName: string;
  suggestedMark: string;
  sourceFolderPath: string[];
  draftGroupId: string;
  targetGroupId: string | null;
  targetGroupTitle: string;
  duplicateStatus: BookmarkImportDuplicateStatus;
  selected: boolean;
  reason: string | null;
}

export interface BookmarkImportCommitResult {
  addedGroupIds: string[];
  addedSiteCount: number;
  addedSiteIdsByGroupId: Record<string, string[]>;
  document: HomeDocumentV2;
  skippedItemCount: number;
}

export interface BookmarkImportUndoRecord {
  importBatchId: string;
  homeDocumentId: string;
  beforeDocument: HomeDocumentV2;
  addedGroupIds: string[];
  addedSiteIdsByGroupId: Record<string, string[]>;
  createdAt: string;
  expiresAt: string;
}

interface NormalizedImportUrl {
  duplicateKey: string;
  hostname: string;
  normalizedUrl: string;
}

const DEFAULT_URL_LIST_GROUP_TITLE = "粘贴链接";
const IMPORT_KEY_SEPARATOR = "\u001f";

export function createBookmarkImportDraft({
  documentValue,
  sourceItems,
  sourceKind,
  sourceName
}: {
  documentValue: HomeDocumentV2;
  sourceItems: BookmarkImportSourceItem[];
  sourceKind: BookmarkImportSourceKind;
  sourceName: string;
}): BookmarkImportDraft {
  const now = new Date().toISOString();
  const existingUrlKeys = new Set<string>();
  const existingHosts = new Set<string>();
  const existingGroupsByTitle = createExistingGroupsByTitle(documentValue.groups);
  const importUrlKeys = new Set<string>();
  const draftGroupsByKey = new Map<string, BookmarkImportDraftGroup>();
  const items: BookmarkImportDraftItem[] = [];

  for (const group of documentValue.groups) {
    for (const site of group.sites) {
      const parsedUrl = normalizeImportUrl(site.url);
      if (parsedUrl) {
        existingUrlKeys.add(parsedUrl.duplicateKey);
        existingHosts.add(parsedUrl.hostname);
      }
    }
  }

  for (const sourceItem of sourceItems) {
    const sourceFolderPath = normalizeFolderPath(sourceItem.folderPath);
    const group = getOrCreateDraftGroup({
      draftGroupsByKey,
      existingGroupsByTitle,
      sourceFolderPath,
      sourceKind
    });
    const parsedUrl = normalizeImportUrl(sourceItem.url);
    const rawTitle = normalizeText(sourceItem.title);
    const fallbackName = parsedUrl ? formatHostnameName(parsedUrl.hostname) : "未命名链接";
    const suggestedName = rawTitle || fallbackName;
    const suggestedMark = generateMark(suggestedName);
    const duplicateStatus = getDuplicateStatus(parsedUrl, existingUrlKeys, existingHosts, importUrlKeys);

    if (parsedUrl) {
      importUrlKeys.add(parsedUrl.duplicateKey);
    }

    const item: BookmarkImportDraftItem = {
      id: createId("import-item"),
      sourceKind,
      rawTitle,
      rawUrl: normalizeText(sourceItem.url),
      normalizedUrl: parsedUrl?.normalizedUrl ?? "",
      duplicateKey: parsedUrl?.duplicateKey ?? "",
      hostname: parsedUrl?.hostname ?? "",
      suggestedName,
      suggestedMark,
      sourceFolderPath,
      draftGroupId: group.id,
      targetGroupId: group.targetGroupId,
      targetGroupTitle: group.targetGroupTitle,
      duplicateStatus,
      selected: getDefaultSelected(duplicateStatus, group.mode),
      reason: getDuplicateReason(duplicateStatus)
    };

    items.push(item);
  }

  return withDraftStats({
    id: createId("import-draft"),
    sourceKind,
    sourceName: normalizeText(sourceName) || getSourceKindLabel(sourceKind),
    createdAt: now,
    stats: createEmptyStats(),
    groups: [...draftGroupsByKey.values()],
    items
  });
}

export function getSelectableBookmarkImportItems(draft: BookmarkImportDraft): BookmarkImportDraftItem[] {
  const groupsById = new Map(draft.groups.map((group) => [group.id, group]));

  return draft.items.filter((item) => isBookmarkImportItemSelectable(item, groupsById.get(item.draftGroupId)));
}

export function isBookmarkImportItemSelectable(item: BookmarkImportDraftItem, group?: BookmarkImportDraftGroup): boolean {
  return item.duplicateStatus !== "invalid-url" && group?.mode !== "skip";
}

export function setBookmarkImportItemSelected(
  draft: BookmarkImportDraft,
  itemId: string,
  selected: boolean
): BookmarkImportDraft {
  const groupsById = new Map(draft.groups.map((group) => [group.id, group]));

  return withDraftStats({
    ...draft,
    items: draft.items.map((item) => item.id === itemId
      ? {
          ...item,
          selected: selected && isBookmarkImportItemSelectable(item, groupsById.get(item.draftGroupId))
        }
      : item)
  });
}

export function setBookmarkImportItemsSelected(
  draft: BookmarkImportDraft,
  predicate: (item: BookmarkImportDraftItem) => boolean,
  selected: boolean
): BookmarkImportDraft {
  const groupsById = new Map(draft.groups.map((group) => [group.id, group]));

  return withDraftStats({
    ...draft,
    items: draft.items.map((item) => predicate(item)
      ? {
          ...item,
          selected: selected && isBookmarkImportItemSelectable(item, groupsById.get(item.draftGroupId))
        }
      : item)
  });
}

export function resetBookmarkImportDefaultSelection(draft: BookmarkImportDraft): BookmarkImportDraft {
  const groupsById = new Map(draft.groups.map((group) => [group.id, group]));

  return withDraftStats({
    ...draft,
    items: draft.items.map((item) => ({
      ...item,
      selected: getDefaultSelected(item.duplicateStatus, groupsById.get(item.draftGroupId)?.mode ?? "skip")
    }))
  });
}

export function setBookmarkImportGroupMapping(
  draft: BookmarkImportDraft,
  groupId: string,
  mapping: Pick<BookmarkImportDraftGroup, "mode" | "targetGroupId" | "targetGroupTitle">
): BookmarkImportDraft {
  const previousGroup = draft.groups.find((group) => group.id === groupId);
  const wasSkipped = previousGroup?.mode === "skip";
  const nextGroups = draft.groups.map((group) => group.id === groupId
    ? {
        ...group,
        mode: mapping.mode,
        targetGroupId: mapping.mode === "merge" ? mapping.targetGroupId : mapping.mode === "ungrouped" ? UNGROUPED_GROUP_ID : null,
        targetGroupTitle: normalizeText(mapping.targetGroupTitle) || getFallbackTargetGroupTitle(group, mapping.mode)
      }
    : group);
  const nextGroup = nextGroups.find((group) => group.id === groupId);

  return withDraftStats({
    ...draft,
    groups: nextGroups,
    items: draft.items.map((item) => {
      if (item.draftGroupId !== groupId || !nextGroup) {
        return item;
      }

      return {
        ...item,
        targetGroupId: nextGroup.targetGroupId,
        targetGroupTitle: nextGroup.targetGroupTitle,
        selected: nextGroup.mode === "skip"
          ? false
          : wasSkipped
            ? getDefaultSelected(item.duplicateStatus, nextGroup.mode)
            : item.selected
      };
    })
  });
}

export function applyBookmarkImportDraft(
  documentValue: HomeDocumentV2,
  draft: BookmarkImportDraft
): BookmarkImportCommitResult {
  const groups = documentValue.groups.map((group) => ({
    ...group,
    sites: [...group.sites]
  }));
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const addedGroupIds: string[] = [];
  const addedSiteIdsByGroupId: Record<string, string[]> = {};
  let addedSiteCount = 0;
  let skippedItemCount = 0;

  const draftGroupsById = new Map(draft.groups.map((group) => [group.id, group]));
  const createdGroupIdsByDraftGroupId = new Map<string, string>();

  for (const item of draft.items) {
    const groupMapping = draftGroupsById.get(item.draftGroupId);
    if (!item.selected || !isBookmarkImportItemSelectable(item, groupMapping)) {
      skippedItemCount += 1;
      continue;
    }

    const targetGroup = getOrCreateTargetGroup({
      createdGroupIdsByDraftGroupId,
      draftGroup: groupMapping,
      groups,
      groupsById
    });
    if (!targetGroup) {
      skippedItemCount += 1;
      continue;
    }

    if (!documentValue.groups.some((group) => group.id === targetGroup.id) && !addedGroupIds.includes(targetGroup.id)) {
      addedGroupIds.push(targetGroup.id);
    }

    const site: HomeSite = {
      id: createId("site"),
      name: item.suggestedName,
      url: item.normalizedUrl,
      keywords: createImportedSiteKeywords(item),
      mark: item.suggestedMark,
      order: targetGroup.sites.length + 1
    };

    targetGroup.sites.push(site);
    addedSiteCount += 1;
    addedSiteIdsByGroupId[targetGroup.id] = [...(addedSiteIdsByGroupId[targetGroup.id] ?? []), site.id];
  }

  return {
    addedGroupIds,
    addedSiteCount,
    addedSiteIdsByGroupId,
    document: {
      ...documentValue,
      groups: renumberGroups(groups)
    },
    skippedItemCount
  };
}

export function applyBookmarkImportUndo(documentValue: HomeDocumentV2, undo: BookmarkImportUndoRecord): HomeDocumentV2 {
  const addedSiteIds = new Set(Object.values(undo.addedSiteIdsByGroupId).flat());
  const addedGroupIds = new Set(undo.addedGroupIds);
  const groups = documentValue.groups
    .map((group) => ({
      ...group,
      sites: group.sites.filter((site) => !addedSiteIds.has(site.id))
    }))
    .filter((group) => isUngroupedGroup(group) || !addedGroupIds.has(group.id) || group.sites.length > 0);

  return {
    ...documentValue,
    groups: renumberGroups(groups)
  };
}

export function filterBookmarkImportItems({
  draft,
  groupId,
  query,
  status
}: {
  draft: BookmarkImportDraft;
  groupId: string;
  query: string;
  status: BookmarkImportStatusFilter;
}): BookmarkImportDraftItem[] {
  const normalizedQuery = normalizeText(query).toLowerCase();

  return draft.items.filter((item) => {
    if (groupId !== "all" && item.draftGroupId !== groupId) {
      return false;
    }

    if (status === "selected" && !item.selected) {
      return false;
    }

    if (status === "unselected" && item.selected) {
      return false;
    }

    if (status !== "all" && status !== "selected" && status !== "unselected" && item.duplicateStatus !== status) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    return [
      item.suggestedName,
      item.rawTitle,
      item.normalizedUrl,
      item.hostname,
      item.targetGroupTitle,
      ...item.sourceFolderPath
    ].join(" ").toLowerCase().includes(normalizedQuery);
  });
}

export function calculateBookmarkImportGroupStats(draft: BookmarkImportDraft, groupId: string): BookmarkImportStats {
  return calculateStats(draft.items.filter((item) => item.draftGroupId === groupId), draft.groups.filter((group) => group.id === groupId));
}

export function getBookmarkImportStatusLabel(status: BookmarkImportDuplicateStatus): string {
  if (status === "duplicate-current-url") {
    return "当前重复";
  }

  if (status === "duplicate-import-url") {
    return "批次重复";
  }

  if (status === "duplicate-current-host") {
    return "同域名";
  }

  if (status === "invalid-url") {
    return "无效";
  }

  return "新链接";
}

function createExistingGroupsByTitle(groups: HomeGroup[]): Map<string, HomeGroup> {
  const result = new Map<string, HomeGroup>();
  for (const group of groups) {
    if (!isUngroupedGroup(group)) {
      result.set(normalizeGroupTitleKey(group.title), group);
    }
  }

  return result;
}

function getOrCreateDraftGroup({
  draftGroupsByKey,
  existingGroupsByTitle,
  sourceFolderPath,
  sourceKind
}: {
  draftGroupsByKey: Map<string, BookmarkImportDraftGroup>;
  existingGroupsByTitle: Map<string, HomeGroup>;
  sourceFolderPath: string[];
  sourceKind: BookmarkImportSourceKind;
}): BookmarkImportDraftGroup {
  const groupKey = sourceFolderPath.length > 0 ? sourceFolderPath.join(IMPORT_KEY_SEPARATOR) : "__ungrouped__";
  const existingDraftGroup = draftGroupsByKey.get(groupKey);
  if (existingDraftGroup) {
    return existingDraftGroup;
  }

  const suggestedTitle = getSuggestedGroupTitle(sourceFolderPath, sourceKind);
  const existingGroup = existingGroupsByTitle.get(normalizeGroupTitleKey(suggestedTitle));
  const mode: BookmarkImportGroupMode = !sourceFolderPath.length
    ? "ungrouped"
    : existingGroup
      ? "merge"
      : "create";
  const group: BookmarkImportDraftGroup = {
    id: createId("import-group"),
    sourcePath: sourceFolderPath,
    suggestedTitle,
    targetGroupId: mode === "merge" ? existingGroup?.id ?? null : mode === "ungrouped" ? UNGROUPED_GROUP_ID : null,
    targetGroupTitle: mode === "merge" ? existingGroup?.title ?? suggestedTitle : mode === "ungrouped" ? "未分组" : suggestedTitle,
    mode
  };

  draftGroupsByKey.set(groupKey, group);
  return group;
}

function getDuplicateStatus(
  parsedUrl: NormalizedImportUrl | null,
  existingUrlKeys: Set<string>,
  existingHosts: Set<string>,
  importUrlKeys: Set<string>
): BookmarkImportDuplicateStatus {
  if (!parsedUrl) {
    return "invalid-url";
  }

  if (existingUrlKeys.has(parsedUrl.duplicateKey)) {
    return "duplicate-current-url";
  }

  if (importUrlKeys.has(parsedUrl.duplicateKey)) {
    return "duplicate-import-url";
  }

  if (existingHosts.has(parsedUrl.hostname)) {
    return "duplicate-current-host";
  }

  return "new";
}

function getDefaultSelected(status: BookmarkImportDuplicateStatus, groupMode: BookmarkImportGroupMode): boolean {
  return groupMode !== "skip" && (status === "new" || status === "duplicate-current-host");
}

function getDuplicateReason(status: BookmarkImportDuplicateStatus): string | null {
  if (status === "duplicate-current-url") {
    return "当前首页已存在相同 URL。";
  }

  if (status === "duplicate-import-url") {
    return "本次导入中已有相同 URL，默认保留第一条。";
  }

  if (status === "duplicate-current-host") {
    return "当前首页已有同一网站域名，但路径不同。";
  }

  if (status === "invalid-url") {
    return "仅支持 http:// 或 https:// 链接。";
  }

  return null;
}

function normalizeImportUrl(input: unknown): NormalizedImportUrl | null {
  const value = normalizeUrlCandidate(input);
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    const hostname = url.hostname.toLowerCase();
    return {
      duplicateKey: createDuplicateKey(url),
      hostname,
      normalizedUrl: url.href
    };
  } catch {
    return null;
  }
}

function normalizeUrlCandidate(input: unknown): string {
  const value = normalizeText(input).replace(/[)\],.;]+$/g, "");
  if (!value) {
    return "";
  }

  if (value.startsWith("//")) {
    return `https:${value}`;
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    return value;
  }

  if (/^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:[/:?#].*)?$/i.test(value)) {
    return `https://${value}`;
  }

  return value;
}

function createDuplicateKey(url: URL): string {
  const copy = new URL(url.href);
  copy.hash = "";
  copy.hostname = copy.hostname.toLowerCase();

  if (copy.pathname !== "/" && copy.pathname.endsWith("/")) {
    copy.pathname = copy.pathname.replace(/\/+$/g, "");
  }

  return copy.href;
}

function normalizeFolderPath(value: unknown[]): string[] {
  return value.map(normalizeText).filter(Boolean);
}

function getSuggestedGroupTitle(sourceFolderPath: string[], sourceKind: BookmarkImportSourceKind): string {
  if (sourceFolderPath.length > 0) {
    return sourceFolderPath[sourceFolderPath.length - 1] ?? DEFAULT_URL_LIST_GROUP_TITLE;
  }

  return sourceKind === "url-list" ? DEFAULT_URL_LIST_GROUP_TITLE : "未分组";
}

function getFallbackTargetGroupTitle(group: BookmarkImportDraftGroup, mode: BookmarkImportGroupMode): string {
  if (mode === "ungrouped") {
    return "未分组";
  }

  if (mode === "skip") {
    return "跳过";
  }

  return group.suggestedTitle || DEFAULT_URL_LIST_GROUP_TITLE;
}

function getSourceKindLabel(sourceKind: BookmarkImportSourceKind): string {
  return sourceKind === "bookmark-html" ? "书签 HTML" : "URL 列表";
}

function formatHostnameName(hostname: string): string {
  return hostname.replace(/^www\./, "") || "未命名链接";
}

function normalizeGroupTitleKey(title: string): string {
  return normalizeText(title).toLowerCase();
}

function withDraftStats(draft: BookmarkImportDraft): BookmarkImportDraft {
  return {
    ...draft,
    stats: calculateStats(draft.items, draft.groups)
  };
}

function calculateStats(items: BookmarkImportDraftItem[], groups: BookmarkImportDraftGroup[]): BookmarkImportStats {
  const selectedGroups = new Set(items.filter((item) => item.selected).map((item) => item.draftGroupId));

  return {
    totalItems: items.length,
    validItems: items.filter((item) => item.duplicateStatus !== "invalid-url").length,
    selectedItems: items.filter((item) => item.selected).length,
    duplicateItems: items.filter((item) => item.duplicateStatus !== "new" && item.duplicateStatus !== "invalid-url").length,
    currentDuplicateItems: items.filter((item) => item.duplicateStatus === "duplicate-current-url").length,
    importDuplicateItems: items.filter((item) => item.duplicateStatus === "duplicate-import-url").length,
    hostMatchItems: items.filter((item) => item.duplicateStatus === "duplicate-current-host").length,
    invalidItems: items.filter((item) => item.duplicateStatus === "invalid-url").length,
    candidateGroups: groups.length,
    selectedGroups: selectedGroups.size,
    newGroupCount: groups.filter((group) => group.mode === "create" && selectedGroups.has(group.id)).length
  };
}

function createEmptyStats(): BookmarkImportStats {
  return {
    totalItems: 0,
    validItems: 0,
    selectedItems: 0,
    duplicateItems: 0,
    currentDuplicateItems: 0,
    importDuplicateItems: 0,
    hostMatchItems: 0,
    invalidItems: 0,
    candidateGroups: 0,
    selectedGroups: 0,
    newGroupCount: 0
  };
}

function getOrCreateTargetGroup({
  createdGroupIdsByDraftGroupId,
  draftGroup,
  groups,
  groupsById
}: {
  createdGroupIdsByDraftGroupId: Map<string, string>;
  draftGroup?: BookmarkImportDraftGroup;
  groups: Array<HomeGroup & { sites: HomeSite[] }>;
  groupsById: Map<string, HomeGroup & { sites: HomeSite[] }>;
}): (HomeGroup & { sites: HomeSite[] }) | null {
  if (!draftGroup || draftGroup.mode === "skip") {
    return null;
  }

  if (draftGroup.mode === "ungrouped") {
    return groupsById.get(UNGROUPED_GROUP_ID) ?? null;
  }

  if (draftGroup.mode === "merge" && draftGroup.targetGroupId) {
    return groupsById.get(draftGroup.targetGroupId) ?? groupsById.get(UNGROUPED_GROUP_ID) ?? null;
  }

  const existingCreatedGroupId = createdGroupIdsByDraftGroupId.get(draftGroup.id);
  if (existingCreatedGroupId) {
    return groupsById.get(existingCreatedGroupId) ?? null;
  }

  const group: HomeGroup = {
    id: createId("group"),
    title: normalizeText(draftGroup.targetGroupTitle) || draftGroup.suggestedTitle || DEFAULT_URL_LIST_GROUP_TITLE,
    keywords: createImportedGroupKeywords(draftGroup),
    order: groups.length + 1,
    sites: []
  };

  groups.push(group);
  groupsById.set(group.id, group);
  createdGroupIdsByDraftGroupId.set(draftGroup.id, group.id);
  return group;
}

function createImportedGroupKeywords(group: BookmarkImportDraftGroup): string {
  return [...group.sourcePath, group.suggestedTitle].map(normalizeText).filter(Boolean).join(" ");
}

function createImportedSiteKeywords(item: BookmarkImportDraftItem): string {
  return [item.hostname, ...item.sourceFolderPath].map(normalizeText).filter(Boolean).join(" ");
}
