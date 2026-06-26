"use client";

import type { ReactNode } from "react";
import { ErrorMonitorBoundary } from "@/components/error-monitor-boundary";
import { ErrorMonitoringInstaller } from "@/components/error-monitoring-installer";
import { SupabaseAuthProvider } from "@/providers/supabase-auth-provider";
import { UiPreferencesProvider } from "@/providers/ui-preferences-provider";

interface AppRuntimeShellProps {
  children: ReactNode;
}

export function AppRuntimeShell({ children }: AppRuntimeShellProps) {
  return (
    <ErrorMonitorBoundary>
      <ErrorMonitoringInstaller />
      <SupabaseAuthProvider>
        <UiPreferencesProvider>{children}</UiPreferencesProvider>
      </SupabaseAuthProvider>
    </ErrorMonitorBoundary>
  );
}
