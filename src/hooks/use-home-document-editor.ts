"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import {
  createId,
  generateMark,
  HomeDocumentV2,
  HomeGroup,
  HomeSite,
  isValidUrl,
  normalizeText,
  normalizeUrl,
  renumberGroups,
  renumberSites,
  sortByOrder
} from "@/domain/home-document";
import { trackProductEvent } from "@/infrastructure/product-analytics-repository";

export type EditorState =
  | { kind: "group"; mode: "add" }
  | { kind: "group"; mode: "edit"; groupId: string }
  | { kind: "site"; mode: "add"; groupId: string }
  | { kind: "site"; mode: "edit"; groupId: string; siteId: string };

export interface FormValues {
  groupTitle: string;
  groupKeywords: string;
  siteName: string;
  siteUrl: string;
  siteKeywords: string;
  siteMark: string;
}

interface UseHomeDocumentEditorOptions {
  homeDocument: HomeDocumentV2;
  commitHomeDocument: (nextDocument: HomeDocumentV2, message?: string) => void;
}

const EMPTY_FORM_VALUES: FormValues = {
  groupTitle: "",
  groupKeywords: "",
  siteName: "",
  siteUrl: "",
  siteKeywords: "",
  siteMark: ""
};

export function useHomeDocumentEditor({ homeDocument, commitHomeDocument }: UseHomeDocumentEditorOptions) {
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [formValues, setFormValues] = useState<FormValues>(EMPTY_FORM_VALUES);
  const [formError, setFormError] = useState("");

  function openGroupEditor(groupId?: string) {
    const group = groupId ? findGroup(homeDocument, groupId) : undefined;

    setEditor(group ? { kind: "group", mode: "edit", groupId: group.id } : { kind: "group", mode: "add" });
    setFormValues({
      ...EMPTY_FORM_VALUES,
      groupTitle: group?.title ?? "",
      groupKeywords: group?.keywords ?? ""
    });
    setFormError("");
  }

  function openSiteEditor(groupId: string, siteId?: string) {
    const group = findGroup(homeDocument, groupId);
    const site = siteId ? findSite(group, siteId) : undefined;

    if (!group) {
      return;
    }

    setEditor(site
      ? { kind: "site", mode: "edit", groupId, siteId: site.id }
      : { kind: "site", mode: "add", groupId });
    setFormValues({
      ...EMPTY_FORM_VALUES,
      siteName: site?.name ?? "",
      siteUrl: site?.url ?? "",
      siteKeywords: site?.keywords ?? "",
      siteMark: site?.mark ?? ""
    });
    setFormError("");
  }

  function closeEditor() {
    setEditor(null);
    setFormError("");
  }

  function updateFormValue(field: keyof FormValues, value: string) {
    setFormValues((current) => ({ ...current, [field]: value }));
  }

  function deleteGroup(groupId: string) {
    const group = findGroup(homeDocument, groupId);
    if (!group || !window.confirm(`删除分组“${group.title}”及其中 ${group.sites.length} 个网站？`)) {
      return;
    }

    commitHomeDocument({
      ...homeDocument,
      groups: renumberGroups(homeDocument.groups.filter((item) => item.id !== groupId))
    }, "分组已删除");
  }

  function deleteSite(groupId: string, siteId: string) {
    const group = findGroup(homeDocument, groupId);
    const site = findSite(group, siteId);
    if (!group || !site || !window.confirm(`删除网站“${site.name}”？`)) {
      return false;
    }

    const groups = homeDocument.groups.map((item) => item.id === groupId
      ? { ...item, sites: renumberSites(item.sites.filter((candidate) => candidate.id !== siteId)) }
      : item);
    commitHomeDocument({ ...homeDocument, groups: renumberGroups(groups) }, "网站已删除");
    return true;
  }

  function handleEditorSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) {
      return;
    }

    if (editor.kind === "group") {
      const title = normalizeText(formValues.groupTitle);
      const keywords = normalizeText(formValues.groupKeywords);
      if (!title) {
        setFormError("请输入分组名称。");
        return;
      }

      if (editor.mode === "add") {
        addGroup(title, keywords);
      } else {
        updateGroup(editor.groupId, title, keywords);
      }
      closeEditor();
      return;
    }

    const name = normalizeText(formValues.siteName);
    const rawUrl = normalizeText(formValues.siteUrl);
    const keywords = normalizeText(formValues.siteKeywords);
    const mark = normalizeText(formValues.siteMark).slice(0, 3) || generateMark(name);

    if (!name) {
      setFormError("请输入网站名称。");
      return;
    }

    if (!isValidUrl(rawUrl)) {
      setFormError("URL 只支持 http:// 或 https://。");
      return;
    }

    const values = {
      name,
      url: normalizeUrl(rawUrl),
      keywords,
      mark
    };

    if (editor.mode === "add") {
      addSite(editor.groupId, values);
    } else {
      updateSite(editor.groupId, editor.siteId, values);
    }
    closeEditor();
  }

  function addGroup(title: string, keywords: string) {
    const groups = sortByOrder(homeDocument.groups);
    groups.push({
      id: createId("group"),
      title,
      keywords,
      order: groups.length + 1,
      sites: []
    });
    commitHomeDocument({ ...homeDocument, groups: renumberGroups(groups) }, "分组已保存");
    trackProductEvent("group.added", {
      source: "editor"
    });
  }

  function updateGroup(groupId: string, title: string, keywords: string) {
    const groups = homeDocument.groups.map((group) => group.id === groupId
      ? { ...group, title, keywords }
      : group);
    commitHomeDocument({ ...homeDocument, groups: renumberGroups(groups) }, "分组已保存");
  }

  function addSite(groupId: string, values: Pick<HomeSite, "name" | "url" | "keywords" | "mark">) {
    const groups = homeDocument.groups.map((group) => {
      if (group.id !== groupId) {
        return group;
      }

      const sites = sortByOrder(group.sites);
      sites.push({
        id: createId("site"),
        ...values,
        order: sites.length + 1
      });
      return { ...group, sites: renumberSites(sites) };
    });

    commitHomeDocument({ ...homeDocument, groups: renumberGroups(groups) }, "网站已保存");
    trackProductEvent("site.added", {
      source: "editor"
    });
  }

  function updateSite(groupId: string, siteId: string, values: Pick<HomeSite, "name" | "url" | "keywords" | "mark">) {
    const groups = homeDocument.groups.map((group) => {
      if (group.id !== groupId) {
        return group;
      }

      return {
        ...group,
        sites: renumberSites(group.sites.map((site) => site.id === siteId ? { ...site, ...values } : site))
      };
    });

    commitHomeDocument({ ...homeDocument, groups: renumberGroups(groups) }, "网站已保存");
  }

  return {
    editor,
    formValues,
    formError,
    openGroupEditor,
    openSiteEditor,
    closeEditor,
    updateFormValue,
    handleEditorSubmit,
    deleteGroup,
    deleteSite
  };
}

function findGroup(documentValue: HomeDocumentV2, groupId: string): HomeGroup | undefined {
  return documentValue.groups.find((group) => group.id === groupId);
}

function findSite(group: HomeGroup | undefined, siteId: string): HomeSite | undefined {
  return group?.sites.find((site) => site.id === siteId);
}
