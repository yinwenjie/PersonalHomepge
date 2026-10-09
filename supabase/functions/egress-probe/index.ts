// Temporary go-live probe for rss-proxy (docs/implementation/phase-2/Phase2_2_RssWidgetDesign.md,
// egress check). The rss-egress-probe workflow deploys it, calls it once and deletes it in the
// same run. It takes no input and only requests the fixed targets below.

import { TARGETS } from "./targets.ts";

async function attempt(url: string): Promise<string> {
  try {
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(3000) });
    await response.body?.cancel();
    return `response ${response.status}`;
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return "timeout";
    }
    const name = error instanceof Error ? error.name : "Error";
    const message = error instanceof Error ? error.message : String(error);
    // The cause tells "connection refused" or a TLS failure (reachable) apart from
    // "unreachable" or DNS errors.
    const cause = error instanceof Error && error.cause instanceof Error
      ? ` (${error.cause.message})`
      : "";
    return `error ${name}: ${`${message}${cause}`.slice(0, 200)}`;
  }
}

Deno.serve(async (request) => {
  const forwardedFor = (request.headers.get("X-Forwarded-For") ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  // In parallel, so the timeouts of blocked targets do not add up.
  const results = await Promise.all(
    TARGETS.map(async (target) => ({ ...target, outcome: await attempt(target.url) })),
  );

  return Response.json({
    forwardedFor,
    createHttpClient: "createHttpClient" in Deno,
    results,
  });
});
