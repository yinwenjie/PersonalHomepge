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
import { useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { requestConfirm } from "@/components/confirm-dialog";
import { createId, type HomeWidget } from "@/domain/home-document";
import {
  createTodoItem,
  getTodoStats,
  normalizeTodoTitle,
  readTodoItems,
  renumberTodoItems,
  type TodoItem
} from "@/domain/todo-widget";
import { useI18n } from "@/hooks/use-i18n";

interface TodoListWidgetProps {
  widget: HomeWidget;
  onUpdate: (widget: HomeWidget, message: string) => void;
}

type TodoFilter = "all" | "active" | "completed";

const TODO_FILTERS: TodoFilter[] = ["all", "active", "completed"];

const todoDragId = (itemId: string) => `todo:${itemId}`;

export function TodoListWidget({ widget, onUpdate }: TodoListWidgetProps) {
  const { t, format } = useI18n();
  const [newTitle, setNewTitle] = useState("");
  const [filter, setFilter] = useState<TodoFilter>("all");
  const [openMenuItemId, setOpenMenuItemId] = useState<string | null>(null);
  const [activeTodoId, setActiveTodoId] = useState<string | null>(null);
  const addInputRef = useRef<HTMLInputElement | null>(null);
  const items = useMemo(() => readTodoItems(widget.config), [widget.config]);
  const stats = useMemo(() => getTodoStats(items), [items]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const activeTodoItem = useMemo(() => items.find((item) => item.id === activeTodoId) ?? null, [activeTodoId, items]);
  const newTitleReady = Boolean(normalizeTodoTitle(newTitle));
  const visibleItems = useMemo(() => {
    if (filter === "active") {
      return items.filter((item) => !item.completed);
    }

    if (filter === "completed") {
      return items.filter((item) => item.completed);
    }

    return items;
  }, [filter, items]);

  function updateItems(nextItems: TodoItem[], message: string) {
    onUpdate({
      ...widget,
      config: {
        ...widget.config,
        items: renumberTodoItems(nextItems)
      }
    }, message);
  }

  function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const title = normalizeTodoTitle(newTitle);
    if (!title) {
      return;
    }

    updateItems([...items, createTodoItem(createId("todo"), title, items.length + 1)], t("todo.message.added"));
    setNewTitle("");
    addInputRef.current?.focus();
  }

  function toggleItem(itemId: string) {
    updateItems(items.map((item) => item.id === itemId
      ? { ...item, completed: !item.completed }
      : item), t("todo.message.updated"));
  }

  function renameItem(itemId: string, value: string) {
    const title = normalizeTodoTitle(value);
    const currentItem = items.find((item) => item.id === itemId);

    if (!currentItem || !title || title === currentItem.title) {
      return;
    }

    updateItems(items.map((item) => item.id === itemId ? { ...item, title } : item), t("todo.message.updated"));
  }

  function deleteItem(itemId: string) {
    updateItems(items.filter((item) => item.id !== itemId), t("todo.message.deleted"));
  }

  async function clearCompleted() {
    if (stats.completed === 0) {
      return;
    }

    if (!(await requestConfirm({
      message: t("todo.clearCompletedConfirm", { count: format.number(stats.completed) }),
      tone: "danger"
    }))) {
      return;
    }

    updateItems(items.filter((item) => !item.completed), t("todo.message.clearedCompleted"));
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveTodoId(readTodoIdFromDragId(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    const activeId = readTodoIdFromDragId(event.active.id);
    const overId = readTodoIdFromDragId(event.over?.id);

    setActiveTodoId(null);
    setOpenMenuItemId(null);

    if (!activeId || !overId || activeId === overId) {
      return;
    }

    const activeIndex = items.findIndex((item) => item.id === activeId);
    const overIndex = items.findIndex((item) => item.id === overId);

    if (activeIndex < 0 || overIndex < 0 || activeIndex === overIndex) {
      return;
    }

    updateItems(arrayMove(items, activeIndex, overIndex), t("todo.message.orderUpdated"));
  }

  function handleTitleKeyDown(event: KeyboardEvent<HTMLInputElement>, item: TodoItem) {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
      return;
    }

    if (event.key === "Escape") {
      event.currentTarget.value = item.title;
      event.currentTarget.blur();
    }
  }

  return (
    <div className="todo-widget">
      <form className="todo-add-form" onSubmit={handleAdd}>
        <input
          ref={addInputRef}
          className="todo-add-input"
          type="text"
          placeholder={t("todo.addPlaceholder")}
          aria-label={t("todo.addAria")}
          value={newTitle}
          maxLength={120}
          onChange={(event) => setNewTitle(event.target.value)}
        />
        <button
          className="todo-add-button"
          type="submit"
          disabled={!newTitleReady}
          aria-label={t("todo.addAria")}
          title={newTitleReady ? t("todo.addReadyTitle") : t("todo.addDisabledTitle")}
        >
          +
        </button>
      </form>

      <div className="todo-summary">
        <span>{t("todo.activeCount", { count: format.number(stats.active) })}</span>
        <span>{t("todo.completedCount", { count: format.number(stats.completed) })}</span>
        <span>{t("todo.totalCount", { count: format.number(stats.total) })}</span>
        {stats.completed > 0 ? (
          <button className="todo-clear-button" type="button" onClick={clearCompleted}>
            {t("todo.clearCompleted")}
          </button>
        ) : null}
      </div>

      {items.length > 0 ? (
        <div className="todo-filter-tabs" role="group" aria-label={t("todo.filterAria")}>
          {TODO_FILTERS.map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={filter === item}
              onClick={() => setFilter(item)}
            >
              {getTodoFilterLabel(item, t)}
            </button>
          ))}
        </div>
      ) : null}

      {visibleItems.length > 0 ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActiveTodoId(null)}
        >
          <SortableContext items={visibleItems.map((item) => todoDragId(item.id))} strategy={verticalListSortingStrategy}>
            <ul className="todo-items">
              {visibleItems.map((item) => (
                <SortableTodoItem
                  key={item.id}
                  item={item}
                  itemsLength={items.length}
                  menuOpen={openMenuItemId === item.id}
                  onToggleMenu={() => setOpenMenuItemId((current) => current === item.id ? null : item.id)}
                  onToggleItem={() => toggleItem(item.id)}
                  onRenameItem={(value) => renameItem(item.id, value)}
                  onDeleteItem={() => {
                    setOpenMenuItemId(null);
                    deleteItem(item.id);
                  }}
                  onTitleKeyDown={handleTitleKeyDown}
                />
              ))}
            </ul>
          </SortableContext>
          <DragOverlay>
            {activeTodoItem ? (
              <div className="todo-drag-overlay">{activeTodoItem.title}</div>
            ) : null}
          </DragOverlay>
        </DndContext>
      ) : (
        <p className="todo-empty">{getTodoEmptyMessage(items.length, filter, t)}</p>
      )}
    </div>
  );
}

function SortableTodoItem({
  item,
  itemsLength,
  menuOpen,
  onToggleMenu,
  onToggleItem,
  onRenameItem,
  onDeleteItem,
  onTitleKeyDown
}: {
  item: TodoItem;
  itemsLength: number;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onToggleItem: () => void;
  onRenameItem: (value: string) => void;
  onDeleteItem: () => void;
  onTitleKeyDown: (event: KeyboardEvent<HTMLInputElement>, item: TodoItem) => void;
}) {
  const { t } = useI18n();
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({
    id: todoDragId(item.id),
    data: { kind: "todo", itemId: item.id },
    disabled: itemsLength < 2
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition
  };

  return (
    <li
      ref={setNodeRef}
      className={[
        "todo-item",
        item.completed ? "is-completed" : "",
        menuOpen ? "has-open-menu" : "",
        isDragging ? "is-dragging" : ""
      ].filter(Boolean).join(" ")}
      style={style}
    >
      <label className="todo-checkbox">
        <input
          type="checkbox"
          checked={item.completed}
          aria-label={item.completed ? t("todo.markActiveAria", { title: item.title }) : t("todo.markCompletedAria", { title: item.title })}
          onChange={onToggleItem}
        />
        <span aria-hidden="true" />
      </label>
      <input
        key={`${item.id}-${item.title}`}
        className="todo-title-input"
        type="text"
        defaultValue={item.title}
        aria-label={t("todo.editTaskAria", { title: item.title })}
        maxLength={120}
        onBlur={(event) => {
          if (!normalizeTodoTitle(event.currentTarget.value)) {
            event.currentTarget.value = item.title;
          }
          onRenameItem(event.currentTarget.value);
        }}
        onKeyDown={(event) => onTitleKeyDown(event, item)}
      />
      <div className="todo-item-menu">
        <button
          className="todo-item-menu-button"
          type="button"
          aria-expanded={menuOpen}
          aria-label={t("todo.moreActionsAria", { title: item.title })}
          title={t("todo.moreActionsTitle")}
          onClick={onToggleMenu}
        >
          ⋯
        </button>
        {menuOpen ? (
          <div className="todo-item-menu-popover">
            <button
              ref={setActivatorNodeRef}
              className="todo-menu-action todo-menu-drag-action"
              type="button"
              disabled={itemsLength < 2}
              aria-label={t("todo.dragTaskAria", { title: item.title })}
              title={t("todo.dragTitle")}
              {...attributes}
              {...listeners}
            >
              {t("common.drag")}
            </button>
            <button
              className="todo-menu-action is-danger"
              type="button"
              aria-label={t("todo.deleteTaskAria", { title: item.title })}
              onClick={onDeleteItem}
            >
              {t("common.delete")}
            </button>
          </div>
        ) : null}
      </div>
    </li>
  );
}

function getTodoFilterLabel(filter: TodoFilter, t: ReturnType<typeof useI18n>["t"]): string {
  if (filter === "active") {
    return t("todo.filter.active");
  }

  if (filter === "completed") {
    return t("todo.filter.completed");
  }

  return t("todo.filter.all");
}

function getTodoEmptyMessage(totalItems: number, filter: TodoFilter, t: ReturnType<typeof useI18n>["t"]): string {
  if (totalItems === 0) {
    return t("todo.emptyInitial");
  }

  if (filter === "active") {
    return t("todo.emptyActive");
  }

  if (filter === "completed") {
    return t("todo.emptyCompleted");
  }

  return t("todo.empty");
}

function readTodoIdFromDragId(value: unknown): string | null {
  const id = String(value ?? "");
  return id.startsWith("todo:") ? id.slice("todo:".length) : null;
}
