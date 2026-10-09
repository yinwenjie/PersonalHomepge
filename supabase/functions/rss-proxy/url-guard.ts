// SSRF guard for rss-proxy: URL normalization, hostname rules and IP range checks.
// Every hop (first request, each redirect, HTML discovery) goes through checkFetchTarget.
import { FeedError, MAX_URL_LENGTH } from "./contract.ts";

/** Returns every A and AAAA address for a hostname; throws when none can be resolved. */
export type DnsResolver = (hostname: string) => Promise<string[]>;

const BLOCKED_HOSTNAMES = new Set(["localhost"]);
const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa"];

/**
 * Parses and normalizes a feed URL: http/https only, default port only, no userinfo,
 * no fragment. Throws invalid_url for anything else.
 */
export function normalizeFeedUrl(raw: string, base?: string): URL {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_URL_LENGTH) {
    throw new FeedError("invalid_url");
  }

  let url: URL;
  try {
    url = base === undefined ? new URL(trimmed) : new URL(trimmed, base);
  } catch {
    throw new FeedError("invalid_url");
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.port !== "" ||
    url.hostname === ""
  ) {
    throw new FeedError("invalid_url");
  }

  url.hash = "";
  if (url.href.length > MAX_URL_LENGTH) {
    throw new FeedError("invalid_url");
  }
  return url;
}

/** Hostname-only rules that need no DNS: names that must never be fetched, and IP literals. */
export function assertHostAllowed(url: URL): void {
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const literal = ipLiteral(host);
  if (literal !== null) {
    if (isBlockedAddress(literal)) {
      throw new FeedError("blocked_address");
    }
    return;
  }

  if (
    BLOCKED_HOSTNAMES.has(host) ||
    BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix)) ||
    !host.includes(".")
  ) {
    throw new FeedError("blocked_address");
  }
}

/**
 * Full check before a request: hostname rules, then every resolved address.
 * Fails closed: a resolver error or an empty answer means the hop is not made.
 */
export async function checkFetchTarget(
  url: URL,
  resolve: DnsResolver,
  signal?: AbortSignal,
): Promise<void> {
  assertHostAllowed(url);
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (ipLiteral(host) !== null) {
    return;
  }

  let addresses: string[];
  try {
    addresses = await withDeadline(resolve(host), signal);
  } catch (error) {
    if (error instanceof FeedError) {
      throw error;
    }
    throw new FeedError("fetch_failed");
  }

  if (addresses.length === 0) {
    throw new FeedError("fetch_failed");
  }

  for (const address of addresses) {
    const parsed = ipLiteral(address.toLowerCase());
    if (parsed === null || isBlockedAddress(parsed)) {
      throw new FeedError("blocked_address");
    }
  }
}

/** A stalled DNS lookup must not outlive the fetch deadline. */
function withDeadline<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) {
    return promise;
  }
  if (signal.aborted) {
    return Promise.reject(new FeedError("timeout"));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new FeedError("timeout"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/** Deno resolver: all A and AAAA records. CNAME chains are followed by the runtime. */
export const denoResolver: DnsResolver = async (hostname) => {
  const [v4, v6] = await Promise.allSettled([
    Deno.resolveDns(hostname, "A"),
    Deno.resolveDns(hostname, "AAAA"),
  ]);
  if (v4.status === "rejected" && v6.status === "rejected") {
    throw new Error("dns lookup failed");
  }
  return [
    ...(v4.status === "fulfilled" ? v4.value : []),
    ...(v6.status === "fulfilled" ? v6.value : []),
  ];
};

type IpAddress = { version: 4; bytes: number[] } | { version: 6; words: number[] };

/** Parses a dotted IPv4 or an (optionally bracketed) IPv6 literal; null for anything else. */
export function ipLiteral(value: string): IpAddress | null {
  const v4 = parseIpv4(value);
  if (v4) {
    return { version: 4, bytes: v4 };
  }
  const v6 = parseIpv6(value.replace(/^\[(.*)\]$/, "$1"));
  return v6 ? { version: 6, words: v6 } : null;
}

function parseIpv4(value: string): number[] | null {
  // WHATWG URL parsing already turns decimal, octal and hex forms into dotted decimal.
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (!match) {
    return null;
  }
  const bytes = match.slice(1).map(Number);
  return bytes.every((byte) => byte <= 255) ? bytes : null;
}

function parseIpv6(value: string): number[] | null {
  if (!/^[0-9a-f:.]+$/i.test(value) || !value.includes(":")) {
    return null;
  }

  // A trailing dotted IPv4 (::ffff:1.2.3.4) becomes two hex groups.
  let text = value;
  const lastColon = text.lastIndexOf(":");
  if (text.slice(lastColon + 1).includes(".")) {
    const v4 = parseIpv4(text.slice(lastColon + 1));
    if (!v4) {
      return null;
    }
    const high = ((v4[0] << 8) | v4[1]).toString(16);
    const low = ((v4[2] << 8) | v4[3]).toString(16);
    text = `${text.slice(0, lastColon + 1)}${high}:${low}`;
  }

  const halves = text.split("::");
  if (halves.length > 2) {
    return null;
  }

  const parseGroups = (part: string): number[] | null => {
    if (part === "") {
      return [];
    }
    const groups = part.split(":");
    if (groups.some((group) => !/^[0-9a-f]{1,4}$/i.test(group))) {
      return null;
    }
    return groups.map((group) => parseInt(group, 16));
  };

  const head = parseGroups(halves[0]);
  const rest = halves.length === 2 ? parseGroups(halves[1]) : [];
  if (!head || !rest) {
    return null;
  }

  const explicit = head.length + rest.length;
  if (halves.length === 1) {
    return explicit === 8 ? head : null;
  }
  if (explicit > 7) {
    return null;
  }
  return [...head, ...new Array(8 - explicit).fill(0), ...rest];
}

/** True for anything that is not a public unicast address. */
export function isBlockedAddress(address: IpAddress): boolean {
  return address.version === 4 ? isBlockedIpv4(address.bytes) : isBlockedIpv6(address.words);
}

function isBlockedIpv4([a, b, c]: number[]): boolean {
  return (
    a === 0 || // "this network"
    a === 10 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    a === 127 ||
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224 // multicast, reserved, broadcast
  );
}

function isBlockedIpv6(words: number[]): boolean {
  const embeddedV4 = (high: number, low: number) => [high >> 8, high & 0xff, low >> 8, low & 0xff];
  const zeroPrefix = (count: number) => words.slice(0, count).every((word) => word === 0);

  // ::ffff:a.b.c.d (mapped) and ::a.b.c.d (deprecated compatible) carry an IPv4 address.
  if (zeroPrefix(5) && (words[5] === 0xffff || words[5] === 0)) {
    if (words[5] === 0 && words[6] === 0) {
      return true; // ::, ::1 and the rest of ::/96 low addresses
    }
    return isBlockedIpv4(embeddedV4(words[6], words[7]));
  }

  // 64:ff9b::/96 NAT64 translates to the embedded IPv4 address.
  if (words[0] === 0x64 && words[1] === 0xff9b && words.slice(2, 6).every((word) => word === 0)) {
    return isBlockedIpv4(embeddedV4(words[6], words[7]));
  }

  // 2002::/16 6to4 embeds an IPv4 address in the next 32 bits.
  if (words[0] === 0x2002) {
    return isBlockedIpv4(embeddedV4(words[1], words[2]));
  }

  // Only global unicast 2000::/3 may be fetched, minus its special-purpose blocks.
  if ((words[0] & 0xe000) !== 0x2000) {
    return true;
  }
  return (
    (words[0] === 0x2001 && words[1] < 0x0200) || // 2001::/23 IANA special (Teredo, ORCHID...)
    (words[0] === 0x2001 && words[1] === 0x0db8) || // documentation
    words[0] === 0x3fff // 3fff::/20 documentation
  );
}
