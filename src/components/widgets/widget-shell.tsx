"use client";

import { type CSSProperties, type FormEvent, type ReactNode, useState } from "react";
import { normalizeText } from "@/domain/home-document";

interface WidgetShellProps {
  title: string;
  defaultTitle: string;
  description: string;
  manageMode: boolean;
  collapsed: boolean;
  widgetIndex: number;
  widgetsLength: number;
  collapsedSummary: string;
  children: ReactNode;
  dragHandle?: ReactNode;
  isDragging?: boolean;
  articleRef?: (node: HTMLElement | null) => void;
  style?: CSSProperties;
  onRenameTitle: (title: string) => void;
  onOpenSettings: () => void;
  onToggleCollapsed: () => void;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
}

export function WidgetShell({
  title,
  defaultTitle,
  description,
  manageMode,
  collapsed,
  widgetIndex,
  widgetsLength,
  collapsedSummary,
  children,
  dragHandle,
  isDragging = false,
  articleRef,
  style,
  onRenameTitle,
  onOpenSettings,
  onToggleCollapsed,
  onMove,
  onDelete
}: WidgetShellProps) {
  const [titleDraftState, setTitleDraftState] = useState({
    sourceTitle: title,
    value: title
  });
  const titleDraft = titleDraftState.sourceTitle === title ? titleDraftState.value : title;

  function commitTitle() {
    const nextTitle = normalizeText(titleDraft) || defaultTitle;

    setTitleDraftState({
      sourceTitle: nextTitle,
      value: nextTitle
    });
    onRenameTitle(nextTitle);
  }

  function handleTitleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    event.currentTarget.querySelector("input")?.blur();
  }

  return (
    <article
      ref={articleRef}
      className={[
        "widget-card",
        manageMode ? "is-managing" : "",
        collapsed ? "is-collapsed" : "",
        isDragging ? "is-dragging" : ""
      ].filter(Boolean).join(" ")}
      style={style}
    >
      <div className="widget-card-head">
        {manageMode ? dragHandle : null}
        <div className="widget-card-copy">
          {manageMode ? (
            <form className="widget-title-form" onSubmit={handleTitleSubmit}>
              <input
                className="widget-title-input"
                value={titleDraft}
                aria-label={`${title}标题`}
                onBlur={commitTitle}
                onChange={(event) => setTitleDraftState({
                  sourceTitle: title,
                  value: event.target.value
                })}
              />
            </form>
          ) : (
            <strong title={title}>{title}</strong>
          )}
          <span title={description}>{description}</span>
        </div>
        <div className="widget-card-actions">
          {!manageMode ? (
            <button
              className="mini-button widget-shell-settings-action"
              type="button"
              aria-label={`配置${title}`}
              title="设置"
              onClick={onOpenSettings}
            >
              ⚙
            </button>
          ) : null}
          <button
            className="mini-button widget-shell-primary-action"
            type="button"
            aria-expanded={!collapsed}
            aria-label={collapsed ? `展开${title}` : `折叠${title}`}
            title={collapsed ? "展开" : "折叠"}
            onClick={onToggleCollapsed}
          >
            {collapsed ? "▾" : "▴"}
          </button>
          {manageMode ? (
            <span className="widget-shell-management-actions">
              <button
                className="mini-button"
                type="button"
                disabled={widgetIndex === 0}
                aria-label={`上移${title}`}
                title="上移"
                onClick={() => onMove(-1)}
              >
                ↑
              </button>
              <button
                className="mini-button"
                type="button"
                disabled={widgetIndex === widgetsLength - 1}
                aria-label={`下移${title}`}
                title="下移"
                onClick={() => onMove(1)}
              >
                ↓
              </button>
              <button
                className="mini-button"
                type="button"
                aria-label={`删除${title}`}
                title="删除"
                onClick={onDelete}
              >
                ×
              </button>
            </span>
          ) : null}
        </div>
      </div>
      {collapsed ? (
        <p className="widget-collapsed-summary">{collapsedSummary}</p>
      ) : (
        children
      )}
    </article>
  );
}
