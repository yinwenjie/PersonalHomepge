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
import { requestConfirm } from "@/components/confirm-dialog";
import {
  type HomeDocumentV2,
  type HomeWidget,
  type HomeWidgetType,
  isUngroupedGroup,
  renumberWidgets,
  sortByOrder
} from "@/domain/home-document";
import { normalizeCalendarConfig } from "@/domain/calendar-widget";
import { getCountdownStatus, normalizeCountdownConfig } from "@/domain/countdown-widget";
import { createHomeWidget } from "@/domain/home-widget";
import { getNotesStats, readNoteItems } from "@/domain/notes-widget";
import { getTodoStats, readTodoItems } from "@/domain/todo-widget";
import { readWorldClockItems } from "@/domain/world-clock-widget";
import { getWidgetDefinition, WIDGET_DEFINITIONS } from "@/domain/widget-registry";
import { CalendarMonthWidget } from "@/components/widgets/calendar-month-widget";
import { CountdownTimerWidget, formatCountdownPrimary } from "@/components/widgets/countdown-timer-widget";
import { NotesListWidget } from "@/components/widgets/notes-list-widget";
import { TodoListWidget } from "@/components/widgets/todo-list-widget";
import { WorldClockListWidget } from "@/components/widgets/world-clock-list-widget";
import { WidgetConfigDialog } from "@/components/widgets/widget-config-dialog";
import { WidgetShell } from "@/components/widgets/widget-shell";
import type { I18nFormatters } from "@/i18n/formatters";
import type { I18nTranslate } from "@/i18n/messages";
import {
  formatHomeWidgetDefaultTitle,
  formatHomeWidgetDescription,
  formatHomeWidgetDisplayTitle,
  formatHomeWidgetTitle,
  formatSyncStatus
} from "@/i18n/home-presentation";
import { useI18n } from "@/hooks/use-i18n";
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
  const { t, format } = useI18n();
  const { user, loading } = useSupabaseAuth();
  const accountLabel = user?.email ?? t("widgetPanel.accountLocal");
  const accountSub = loading ? t("widgetPanel.accountLoading") : user ? t("widgetPanel.accountSignedIn") : t("widgetPanel.accountLocalMode");
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
      updateWidget(nextWidget, t("widgetPanel.settingsUpdated"));
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

    commitWidgets([...widgets, nextWidget], t("widgetPanel.widgetAdded"));
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

    commitWidgets(arrayMove(widgets, widgetIndex, targetIndex), t("widgetPanel.orderUpdated"));
  }

  function renameWidget(widgetId: string, title: string) {
    const widget = widgets.find((item) => item.id === widgetId);
    if (!widget || widget.title === title) {
      return;
    }

    commitWidgets(widgets.map((item) => item.id === widgetId ? { ...item, title } : item), t("widgetPanel.titleUpdated"));
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
    ), t("widgetPanel.layoutUpdated"));
  }

  async function deleteWidget(widgetId: string) {
    const widget = widgets.find((item) => item.id === widgetId);
    if (!widget) {
      return;
    }

    if (!(await requestConfirm({
      message: t("widgetPanel.deleteConfirm", { widget: formatHomeWidgetDisplayTitle(widget, t) }),
      confirmLabel: t("common.delete"),
      tone: "danger"
    }))) {
      return;
    }

    commitWidgets(widgets.filter((item) => item.id !== widgetId), t("widgetPanel.widgetDeleted"));
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

    commitWidgets(arrayMove(widgets, activeIndex, overIndex), t("widgetPanel.orderUpdated"));
  }

  return (
    <aside className="sidebar" aria-label={t("widgetPanel.sidebarAria")}>
      <section className="status-panel">
        <div className="status-head">
          <span className="avatar">{accountInitial}</span>
          <div className="status-copy">
            <div className="status-title-row">
              <p className="status-title">{accountLabel}</p>
              <Link className="settings-button" href="/edit" aria-label={t("widgetPanel.openEditAria")} title={t("widgetPanel.openEditTitle")}>
                <span aria-hidden="true">⚙</span>
              </Link>
            </div>
            <p className="status-sub">{accountSub}</p>
          </div>
        </div>
        <div className="metrics">
          <div>
            <strong>{groupCount}</strong>
            <span>{t("widgetPanel.metricGroups")}</span>
          </div>
          <div>
            <strong>{siteCount}</strong>
            <span>{t("widgetPanel.metricSites")}</span>
          </div>
          <div>
            <strong>{documentValue.widgets.length}</strong>
            <span>{t("widgetPanel.metricWidgets")}</span>
          </div>
          <div>
            <strong>{documentValue.revision}</strong>
            <span>{t("widgetPanel.metricRevision")}</span>
          </div>
        </div>
        <div className="sync-row">
          <span className="dot" />
          <span>{formatSyncStatus(documentValue.syncMeta.status, t)}</span>
        </div>
        <p className="updated-line">{t("widgetPanel.updatedLine", { time: updatedLabel })}</p>
      </section>

      <section className={`widget-panel ${manageMode ? "is-managing" : ""}`}>
        <div className="panel-header">
          <div>
            <h2>{t("widgetPanel.title")}</h2>
            <span>{t("widgetPanel.count", { count: format.number(widgets.length) })}</span>
          </div>
          <div className="widget-panel-actions">
            <button
              className={`widget-manage-button ${manageMode ? "is-active" : ""}`}
              type="button"
              aria-pressed={manageMode}
              title={manageMode ? t("widgetPanel.finishManageTitle") : t("widgetPanel.manageTitle")}
              onClick={toggleManageMode}
            >
              {manageMode ? t("widgetPanel.finish") : t("widgetPanel.manage")}
            </button>
            <button
              className="widget-add-button"
              type="button"
              aria-expanded={pickerOpen}
              aria-label={t("widgetPanel.addAria")}
              title={t("widgetPanel.addTitle")}
              onClick={() => setPickerOpen((current) => !current)}
            >
              +
            </button>
          </div>
        </div>

        {pickerOpen ? (
          <div className="widget-picker" aria-label={t("widgetPanel.pickerAria")}>
            {WIDGET_DEFINITIONS.map((definition) => {
              const disabled = !definition.allowMultiple && widgetTypes.has(definition.type);

              return (
                <button
                  key={definition.type}
                  className="widget-option"
                  type="button"
                  disabled={disabled}
                  title={disabled ? t("widgetPanel.alreadyAddedTitle") : t("widgetPanel.addWidgetTitle", { widget: formatHomeWidgetTitle(definition.type, t) })}
                  onClick={() => addWidget(definition.type)}
                >
                  <strong>{formatHomeWidgetTitle(definition.type, t)}</strong>
                  <span>{disabled ? t("widgetPanel.alreadyAdded") : formatHomeWidgetDescription(definition.type, t)}</span>
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
                <p className="widget-empty">{t("widgetPanel.empty")}</p>
              )}
            </div>
          </SortableContext>
          <DragOverlay>
            {activeWidget ? (
              <div className="widget-drag-overlay">{formatHomeWidgetDisplayTitle(activeWidget, t)}</div>
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
  const { t, format } = useI18n();
  const displayTitle = formatHomeWidgetDisplayTitle(widget, t);
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
      aria-label={t("widgetPanel.dragWidgetAria", { widget: displayTitle })}
      title={t("widgetPanel.dragTitle")}
      {...attributes}
      {...listeners}
    >
      ↕
    </button>
  );

  return (
    <WidgetShell
      title={widget.title}
      displayTitle={displayTitle}
      defaultTitle={formatHomeWidgetDefaultTitle(widget.type, t)}
      description={formatHomeWidgetDescription(widget.type, t)}
      manageMode={manageMode}
      collapsed={collapsed}
      widgetIndex={widgetIndex}
      widgetsLength={widgetsLength}
      collapsedSummary={getWidgetCollapsedSummary(widget, t, format)}
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

  if (widget.type === "notes.list") {
    return <NotesListWidget widget={widget} onUpdate={onUpdateWidget} />;
  }

  if (widget.type === "calendar.month") {
    return <CalendarMonthWidget widget={widget} />;
  }

  if (widget.type === "countdown.timer") {
    return <CountdownTimerWidget widget={widget} />;
  }

  if (widget.type === "world-clock.list") {
    return <WorldClockListWidget widget={widget} />;
  }

  return null;
}

function hasWidgetSettingsChanged(currentWidget: HomeWidget, nextWidget: HomeWidget): boolean {
  return currentWidget.title !== nextWidget.title
    || JSON.stringify(currentWidget.config) !== JSON.stringify(nextWidget.config);
}

function getWidgetCollapsedSummary(widget: HomeWidget, t: I18nTranslate, format: I18nFormatters): string {
  if (widget.type === "todo.list") {
    const stats = getTodoStats(readTodoItems(widget.config));
    if (stats.total === 0) {
      return t("widget.todoEmpty");
    }

    return t("widget.todoSummary", {
      active: format.number(stats.active),
      total: format.number(stats.total)
    });
  }

  if (widget.type === "calendar.month") {
    const config = normalizeCalendarConfig(widget.config);
    const now = new Date();
    const monthLabel = format.monthYear(now);
    const todayLabel = t("calendar.todayCurrent", { date: format.dayOfMonth(now) });
    const weekStartLabel = t(config.weekStartsOn === 1 ? "calendar.weekStartMonday" : "calendar.weekStartSunday");

    return t("widget.calendarSummary", {
      month: monthLabel,
      today: todayLabel,
      weekStart: weekStartLabel
    });
  }

  if (widget.type === "notes.list") {
    const stats = getNotesStats(readNoteItems(widget.config));
    if (stats.total === 0) {
      return t("notes.empty");
    }

    return t("notes.summary", {
      count: format.number(stats.total)
    });
  }

  if (widget.type === "countdown.timer") {
    const config = normalizeCountdownConfig(widget.config);
    const status = getCountdownStatus(config);

    return formatCountdownPrimary(status, config.displayMode, t, format);
  }

  if (widget.type === "world-clock.list") {
    const total = readWorldClockItems(widget.config).length;
    if (total === 0) {
      return t("worldClock.empty");
    }

    return t("worldClock.summary", {
      count: format.number(total)
    });
  }

  return t("widget.collapsedFallback");
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
