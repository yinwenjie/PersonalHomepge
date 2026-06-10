"use client";

import { useContext } from "react";
import { SupabaseAuthContext, type SupabaseAuthState } from "@/contexts/supabase-auth-context";

export function useSupabaseAuth(): SupabaseAuthState {
  const context = useContext(SupabaseAuthContext);
  if (!context) {
    throw new Error("useSupabaseAuth must be used within SupabaseAuthProvider");
  }

  return context;
}
