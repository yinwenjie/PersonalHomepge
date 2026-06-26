export const ERROR_MONITORING_SCHEMA_VERSION = 1;

export const CLIENT_ERROR_EVENT_TYPES = [
  "react_render_error",
  "window_error",
  "unhandled_rejection",
  "resource_load_failed",
  "async_operation_failed"
] as const;

export type ClientErrorEventType = typeof CLIENT_ERROR_EVENT_TYPES[number];

export const CLIENT_ERROR_SEVERITIES = [
  "info",
  "warning",
  "error",
  "fatal"
] as const;

export type ClientErrorSeverity = typeof CLIENT_ERROR_SEVERITIES[number];

export const CLIENT_ERROR_PROPERTY_KEYS = [
  "accessMode",
  "documentClass",
  "hasSyncBinding",
  "online",
  "reasonCode",
  "resourceKind",
  "resourceOriginKind",
  "runtime",
  "source",
  "sourceKind",
  "storageReady",
  "supabaseConfigured",
  "syncStatus",
  "visibilityState"
] as const;

export type ClientErrorPropertyKey = typeof CLIENT_ERROR_PROPERTY_KEYS[number];

export type ClientErrorPropertyValue =
  | boolean
  | number
  | string
  | null
  | Array<boolean | number | string | null>;

export type ClientErrorProperties = Partial<Record<ClientErrorPropertyKey, ClientErrorPropertyValue>>;

export const CLIENT_ERROR_FORBIDDEN_KEYS = [
  "accessToken",
  "access_token",
  "authorization",
  "document",
  "documentJson",
  "document_json",
  "email",
  "encryptionKey",
  "encryption_key",
  "groupName",
  "groupTitle",
  "homepage",
  "homeDocument",
  "imageUrl",
  "password",
  "query",
  "refreshToken",
  "refresh_token",
  "searchTerm",
  "secret",
  "session",
  "siteName",
  "syncCode",
  "sync_code",
  "todo",
  "token",
  "url",
  "userEmail",
  "userId"
] as const;

const EVENT_TYPE_SET = new Set<string>(CLIENT_ERROR_EVENT_TYPES);
const SEVERITY_SET = new Set<string>(CLIENT_ERROR_SEVERITIES);
const PROPERTY_KEY_SET = new Set<string>(CLIENT_ERROR_PROPERTY_KEYS);
const FORBIDDEN_KEY_SET = new Set<string>(CLIENT_ERROR_FORBIDDEN_KEYS.map((key) => key.toLowerCase()));
const MAX_MESSAGE_LENGTH = 500;
const MAX_STACK_LENGTH = 3000;
const MAX_COMPONENT_STACK_LENGTH = 2000;
const MAX_OPERATION_LENGTH = 96;
const MAX_PROPERTY_STRING_LENGTH = 120;
const MAX_PROPERTY_ARRAY_LENGTH = 24;

export interface NormalizedClientError {
  componentStack: string | null;
  errorName: string;
  fingerprint: string;
  message: string;
  operation: string | null;
  properties: ClientErrorProperties;
  stack: string | null;
}

export interface NormalizeClientErrorInput {
  componentStack?: string | null;
  error: unknown;
  eventType: ClientErrorEventType;
  operation?: string | null;
  properties?: Record<string, unknown>;
}

export function isClientErrorEventType(value: string): value is ClientErrorEventType {
  return EVENT_TYPE_SET.has(value);
}

export function isClientErrorSeverity(value: string): value is ClientErrorSeverity {
  return SEVERITY_SET.has(value);
}

export function normalizeClientError(input: NormalizeClientErrorInput): NormalizedClientError {
  const errorDetails = readErrorDetails(input.error);
  const operation = sanitizeOperation(input.operation);
  const message = sanitizeDiagnosticText(errorDetails.message || "Unknown client error", MAX_MESSAGE_LENGTH);
  const stack = errorDetails.stack
    ? sanitizeDiagnosticText(errorDetails.stack, MAX_STACK_LENGTH)
    : null;
  const componentStack = input.componentStack
    ? sanitizeDiagnosticText(input.componentStack, MAX_COMPONENT_STACK_LENGTH)
    : null;
  const topFrame = readTopStackFrame(stack ?? componentStack);

  return {
    componentStack,
    errorName: sanitizeDiagnosticText(errorDetails.name || "Error", 80),
    fingerprint: buildFingerprint([
      input.eventType,
      operation ?? "",
      errorDetails.name,
      message,
      topFrame ?? ""
    ]),
    message,
    operation,
    properties: sanitizeClientErrorProperties(input.properties),
    stack
  };
}

export function sanitizeClientErrorProperties(input: Record<string, unknown> = {}): ClientErrorProperties {
  const entries: [ClientErrorPropertyKey, ClientErrorPropertyValue][] = [];

  for (const [key, rawValue] of Object.entries(input).slice(0, 32)) {
    if (!PROPERTY_KEY_SET.has(key) || FORBIDDEN_KEY_SET.has(key.toLowerCase())) {
      continue;
    }

    const sanitized = sanitizePropertyValue(rawValue);
    if (sanitized !== undefined) {
      entries.push([key as ClientErrorPropertyKey, sanitized]);
    }
  }

  return Object.fromEntries(entries) as ClientErrorProperties;
}

export function sanitizeDiagnosticText(value: string, maxLength: number): string {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/https?:\/\/[^\s"'<>)]{1,2048}/gi, "[url]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b(access[_-]?token|refresh[_-]?token|encryption[_-]?key|sync[_-]?code|secret|password|authorization|token)\b\s*[:=]\s*["']?[^"',\s}]+/gi, "$1=[redacted]")
    .replace(/\b[A-Za-z0-9+/=_-]{48,}\b/g, "[redacted]")
    .slice(0, maxLength);
}

function readErrorDetails(error: unknown): { message: string; name: string; stack: string | null } {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name || "Error",
      stack: error.stack ?? null
    };
  }

  if (typeof error === "string") {
    return {
      message: error,
      name: "Error",
      stack: null
    };
  }

  if (isRecord(error)) {
    const message = readString(error.message) || readString(error.reason) || readString(error.code) || "Object error";
    return {
      message,
      name: readString(error.name) || readString(error.code) || "Error",
      stack: readString(error.stack) || null
    };
  }

  return {
    message: String(error ?? "Unknown client error"),
    name: "Error",
    stack: null
  };
}

function sanitizeOperation(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9._:-]+$/.test(normalized)) {
    return "unknown";
  }

  return normalized.slice(0, MAX_OPERATION_LENGTH);
}

function readTopStackFrame(stack: string | null | undefined): string | null {
  if (!stack) {
    return null;
  }

  return stack
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("at ") || line.includes("@"))
    ?.slice(0, 160) ?? null;
}

function buildFingerprint(parts: string[]): string {
  const value = parts.join("|");
  let hash = 5381;

  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }

  return `err-${(hash >>> 0).toString(36)}`;
}

function sanitizePropertyValue(value: unknown): ClientErrorPropertyValue | undefined {
  if (value === null || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === "string") {
    return sanitizeDiagnosticText(value, MAX_PROPERTY_STRING_LENGTH);
  }

  if (Array.isArray(value)) {
    const values: Array<boolean | number | string | null> = [];

    for (const item of value.slice(0, MAX_PROPERTY_ARRAY_LENGTH)) {
      const sanitized = sanitizePropertyValue(item);
      if (sanitized !== undefined && !Array.isArray(sanitized)) {
        values.push(sanitized);
      }
    }

    return values;
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
