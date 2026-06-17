"use client";

import { useMemo, useState } from "react";
import { type HomeWidget } from "@/domain/home-document";
import {
  addMonths,
  buildCalendarMonth,
  isSameMonth,
  normalizeCalendarConfig,
  startOfMonth,
  type WeekStart
} from "@/domain/calendar-widget";

interface CalendarMonthWidgetProps {
  widget: HomeWidget;
  onUpdate: (widget: HomeWidget, message: string) => void;
}

export function CalendarMonthWidget({ widget, onUpdate }: CalendarMonthWidgetProps) {
  const config = useMemo(() => normalizeCalendarConfig(widget.config), [widget.config]);
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(new Date()));
  const todayMonth = startOfMonth(new Date());
  const calendar = useMemo(() => buildCalendarMonth(visibleMonth, config.weekStartsOn), [config.weekStartsOn, visibleMonth]);
  const viewingCurrentMonth = isSameMonth(visibleMonth, todayMonth);

  function updateWeekStart(weekStartsOn: WeekStart) {
    if (weekStartsOn === config.weekStartsOn) {
      return;
    }

    onUpdate({
      ...widget,
      config: {
        ...widget.config,
        weekStartsOn
      }
    }, "月历设置已更新");
  }

  return (
    <div className="calendar-widget">
      <div className="calendar-toolbar">
        <button className="mini-button" type="button" aria-label="上个月" title="上个月" onClick={() => setVisibleMonth((current) => addMonths(current, -1))}>
          ←
        </button>
        <strong>{calendar.label}</strong>
        <button className="mini-button" type="button" aria-label="下个月" title="下个月" onClick={() => setVisibleMonth((current) => addMonths(current, 1))}>
          →
        </button>
      </div>

      <div className="calendar-controls">
        <button
          className="calendar-today-button"
          type="button"
          disabled={viewingCurrentMonth}
          onClick={() => setVisibleMonth(todayMonth)}
        >
          今天
        </button>
        <div className="calendar-week-start" aria-label="周起始">
          <button
            type="button"
            aria-pressed={config.weekStartsOn === 1}
            onClick={() => updateWeekStart(1)}
          >
            一
          </button>
          <button
            type="button"
            aria-pressed={config.weekStartsOn === 0}
            onClick={() => updateWeekStart(0)}
          >
            日
          </button>
        </div>
      </div>

      <div className="calendar-grid" aria-label={`${calendar.label}月历`}>
        {calendar.weekLabels.map((label) => (
          <span className="calendar-weekday" key={label}>{label}</span>
        ))}
        {calendar.days.map((day) => (
          <time
            className={[
              "calendar-day",
              day.inCurrentMonth ? "" : "is-muted",
              day.isToday ? "is-today" : ""
            ].filter(Boolean).join(" ")}
            key={day.key}
            dateTime={day.key}
          >
            {day.day}
          </time>
        ))}
      </div>
    </div>
  );
}
