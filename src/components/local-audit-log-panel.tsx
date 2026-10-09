"use client";

import { useEffect, useMemo, useState } from "react";
import { requestConfirm } from "@/components/confirm-dialog";
import { StatusMessage } from "@/components/status-message";
import { useI18n } from "@/hooks/use-i18n";
import type { I18nTranslate } from "@/i18n/messages";
import {
  LOCAL_AUDIT_LOG_UPDATED_EVENT,
  LocalAuditLogRepository,
  type LocalAuditEvent
} from "@/infrastructure/local-audit-log-repository";

const VISIBLE_EVENT_COUNT = 10;

export function LocalAuditLogPanel() {
  const { format, t } = useI18n();
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

  async function clearEvents() {
    if (!(await requestConfirm({ message: t("settings.audit.clearConfirm"), tone: "danger" }))) {
      return;
    }

    try {
      new LocalAuditLogRepository(window.localStorage).clear();
      setEvents([]);
      setMessage(t("settings.audit.cleared"));
    } catch {
      setMessage(t("settings.audit.clearFailed"));
    }
  }

  return (
    <div className="advanced-operation-block">
      <div className="advanced-operation-head">
        <h3>{t("settings.audit.title")}</h3>
        <span>{t("settings.audit.kicker")}</span>
      </div>
      {visibleEvents.length > 0 ? (
        <div className="audit-log-list">
          {visibleEvents.map((event) => (
            <article className={`audit-log-item audit-log-item-${event.level}`} key={event.id}>
              <div>
                <strong>{event.message}</strong>
                <span>{formatAuditMeta(event, t)}</span>
              </div>
              <time>{format.shortDateTime(event.createdAt)}</time>
            </article>
          ))}
        </div>
      ) : (
        <StatusMessage tone={message ? "success" : "neutral"}>
          {message || t("settings.audit.empty")}
        </StatusMessage>
      )}
      <div className="settings-actions">
        <button className="utility-button" type="button" onClick={() => setEvents(loadEvents())}>{t("settings.audit.refresh")}</button>
        <button className="danger-button" type="button" onClick={clearEvents} disabled={events.length === 0}>{t("settings.audit.clear")}</button>
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

function formatAuditMeta(event: LocalAuditEvent, t: I18nTranslate): string {
  const parts = [
    event.type,
    event.spaceId ? t("settings.audit.spaceId", { id: event.spaceId.slice(0, 8) }) : "",
    event.documentId ? t("settings.audit.documentId", { id: event.documentId.slice(0, 12) }) : ""
  ].filter(Boolean);

  return parts.join(" · ");
}
