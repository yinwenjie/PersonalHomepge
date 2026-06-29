"use client";

import { type FormEvent, useMemo, useState } from "react";
import { normalizeCalendarConfig, type WeekStart } from "@/domain/calendar-widget";
import { normalizeText, type HomeWidget } from "@/domain/home-document";
import { getTodoStats, readTodoItems } from "@/domain/todo-widget";
import { getWidgetDefinition } from "@/domain/widget-registry";

interface WidgetConfigDialogProps {
  widget: HomeWidget;
  onCancel: () => void;
  onSave: (widget: HomeWidget) => void;
}

export function WidgetConfigDialog({ widget, onCancel, onSave }: WidgetConfigDialogProps) {
  const definition = getWidgetDefinition(widget.type);
  const dialogTitle = definition.settings?.title ?? "组件设置";
  const dialogDescription = definition.settings?.description ?? definition.description;
  const [titleDraft, setTitleDraft] = useState(widget.title);
  const [weekStartsOn, setWeekStartsOn] = useState<WeekStart>(() => normalizeCalendarConfig(widget.config).weekStartsOn);
  const todoStats = useMemo(() => {
    if (widget.type !== "todo.list") {
      return null;
    }

    return getTodoStats(readTodoItems(widget.config));
  }, [widget.config, widget.type]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const title = normalizeText(titleDraft) || definition.defaultTitle;
    const nextWidget: HomeWidget = {
      ...widget,
      title,
      config: widget.type === "calendar.month"
        ? {
          ...widget.config,
          weekStartsOn
        }
        : widget.config
    };

    onSave(nextWidget);
  }

  return (
    <div className="settings-modal" role="presentation">
      <form
        className="settings-dialog widget-config-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="widget-config-title"
        onSubmit={handleSubmit}
      >
        <div className="settings-dialog-header">
          <div>
            <h2 id="widget-config-title">{dialogTitle}</h2>
            <p>{definition.title} · {dialogDescription}</p>
          </div>
          <button className="mini-button" type="button" aria-label="关闭组件设置" title="关闭" onClick={onCancel}>
            ×
          </button>
        </div>

        <div className="settings-dialog-body">
          <label className="widget-config-field">
            <span>名称</span>
            <input
              type="text"
              value={titleDraft}
              maxLength={48}
              onChange={(event) => setTitleDraft(event.target.value)}
            />
          </label>

          <div className="widget-config-readonly-grid" aria-label="组件状态">
            <div>
              <span>类型</span>
              <strong>{definition.title}</strong>
            </div>
            <div>
              <span>折叠</span>
              <strong>{widget.layout.collapsed ? "是" : "否"}</strong>
            </div>
          </div>

          {todoStats ? (
            <section className="widget-config-section" aria-label="Todo 状态">
              <h3>任务状态</h3>
              <div className="widget-config-readonly-grid">
                <div>
                  <span>未完成</span>
                  <strong>{todoStats.active}</strong>
                </div>
                <div>
                  <span>已完成</span>
                  <strong>{todoStats.completed}</strong>
                </div>
                <div>
                  <span>总计</span>
                  <strong>{todoStats.total}</strong>
                </div>
              </div>
            </section>
          ) : null}

          {widget.type === "calendar.month" ? (
            <section className="widget-config-section" aria-label="月历设置">
              <h3>月历设置</h3>
              <div className="widget-config-option-row">
                <span>周起始</span>
                <div className="widget-config-segmented" role="group" aria-label="周起始">
                  <button
                    type="button"
                    aria-pressed={weekStartsOn === 1}
                    onClick={() => setWeekStartsOn(1)}
                  >
                    周一
                  </button>
                  <button
                    type="button"
                    aria-pressed={weekStartsOn === 0}
                    onClick={() => setWeekStartsOn(0)}
                  >
                    周日
                  </button>
                </div>
              </div>
            </section>
          ) : null}
        </div>

        <div className="settings-dialog-footer">
          <button className="utility-button" type="button" onClick={onCancel}>
            取消
          </button>
          <button className="utility-button" type="submit">
            保存
          </button>
        </div>
      </form>
    </div>
  );
}
