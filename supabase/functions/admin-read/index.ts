// Supabase Edge Function entry point for admin-read (Phase 1.18.2-1.18.3).
// JWT verification stays enabled in supabase/config.toml; the handler still verifies
// the session and administrator itself because the function URL is public.
import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import { createSupabaseAdminAudit } from "../_shared/admin-audit.ts";
import { createSupabaseAdminAuth } from "../_shared/admin-auth.ts";
import { createSupabaseAdminReadStore } from "../_shared/admin-read-store.ts";
import { resolveAllowedOrigins } from "../_shared/cors.ts";
import { BASE_OPERATIONS, handleAdminRead } from "./handler.ts";
import { createReadOperations } from "./operations.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("admin-read is missing its server configuration.");
}

const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});

const deps = {
  allowedOrigins: resolveAllowedOrigins(Deno.env.get("ADMIN_ALLOWED_ORIGINS")),
  auth: createSupabaseAdminAuth(serviceClient),
  audit: createSupabaseAdminAudit(serviceClient),
  operations: {
    ...BASE_OPERATIONS,
    ...createReadOperations(createSupabaseAdminReadStore(serviceClient)),
  },
  log: (entry: { requestId: string; operation: string | null; outcome: string }) => {
    console.info(JSON.stringify({ fn: "admin-read", ...entry }));
  },
};

Deno.serve((request) => handleAdminRead(request, deps));
