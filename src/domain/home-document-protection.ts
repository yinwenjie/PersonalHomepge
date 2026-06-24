import {
  createDefaultHomeDocument,
  type HomeDocumentV2,
  normalizeHomeDocument,
  sortByOrder
} from "@/domain/home-document";
import {
  createHomeDocumentFromTemplate,
  HOME_TEMPLATES,
  type HomeTemplateId
} from "@/domain/home-template";

export const DOCUMENT_PROTECTION_STORAGE_KEY = "homepage:document-protection:v1";

export type HomeDocumentClass =
  | "system-default"
  | "system-blank"
  | "system-template"
  | "user-data";

export interface HomeDocumentClassification {
  documentClass: HomeDocumentClass;
  isSystemDocument: boolean;
  isUserData: boolean;
  sourceTemplateId: HomeTemplateId | null;
}

export interface DocumentProtectionState extends HomeDocumentClassification {
  classifiedAt: string;
  contentFingerprint: string;
  documentId: string;
}

export function classifyHomeDocument(documentValue: HomeDocumentV2): HomeDocumentClassification {
  if (isHomeDocumentContentEquivalent(documentValue, createDefaultHomeDocument())) {
    return createClassification("system-default", null);
  }

  const templateId = getUnmodifiedHomeTemplateId(documentValue);
  if (templateId === "blank") {
    return createClassification("system-blank", templateId);
  }

  if (templateId) {
    return createClassification("system-template", templateId);
  }

  return createClassification("user-data", null);
}

export function createDocumentProtectionState(
  documentValue: HomeDocumentV2,
  classifiedAt = new Date().toISOString()
): DocumentProtectionState {
  const normalized = normalizeHomeDocument(documentValue);
  const classification = classifyHomeDocument(normalized);

  return {
    ...classification,
    classifiedAt,
    contentFingerprint: createHomeDocumentContentFingerprint(normalized),
    documentId: normalized.documentId
  };
}

export function isUserHomeDocument(documentValue: HomeDocumentV2): boolean {
  return classifyHomeDocument(documentValue).isUserData;
}

export function isSystemHomeDocument(documentValue: HomeDocumentV2): boolean {
  return classifyHomeDocument(documentValue).isSystemDocument;
}

export function isBlankHomeDocumentContent(documentValue: HomeDocumentV2): boolean {
  return getUnmodifiedHomeTemplateId(documentValue) === "blank";
}

export function getUnmodifiedHomeTemplateId(documentValue: HomeDocumentV2): HomeTemplateId | null {
  for (const template of HOME_TEMPLATES) {
    if (isHomeDocumentContentEquivalent(documentValue, createHomeDocumentFromTemplate(template.id))) {
      return template.id;
    }
  }

  return null;
}

export function isHomeDocumentContentEquivalent(left: HomeDocumentV2, right: HomeDocumentV2): boolean {
  return createHomeDocumentContentFingerprint(left) === createHomeDocumentContentFingerprint(right);
}

export function createHomeDocumentContentFingerprint(documentValue: HomeDocumentV2): string {
  const normalized = normalizeHomeDocument(documentValue);

  return stableStringify({
    groups: sortByOrder(normalized.groups).map((group) => ({
      keywords: group.keywords,
      sites: sortByOrder(group.sites).map((site) => ({
        keywords: site.keywords,
        mark: site.mark,
        name: site.name,
        url: site.url
      })),
      title: group.title
    })),
    theme: normalized.theme,
    widgets: sortByOrder(normalized.widgets).map((widget) => ({
      config: widget.config,
      layout: widget.layout,
      title: widget.title,
      type: widget.type
    }))
  });
}

export function getHomeDocumentClassLabel(classification: HomeDocumentClassification): string {
  switch (classification.documentClass) {
    case "system-default":
      return "系统默认";
    case "system-blank":
      return "空白首页";
    case "system-template": {
      const templateName = classification.sourceTemplateId
        ? HOME_TEMPLATES.find((template) => template.id === classification.sourceTemplateId)?.shortName
        : null;
      return templateName ? `未编辑模板：${templateName}` : "未编辑模板";
    }
    case "user-data":
      return "有效用户首页";
  }
}

function createClassification(
  documentClass: HomeDocumentClass,
  sourceTemplateId: HomeTemplateId | null
): HomeDocumentClassification {
  const isUserData = documentClass === "user-data";

  return {
    documentClass,
    isSystemDocument: !isUserData,
    isUserData,
    sourceTemplateId
  };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "undefined";
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  return `{${Object.entries(value)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, childValue]) => `${JSON.stringify(key)}:${stableStringify(childValue)}`)
    .join(",")}}`;
}
