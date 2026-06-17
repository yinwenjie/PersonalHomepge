import type { HomeWidgetType } from "@/domain/home-document";
import { normalizeTodoConfig } from "@/domain/todo-widget";

export interface WidgetDefinition {
  type: HomeWidgetType;
  title: string;
  defaultTitle: string;
  description: string;
  allowMultiple: boolean;
  defaultConfig: () => Record<string, unknown>;
  normalizeConfig: (input: unknown) => Record<string, unknown>;
}

export const WIDGET_DEFINITIONS: WidgetDefinition[] = [
  {
    type: "todo.list",
    title: "Todo",
    defaultTitle: "Todo",
    description: "轻量任务清单",
    allowMultiple: true,
    defaultConfig: () => ({ items: [] }),
    normalizeConfig: normalizeTodoConfig
  },
  {
    type: "calendar.month",
    title: "月历",
    defaultTitle: "月历",
    description: "当前月份概览",
    allowMultiple: false,
    defaultConfig: () => ({ weekStartsOn: 1 }),
    normalizeConfig: normalizeCalendarConfig
  }
];

export const WIDGET_REGISTRY: Record<HomeWidgetType, WidgetDefinition> = Object.fromEntries(
  WIDGET_DEFINITIONS.map((definition) => [definition.type, definition])
) as Record<HomeWidgetType, WidgetDefinition>;

export function isWidgetType(value: unknown): value is HomeWidgetType {
  return value === "calendar.month" || value === "todo.list";
}

export function getWidgetDefinition(type: HomeWidgetType): WidgetDefinition {
  return WIDGET_REGISTRY[type];
}

export function normalizeWidgetConfig(type: HomeWidgetType, input: unknown): Record<string, unknown> {
  return getWidgetDefinition(type).normalizeConfig(input);
}

function normalizeCalendarConfig(input: unknown): Record<string, unknown> {
  const weekStartsOn = isRecord(input) && Number(input.weekStartsOn) === 0 ? 0 : 1;
  return { weekStartsOn };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
