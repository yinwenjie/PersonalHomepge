"use client";

import type { FormEvent } from "react";
import type { EditorState, FormValues } from "@/hooks/use-home-document-editor";

interface HomeDocumentEditorModalProps {
  editor: EditorState;
  formValues: FormValues;
  formError: string;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onUpdateFormValue: (field: keyof FormValues, value: string) => void;
  onDeleteSite: (groupId: string, siteId: string) => boolean;
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
  return (
    <div className="editor-modal">
      <form className="editor-card" onSubmit={onSubmit}>
        <div className="editor-header">
          <h2 className="editor-title">{getEditorTitle(editor)}</h2>
          <button className="mini-button" type="button" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <div className="editor-body">
          {editor.kind === "group" ? (
            <>
              <label className="field">
                <span>分组名称</span>
                <input value={formValues.groupTitle} onChange={(event) => onUpdateFormValue("groupTitle", event.target.value)} autoFocus />
              </label>
              <label className="field">
                <span>分组关键词</span>
                <input value={formValues.groupKeywords} onChange={(event) => onUpdateFormValue("groupKeywords", event.target.value)} />
              </label>
            </>
          ) : (
            <>
              <label className="field">
                <span>网站名称</span>
                <input value={formValues.siteName} onChange={(event) => onUpdateFormValue("siteName", event.target.value)} autoFocus />
              </label>
              <label className="field">
                <span>网站 URL</span>
                <input value={formValues.siteUrl} onChange={(event) => onUpdateFormValue("siteUrl", event.target.value)} inputMode="url" />
              </label>
              <label className="field">
                <span>网站关键词</span>
                <input value={formValues.siteKeywords} onChange={(event) => onUpdateFormValue("siteKeywords", event.target.value)} />
              </label>
              <label className="field">
                <span>图标文字</span>
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
              onClick={() => {
                if (onDeleteSite(editor.groupId, editor.siteId)) {
                  onClose();
                }
              }}
            >
              删除
            </button>
          ) : <span />}
          <div className="editor-footer-actions">
            <button className="utility-button" type="button" onClick={onClose}>取消</button>
            <button className="utility-button" type="submit">保存</button>
          </div>
        </div>
      </form>
    </div>
  );
}

function getEditorTitle(editor: EditorState): string {
  if (editor.kind === "group") {
    return editor.mode === "add" ? "新增分组" : "编辑分组";
  }

  return editor.mode === "add" ? "新增网站" : "编辑网站";
}
