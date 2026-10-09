// Supabase Edge Function entry point for rss-proxy (Phase 2.2).
// verify_jwt stays on in supabase/config.toml; the public anon key is enough to call it.
import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import { createSupabaseFeedStore } from "./feed-store.ts";
import { clientAddress, handleRssProxy, isRssOriginAllowed, type RssLogEntry } from "./handler.ts";
import { sha256Hex } from "./service.ts";
import { denoResolver } from "./url-guard.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const rateLimitSalt = Deno.env.get("RSS_RATE_LIMIT_SALT");
if (!supabaseUrl || !serviceRoleKey || !rateLimitSalt || rateLimitSalt.length < 32) {
  throw new Error("rss-proxy is missing its server configuration.");
}

// fetch() resolves DNS again after checkFetchTarget, and Deno cannot pin the connection to
// the checked address, so a DNS rebinding window remains. Go-live step 0 probed the hosted
// egress network and the residual risk was reviewed and accepted (Phase2_2_RssWidgetDesign.md,
// section 4); until that is recorded with this secret, the function refuses to start.
if (Deno.env.get("RSS_EGRESS_VERIFIED") !== "true") {
  throw new Error("rss-proxy egress verification has not been recorded.");
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
  clientKey: (request: Request) => sha256Hex(`${rateLimitSalt}:${clientAddress(request)}`),
  log: (entry: RssLogEntry) => {
    console.info(JSON.stringify({ fn: "rss-proxy", ...entry }));
  },
};

Deno.serve((request) => handleRssProxy(request, deps));
