// RSS 2.0, RSS 1.0 (RDF) and Atom parsing plus cleaning into plain-text items.
// The XML parser never loads anything and entity expansion is off; this module decodes
// a fixed set of entities itself, once, so no declared entity can ever be expanded.
import { XMLParser } from "npm:fast-xml-parser@5.11.1";
import {
  FeedError,
  type FeedItem,
  MAX_ITEMS_BYTES,
  MAX_ITEMS_PER_FEED,
  MAX_SUMMARY_LENGTH,
  MAX_TITLE_LENGTH,
  type ParsedFeed,
} from "./contract.ts";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  processEntities: false,
  htmlEntities: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => name === "item" || name === "entry" || name === "link",
});

const MAX_ENTRIES_SCANNED = 200;

type Node = unknown;
type Element = Record<string, Node>;

/**
 * Removes a plain <!DOCTYPE> and rejects one with an internal subset or any entity
 * declaration, before the parser sees the document.
 */
export function prepareXml(text: string): string {
  let xml = text.replace(/^﻿/, "");
  if (/<!ENTITY/i.test(xml)) {
    throw new FeedError("not_feed");
  }

  const doctype = /<!DOCTYPE\b/i.exec(xml);
  if (doctype) {
    const end = xml.indexOf(">", doctype.index);
    const declaration = end === -1 ? "" : xml.slice(doctype.index, end + 1);
    if (end === -1 || declaration.includes("[")) {
      throw new FeedError("not_feed");
    }
    xml = xml.slice(0, doctype.index) + xml.slice(end + 1);
    if (/<!DOCTYPE\b/i.test(xml)) {
      throw new FeedError("not_feed");
    }
  }
  return xml;
}

export async function parseFeed(text: string, feedUrl: URL): Promise<ParsedFeed> {
  try {
    return await parseFeedUnchecked(text, feedUrl);
  } catch (error) {
    // Odd but well-formed documents must fail as this feed's problem, never as a crash.
    throw error instanceof FeedError ? error : new FeedError("not_feed");
  }
}

async function parseFeedUnchecked(text: string, feedUrl: URL): Promise<ParsedFeed> {
  let document: Element;
  try {
    document = parser.parse(prepareXml(text)) as Element;
  } catch (error) {
    if (error instanceof FeedError) {
      throw error;
    }
    throw new FeedError("not_feed");
  }

  const rss = asElement(document.rss);
  const rdf = asElement(document.RDF);
  const atom = asElement(document.feed);

  // Links in raw are already absolute: RSS resolves against the feed URL, Atom against the
  // effective xml:base of the feed, entry and link elements.
  let raw: { title: Node; site: string | null; entries: RawEntry[] };
  if (rss && asElement(rss.channel)) {
    const channel = asElement(rss.channel)!;
    raw = {
      title: channel.title,
      site: pickLink(channel.link, false, feedUrl),
      entries: asArray(channel.item).map((item) => rssEntry(item, feedUrl)),
    };
  } else if (rdf && asElement(rdf.channel)) {
    const channel = asElement(rdf.channel)!;
    raw = {
      title: channel.title,
      site: pickLink(channel.link, false, feedUrl),
      entries: asArray(rdf.item).map((item) => rssEntry(item, feedUrl)),
    };
  } else if (atom) {
    const feedBase = xmlBase(atom, feedUrl);
    raw = {
      title: atom.title,
      site: pickLink(atom.link, true, feedBase),
      entries: asArray(atom.entry).map((entry) => atomEntry(entry, feedBase)),
    };
  } else {
    throw new FeedError("not_feed");
  }

  const items: FeedItem[] = [];
  const seen = new Set<string>();
  // Feeds list newest first; looking at the first entries bounds the work per document.
  for (const entry of raw.entries.slice(0, MAX_ENTRIES_SCANNED)) {
    const item = await cleanEntry(entry);
    if (item && !seen.has(item.id)) {
      seen.add(item.id);
      items.push(item);
    }
  }

  items.sort((left, right) => {
    if (left.publishedAt === right.publishedAt) return 0;
    if (left.publishedAt === null) return 1;
    if (right.publishedAt === null) return -1;
    return left.publishedAt < right.publishedAt ? 1 : -1;
  });
  const limited = items.slice(0, MAX_ITEMS_PER_FEED);
  while (limited.length > 0 && byteLength(JSON.stringify(limited)) > MAX_ITEMS_BYTES) {
    limited.pop();
  }

  const title = cleanText(textOf(raw.title), MAX_TITLE_LENGTH, false);
  return {
    title: title || null,
    siteUrl: raw.site,
    items: limited,
  };
}

interface RawEntry {
  title: Node;
  link: string | null;
  guid: Node;
  date: Node;
  summary: Node;
}

function rssEntry(node: Node, feedUrl: URL): RawEntry {
  const item = asElement(node) ?? {};
  return {
    title: item.title,
    link: pickLink(item.link, false, feedUrl),
    guid: item.guid ?? item["@_about"],
    date: item.pubDate ?? item.date ?? item.published ?? item.updated,
    summary: item.description ?? item.summary ?? item.encoded,
  };
}

function atomEntry(node: Node, feedBase: URL): RawEntry {
  const entry = asElement(node) ?? {};
  return {
    title: entry.title,
    link: pickLink(entry.link, true, xmlBase(entry, feedBase)),
    guid: entry.id,
    date: entry.published ?? entry.updated,
    summary: entry.summary ?? entry.content,
  };
}

/**
 * The absolute http(s) link of an element. RSS links are text; Atom (and atom:link inside
 * RSS) links are href attributes, resolved against the link element's own xml:base.
 */
function pickLink(node: Node, atomOnly: boolean, base: URL): string | null {
  const candidates = asArray(node);
  if (!atomOnly) {
    for (const candidate of candidates) {
      const text = typeof candidate === "string" ? candidate : textOf(candidate);
      if (text.trim()) {
        return absoluteHttpUrl(text, base);
      }
    }
  }
  for (const candidate of candidates) {
    const element = asElement(candidate);
    const href = element?.["@_href"];
    const rel = element?.["@_rel"];
    if (typeof href === "string" && href.trim() && (rel === undefined || rel === "alternate")) {
      return element ? absoluteHttpUrl(href, xmlBase(element, base)) : null;
    }
  }
  return null;
}

/** Applies an element's xml:base (the parser drops the xml: prefix) on top of the inherited base. */
function xmlBase(element: Element, inherited: URL): URL {
  const value = element["@_base"];
  if (typeof value !== "string" || !value.trim()) {
    return inherited;
  }
  const resolved = absoluteHttpUrl(value, inherited);
  return resolved ? new URL(resolved) : inherited;
}

async function cleanEntry(entry: RawEntry): Promise<FeedItem | null> {
  const link = entry.link;
  if (!link) {
    return null;
  }

  const summary = cleanText(textOf(entry.summary), MAX_SUMMARY_LENGTH, true);
  const title = cleanText(textOf(entry.title), MAX_TITLE_LENGTH, false) ||
    truncate(summary, MAX_TITLE_LENGTH);
  if (!title) {
    return null;
  }

  const guid = textOf(entry.guid).trim();
  return {
    id: await shortHash(guid || link || title),
    title,
    link,
    publishedAt: parseDate(textOf(entry.date)),
    summary,
  };
}

function absoluteHttpUrl(value: string, base: URL): string | null {
  try {
    const url = new URL(decodeEntities(value.trim()), base);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.href.length > 2048) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

function parseDate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const time = Date.parse(trimmed);
  if (Number.isNaN(time)) {
    return null;
  }
  const year = new Date(time).getUTCFullYear();
  return year >= 1990 && year <= 2100 ? new Date(time).toISOString() : null;
}

/** Flattens a parsed node to its text, ignoring attributes. */
function textOf(node: Node): string {
  if (node === undefined || node === null) {
    return "";
  }
  if (typeof node === "string") {
    return node;
  }
  if (typeof node === "number" || typeof node === "boolean") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(textOf).join(" ");
  }
  if (typeof node === "object") {
    // Mixed content (Atom xhtml) loses its exact order here; good enough for plain-text summaries.
    const element = node as Element;
    const children = Object.entries(element)
      .filter(([key]) => !key.startsWith("@_") && key !== "#text")
      .map(([, value]) => textOf(value));
    return [textOf(element["#text"]), ...children].join(" ");
  }
  return "";
}

/**
 * Plain text only: strip tags, decode entities, then strip once more so entity-escaped
 * HTML (RSS descriptions, Atom type="html" titles) also loses its markup.
 */
export function cleanText(raw: string, max: number, htmlBody: boolean): string {
  // Only a short prefix can survive truncation; capping the input keeps regex work bounded.
  let text = decodeEntities(stripTags(raw.slice(0, htmlBody ? 16_384 : 4_096)));
  text = stripTags(text);
  // deno-lint-ignore no-control-regex
  text = text.replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return truncate(text, max);
}

function stripTags(value: string): string {
  value = value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  return removeTags(value);
}

/**
 * Replaces each tag with a space. A ">" inside a quoted attribute value does not end the
 * tag, as in HTML. One forward pass: after a quote left open to the end, later tags end at
 * the next ">" instead, so hostile markup cannot make this quadratic.
 */
function removeTags(value: string): string {
  const opener = /<\/?[a-zA-Z]/g;
  let quoteAware = true;
  let text = "";
  let copied = 0;
  for (let match = opener.exec(value); match; match = opener.exec(value)) {
    let end = -1;
    if (quoteAware) {
      let quote = "";
      for (let index = opener.lastIndex; index < value.length; index += 1) {
        const char = value[index];
        if (quote) {
          if (char === quote) {
            quote = "";
          }
        } else if (char === '"' || char === "'") {
          quote = char;
        } else if (char === ">") {
          end = index;
          break;
        }
      }
      quoteAware = end >= 0;
    }
    if (end < 0) {
      end = value.indexOf(">", opener.lastIndex);
    }
    if (end < 0) {
      break; // no ">" left, so the rest is text
    }
    text += value.slice(copied, match.index) + " ";
    copied = end + 1;
    opener.lastIndex = copied;
  }
  return text + value.slice(copied);
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  laquo: "«",
  raquo: "»",
  middot: "·",
  bull: "•",
  copy: "©",
  reg: "®",
  trade: "™",
};

/** One pass over a fixed entity table; output is never re-scanned, so nothing nests. */
export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8});/gi, (match, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X"
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      if (code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff)) {
        return String.fromCodePoint(code);
      }
      return "";
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

function truncate(value: string, max: number): string {
  const characters = Array.from(value);
  return characters.length <= max ? value : characters.slice(0, max).join("").trimEnd();
}

async function shortHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest).subarray(0, 12))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function asElement(node: Node): Element | null {
  if (Array.isArray(node)) {
    return asElement(node[0]);
  }
  return node && typeof node === "object" ? node as Element : null;
}

function asArray(node: Node): Node[] {
  if (node === undefined || node === null) {
    return [];
  }
  return Array.isArray(node) ? node : [node];
}
