import { normalizeText } from "@/domain/home-document";
import type { BookmarkImportSourceItem } from "@/domain/bookmark-import";

export function parseBookmarkHtml(html: string): BookmarkImportSourceItem[] {
  const parser = new DOMParser();
  const documentValue = parser.parseFromString(html, "text/html");
  const root = documentValue.querySelector("dl") ?? documentValue.body;
  const items: BookmarkImportSourceItem[] = [];

  walkBookmarkContainer(root, [], items);

  if (items.length > 0) {
    return items;
  }

  return Array.from(documentValue.querySelectorAll("a[href]")).map((link) => ({
    title: normalizeText(link.textContent),
    url: normalizeText(link.getAttribute("href")),
    folderPath: []
  })).filter((item) => item.url);
}

function walkBookmarkContainer(
  container: Element,
  folderPath: string[],
  items: BookmarkImportSourceItem[]
): void {
  const children = Array.from(container.children);

  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    const tagName = child.tagName.toUpperCase();

    if (tagName === "DT") {
      const directChildren = Array.from(child.children);
      const link = directChildren.find((element) => element.tagName.toUpperCase() === "A");
      if (link) {
        const url = normalizeText(link.getAttribute("href"));
        if (url) {
          items.push({
            title: normalizeText(link.textContent),
            url,
            folderPath
          });
        }
      }

      const heading = directChildren.find((element) => element.tagName.toUpperCase() === "H3");
      if (heading) {
        const nextPath = [...folderPath, normalizeText(heading.textContent)].filter(Boolean);
        const nestedDl = directChildren.find((element) => element.tagName.toUpperCase() === "DL")
          ?? getNextDlSibling(children, index);

        if (nestedDl) {
          walkBookmarkContainer(nestedDl, nextPath, items);
          if (nestedDl === children[index + 1]) {
            index += 1;
          }
        }
      }

      const nestedDl = directChildren.find((element) => element.tagName.toUpperCase() === "DL");
      if (!heading && nestedDl) {
        walkBookmarkContainer(nestedDl, folderPath, items);
      }

      continue;
    }

    if (tagName === "DL" || tagName === "P") {
      walkBookmarkContainer(child, folderPath, items);
    }
  }
}

function getNextDlSibling(children: Element[], index: number): Element | null {
  const next = children[index + 1];

  return next?.tagName.toUpperCase() === "DL" ? next : null;
}
