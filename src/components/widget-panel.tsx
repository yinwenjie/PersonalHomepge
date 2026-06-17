"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  createId,
  type HomeDocumentV2,
  type HomeWidget,
  type HomeWidgetType,
  isUngroupedGroup,
  renumberWidgets,
  sortByOrder
} from "@/domain/home-document";
import { getWidgetDefinition, WIDGET_DEFINITIONS } from "@/domain/widget-registry";
import { useSupabaseAuth } from "@/hooks/use-supabase-auth";

interface WidgetPanelProps {
  documentValue: HomeDocumentV2;
  updatedLabel: string;
  onCommitDocument: (documentValue: HomeDocumentV2, message?: string) => void;
}

export function WidgetPanel({ documentValue, updatedLabel, onCommitDocument }: WidgetPanelProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const siteCount = documentValue.groups.reduce((sum, group) => sum + group.sites.length, 0);
  const groupCount = documentValue.groups.filter((group) => !isUngroupedGroup(group)).length;
  const widgets = useMemo(() => sortByOrder(documentValue.widgets), [documentValue.widgets]);
  const widgetTypes = useMemo(() => new Set(widgets.map((widget) => widget.type)), [widgets]);
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

  function addWidget(type: HomeWidgetType) {
    const definition = getWidgetDefinition(type);
    const alreadyAdded = widgetTypes.has(type);

    if (!definition.allowMultiple && alreadyAdded) {
      return;
    }

    const nextWidget: HomeWidget = {
      id: createId("widget"),
      type,
      title: definition.defaultTitle,
      order: widgets.length + 1,
      config: definition.defaultConfig()
    };

    commitWidgets([...widgets, nextWidget], "组件已添加");
    setPickerOpen(false);
  }

  function moveWidget(widgetId: string, direction: -1 | 1) {
    const widgetIndex = widgets.findIndex((widget) => widget.id === widgetId);
    const targetIndex = widgetIndex + direction;

    if (widgetIndex < 0 || targetIndex < 0 || targetIndex >= widgets.length) {
      return;
    }

    const nextWidgets = [...widgets];
    const currentWidget = nextWidgets[widgetIndex];
    const targetWidget = nextWidgets[targetIndex];

    nextWidgets[widgetIndex] = targetWidget;
    nextWidgets[targetIndex] = currentWidget;
    commitWidgets(nextWidgets, "组件顺序已更新");
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

      <section className="widget-panel">
        <div className="panel-header">
          <div>
            <h2>组件</h2>
            <span>{widgets.length} active</span>
          </div>
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

        <div className="widget-list">
          {widgets.length > 0 ? widgets.map((widget, widgetIndex) => (
            <article className="widget-card" key={widget.id}>
              <div className="widget-card-head">
                <div className="widget-card-copy">
                  <strong>{widget.title}</strong>
                  <span>{getWidgetDefinition(widget.type).description}</span>
                </div>
                <div className="widget-card-actions">
                  <button
                    className="mini-button"
                    type="button"
                    disabled={widgetIndex === 0}
                    aria-label={`上移${widget.title}`}
                    title="上移"
                    onClick={() => moveWidget(widget.id, -1)}
                  >
                    ↑
                  </button>
                  <button
                    className="mini-button"
                    type="button"
                    disabled={widgetIndex === widgets.length - 1}
                    aria-label={`下移${widget.title}`}
                    title="下移"
                    onClick={() => moveWidget(widget.id, 1)}
                  >
                    ↓
                  </button>
                  <button
                    className="mini-button"
                    type="button"
                    aria-label={`删除${widget.title}`}
                    title="删除"
                    onClick={() => deleteWidget(widget.id)}
                  >
                    ×
                  </button>
                </div>
              </div>
              <WidgetPreview widget={widget} />
            </article>
          )) : (
            <p className="widget-empty">暂无组件</p>
          )}
        </div>
      </section>
    </aside>
  );
}

function getAccountInitial(email?: string): string {
  const value = email?.trim();
  if (!value) {
    return "L";
  }

  return value.slice(0, 1).toUpperCase();
}

function WidgetPreview({ widget }: { widget: HomeWidget }) {
  if (widget.type === "todo.list") {
    const items = readTodoItems(widget.config);
    const completedCount = items.filter((item) => item.completed).length;

    return (
      <div className="widget-preview todo-preview">
        <div>
          <strong>{items.length}</strong>
          <span>任务</span>
        </div>
        <div>
          <strong>{completedCount}</strong>
          <span>完成</span>
        </div>
      </div>
    );
  }

  if (widget.type === "calendar.month") {
    const now = new Date();
    const monthLabel = new Intl.DateTimeFormat("zh-CN", {
      month: "long",
      year: "numeric"
    }).format(now);
    const dayLabel = new Intl.DateTimeFormat("zh-CN", {
      day: "2-digit",
      weekday: "short"
    }).format(now);

    return (
      <div className="widget-preview calendar-preview">
        <span>{monthLabel}</span>
        <strong>{dayLabel}</strong>
      </div>
    );
  }

  return null;
}

function readTodoItems(config: Record<string, unknown>): Array<{ completed: boolean }> {
  if (!Array.isArray(config.items)) {
    return [];
  }

  return config.items
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    .map((item) => ({ completed: Boolean(item.completed) }));
}
