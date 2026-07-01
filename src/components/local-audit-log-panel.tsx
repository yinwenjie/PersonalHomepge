"use client";

import { useEffect, useMemo, useState } from "react";
import { resolveLocalePreference, type LocalePreference } from "@/domain/ui-preferences";
import { StatusMessage } from "@/components/status-message";
import { useUiPreferences } from "@/hooks/use-ui-preferences";
import {
  LOCAL_AUDIT_LOG_UPDATED_EVENT,
  LocalAuditLogRepository,
  type LocalAuditEvent
} from "@/infrastructure/local-audit-log-repository";

const VISIBLE_EVENT_COUNT = 10;

export function LocalAuditLogPanel() {
  const { preferences } = useUiPreferences();
  const [events, setEvents] = useState<LocalAuditEvent[]>([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    function refreshEvents() {
      setEvents(loadEvents());
    }

    refreshEvents();
    window.addEventListener(LOCAL_AUDIT_LOG_UPDATED_EVENT, refreshEvents);

    return () => window.removeEventListener(LOCAL_AUDIT_LOG_UPDATED_EVENT, refreshEvents);
  }, []);

  const visibleEvents = useMemo(() => events.slice(0, VISIBLE_EVENT_COUNT), [events]);

  function clearEvents() {
    if (!window.confirm("清空本机审计日志？这只影响当前浏览器。")) {
      return;
    }

    try {
      new LocalAuditLogRepository(window.localStorage).clear();
      setEvents([]);
      setMessage("本机审计日志已清空。");
    } catch {
      setMessage("清空失败，请稍后重试。");
    }
  }

  return (
    <div className="advanced-operation-block">
      <div className="advanced-operation-head">
        <h3>本地审计日志</h3>
        <span>Audit</span>
      </div>
      {visibleEvents.length > 0 ? (
        <div className="audit-log-list">
          {visibleEvents.map((event) => (
            <article className={`audit-log-item audit-log-item-${event.level}`} key={event.id}>
              <div>
                <strong>{event.message}</strong>
                <span>{formatAuditMeta(event)}</span>
              </div>
              <time>{formatDateTime(event.createdAt, preferences.locale)}</time>
            </article>
          ))}
        </div>
      ) : (
        <StatusMessage tone={message ? "success" : "neutral"}>
          {message || "当前浏览器暂无本地审计事件。"}
        </StatusMessage>
      )}
      <div className="settings-actions">
        <button className="utility-button" type="button" onClick={() => setEvents(loadEvents())}>刷新</button>
        <button className="danger-button" type="button" onClick={clearEvents} disabled={events.length === 0}>清空</button>
      </div>
    </div>
  );
}

function loadEvents(): LocalAuditEvent[] {
  try {
    return new LocalAuditLogRepository(window.localStorage).load();
  } catch {
    return [];
  }
}

function formatAuditMeta(event: LocalAuditEvent): string {
  const parts = [
    event.type,
    event.spaceId ? `space ${event.spaceId.slice(0, 8)}` : "",
    event.documentId ? `doc ${event.documentId.slice(0, 12)}` : ""
  ].filter(Boolean);

  return parts.join(" · ");
}

function formatDateTime(value: string, locale: LocalePreference): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "未知";
  }

  return new Intl.DateTimeFormat(resolveLocalePreference(locale), {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}
