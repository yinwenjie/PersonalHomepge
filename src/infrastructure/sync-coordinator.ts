export type SyncCoordinatorOperation =
  | "check"
  | "pull"
  | "push"
  | "force-push"
  | "bind"
  | "create"
  | "revoke";

export type SyncCoordinatorRunResult<T> =
  | { status: "completed"; value: T }
  | { status: "busy"; ownerId: string | null; operation: SyncCoordinatorOperation | null };

interface SyncCoordinatorLock {
  acquiredAt: number;
  expiresAt: number;
  operation: SyncCoordinatorOperation;
  ownerId: string;
  schema: typeof SYNC_COORDINATOR_SCHEMA;
  spaceId: string;
}

export interface RunWithSyncLockOptions {
  operation: SyncCoordinatorOperation;
  spaceId: string;
  storage: Storage;
  ttlMs?: number;
}

const SYNC_COORDINATOR_SCHEMA = "homepage-sync-lock-v1";
const SYNC_LOCK_PREFIX = "homepage:sync-lock:v1:";
const DEFAULT_SYNC_LOCK_TTL_MS = 15000;
const LOCK_BROADCAST_CHANNEL = "homepage-sync-coordinator";
const ownerId = createOwnerId();

export async function runWithSyncLock<T>(
  options: RunWithSyncLockOptions,
  action: () => Promise<T>
): Promise<SyncCoordinatorRunResult<T>> {
  const ttlMs = options.ttlMs ?? DEFAULT_SYNC_LOCK_TTL_MS;
  const key = getLockKey(options.spaceId);
  const acquired = acquireLock(options.storage, key, options.spaceId, options.operation, ttlMs);

  if (!acquired) {
    const current = readLock(options.storage, key);
    return {
      status: "busy",
      ownerId: current?.ownerId ?? null,
      operation: current?.operation ?? null
    };
  }

  broadcastSyncLockEvent("acquired", options.spaceId, options.operation);

  try {
    const value = await action();
    return { status: "completed", value };
  } finally {
    releaseLock(options.storage, key);
    broadcastSyncLockEvent("released", options.spaceId, options.operation);
  }
}

function acquireLock(
  storage: Storage,
  key: string,
  spaceId: string,
  operation: SyncCoordinatorOperation,
  ttlMs: number
): boolean {
  const current = readLock(storage, key);
  const now = Date.now();

  if (current && current.expiresAt > now && current.ownerId !== ownerId) {
    return false;
  }

  const nextLock: SyncCoordinatorLock = {
    acquiredAt: now,
    expiresAt: now + ttlMs,
    operation,
    ownerId,
    schema: SYNC_COORDINATOR_SCHEMA,
    spaceId
  };

  storage.setItem(key, JSON.stringify(nextLock));
  return readLock(storage, key)?.ownerId === ownerId;
}

function releaseLock(storage: Storage, key: string): void {
  const current = readLock(storage, key);
  if (!current || current.ownerId !== ownerId) {
    return;
  }

  storage.removeItem(key);
}

function readLock(storage: Storage, key: string): SyncCoordinatorLock | null {
  try {
    const raw = storage.getItem(key);
    const value = raw ? JSON.parse(raw) as SyncCoordinatorLock : null;

    if (!value || value.schema !== SYNC_COORDINATOR_SCHEMA || typeof value.ownerId !== "string") {
      return null;
    }

    if (value.expiresAt <= Date.now()) {
      storage.removeItem(key);
      return null;
    }

    return value;
  } catch {
    return null;
  }
}

function getLockKey(spaceId: string): string {
  return `${SYNC_LOCK_PREFIX}${encodeURIComponent(spaceId)}`;
}

function broadcastSyncLockEvent(
  type: "acquired" | "released",
  spaceId: string,
  operation: SyncCoordinatorOperation
): void {
  if (typeof BroadcastChannel === "undefined") {
    return;
  }

  try {
    const channel = new BroadcastChannel(LOCK_BROADCAST_CHANNEL);
    channel.postMessage({
      type,
      operation,
      ownerId,
      spaceId,
      createdAt: new Date().toISOString()
    });
    channel.close();
  } catch {
    // The localStorage lock is the source of truth; BroadcastChannel is just a hint.
  }
}

function createOwnerId(): string {
  const random = globalThis.crypto?.getRandomValues
    ? Array.from(globalThis.crypto.getRandomValues(new Uint32Array(2)), (value) => value.toString(36)).join("")
    : Math.random().toString(36).slice(2);

  return `tab-${Date.now().toString(36)}-${random}`;
}
