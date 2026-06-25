import {
  PRODUCT_ANALYTICS_SCHEMA_VERSION,
  isProductAnalyticsEventName,
  sanitizeProductAnalyticsProperties,
  type ProductAnalyticsEventName,
  type ProductAnalyticsProperties
} from "@/domain/product-analytics";
import {
  getSupabaseBrowserClient,
  isSupabaseConfigured
} from "@/infrastructure/supabase-client";

export const PRODUCT_ANALYTICS_STORAGE_KEY = "homepage:analytics:v1";
export const PRODUCT_ANALYTICS_UPDATED_EVENT = "homepage:product-analytics-updated";

const PRODUCT_ANALYTICS_STORAGE_SCHEMA = "homepage-product-analytics-v1";
const SESSION_ID = createAnalyticsId("session");

interface ProductAnalyticsStorageValue {
  anonymousId: string;
  createdAt: string;
  enabled: boolean;
  schema: typeof PRODUCT_ANALYTICS_STORAGE_SCHEMA;
  updatedAt: string;
}

export interface ProductAnalyticsPreferences {
  anonymousId: string;
  enabled: boolean;
}

interface ProductAnalyticsRpcArgs {
  p_anonymous_id: string;
  p_app_version: string | null;
  p_client_created_at: string;
  p_event_name: ProductAnalyticsEventName;
  p_page_path: string | null;
  p_properties: ProductAnalyticsProperties;
  p_referrer_origin: string | null;
  p_schema_version: number;
  p_session_id: string;
}

export function loadProductAnalyticsPreferences(): ProductAnalyticsPreferences {
  if (typeof window === "undefined") {
    return {
      anonymousId: "",
      enabled: false
    };
  }

  try {
    const repository = new ProductAnalyticsRepository(window.localStorage);
    return repository.load();
  } catch {
    return {
      anonymousId: "",
      enabled: false
    };
  }
}

export function setProductAnalyticsEnabled(enabled: boolean): ProductAnalyticsPreferences {
  if (typeof window === "undefined") {
    return {
      anonymousId: "",
      enabled: false
    };
  }

  const repository = new ProductAnalyticsRepository(window.localStorage);
  const preferences = repository.setEnabled(enabled);
  window.dispatchEvent(new CustomEvent(PRODUCT_ANALYTICS_UPDATED_EVENT));
  trackProductEvent("analytics.preference_changed", {
    result: enabled ? "enabled" : "disabled"
  });
  return preferences;
}

export function trackProductEvent(
  eventName: ProductAnalyticsEventName,
  properties: object = {}
): void {
  if (typeof window === "undefined" || !isProductAnalyticsEventName(eventName)) {
    return;
  }

  try {
    const repository = new ProductAnalyticsRepository(window.localStorage);
    const preferences = repository.load();
    if (!preferences.enabled) {
      return;
    }

    const sanitizedProperties = sanitizeProductAnalyticsProperties(properties as Record<string, unknown>);
    const event = {
      eventName,
      properties: sanitizedProperties,
      preferences
    };

    if (!shouldUploadProductAnalytics()) {
      debugProductAnalytics(event.eventName, event.properties);
      return;
    }

    if (!isSupabaseConfigured()) {
      debugProductAnalytics(event.eventName, event.properties);
      return;
    }

    const args: ProductAnalyticsRpcArgs = {
      p_anonymous_id: preferences.anonymousId,
      p_app_version: process.env.NEXT_PUBLIC_APP_VERSION?.trim() || null,
      p_client_created_at: new Date().toISOString(),
      p_event_name: event.eventName,
      p_page_path: getSafePagePath(),
      p_properties: event.properties,
      p_referrer_origin: getReferrerOrigin(),
      p_schema_version: PRODUCT_ANALYTICS_SCHEMA_VERSION,
      p_session_id: SESSION_ID
    };

    void getSupabaseBrowserClient().rpc("record_product_event", args).then(({ error }) => {
      if (error) {
        debugProductAnalyticsFailure(error);
      }
    });
  } catch (error) {
    debugProductAnalyticsFailure(error);
  }
}

export class ProductAnalyticsRepository {
  constructor(private readonly storage: Storage) {}

  load(): ProductAnalyticsPreferences {
    const value = this.read();
    if (value) {
      return {
        anonymousId: value.anonymousId,
        enabled: value.enabled
      };
    }

    const now = new Date().toISOString();
    const nextValue: ProductAnalyticsStorageValue = {
      anonymousId: createAnalyticsId("anon"),
      createdAt: now,
      enabled: shouldEnableByDefault(),
      schema: PRODUCT_ANALYTICS_STORAGE_SCHEMA,
      updatedAt: now
    };

    this.storage.setItem(PRODUCT_ANALYTICS_STORAGE_KEY, JSON.stringify(nextValue));
    return {
      anonymousId: nextValue.anonymousId,
      enabled: nextValue.enabled
    };
  }

  setEnabled(enabled: boolean): ProductAnalyticsPreferences {
    const current = this.read();
    const now = new Date().toISOString();
    const nextValue: ProductAnalyticsStorageValue = {
      anonymousId: current?.anonymousId ?? createAnalyticsId("anon"),
      createdAt: current?.createdAt ?? now,
      enabled,
      schema: PRODUCT_ANALYTICS_STORAGE_SCHEMA,
      updatedAt: now
    };

    this.storage.setItem(PRODUCT_ANALYTICS_STORAGE_KEY, JSON.stringify(nextValue));
    return {
      anonymousId: nextValue.anonymousId,
      enabled: nextValue.enabled
    };
  }

  private read(): ProductAnalyticsStorageValue | null {
    try {
      const raw = this.storage.getItem(PRODUCT_ANALYTICS_STORAGE_KEY);
      const value = raw ? JSON.parse(raw) as ProductAnalyticsStorageValue : null;

      if (!value
        || value.schema !== PRODUCT_ANALYTICS_STORAGE_SCHEMA
        || typeof value.anonymousId !== "string"
        || typeof value.enabled !== "boolean") {
        return null;
      }

      return value;
    } catch {
      return null;
    }
  }
}

function shouldEnableByDefault(): boolean {
  if (typeof navigator !== "undefined" && navigator.doNotTrack === "1") {
    return false;
  }

  return true;
}

function shouldUploadProductAnalytics(): boolean {
  return process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_PRODUCT_ANALYTICS_DEBUG === "true";
}

function debugProductAnalytics(eventName: ProductAnalyticsEventName, properties: ProductAnalyticsProperties): void {
  if (process.env.NEXT_PUBLIC_PRODUCT_ANALYTICS_DEBUG === "true") {
    console.debug("[product-analytics]", eventName, properties);
  }
}

function debugProductAnalyticsFailure(error: unknown): void {
  if (process.env.NEXT_PUBLIC_PRODUCT_ANALYTICS_DEBUG === "true") {
    console.debug("[product-analytics] dropped event", error);
  }
}

function createAnalyticsId(prefix: string): string {
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

function getReferrerOrigin(): string | null {
  try {
    if (!document.referrer) {
      return null;
    }

    return new URL(document.referrer).origin.slice(0, 160);
  } catch {
    return null;
  }
}
