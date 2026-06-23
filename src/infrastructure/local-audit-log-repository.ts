export const LOCAL_AUDIT_LOG_STORAGE_KEY = "homepage:audit-log:v1";
export const LOCAL_AUDIT_LOG_UPDATED_EVENT = "homepage:local-audit-log-updated";

const LOCAL_AUDIT_LOG_SCHEMA = "homepage-audit-log-v1";
const MAX_AUDIT_EVENTS = 160;
const FORBIDDEN_METADATA_KEYS = new Set([
  "accessToken",
  "access_token",
  "encryptionKey",
  "encryption_key",
  "syncCode",
  "sync_code",
  "session",
  "refreshToken",
  "refresh_token"
]);

export type LocalAuditEventLevel = "info" | "warning" | "danger";

export interface LocalAuditEvent {
  id: string;
  createdAt: string;
  documentId: string | null;
  level: LocalAuditEventLevel;
  message: string;
  metadata: Record<string, unknown>;
  spaceId: string | null;
  type: string;
}

interface LocalAuditLogStorageValue {
  events: LocalAuditEvent[];
  schema: typeof LOCAL_AUDIT_LOG_SCHEMA;
}

export interface AppendLocalAuditEventInput {
  documentId?: string | null;
  level?: LocalAuditEventLevel;
  message: string;
  metadata?: Record<string, unknown>;
  spaceId?: string | null;
  type: string;
}

export class LocalAuditLogRepository {
  constructor(private readonly storage: Storage) {}

  load(): LocalAuditEvent[] {
    const value = this.read();
    return value?.events ?? [];
  }

  append(input: AppendLocalAuditEventInput): LocalAuditEvent {
    const event: LocalAuditEvent = {
      id: createAuditId(),
      createdAt: new Date().toISOString(),
      documentId: input.documentId ?? null,
      level: input.level ?? "info",
      message: input.message,
      metadata: sanitizeAuditMetadata(input.metadata ?? {}),
      spaceId: input.spaceId ?? null,
      type: input.type
    };
    const nextEvents = [event, ...this.load()].slice(0, MAX_AUDIT_EVENTS);

    this.storage.setItem(LOCAL_AUDIT_LOG_STORAGE_KEY, JSON.stringify({
      schema: LOCAL_AUDIT_LOG_SCHEMA,
      events: nextEvents
    } satisfies LocalAuditLogStorageValue));

    return event;
  }

  clear(): void {
    this.storage.removeItem(LOCAL_AUDIT_LOG_STORAGE_KEY);
  }

  private read(): LocalAuditLogStorageValue | null {
    try {
      const raw = this.storage.getItem(LOCAL_AUDIT_LOG_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) as LocalAuditLogStorageValue : null;

      if (!parsed || parsed.schema !== LOCAL_AUDIT_LOG_SCHEMA || !Array.isArray(parsed.events)) {
        return null;
      }

      return {
        schema: LOCAL_AUDIT_LOG_SCHEMA,
        events: parsed.events.filter(isAuditEvent).slice(0, MAX_AUDIT_EVENTS)
      };
    } catch {
      return null;
    }
  }
}

export function recordLocalAuditEvent(input: AppendLocalAuditEventInput): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    new LocalAuditLogRepository(window.localStorage).append(input);
    window.dispatchEvent(new CustomEvent(LOCAL_AUDIT_LOG_UPDATED_EVENT));
  } catch (error) {
    console.warn("Failed to record local audit event:", error);
  }
}

function isAuditEvent(value: unknown): value is LocalAuditEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const event = value as Record<string, unknown>;
  return typeof event.id === "string"
    && typeof event.createdAt === "string"
    && typeof event.type === "string"
    && typeof event.message === "string";
}

function sanitizeAuditMetadata(value: Record<string, unknown>): Record<string, unknown> {
  return sanitizeValue(value) as Record<string, unknown>;
}

function sanitizeValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 24).map(sanitizeValue);
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const entries = Object.entries(value as Record<string, unknown>).slice(0, 32).map(([key, childValue]) => [
    key,
    FORBIDDEN_METADATA_KEYS.has(key) ? "[redacted]" : sanitizeValue(childValue)
  ]);

  return Object.fromEntries(entries);
}

function createAuditId(): string {
  const random = globalThis.crypto?.getRandomValues
    ? Array.from(globalThis.crypto.getRandomValues(new Uint32Array(1)), (value) => value.toString(36)).join("")
    : Math.random().toString(36).slice(2);

  return `audit-${Date.now().toString(36)}-${random}`;
}
