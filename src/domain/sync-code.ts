import { normalizeRevision } from "@/domain/home-document";

export const SYNC_CODE_VERSION = 1;
export const SYNC_CODE_PREFIX = "hp1";
export const SYNC_BINDING_STORAGE_KEY = "homepage:sync-code:v1";

const TOKEN_BYTE_LENGTH = 32;
const TOKEN_TEXT_LENGTH = Math.ceil((TOKEN_BYTE_LENGTH * 4) / 3);
const SPACE_ID_PATTERN_SOURCE = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const SECRET_PATTERN_SOURCE = `[A-Za-z0-9_-]{${TOKEN_TEXT_LENGTH}}`;
const SPACE_ID_PATTERN = new RegExp(`^${SPACE_ID_PATTERN_SOURCE}$`, "i");
const SECRET_PATTERN = new RegExp(`^${SECRET_PATTERN_SOURCE}$`);
const SYNC_CODE_PATTERN = new RegExp(
  `^${SYNC_CODE_PREFIX}_(${SPACE_ID_PATTERN_SOURCE})_(${SECRET_PATTERN_SOURCE})_(${SECRET_PATTERN_SOURCE})$`,
  "i"
);

export interface SyncCodeParts {
  version: typeof SYNC_CODE_VERSION;
  spaceId: string;
  accessToken: string;
  encryptionKey: string;
}

export interface StoredSyncBinding extends SyncCodeParts {
  remoteRevision: number;
  lastSyncedAt: string | null;
  lastSyncedDocumentRevision: number;
  lastSyncedDocumentUpdatedAt: string | null;
}

export function createSyncSecrets(): Pick<SyncCodeParts, "accessToken" | "encryptionKey"> {
  return {
    accessToken: randomBase64Url(TOKEN_BYTE_LENGTH),
    encryptionKey: randomBase64Url(TOKEN_BYTE_LENGTH)
  };
}

export function formatSyncCode(parts: Pick<SyncCodeParts, "spaceId" | "accessToken" | "encryptionKey">): string {
  assertValidSpaceId(parts.spaceId);
  assertValidSecret(parts.accessToken, "accessToken");
  assertValidSecret(parts.encryptionKey, "encryptionKey");

  return `${SYNC_CODE_PREFIX}_${parts.spaceId}_${parts.accessToken}_${parts.encryptionKey}`;
}

export function parseSyncCode(value: string): SyncCodeParts {
  // Base64URL secrets may contain "_", so parse by fixed token length instead of split("_").
  const match = SYNC_CODE_PATTERN.exec(value.trim());
  if (!match) {
    throw new Error("同步码格式不正确");
  }

  const [, spaceId = "", accessToken = "", encryptionKey = ""] = match;
  assertValidSpaceId(spaceId);
  assertValidSecret(accessToken, "accessToken");
  assertValidSecret(encryptionKey, "encryptionKey");

  return {
    version: SYNC_CODE_VERSION,
    spaceId,
    accessToken,
    encryptionKey
  };
}

export function normalizeStoredSyncBinding(input: unknown): StoredSyncBinding | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }

  const value = input as Record<string, unknown>;
  try {
    if (value.version !== SYNC_CODE_VERSION) {
      return null;
    }

    const parts = parseSyncCode(formatSyncCode({
      spaceId: String(value.spaceId ?? ""),
      accessToken: String(value.accessToken ?? ""),
      encryptionKey: String(value.encryptionKey ?? "")
    }));

    return {
      ...parts,
      remoteRevision: normalizeRevision(value.remoteRevision),
      lastSyncedAt: typeof value.lastSyncedAt === "string" ? value.lastSyncedAt : null,
      lastSyncedDocumentRevision: normalizeRevision(value.lastSyncedDocumentRevision),
      lastSyncedDocumentUpdatedAt: typeof value.lastSyncedDocumentUpdatedAt === "string"
        ? value.lastSyncedDocumentUpdatedAt
        : null
    };
  } catch {
    return null;
  }
}

export function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) {
    throw new Error("当前浏览器环境不支持安全随机数生成，无法创建同步码。请使用 HTTPS 页面、localhost/127.0.0.1 本地页面，或现代浏览器后再试。");
  }

  cryptoApi.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function assertValidSpaceId(value: string): void {
  if (!SPACE_ID_PATTERN.test(value)) {
    throw new Error("同步空间 ID 无效");
  }
}

function assertValidSecret(value: string, label: string): void {
  if (!SECRET_PATTERN.test(value)) {
    throw new Error(`${label} 无效`);
  }
}
