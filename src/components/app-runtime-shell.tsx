"use client";

import type { ReactNode } from "react";
import { ConfirmDialogHost } from "@/components/confirm-dialog";
import { ErrorMonitorBoundary } from "@/components/error-monitor-boundary";
import { ErrorMonitoringInstaller } from "@/components/error-monitoring-installer";
import { SupabaseAuthProvider } from "@/providers/supabase-auth-provider";
import { I18nProvider } from "@/providers/i18n-provider";
import { UiPreferencesProvider } from "@/providers/ui-preferences-provider";

interface AppRuntimeShellProps {
  children: ReactNode;
}

export function AppRuntimeShell({ children }: AppRuntimeShellProps) {
  return (
    <ErrorMonitorBoundary>
      <ErrorMonitoringInstaller />
      <SupabaseAuthProvider>
        <UiPreferencesProvider>
          <I18nProvider>
            {children}
            <ConfirmDialogHost />
          </I18nProvider>
        </UiPreferencesProvider>
      </SupabaseAuthProvider>
    </ErrorMonitorBoundary>
  );
}
