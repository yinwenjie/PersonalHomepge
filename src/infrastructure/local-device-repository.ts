export const LOCAL_DEVICE_STORAGE_KEY = "homepage:device:v1";

const LOCAL_DEVICE_SCHEMA = "homepage-device-v1";

export interface LocalDeviceRecord {
  id: string;
  createdAt: string;
  language: string | null;
  lastSeenAt: string;
  timeZone: string | null;
  userAgent: string | null;
}

interface LocalDeviceStorageValue extends LocalDeviceRecord {
  schema: typeof LOCAL_DEVICE_SCHEMA;
}

export class LocalDeviceRepository {
  constructor(private readonly storage: Storage) {}

  load(): LocalDeviceRecord | null {
    try {
      const raw = this.storage.getItem(LOCAL_DEVICE_STORAGE_KEY);
      const value = raw ? JSON.parse(raw) as LocalDeviceStorageValue : null;
      if (!value || value.schema !== LOCAL_DEVICE_SCHEMA || typeof value.id !== "string") {
        return null;
      }

      return toDeviceRecord(value);
    } catch {
      return null;
    }
  }

  touch(): LocalDeviceRecord {
    const now = new Date().toISOString();
    const existing = this.load();
    const nextRecord: LocalDeviceRecord = {
      id: existing?.id ?? createDeviceId(),
      createdAt: existing?.createdAt ?? now,
      language: getBrowserLanguage(),
      lastSeenAt: now,
      timeZone: getTimeZone(),
      userAgent: getUserAgent()
    };

    this.storage.setItem(LOCAL_DEVICE_STORAGE_KEY, JSON.stringify({
      schema: LOCAL_DEVICE_SCHEMA,
      ...nextRecord
    } satisfies LocalDeviceStorageValue));

    return nextRecord;
  }
}

export function loadOrTouchLocalDevice(): LocalDeviceRecord | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return new LocalDeviceRepository(window.localStorage).touch();
  } catch {
    return null;
  }
}

export function formatDeviceShortId(deviceId: string | null | undefined): string {
  if (!deviceId) {
    return "未初始化";
  }

  return deviceId.slice(-8);
}

function toDeviceRecord(value: LocalDeviceStorageValue): LocalDeviceRecord {
  return {
    id: value.id,
    createdAt: value.createdAt,
    language: value.language,
    lastSeenAt: value.lastSeenAt,
    timeZone: value.timeZone,
    userAgent: value.userAgent
  };
}

function createDeviceId(): string {
  const random = globalThis.crypto?.getRandomValues
    ? Array.from(globalThis.crypto.getRandomValues(new Uint32Array(2)), (value) => value.toString(36)).join("")
    : Math.random().toString(36).slice(2);

  return `device-${Date.now().toString(36)}-${random}`;
}

function getBrowserLanguage(): string | null {
  return typeof navigator === "undefined" ? null : navigator.language || null;
}

function getTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

function getUserAgent(): string | null {
  return typeof navigator === "undefined" ? null : navigator.userAgent || null;
}
