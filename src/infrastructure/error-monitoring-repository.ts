import {
  ERROR_MONITORING_SCHEMA_VERSION,
  normalizeClientError,
  type ClientErrorEventType,
  type ClientErrorProperties,
  type ClientErrorSeverity
} from "@/domain/error-monitoring";
import {
  getSupabaseBrowserClient,
  isSupabaseConfigured
} from "@/infrastructure/supabase-client";

export const ERROR_MONITORING_STORAGE_KEY = "homepage:error-monitoring:v1";
export const ERROR_MONITORING_UPDATED_EVENT = "homepage:error-monitoring-updated";

const ERROR_MONITORING_STORAGE_SCHEMA = "homepage-error-monitoring-v1";
const SESSION_ID = createMonitoringId("session");
const MAX_EVENTS_PER_SESSION = 30;
const FINGERPRINT_SUPPRESSION_MS = 5 * 60 * 1000;

let sessionEventCount = 0;
const fingerprintLastSentAt = new Map<string, number>();

interface ErrorMonitoringStorageValue {
  createdAt: string;
  diagnosticId: string;
  enabled: boolean;
  schema: typeof ERROR_MONITORING_STORAGE_SCHEMA;
  updatedAt: string;
}

export interface ErrorMonitoringPreferences {
  diagnosticId: string;
  enabled: boolean;
}

export interface ClientErrorCaptureContext {
  componentStack?: string | null;
  eventType: ClientErrorEventType;
  operation?: string | null;
  properties?: Record<string, unknown>;
  severity?: ClientErrorSeverity;
}

interface ClientErrorRpcArgs {
  p_anonymous_id: string;
  p_app_version: string | null;
  p_client_created_at: string;
  p_component_stack_sanitized: string | null;
  p_error_name: string;
  p_event_type: ClientErrorEventType;
  p_fingerprint: string;
  p_message_sanitized: string;
  p_operation: string | null;
  p_page_path: string | null;
  p_properties: ClientErrorProperties;
  p_schema_version: number;
  p_session_id: string;
  p_severity: ClientErrorSeverity;
  p_stack_sanitized: string | null;
}

export function loadErrorMonitoringPreferences(): ErrorMonitoringPreferences {
  if (typeof window === "undefined") {
    return {
      diagnosticId: "",
      enabled: false
    };
  }

  try {
    const repository = new ErrorMonitoringRepository(window.localStorage);
    return repository.load();
  } catch {
    return {
      diagnosticId: "",
      enabled: false
    };
  }
}

export function setErrorMonitoringEnabled(enabled: boolean): ErrorMonitoringPreferences {
  if (typeof window === "undefined") {
    return {
      diagnosticId: "",
      enabled: false
    };
  }

  const repository = new ErrorMonitoringRepository(window.localStorage);
  const preferences = repository.setEnabled(enabled);
  window.dispatchEvent(new CustomEvent(ERROR_MONITORING_UPDATED_EVENT));
  return preferences;
}

export function captureClientError(error: unknown, context: ClientErrorCaptureContext): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const repository = new ErrorMonitoringRepository(window.localStorage);
    const preferences = repository.load();
    const normalized = normalizeClientError({
      componentStack: context.componentStack,
      error,
      eventType: context.eventType,
      operation: context.operation,
      properties: {
        ...context.properties,
        online: navigator.onLine,
        visibilityState: document.visibilityState
      }
    });

    if (!preferences.enabled) {
      return null;
    }

    if (!shouldSendFingerprint(normalized.fingerprint)) {
      return normalized.fingerprint;
    }

    if (!shouldUploadErrorMonitoring()) {
      debugClientError(normalized.fingerprint, context.eventType, normalized.properties);
      return normalized.fingerprint;
    }

    if (!isSupabaseConfigured()) {
      debugClientError(normalized.fingerprint, context.eventType, normalized.properties);
      return normalized.fingerprint;
    }

    const args: ClientErrorRpcArgs = {
      p_anonymous_id: preferences.diagnosticId,
      p_app_version: process.env.NEXT_PUBLIC_APP_VERSION?.trim() || null,
      p_client_created_at: new Date().toISOString(),
      p_component_stack_sanitized: normalized.componentStack,
      p_error_name: normalized.errorName,
      p_event_type: context.eventType,
      p_fingerprint: normalized.fingerprint,
      p_message_sanitized: normalized.message,
      p_operation: normalized.operation,
      p_page_path: getSafePagePath(),
      p_properties: normalized.properties,
      p_schema_version: ERROR_MONITORING_SCHEMA_VERSION,
      p_session_id: SESSION_ID,
      p_severity: context.severity ?? "error",
      p_stack_sanitized: normalized.stack
    };

    void getSupabaseBrowserClient().rpc("record_client_error_event", args).then(
      ({ error: rpcError }) => {
        if (rpcError) {
          debugClientErrorFailure(rpcError);
        }
      },
      (rpcError: unknown) => {
        debugClientErrorFailure(rpcError);
      }
    );

    return normalized.fingerprint;
  } catch (monitoringError) {
    debugClientErrorFailure(monitoringError);
    return null;
  }
}

export class ErrorMonitoringRepository {
  constructor(private readonly storage: Storage) {}

  load(): ErrorMonitoringPreferences {
    const value = this.read();
    if (value) {
      return {
        diagnosticId: value.diagnosticId,
        enabled: value.enabled
      };
    }

    const now = new Date().toISOString();
    const nextValue: ErrorMonitoringStorageValue = {
      createdAt: now,
      diagnosticId: createMonitoringId("diag"),
      enabled: shouldEnableByDefault(),
      schema: ERROR_MONITORING_STORAGE_SCHEMA,
      updatedAt: now
    };

    this.storage.setItem(ERROR_MONITORING_STORAGE_KEY, JSON.stringify(nextValue));
    return {
      diagnosticId: nextValue.diagnosticId,
      enabled: nextValue.enabled
    };
  }

  setEnabled(enabled: boolean): ErrorMonitoringPreferences {
    const current = this.read();
    const now = new Date().toISOString();
    const nextValue: ErrorMonitoringStorageValue = {
      createdAt: current?.createdAt ?? now,
      diagnosticId: current?.diagnosticId ?? createMonitoringId("diag"),
      enabled,
      schema: ERROR_MONITORING_STORAGE_SCHEMA,
      updatedAt: now
    };

    this.storage.setItem(ERROR_MONITORING_STORAGE_KEY, JSON.stringify(nextValue));
    return {
      diagnosticId: nextValue.diagnosticId,
      enabled: nextValue.enabled
    };
  }

  private read(): ErrorMonitoringStorageValue | null {
    try {
      const raw = this.storage.getItem(ERROR_MONITORING_STORAGE_KEY);
      const value = raw ? JSON.parse(raw) as ErrorMonitoringStorageValue : null;

      if (!value
        || value.schema !== ERROR_MONITORING_STORAGE_SCHEMA
        || typeof value.diagnosticId !== "string"
        || typeof value.enabled !== "boolean") {
        return null;
      }

      return value;
    } catch {
      return null;
    }
  }
}

function shouldSendFingerprint(fingerprint: string): boolean {
  if (sessionEventCount >= MAX_EVENTS_PER_SESSION) {
    return false;
  }

  const now = Date.now();
  const lastSentAt = fingerprintLastSentAt.get(fingerprint) ?? 0;
  if (now - lastSentAt < FINGERPRINT_SUPPRESSION_MS) {
    return false;
  }

  sessionEventCount += 1;
  fingerprintLastSentAt.set(fingerprint, now);
  return true;
}

function shouldEnableByDefault(): boolean {
  if (typeof navigator !== "undefined" && navigator.doNotTrack === "1") {
    return false;
  }

  return true;
}

function shouldUploadErrorMonitoring(): boolean {
  return process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_ERROR_MONITORING_DEBUG === "true";
}

function debugClientError(fingerprint: string, eventType: ClientErrorEventType, properties: ClientErrorProperties): void {
  if (process.env.NEXT_PUBLIC_ERROR_MONITORING_DEBUG === "true") {
    console.debug("[error-monitoring]", fingerprint, eventType, properties);
  }
}

function debugClientErrorFailure(error: unknown): void {
  if (process.env.NEXT_PUBLIC_ERROR_MONITORING_DEBUG === "true") {
    console.debug("[error-monitoring] dropped event", error);
  }
}

function createMonitoringId(prefix: string): string {
  const random = globalThis.crypto?.getRandomValues
    ? Array.from(globalThis.crypto.getRandomValues(new Uint32Array(3)), (value) => value.toString(36)).join("")
    : Math.random().toString(36).slice(2);

  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

function getSafePagePath(): string | null {
  try {
    return window.location.pathname.slice(0, 160);
  } catch {
    return null;
  }
}
