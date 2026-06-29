"use client";

import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors
} from "@dnd-kit/core";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  type HomeDocumentV2,
  type HomeWidget,
  type HomeWidgetType,
  isUngroupedGroup,
  renumberWidgets,
  sortByOrder
} from "@/domain/home-document";
import { normalizeCalendarConfig } from "@/domain/calendar-widget";
import { createHomeWidget } from "@/domain/home-widget";
import { getTodoStats, readTodoItems } from "@/domain/todo-widget";
import { getWidgetDefinition, WIDGET_DEFINITIONS } from "@/domain/widget-registry";
import { CalendarMonthWidget } from "@/components/widgets/calendar-month-widget";
import { TodoListWidget } from "@/components/widgets/todo-list-widget";
import { WidgetConfigDialog } from "@/components/widgets/widget-config-dialog";
import { WidgetShell } from "@/components/widgets/widget-shell";
import { useSupabaseAuth } from "@/hooks/use-supabase-auth";
import { trackProductEvent } from "@/infrastructure/product-analytics-repository";

interface WidgetPanelProps {
  documentValue: HomeDocumentV2;
  updatedLabel: string;
  onCommitDocument: (documentValue: HomeDocumentV2, message?: string) => void;
}

interface SortableWidgetCardProps {
  widget: HomeWidget;
  widgetIndex: number;
  widgetsLength: number;
  manageMode: boolean;
  onDeleteWidget: (widgetId: string) => void;
  onMoveWidget: (widgetId: string, direction: -1 | 1) => void;
  onOpenWidgetSettings: (widgetId: string) => void;
  onRenameWidget: (widgetId: string, title: string) => void;
  onToggleCollapsed: (widgetId: string) => void;
  onUpdateWidget: (nextWidget: HomeWidget, message: string) => void;
}

const widgetDragId = (widgetId: string) => `widget:${widgetId}`;

export function WidgetPanel({ documentValue, updatedLabel, onCommitDocument }: WidgetPanelProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [manageMode, setManageMode] = useState(false);
  const [activeWidgetId, setActiveWidgetId] = useState<string | null>(null);
  const [configuringWidgetId, setConfiguringWidgetId] = useState<string | null>(null);
  const siteCount = documentValue.groups.reduce((sum, group) => sum + group.sites.length, 0);
  const groupCount = documentValue.groups.filter((group) => !isUngroupedGroup(group)).length;
  const widgets = useMemo(() => sortByOrder(documentValue.widgets), [documentValue.widgets]);
  const widgetTypes = useMemo(() => new Set(widgets.map((widget) => widget.type)), [widgets]);
  const activeWidget = useMemo(() => widgets.find((widget) => widget.id === activeWidgetId) ?? null, [activeWidgetId, widgets]);
  const configuringWidget = useMemo(() => widgets.find((widget) => widget.id === configuringWidgetId) ?? null, [configuringWidgetId, widgets]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const { user, loading } = useSupabaseAuth();
  const accountLabel = user?.email ?? "Local";
  const accountSub = loading ? "读取账号状态" : user ? "账号已登录" : "本地模式";
  const accountInitial = getAccountInitial(user?.email);

  function commitWidgets(nextWidgets: HomeWidget[], message: string) {
    onCommitDocument({
      ...documentValue,
      widgets: renumberWidgets(nextWidgets.map((widget, widgetIndex) => ({
        ...widget,
        order: widgetIndex + 1
      })))
    }, message);
  }

  function updateWidget(nextWidget: HomeWidget, message: string) {
    commitWidgets(widgets.map((widget) => widget.id === nextWidget.id ? nextWidget : widget), message);
  }

  function updateWidgetSettings(nextWidget: HomeWidget) {
    const currentWidget = widgets.find((widget) => widget.id === nextWidget.id);

    if (currentWidget && hasWidgetSettingsChanged(currentWidget, nextWidget)) {
      updateWidget(nextWidget, "组件设置已更新");
    }

    setConfiguringWidgetId(null);
  }

  function openWidgetSettings(widgetId: string) {
    setPickerOpen(false);
    setConfiguringWidgetId(widgetId);
  }

  function addWidget(type: HomeWidgetType) {
    const definition = getWidgetDefinition(type);
    const alreadyAdded = widgetTypes.has(type);

    if (!definition.allowMultiple && alreadyAdded) {
      return;
    }

    const nextWidget = createHomeWidget(type, { order: widgets.length + 1 });

    commitWidgets([...widgets, nextWidget], "组件已添加");
    trackProductEvent("widget.added", {
      widgetType: type
    });
    setPickerOpen(false);
  }

  function toggleManageMode() {
    if (manageMode) {
      setPickerOpen(false);
    }

    setManageMode((current) => !current);
    setConfiguringWidgetId(null);
  }

  function moveWidget(widgetId: string, direction: -1 | 1) {
    const widgetIndex = widgets.findIndex((widget) => widget.id === widgetId);
    const targetIndex = widgetIndex + direction;

    if (widgetIndex < 0 || targetIndex < 0 || targetIndex >= widgets.length) {
      return;
    }

    commitWidgets(arrayMove(widgets, widgetIndex, targetIndex), "组件顺序已更新");
  }

  function renameWidget(widgetId: string, title: string) {
    const widget = widgets.find((item) => item.id === widgetId);
    if (!widget || widget.title === title) {
      return;
    }

    commitWidgets(widgets.map((item) => item.id === widgetId ? { ...item, title } : item), "组件标题已更新");
  }

  function toggleWidgetCollapsed(widgetId: string) {
    commitWidgets(widgets.map((widget) => widget.id === widgetId
      ? {
        ...widget,
        layout: {
          ...widget.layout,
          collapsed: !widget.layout.collapsed
        }
      }
      : widget
    ), "组件布局已更新");
  }

  function deleteWidget(widgetId: string) {
    const widget = widgets.find((item) => item.id === widgetId);
    if (!widget) {
      return;
    }

    if (!window.confirm(`删除组件「${widget.title}」？`)) {
      return;
    }

    commitWidgets(widgets.filter((item) => item.id !== widgetId), "组件已删除");
    setConfiguringWidgetId((current) => current === widgetId ? null : current);
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveWidgetId(readWidgetIdFromDragId(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    const activeId = readWidgetIdFromDragId(event.active.id);
    const overId = readWidgetIdFromDragId(event.over?.id);
    setActiveWidgetId(null);

    if (!manageMode || !activeId || !overId || activeId === overId) {
      return;
    }

    const activeIndex = widgets.findIndex((widget) => widget.id === activeId);
    const overIndex = widgets.findIndex((widget) => widget.id === overId);

    if (activeIndex < 0 || overIndex < 0 || activeIndex === overIndex) {
      return;
    }

    commitWidgets(arrayMove(widgets, activeIndex, overIndex), "组件顺序已更新");
  }

  return (
    <aside className="sidebar" aria-label="状态和组件">
      <section className="status-panel">
        <div className="status-head">
          <span className="avatar">{accountInitial}</span>
          <div className="status-copy">
            <div className="status-title-row">
              <p className="status-title">{accountLabel}</p>
              <Link className="settings-button" href="/edit" aria-label="打开编辑页面" title="编辑首页">
                <span aria-hidden="true">⚙</span>
              </Link>
            </div>
            <p className="status-sub">{accountSub}</p>
          </div>
        </div>
        <div className="metrics">
          <div>
            <strong>{groupCount}</strong>
            <span>分组</span>
          </div>
          <div>
            <strong>{siteCount}</strong>
            <span>网站</span>
          </div>
          <div>
            <strong>{documentValue.widgets.length}</strong>
            <span>组件</span>
          </div>
          <div>
            <strong>{documentValue.revision}</strong>
            <span>修订</span>
          </div>
        </div>
        <div className="sync-row">
          <span className="dot" />
          <span>{documentValue.syncMeta.status}</span>
        </div>
        <p className="updated-line">更新于 {updatedLabel}</p>
      </section>

      <section className={`widget-panel ${manageMode ? "is-managing" : ""}`}>
        <div className="panel-header">
          <div>
            <h2>组件</h2>
            <span>{widgets.length} 个组件</span>
          </div>
          <div className="widget-panel-actions">
            <button
              className={`widget-manage-button ${manageMode ? "is-active" : ""}`}
              type="button"
              aria-pressed={manageMode}
              title={manageMode ? "完成组件管理" : "管理组件"}
              onClick={toggleManageMode}
            >
              {manageMode ? "完成" : "管理"}
            </button>
            <button
              className="widget-add-button"
              type="button"
              aria-expanded={pickerOpen}
              aria-label="添加组件"
              title="添加组件"
              onClick={() => setPickerOpen((current) => !current)}
            >
              +
            </button>
          </div>
        </div>

        {pickerOpen ? (
          <div className="widget-picker" aria-label="可添加组件">
            {WIDGET_DEFINITIONS.map((definition) => {
              const disabled = !definition.allowMultiple && widgetTypes.has(definition.type);

              return (
                <button
                  key={definition.type}
                  className="widget-option"
                  type="button"
                  disabled={disabled}
                  title={disabled ? "该组件已添加" : `添加${definition.title}`}
                  onClick={() => addWidget(definition.type)}
                >
                  <strong>{definition.title}</strong>
                  <span>{disabled ? "已添加" : definition.description}</span>
                </button>
              );
            })}
          </div>
        ) : null}

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActiveWidgetId(null)}
        >
          <SortableContext items={widgets.map((widget) => widgetDragId(widget.id))} strategy={verticalListSortingStrategy}>
            <div className="widget-list">
              {widgets.length > 0 ? widgets.map((widget, widgetIndex) => (
                <SortableWidgetCard
                  key={widget.id}
                  widget={widget}
                  widgetIndex={widgetIndex}
                  widgetsLength={widgets.length}
                  manageMode={manageMode}
                  onDeleteWidget={deleteWidget}
                  onMoveWidget={moveWidget}
                  onOpenWidgetSettings={openWidgetSettings}
                  onRenameWidget={renameWidget}
                  onToggleCollapsed={toggleWidgetCollapsed}
                  onUpdateWidget={updateWidget}
                />
              )) : (
                <p className="widget-empty">暂无组件</p>
              )}
            </div>
          </SortableContext>
          <DragOverlay>
            {activeWidget ? (
              <div className="widget-drag-overlay">{activeWidget.title}</div>
            ) : null}
          </DragOverlay>
        </DndContext>

        {configuringWidget ? (
          <WidgetConfigDialog
            key={configuringWidget.id}
            widget={configuringWidget}
            onCancel={() => setConfiguringWidgetId(null)}
            onSave={updateWidgetSettings}
          />
        ) : null}
      </section>
    </aside>
  );
}

function SortableWidgetCard({
  widget,
  widgetIndex,
  widgetsLength,
  manageMode,
  onDeleteWidget,
  onMoveWidget,
  onOpenWidgetSettings,
  onRenameWidget,
  onToggleCollapsed,
  onUpdateWidget
}: SortableWidgetCardProps) {
  const definition = getWidgetDefinition(widget.type);
  const collapsed = widget.layout.collapsed;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({
    id: widgetDragId(widget.id),
    data: { kind: "widget", widgetId: widget.id },
    disabled: !manageMode || widgetsLength < 2
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition
  };
  const dragHandle = (
    <button
      className="widget-drag-handle"
      type="button"
      disabled={widgetsLength < 2}
      aria-label={`拖动${widget.title}排序`}
      title="拖动排序"
      {...attributes}
      {...listeners}
    >
      ↕
    </button>
  );

  return (
    <WidgetShell
      title={widget.title}
      defaultTitle={definition.defaultTitle}
      description={definition.description}
      manageMode={manageMode}
      collapsed={collapsed}
      widgetIndex={widgetIndex}
      widgetsLength={widgetsLength}
      collapsedSummary={getWidgetCollapsedSummary(widget)}
      dragHandle={dragHandle}
      isDragging={isDragging}
      articleRef={setNodeRef}
      style={style}
      onRenameTitle={(title) => onRenameWidget(widget.id, title)}
      onOpenSettings={() => onOpenWidgetSettings(widget.id)}
      onToggleCollapsed={() => onToggleCollapsed(widget.id)}
      onMove={(direction) => onMoveWidget(widget.id, direction)}
      onDelete={() => onDeleteWidget(widget.id)}
    >
      <WidgetContent widget={widget} onUpdateWidget={onUpdateWidget} />
    </WidgetShell>
  );
}

function WidgetContent({
  widget,
  onUpdateWidget
}: {
  widget: HomeWidget;
  onUpdateWidget: (nextWidget: HomeWidget, message: string) => void;
}) {
  if (widget.type === "todo.list") {
    return <TodoListWidget widget={widget} onUpdate={onUpdateWidget} />;
  }

  if (widget.type === "calendar.month") {
    return <CalendarMonthWidget widget={widget} />;
  }

  return null;
}

function hasWidgetSettingsChanged(currentWidget: HomeWidget, nextWidget: HomeWidget): boolean {
  return currentWidget.title !== nextWidget.title
    || JSON.stringify(currentWidget.config) !== JSON.stringify(nextWidget.config);
}

function getWidgetCollapsedSummary(widget: HomeWidget): string {
  if (widget.type === "todo.list") {
    const stats = getTodoStats(readTodoItems(widget.config));
    if (stats.total === 0) {
      return "暂无任务";
    }

    return `${stats.active} 项待办 / ${stats.total} 项任务`;
  }

  if (widget.type === "calendar.month") {
    const config = normalizeCalendarConfig(widget.config);
    const now = new Date();
    const monthLabel = `${now.getFullYear()}年${now.getMonth() + 1}月`;
    const todayLabel = `今日 ${now.getDate()}日`;
    const weekStartLabel = config.weekStartsOn === 1 ? "周一开始" : "周日开始";

    return `${monthLabel} · ${todayLabel} · ${weekStartLabel}`;
  }

  return "组件已折叠";
}

function readWidgetIdFromDragId(value: unknown): string | null {
  const id = String(value ?? "");
  return id.startsWith("widget:") ? id.slice("widget:".length) : null;
}

function getAccountInitial(email?: string): string {
  const value = email?.trim();
  if (!value) {
    return "L";
  }

  return value.slice(0, 1).toUpperCase();
}
