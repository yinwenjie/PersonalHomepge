"use client";

import { createContext } from "react";
import type { Session, User } from "@supabase/supabase-js";

export interface SupabaseAuthState {
  user: User | null;
  session: Session | null;
  configured: boolean;
  loading: boolean;
  actionPending: boolean;
  message: string;
  error: string;
  signInWithMagicLink: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
}

export const SupabaseAuthContext = createContext<SupabaseAuthState | null>(null);
