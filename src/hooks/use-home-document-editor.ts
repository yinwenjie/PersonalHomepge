"use client";

import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { requestConfirm } from "@/components/confirm-dialog";
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
import { useI18n } from "@/hooks/use-i18n";
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
  const { t, format } = useI18n();
  const homeDocumentRef = useRef(homeDocument);

  useEffect(() => {
    homeDocumentRef.current = homeDocument;
  }, [homeDocument]);

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

  async function deleteGroup(groupId: string) {
    const group = findGroup(homeDocument, groupId);
    if (!group || !(await requestConfirm({
      message: t("editor.deleteGroupConfirm", {
        group: group.title,
        count: format.number(group.sites.length)
      }),
      confirmLabel: t("common.delete"),
      tone: "danger"
    }))) {
      return;
    }

    // The dialog is asynchronous, so apply the deletion to the latest document.
    const latestDocument = homeDocumentRef.current;
    commitHomeDocument({
      ...latestDocument,
      groups: renumberGroups(latestDocument.groups.filter((item) => item.id !== groupId))
    }, t("editor.groupDeleted"));
  }

  async function deleteSite(groupId: string, siteId: string): Promise<boolean> {
    const group = findGroup(homeDocument, groupId);
    const site = findSite(group, siteId);
    if (!group || !site || !(await requestConfirm({
      message: t("editor.deleteSiteConfirm", { site: site.name }),
      confirmLabel: t("common.delete"),
      tone: "danger"
    }))) {
      return false;
    }

    const latestDocument = homeDocumentRef.current;
    const groups = latestDocument.groups.map((item) => item.id === groupId
      ? { ...item, sites: renumberSites(item.sites.filter((candidate) => candidate.id !== siteId)) }
      : item);
    commitHomeDocument({ ...latestDocument, groups: renumberGroups(groups) }, t("editor.siteDeleted"));
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
        setFormError(t("editor.groupNameRequired"));
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
      setFormError(t("editor.siteNameRequired"));
      return;
    }

    if (!isValidUrl(rawUrl)) {
      setFormError(t("editor.siteUrlInvalid"));
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
    commitHomeDocument({ ...homeDocument, groups: renumberGroups(groups) }, t("editor.groupSaved"));
    trackProductEvent("group.added", {
      source: "editor"
    });
  }

  function updateGroup(groupId: string, title: string, keywords: string) {
    const groups = homeDocument.groups.map((group) => group.id === groupId
      ? { ...group, title, keywords }
      : group);
    commitHomeDocument({ ...homeDocument, groups: renumberGroups(groups) }, t("editor.groupSaved"));
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

    commitHomeDocument({ ...homeDocument, groups: renumberGroups(groups) }, t("editor.siteSaved"));
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

    commitHomeDocument({ ...homeDocument, groups: renumberGroups(groups) }, t("editor.siteSaved"));
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
