import { normalizeText } from "@/domain/home-document";
import type { BookmarkImportSourceItem } from "@/domain/bookmark-import";

const MARKDOWN_LINK_PATTERN = /\[([^\]]+)]\(([^)\s]+)\)/g;
const URL_PATTERN = /(?:https?:\/\/|\/\/|www\.)[^\s<>"']+|[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:[/:?#][^\s<>"']*)?/gi;

export function parseUrlList(value: string): BookmarkImportSourceItem[] {
  return value
    .split(/\r?\n/)
    .flatMap(parseUrlListLine)
    .filter((item) => item.url);
}

function parseUrlListLine(line: string): BookmarkImportSourceItem[] {
  const value = normalizeText(line);
  if (!value) {
    return [];
  }

  const markdownItems = parseMarkdownLinks(value);
  if (markdownItems.length > 0) {
    return markdownItems;
  }

  const matches = value.match(URL_PATTERN) ?? [];
  return matches.map((url) => ({
    title: "",
    url: normalizeText(url),
    folderPath: []
  }));
}

function parseMarkdownLinks(value: string): BookmarkImportSourceItem[] {
  const items: BookmarkImportSourceItem[] = [];
  for (const match of value.matchAll(MARKDOWN_LINK_PATTERN)) {
    const [, title = "", url = ""] = match;
    items.push({
      title: normalizeText(title),
      url: normalizeText(url),
      folderPath: []
    });
  }

  return items;
}
