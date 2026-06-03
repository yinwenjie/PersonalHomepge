"use client";

import {
  closestCorners,
  CollisionDetection,
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors
} from "@dnd-kit/core";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { UniqueIdentifier } from "@dnd-kit/core";
import { useMemo, useState } from "react";
import {
  HomeDocumentV2,
  HomeGroup,
  HomeSite,
  sortByOrder
} from "@/domain/home-document";
import { SiteIcon } from "@/components/site-icon";

type DragItem =
  | { kind: "group"; groupId: string }
  | { kind: "site"; groupId: string; siteId: string }
  | { kind: "group-drop"; groupId: string };

interface VisibleGroup {
  group: HomeGroup;
  sites: HomeSite[];
}

interface SiteCollectionProps {
  documentValue: HomeDocumentV2;
  visibleGroups: VisibleGroup[];
  editMode: boolean;
  dragDisabled: boolean;
  visibleCount: number;
  onCommitDocument: (documentValue: HomeDocumentV2, message: string) => void;
  onOpenGroupEditor: (groupId?: string) => void;
  onOpenSiteEditor: (groupId: string, siteId?: string) => void;
  onDeleteGroup: (groupId: string) => void;
  onDeleteSite: (groupId: string, siteId: string) => void;
}

const groupDragId = (groupId: string) => `group:${groupId}`;
const siteDragId = (siteId: string) => `site:${siteId}`;
const groupDropId = (groupId: string) => `group-drop:${groupId}`;
const pointerFirstCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  const collisions = pointerCollisions.length > 0 ? pointerCollisions : closestCorners(args);
  const activeId = String(args.active.id);

  if (activeId.startsWith("site:")) {
    const siteCollisions = pointerCollisions.filter((collision) => String(collision.id).startsWith("site:"));
    if (siteCollisions.length > 0) {
      return siteCollisions;
    }

    const groupDropCollisions = pointerCollisions.filter((collision) => String(collision.id).startsWith("group-drop:"));
    if (groupDropCollisions.length > 0) {
      return groupDropCollisions;
    }

    const groupCollisions = pointerCollisions.filter((collision) => String(collision.id).startsWith("group:"));
    if (groupCollisions.length > 0) {
      return groupCollisions;
    }

    return [];
  }

  if (activeId.startsWith("group:")) {
    const groupCollisions = collisions.filter((collision) => String(collision.id).startsWith("group:"));
    if (groupCollisions.length > 0) {
      return groupCollisions;
    }
  }

  return collisions;
};

export function SiteCollection({
  documentValue,
  visibleGroups,
  editMode,
  dragDisabled,
  visibleCount,
  onCommitDocument,
  onOpenGroupEditor,
  onOpenSiteEditor,
  onDeleteGroup,
  onDeleteSite
}: SiteCollectionProps) {
  const [activeItem, setActiveItem] = useState<DragItem | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const activeLabel = useMemo(() => {
    if (!activeItem) {
      return "";
    }

    if (activeItem.kind === "group") {
      return documentValue.groups.find((group) => group.id === activeItem.groupId)?.title ?? "";
    }

    if (activeItem.kind === "site") {
      return documentValue.groups
        .flatMap((group) => group.sites)
        .find((site) => site.id === activeItem.siteId)?.name ?? "";
    }

    return "";
  }, [activeItem, documentValue.groups]);

  function handleDragStart(event: DragStartEvent) {
    setActiveItem(toDragItem(event.active.data.current, event.active.id, documentValue.groups));
  }

  function handleDragEnd(event: DragEndEvent) {
    const activeData = toDragItem(event.active.data.current, event.active.id, documentValue.groups);
    const overData = toDragItem(event.over?.data.current, event.over?.id, documentValue.groups);
    setActiveItem(null);

    if (!activeData || !overData || dragDisabled) {
      return;
    }

    if (activeData.kind === "group") {
      reorderGroups(activeData.groupId, overData.groupId);
      return;
    }

    if (activeData.kind === "site") {
      moveSite(activeData, overData);
    }
  }

  function reorderGroups(activeGroupId: string, overGroupId: string) {
    if (activeGroupId === overGroupId) {
      return;
    }

    const groups = sortByOrder(documentValue.groups);
    const activeIndex = groups.findIndex((group) => group.id === activeGroupId);
    const overIndex = groups.findIndex((group) => group.id === overGroupId);
    if (activeIndex < 0 || overIndex < 0 || activeIndex === overIndex) {
      return;
    }

    onCommitDocument({
      ...documentValue,
      groups: applyCurrentOrder(arrayMove(groups, activeIndex, overIndex))
    }, "分组排序已保存");
  }

  function moveSite(activeSite: Extract<DragItem, { kind: "site" }>, overData: DragItem) {
    const targetGroupId = overData.kind === "site" || overData.kind === "group-drop" || overData.kind === "group"
      ? overData.groupId
      : null;
    if (!targetGroupId) {
      return;
    }

    const groups = sortByOrder(documentValue.groups).map((group) => ({
      ...group,
      sites: sortByOrder(group.sites)
    }));
    const sourceGroup = groups.find((group) => group.id === activeSite.groupId);
    const targetGroup = groups.find((group) => group.id === targetGroupId);
    if (!sourceGroup || !targetGroup) {
      return;
    }

    const sourceIndex = sourceGroup.sites.findIndex((site) => site.id === activeSite.siteId);
    if (sourceIndex < 0) {
      return;
    }

    if (sourceGroup.id === targetGroup.id) {
      const targetIndex = overData.kind === "site"
        ? sourceGroup.sites.findIndex((site) => site.id === overData.siteId)
        : sourceGroup.sites.length - 1;
      if (targetIndex < 0 || sourceIndex === targetIndex) {
        return;
      }

      sourceGroup.sites = arrayMove(sourceGroup.sites, sourceIndex, targetIndex);
      onCommitDocument({
        ...documentValue,
        groups: applyCurrentOrder(groups)
      }, "网站排序已保存");
      return;
    }

    const [movingSite] = sourceGroup.sites.splice(sourceIndex, 1);
    const overSiteIndex = overData.kind === "site"
      ? targetGroup.sites.findIndex((site) => site.id === overData.siteId)
      : targetGroup.sites.length;
    const insertIndex = overSiteIndex < 0 ? targetGroup.sites.length : overSiteIndex;

    targetGroup.sites.splice(insertIndex, 0, movingSite);

    onCommitDocument({
      ...documentValue,
      groups: applyCurrentOrder(groups)
    }, "网站已移动");
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerFirstCollisionDetection}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveItem(null)}
    >
      <SortableContext items={visibleGroups.map(({ group }) => groupDragId(group.id))} strategy={verticalListSortingStrategy}>
        <section className="sections" aria-label="常用网站导航">
          {visibleGroups.map(({ group, sites }) => (
            <SortableGroup
              key={group.id}
              group={group}
              sites={sites}
              editMode={editMode}
              dragDisabled={dragDisabled}
              onOpenGroupEditor={onOpenGroupEditor}
              onOpenSiteEditor={onOpenSiteEditor}
              onDeleteGroup={onDeleteGroup}
              onDeleteSite={onDeleteSite}
            />
          ))}
          {visibleCount === 0 && !editMode ? (
            <p className="empty-state is-visible">没有匹配的网站。</p>
          ) : null}
        </section>
      </SortableContext>
      <DragOverlay>
        {activeLabel ? <div className="drag-overlay">{activeLabel}</div> : null}
      </DragOverlay>
    </DndContext>
  );
}

interface SortableGroupProps {
  group: HomeGroup;
  sites: HomeSite[];
  editMode: boolean;
  dragDisabled: boolean;
  onOpenGroupEditor: (groupId?: string) => void;
  onOpenSiteEditor: (groupId: string, siteId?: string) => void;
  onDeleteGroup: (groupId: string) => void;
  onDeleteSite: (groupId: string, siteId: string) => void;
}

function SortableGroup({
  group,
  sites,
  editMode,
  dragDisabled,
  onOpenGroupEditor,
  onOpenSiteEditor,
  onDeleteGroup,
  onDeleteSite
}: SortableGroupProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({
    id: groupDragId(group.id),
    data: { kind: "group", groupId: group.id } satisfies DragItem,
    disabled: dragDisabled
  });
  const {
    isOver,
    setNodeRef: setDropRef
  } = useDroppable({
    id: groupDropId(group.id),
    data: { kind: "group-drop", groupId: group.id } satisfies DragItem,
    disabled: dragDisabled
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition
  };

  return (
    <article ref={setNodeRef} className={`section ${isDragging ? "is-dragging" : ""}`} style={style}>
      <div className="section-meta">
        <div className="section-heading-row">
          <h2 className="section-title">{group.title}</h2>
          <button
            className="drag-handle group-drag-handle"
            type="button"
            aria-label={`拖拽排序分组 ${group.title}`}
            title={dragDisabled ? "搜索时不可拖拽排序" : "拖拽排序分组"}
            disabled={dragDisabled}
            {...attributes}
            {...listeners}
          >
            ⋮⋮
          </button>
        </div>
        <span className="section-count">{sites.length} / {group.sites.length}</span>
        {editMode ? (
          <div className="section-controls" aria-label={`${group.title} 操作`}>
            <button className="mini-button" type="button" onClick={() => onOpenGroupEditor(group.id)} aria-label={`编辑 ${group.title}`}>改</button>
            <button className="mini-button" type="button" onClick={() => onDeleteGroup(group.id)} aria-label={`删除 ${group.title}`}>×</button>
          </div>
        ) : null}
      </div>
      <SortableContext items={sites.map((site) => siteDragId(site.id))} strategy={rectSortingStrategy}>
        <div ref={setDropRef} className={`links ${isOver ? "is-drop-target" : ""}`}>
          {sites.map((site) => (
            <SortableSiteTile
              key={site.id}
              groupId={group.id}
              site={site}
              editMode={editMode}
              dragDisabled={dragDisabled}
              onOpenSiteEditor={onOpenSiteEditor}
              onDeleteSite={onDeleteSite}
            />
          ))}
          {editMode ? (
            <button className="add-site-button" type="button" onClick={() => onOpenSiteEditor(group.id)}>+ 新增网站</button>
          ) : null}
        </div>
      </SortableContext>
    </article>
  );
}

interface SortableSiteTileProps {
  groupId: string;
  site: HomeSite;
  editMode: boolean;
  dragDisabled: boolean;
  onOpenSiteEditor: (groupId: string, siteId?: string) => void;
  onDeleteSite: (groupId: string, siteId: string) => void;
}

function SortableSiteTile({
  groupId,
  site,
  editMode,
  dragDisabled,
  onOpenSiteEditor,
  onDeleteSite
}: SortableSiteTileProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({
    id: siteDragId(site.id),
    data: { kind: "site", groupId, siteId: site.id } satisfies DragItem,
    disabled: dragDisabled
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition
  };

  return (
    <div ref={setNodeRef} className={`site-tile ${editMode ? "is-editing" : ""} ${isDragging ? "is-dragging" : ""}`} style={style}>
      {editMode ? (
        <div className="site-link is-editing">
          <SiteIcon site={site} />
          <span className="site-name">{site.name}</span>
          <div className="site-controls" aria-label={`${site.name} 操作`}>
            <button className="mini-button" type="button" onClick={() => onOpenSiteEditor(groupId, site.id)} aria-label={`编辑 ${site.name}`}>改</button>
            <button className="mini-button" type="button" onClick={() => onDeleteSite(groupId, site.id)} aria-label={`删除 ${site.name}`}>×</button>
          </div>
        </div>
      ) : (
        <a className="site-link" href={site.url} target="_blank" rel="noopener noreferrer">
          <SiteIcon site={site} />
          <span className="site-name">{site.name}</span>
        </a>
      )}
      <button
        className="drag-handle site-drag-handle"
        type="button"
        aria-label={`拖拽移动网站 ${site.name}`}
        title={dragDisabled ? "搜索时不可拖拽排序" : "拖拽移动网站"}
        disabled={dragDisabled}
        {...attributes}
        {...listeners}
      >
        ⋮⋮
      </button>
    </div>
  );
}

function applyCurrentOrder(groups: HomeGroup[]): HomeGroup[] {
  return groups.map((group, groupIndex) => ({
    ...group,
    order: groupIndex + 1,
    sites: group.sites.map((site, siteIndex) => ({
      ...site,
      order: siteIndex + 1
    }))
  }));
}

function toDragItem(value: unknown, fallbackId: UniqueIdentifier | undefined, groups: HomeGroup[]): DragItem | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const item = value as Record<string, unknown>;
    if (item.kind === "group" && typeof item.groupId === "string") {
      return { kind: "group", groupId: item.groupId };
    }

    if (item.kind === "site" && typeof item.groupId === "string" && typeof item.siteId === "string") {
      return { kind: "site", groupId: item.groupId, siteId: item.siteId };
    }

    if (item.kind === "group-drop" && typeof item.groupId === "string") {
      return { kind: "group-drop", groupId: item.groupId };
    }
  }

  if (typeof fallbackId !== "string") {
    return null;
  }

  if (fallbackId.startsWith("group:")) {
    return { kind: "group", groupId: fallbackId.slice("group:".length) };
  }

  if (fallbackId.startsWith("group-drop:")) {
    return { kind: "group-drop", groupId: fallbackId.slice("group-drop:".length) };
  }

  if (fallbackId.startsWith("site:")) {
    const siteId = fallbackId.slice("site:".length);
    const group = groups.find((candidate) => candidate.sites.some((site) => site.id === siteId));
    return group ? { kind: "site", groupId: group.id, siteId } : null;
  }

  return null;
}
