"use client";

import { useMemo, useState } from "react";
import { type HomeWidget } from "@/domain/home-document";
import {
  addMonths,
  buildCalendarMonth,
  getMonthLabel,
  isSameMonth,
  normalizeCalendarConfig,
  startOfMonth
} from "@/domain/calendar-widget";

interface CalendarMonthWidgetProps {
  widget: HomeWidget;
}

export function CalendarMonthWidget({ widget }: CalendarMonthWidgetProps) {
  const config = useMemo(() => normalizeCalendarConfig(widget.config), [widget.config]);
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(new Date()));
  const today = new Date();
  const todayMonth = startOfMonth(today);
  const calendar = useMemo(() => buildCalendarMonth(visibleMonth, config.weekStartsOn), [config.weekStartsOn, visibleMonth]);
  const viewingCurrentMonth = isSameMonth(visibleMonth, todayMonth);
  const previousMonthLabel = getMonthLabel(addMonths(visibleMonth, -1));
  const nextMonthLabel = getMonthLabel(addMonths(visibleMonth, 1));
  const todayLabel = `${today.getMonth() + 1}月${today.getDate()}日`;

  return (
    <div className="calendar-widget">
      <div className="calendar-header">
        <button
          className="calendar-nav-button"
          type="button"
          aria-label={`查看${previousMonthLabel}`}
          title="上个月"
          onClick={() => setVisibleMonth((current) => addMonths(current, -1))}
        >
          ‹
        </button>
        <div className="calendar-month-heading">
          <strong>{calendar.label}</strong>
          <span>{viewingCurrentMonth ? `今日 ${todayLabel}` : `今天 ${todayLabel}`}</span>
        </div>
        <button
          className="calendar-nav-button"
          type="button"
          aria-label={`查看${nextMonthLabel}`}
          title="下个月"
          onClick={() => setVisibleMonth((current) => addMonths(current, 1))}
        >
          ›
        </button>
      </div>

      <div className="calendar-control-row">
        <button
          className={["calendar-today-button", viewingCurrentMonth ? "is-current" : ""].filter(Boolean).join(" ")}
          type="button"
          disabled={viewingCurrentMonth}
          title={viewingCurrentMonth ? "正在查看本月" : "回到今天"}
          onClick={() => setVisibleMonth(todayMonth)}
        >
          回今天
        </button>
        <span className="calendar-config-summary">
          {config.weekStartsOn === 1 ? "周一开始" : "周日开始"}
        </span>
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
              day.isToday ? "is-today" : "",
              day.isWeekend ? "is-weekend" : ""
            ].filter(Boolean).join(" ")}
            key={day.key}
            dateTime={day.key}
            aria-current={day.isToday ? "date" : undefined}
            title={`${day.key}${day.isToday ? " 今天" : ""}`}
          >
            {day.day}
          </time>
        ))}
      </div>
    </div>
  );
}
