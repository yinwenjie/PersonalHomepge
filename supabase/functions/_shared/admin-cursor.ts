// Opaque keyset cursors for admin-read list operations. Server-only.
// A cursor is bound to the operation and target it was issued for, so it cannot be
// replayed against another user or space.
import { AdminRequestError, isPlainObject, MAX_CURSOR_LENGTH } from "./admin-contract.ts";

export interface PagePosition {
  createdAt: string;
  id: string;
}

const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && TIMESTAMP_PATTERN.test(value) &&
    !Number.isNaN(Date.parse(value));
}

export function encodeCursor(scope: string, position: PagePosition): string {
  const json = JSON.stringify({ v: 1, s: scope, t: position.createdAt, i: position.id });
  return btoa(json).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** Decodes a cursor issued for `scope`; anything else is invalid_request. */
export function decodeCursor(cursor: string | null, scope: string): PagePosition | null {
  if (cursor === null) {
    return null;
  }

  if (cursor.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
    throw new AdminRequestError("invalid_request");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(atob(cursor.replaceAll("-", "+").replaceAll("_", "/")));
  } catch {
    throw new AdminRequestError("invalid_request");
  }

  if (
    !isPlainObject(parsed) || parsed.v !== 1 || parsed.s !== scope || !isTimestamp(parsed.t) ||
    typeof parsed.i !== "string" || !UUID_PATTERN.test(parsed.i)
  ) {
    throw new AdminRequestError("invalid_request");
  }

  return { createdAt: parsed.t, id: parsed.i };
}
