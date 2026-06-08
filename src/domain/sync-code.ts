import { normalizeRevision } from "@/domain/home-document";

export const SYNC_CODE_VERSION = 1;
export const SYNC_CODE_PREFIX = "hp1";
export const SYNC_BINDING_STORAGE_KEY = "homepage:sync-code:v1";

const TOKEN_BYTE_LENGTH = 32;

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
  const parts = value.trim().split("_");
  if (parts.length !== 4 || parts[0] !== SYNC_CODE_PREFIX) {
    throw new Error("同步码格式不正确");
  }

  const [, spaceId, accessToken, encryptionKey] = parts;
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
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(value)) {
    throw new Error("同步空间 ID 无效");
  }
}

function assertValidSecret(value: string, label: string): void {
  const secretPattern = /^[A-Za-z0-9_-]{32,512}$/;
  if (!secretPattern.test(value)) {
    throw new Error(`${label} 无效`);
  }
}
