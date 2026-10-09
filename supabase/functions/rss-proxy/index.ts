// Supabase Edge Function entry point for rss-proxy (Phase 2.2).
// verify_jwt stays on in supabase/config.toml; the public anon key is enough to call it.
import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import { createSupabaseFeedStore } from "./feed-store.ts";
import { handleRssProxy, isRssOriginAllowed, type RssLogEntry } from "./handler.ts";
import { sha256Hex } from "./service.ts";
import { denoResolver } from "./url-guard.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const rateLimitSalt = Deno.env.get("RSS_RATE_LIMIT_SALT");
if (!supabaseUrl || !serviceRoleKey || !rateLimitSalt || rateLimitSalt.length < 32) {
  throw new Error("rss-proxy is missing its server configuration.");
}

const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});

const deps = {
  store: createSupabaseFeedStore(serviceClient),
  fetcher: {
    fetch: (input: string, init: RequestInit) => fetch(input, init),
    resolve: denoResolver,
  },
  isAllowedOrigin: isRssOriginAllowed,
  // The platform appends the real client address to X-Forwarded-For; the first entry is the
  // client. Confirm against the Supabase docs before go-live (runbook step).
  clientKey: (request: Request) => {
    const forwarded = request.headers.get("X-Forwarded-For") ?? "";
    const ip = forwarded.split(",")[0].trim() || "unknown";
    return sha256Hex(`${rateLimitSalt}:${ip}`);
  },
  log: (entry: RssLogEntry) => {
    console.info(JSON.stringify({ fn: "rss-proxy", ...entry }));
  },
};

Deno.serve((request) => handleRssProxy(request, deps));
