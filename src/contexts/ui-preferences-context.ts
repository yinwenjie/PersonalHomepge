"use client";

import { createContext } from "react";
import type { AccountPreferences } from "@/domain/account";
import type { UiPreferences } from "@/domain/ui-preferences";

export interface UiPreferencesState {
  preferences: UiPreferences;
  source: "default" | "local" | "account";
  loading: boolean;
  error: string;
  updateLocalPreferences: (preferences: UiPreferences) => void;
  applyAccountPreferences: (preferences: AccountPreferences) => void;
}

export const UiPreferencesContext = createContext<UiPreferencesState | null>(null);
