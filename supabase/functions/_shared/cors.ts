// CORS allowlist for admin-read. Origin is not an identity: every request is still
// authenticated with a Supabase JWT and authorized against admin_users.

export const PRODUCTION_ADMIN_ORIGIN = "https://admin.mylinker.net";
export const LOCAL_ADMIN_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"] as const;

// The public product sites must never be able to call the admin API.
const FORBIDDEN_HOSTS = ["mylinker.net", "www.mylinker.net"];
const FORBIDDEN_HOST_SUFFIXES = [".github.io"];

/**
 * Builds the allowed origin set from the fixed origins plus ADMIN_ALLOWED_ORIGINS
 * (comma separated). Extra entries must be exact https origins of a single host:
 * wildcards, paths, the public product hosts and GitHub Pages are ignored.
 */
export function resolveAllowedOrigins(extraOrigins: string | undefined): ReadonlySet<string> {
  const origins = new Set<string>([PRODUCTION_ADMIN_ORIGIN, ...LOCAL_ADMIN_ORIGINS]);

  for (const candidate of (extraOrigins ?? "").split(",")) {
    const origin = normalizeExtraOrigin(candidate.trim());
    if (origin) {
      origins.add(origin);
    }
  }

  return origins;
}

function normalizeExtraOrigin(candidate: string): string | null {
  if (!candidate || candidate.includes("*")) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.origin !== candidate.replace(/\/$/, "").toLowerCase() ||
    url.username ||
    url.password ||
    FORBIDDEN_HOSTS.includes(host) ||
    FORBIDDEN_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
  ) {
    return null;
  }

  return url.origin;
}

export function isAllowedOrigin(
  origin: string | null,
  allowedOrigins: ReadonlySet<string>,
): origin is string {
  return origin !== null && allowedOrigins.has(origin);
}

export function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  };
}
