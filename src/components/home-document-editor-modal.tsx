"use client";

import type { FormEvent } from "react";
import type { EditorState, FormValues } from "@/hooks/use-home-document-editor";
import { useI18n } from "@/hooks/use-i18n";

interface HomeDocumentEditorModalProps {
  editor: EditorState;
  formValues: FormValues;
  formError: string;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onUpdateFormValue: (field: keyof FormValues, value: string) => void;
  onDeleteSite: (groupId: string, siteId: string) => Promise<boolean>;
}

export function HomeDocumentEditorModal({
  editor,
  formValues,
  formError,
  onClose,
  onSubmit,
  onUpdateFormValue,
  onDeleteSite
}: HomeDocumentEditorModalProps) {
  const { t } = useI18n();

  return (
    <div className="editor-modal">
      <form className="editor-card" onSubmit={onSubmit}>
        <div className="editor-header">
          <h2 className="editor-title">{getEditorTitle(editor, t)}</h2>
          <button className="mini-button" type="button" onClick={onClose} aria-label={t("common.close")}>×</button>
        </div>
        <div className="editor-body">
          {editor.kind === "group" ? (
            <>
              <label className="field">
                <span>{t("editor.groupName")}</span>
                <input value={formValues.groupTitle} onChange={(event) => onUpdateFormValue("groupTitle", event.target.value)} autoFocus />
              </label>
              <label className="field">
                <span>{t("editor.groupKeywords")}</span>
                <input value={formValues.groupKeywords} onChange={(event) => onUpdateFormValue("groupKeywords", event.target.value)} />
              </label>
            </>
          ) : (
            <>
              <label className="field">
                <span>{t("editor.siteName")}</span>
                <input value={formValues.siteName} onChange={(event) => onUpdateFormValue("siteName", event.target.value)} autoFocus />
              </label>
              <label className="field">
                <span>{t("editor.siteUrl")}</span>
                <input value={formValues.siteUrl} onChange={(event) => onUpdateFormValue("siteUrl", event.target.value)} inputMode="url" />
              </label>
              <label className="field">
                <span>{t("editor.siteKeywords")}</span>
                <input value={formValues.siteKeywords} onChange={(event) => onUpdateFormValue("siteKeywords", event.target.value)} />
              </label>
              <label className="field">
                <span>{t("editor.siteMark")}</span>
                <input value={formValues.siteMark} onChange={(event) => onUpdateFormValue("siteMark", event.target.value)} maxLength={3} />
              </label>
            </>
          )}
          <p className="form-error">{formError}</p>
        </div>
        <div className="editor-footer">
          {editor.kind === "site" && editor.mode === "edit" ? (
            <button
              className="danger-button"
              type="button"
              onClick={async () => {
                if (await onDeleteSite(editor.groupId, editor.siteId)) {
                  onClose();
                }
              }}
            >
              {t("common.delete")}
            </button>
          ) : <span />}
          <div className="editor-footer-actions">
            <button className="utility-button" type="button" onClick={onClose}>{t("common.cancel")}</button>
            <button className="utility-button" type="submit">{t("common.save")}</button>
          </div>
        </div>
      </form>
    </div>
  );
}

function getEditorTitle(editor: EditorState, t: ReturnType<typeof useI18n>["t"]): string {
  if (editor.kind === "group") {
    return editor.mode === "add" ? t("editor.addGroupTitle") : t("editor.editGroupTitle");
  }

  return editor.mode === "add" ? t("editor.addSiteTitle") : t("editor.editSiteTitle");
}
