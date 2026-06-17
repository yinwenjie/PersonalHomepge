export interface TodoItem {
  id: string;
  title: string;
  completed: boolean;
  order: number;
}

export interface TodoWidgetConfig extends Record<string, unknown> {
  items: TodoItem[];
}

export function createTodoItem(id: string, title: string, order: number): TodoItem {
  return {
    id,
    title: normalizeTodoTitle(title),
    completed: false,
    order
  };
}

export function normalizeTodoConfig(input: unknown): TodoWidgetConfig {
  const items = isRecord(input) && Array.isArray(input.items)
    ? input.items
      .filter(isRecord)
      .map((item, index) => ({
        id: readString(item.id) || `todo-${index + 1}`,
        title: normalizeTodoTitle(item.title),
        completed: Boolean(item.completed),
        order: Number.isFinite(Number(item.order)) ? Number(item.order) : index + 1
      }))
      .filter((item) => item.title)
    : [];

  return {
    items: renumberTodoItems(items)
  };
}

export function readTodoItems(config: Record<string, unknown>): TodoItem[] {
  return normalizeTodoConfig(config).items;
}

export function renumberTodoItems(items: TodoItem[]): TodoItem[] {
  return [...items]
    .sort((a, b) => a.order - b.order)
    .map((item, index) => ({
      ...item,
      order: index + 1
    }));
}

export function normalizeTodoTitle(value: unknown): string {
  return readString(value).replace(/\s+/g, " ").slice(0, 120);
}

export function getTodoStats(items: TodoItem[]) {
  const total = items.length;
  const completed = items.filter((item) => item.completed).length;

  return {
    total,
    completed,
    active: total - completed
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
