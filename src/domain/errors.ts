export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  if (isRecord(error)) {
    const message = readString(error.message);
    const details = readString(error.details);
    const hint = readString(error.hint);
    const code = readString(error.code);
    const parts = [message];

    if (details && details !== message) {
      parts.push(details);
    }

    if (hint) {
      parts.push(`提示：${hint}`);
    }

    if (code) {
      parts.push(`错误码：${code}`);
    }

    const formatted = parts.filter(Boolean).join(" ");
    if (formatted) {
      return formatted;
    }
  }

  return fallback;
}

export function getActionErrorMessage(action: string, error: unknown): string {
  const message = getErrorMessage(error, `${action}。`);
  return message.startsWith(action) ? message : `${action}：${message}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
