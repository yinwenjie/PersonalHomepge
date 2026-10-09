"use client";

import { useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { requestConfirm } from "@/components/confirm-dialog";
import { createId, type HomeWidget } from "@/domain/home-document";
import {
  createNoteItem,
  getNotesStats,
  NOTES_WIDGET_MAX_ITEMS,
  NOTES_WIDGET_MAX_TEXT_LENGTH,
  normalizeNoteText,
  readNoteItems,
  renumberNoteItems,
  type NoteItem
} from "@/domain/notes-widget";
import { useI18n } from "@/hooks/use-i18n";

interface NotesListWidgetProps {
  widget: HomeWidget;
  onUpdate: (widget: HomeWidget, message: string) => void;
}

export function NotesListWidget({ widget, onUpdate }: NotesListWidgetProps) {
  const { t, format } = useI18n();
  const [newText, setNewText] = useState("");
  const addInputRef = useRef<HTMLTextAreaElement | null>(null);
  const notes = useMemo(() => readNoteItems(widget.config), [widget.config]);
  const stats = useMemo(() => getNotesStats(notes), [notes]);
  const noteReady = Boolean(normalizeNoteText(newText));
  const noteLimitReached = notes.length >= NOTES_WIDGET_MAX_ITEMS;

  function updateNotes(nextNotes: NoteItem[], message: string) {
    onUpdate({
      ...widget,
      config: {
        ...widget.config,
        notes: renumberNoteItems(nextNotes)
      }
    }, message);
  }

  function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const text = normalizeNoteText(newText);
    if (!text || noteLimitReached) {
      return;
    }

    updateNotes([...notes, createNoteItem(createId("note"), text, notes.length + 1)], t("notes.message.added"));
    setNewText("");
    addInputRef.current?.focus();
  }

  function renameNote(noteId: string, value: string) {
    const text = normalizeNoteText(value);
    const currentNote = notes.find((note) => note.id === noteId);

    if (!currentNote) {
      return;
    }

    if (!text) {
      updateNotes(notes.filter((note) => note.id !== noteId), t("notes.message.deleted"));
      return;
    }

    if (text === currentNote.text) {
      return;
    }

    updateNotes(notes.map((note) => note.id === noteId
      ? {
        ...note,
        text,
        updatedAt: new Date().toISOString()
      }
      : note), t("notes.message.updated"));
  }

  async function deleteNote(noteId: string) {
    if (!(await requestConfirm({ message: t("notes.deleteConfirm"), confirmLabel: t("common.delete"), tone: "danger" }))) {
      return;
    }

    updateNotes(notes.filter((note) => note.id !== noteId), t("notes.message.deleted"));
  }

  function moveNote(noteId: string, direction: -1 | 1) {
    const currentIndex = notes.findIndex((note) => note.id === noteId);
    const targetIndex = currentIndex + direction;

    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= notes.length) {
      return;
    }

    const nextNotes = [...notes];
    const [currentNote] = nextNotes.splice(currentIndex, 1);
    nextNotes.splice(targetIndex, 0, currentNote);
    updateNotes(nextNotes, t("notes.message.orderUpdated"));
  }

  return (
    <div className="notes-widget">
      <form className="notes-add-form" onSubmit={handleAdd}>
        <textarea
          ref={addInputRef}
          className="notes-add-input"
          placeholder={noteLimitReached ? t("notes.limitReached") : t("notes.addPlaceholder")}
          aria-label={t("notes.addAria")}
          value={newText}
          maxLength={NOTES_WIDGET_MAX_TEXT_LENGTH}
          rows={3}
          disabled={noteLimitReached}
          onChange={(event) => setNewText(event.target.value)}
        />
        <div className="notes-add-meta">
          <span>{t("notes.count", { count: format.number(stats.total), max: format.number(NOTES_WIDGET_MAX_ITEMS) })}</span>
          <span>{t("notes.characters", { count: format.number(normalizeNoteText(newText).length), max: format.number(NOTES_WIDGET_MAX_TEXT_LENGTH) })}</span>
        </div>
        <button
          className="notes-add-button"
          type="submit"
          disabled={!noteReady || noteLimitReached}
          title={noteLimitReached ? t("notes.limitReached") : noteReady ? t("notes.addReadyTitle") : t("notes.addDisabledTitle")}
        >
          {t("notes.add")}
        </button>
      </form>

      {notes.length > 0 ? (
        <ul className="notes-list">
          {notes.map((note, noteIndex) => (
            <NoteListItem
              key={note.id}
              note={note}
              noteIndex={noteIndex}
              notesLength={notes.length}
              onDelete={() => deleteNote(note.id)}
              onMove={(direction) => moveNote(note.id, direction)}
              onRename={(value) => renameNote(note.id, value)}
            />
          ))}
        </ul>
      ) : (
        <p className="notes-empty">{t("notes.emptyInitial")}</p>
      )}
    </div>
  );
}

function NoteListItem({
  note,
  noteIndex,
  notesLength,
  onDelete,
  onMove,
  onRename
}: {
  note: NoteItem;
  noteIndex: number;
  notesLength: number;
  onDelete: () => void;
  onMove: (direction: -1 | 1) => void;
  onRename: (value: string) => void;
}) {
  const { t } = useI18n();

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape") {
      event.currentTarget.value = note.text;
      event.currentTarget.blur();
    }
  }

  return (
    <li className="notes-item">
      <textarea
        key={`${note.id}-${note.text}`}
        className="notes-item-input"
        defaultValue={note.text}
        aria-label={t("notes.editAria")}
        maxLength={NOTES_WIDGET_MAX_TEXT_LENGTH}
        rows={3}
        onBlur={(event) => {
          if (!normalizeNoteText(event.currentTarget.value)) {
            event.currentTarget.value = note.text;
          }
          onRename(event.currentTarget.value);
        }}
        onKeyDown={handleKeyDown}
      />
      <div className="notes-item-actions">
        <button
          className="notes-item-action"
          type="button"
          disabled={noteIndex === 0}
          aria-label={t("notes.moveUpAria")}
          title={t("notes.moveUpTitle")}
          onClick={() => onMove(-1)}
        >
          ↑
        </button>
        <button
          className="notes-item-action"
          type="button"
          disabled={noteIndex === notesLength - 1}
          aria-label={t("notes.moveDownAria")}
          title={t("notes.moveDownTitle")}
          onClick={() => onMove(1)}
        >
          ↓
        </button>
        <button
          className="notes-item-action is-danger"
          type="button"
          aria-label={t("notes.deleteAria")}
          title={t("common.delete")}
          onClick={onDelete}
        >
          ×
        </button>
      </div>
    </li>
  );
}
