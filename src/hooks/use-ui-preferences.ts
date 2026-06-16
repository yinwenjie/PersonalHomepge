"use client";

import { useContext } from "react";
import { UiPreferencesContext, type UiPreferencesState } from "@/contexts/ui-preferences-context";

export function useUiPreferences(): UiPreferencesState {
  const context = useContext(UiPreferencesContext);
  if (!context) {
    throw new Error("useUiPreferences must be used within UiPreferencesProvider");
  }

  return context;
}
