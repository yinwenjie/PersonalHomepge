"use client";

import { useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import { createId, type HomeWidget } from "@/domain/home-document";
import {
  createTodoItem,
  getTodoStats,
  normalizeTodoTitle,
  readTodoItems,
  renumberTodoItems,
  type TodoItem
} from "@/domain/todo-widget";

interface TodoListWidgetProps {
  widget: HomeWidget;
  onUpdate: (widget: HomeWidget, message: string) => void;
}

export function TodoListWidget({ widget, onUpdate }: TodoListWidgetProps) {
  const [newTitle, setNewTitle] = useState("");
  const items = useMemo(() => readTodoItems(widget.config), [widget.config]);
  const stats = useMemo(() => getTodoStats(items), [items]);

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

    updateItems([...items, createTodoItem(createId("todo"), title, items.length + 1)], "任务已添加");
    setNewTitle("");
  }

  function toggleItem(itemId: string) {
    updateItems(items.map((item) => item.id === itemId
      ? { ...item, completed: !item.completed }
      : item), "任务已更新");
  }

  function renameItem(itemId: string, value: string) {
    const title = normalizeTodoTitle(value);
    const currentItem = items.find((item) => item.id === itemId);

    if (!currentItem || !title || title === currentItem.title) {
      return;
    }

    updateItems(items.map((item) => item.id === itemId ? { ...item, title } : item), "任务已更新");
  }

  function deleteItem(itemId: string) {
    updateItems(items.filter((item) => item.id !== itemId), "任务已删除");
  }

  function moveItem(itemId: string, direction: -1 | 1) {
    const itemIndex = items.findIndex((item) => item.id === itemId);
    const targetIndex = itemIndex + direction;

    if (itemIndex < 0 || targetIndex < 0 || targetIndex >= items.length) {
      return;
    }

    const nextItems = [...items];
    const currentItem = nextItems[itemIndex];
    const targetItem = nextItems[targetIndex];

    nextItems[itemIndex] = targetItem;
    nextItems[targetIndex] = currentItem;
    updateItems(nextItems, "任务顺序已更新");
  }

  function clearCompleted() {
    if (stats.completed === 0) {
      return;
    }

    if (!window.confirm(`清除 ${stats.completed} 个已完成任务？`)) {
      return;
    }

    updateItems(items.filter((item) => !item.completed), "已清除完成任务");
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
          className="todo-add-input"
          type="text"
          placeholder="添加任务"
          aria-label="添加任务"
          value={newTitle}
          maxLength={120}
          onChange={(event) => setNewTitle(event.target.value)}
        />
        <button className="todo-add-button" type="submit" aria-label="添加任务" title="添加任务">
          +
        </button>
      </form>

      <div className="todo-summary">
        <span>{stats.active} 未完成</span>
        <span>{stats.total} 总计</span>
        {stats.completed > 0 ? (
          <button className="todo-clear-button" type="button" onClick={clearCompleted}>
            清除完成
          </button>
        ) : null}
      </div>

      {items.length > 0 ? (
        <ul className="todo-items">
          {items.map((item, itemIndex) => (
            <li className={item.completed ? "todo-item is-completed" : "todo-item"} key={item.id}>
              <label className="todo-checkbox">
                <input
                  type="checkbox"
                  checked={item.completed}
                  aria-label={item.completed ? `标记 ${item.title} 为未完成` : `完成 ${item.title}`}
                  onChange={() => toggleItem(item.id)}
                />
                <span aria-hidden="true" />
              </label>
              <input
                key={`${item.id}-${item.title}`}
                className="todo-title-input"
                type="text"
                defaultValue={item.title}
                aria-label={`编辑任务 ${item.title}`}
                maxLength={120}
                onBlur={(event) => {
                  if (!normalizeTodoTitle(event.currentTarget.value)) {
                    event.currentTarget.value = item.title;
                  }
                  renameItem(item.id, event.currentTarget.value);
                }}
                onKeyDown={(event) => handleTitleKeyDown(event, item)}
              />
              <div className="todo-item-actions">
                <button
                  className="mini-button"
                  type="button"
                  disabled={itemIndex === 0}
                  aria-label={`上移${item.title}`}
                  title="上移"
                  onClick={() => moveItem(item.id, -1)}
                >
                  ↑
                </button>
                <button
                  className="mini-button"
                  type="button"
                  disabled={itemIndex === items.length - 1}
                  aria-label={`下移${item.title}`}
                  title="下移"
                  onClick={() => moveItem(item.id, 1)}
                >
                  ↓
                </button>
                <button
                  className="mini-button"
                  type="button"
                  aria-label={`删除${item.title}`}
                  title="删除"
                  onClick={() => deleteItem(item.id)}
                >
                  ×
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="todo-empty">暂无任务</p>
      )}
    </div>
  );
}
