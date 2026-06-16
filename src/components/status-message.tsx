"use client";

import type { ReactNode } from "react";

export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

interface StatusMessageProps {
  children: ReactNode;
  className?: string;
  role?: "status" | "alert";
  tone?: StatusTone;
}

export function StatusMessage({
  children,
  className = "",
  role = "status",
  tone = "neutral"
}: StatusMessageProps) {
  if (!children) {
    return null;
  }

  return (
    <p className={`status-message status-message-${tone}${className ? ` ${className}` : ""}`} role={role}>
      {children}
    </p>
  );
}
