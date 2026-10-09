// Temporary go-live probe for rss-proxy (docs/implementation/phase-2/Phase2_2_RssWidgetDesign.md,
// egress check). The rss-egress-probe workflow deploys it, calls it once and deletes it in the
// same run. It takes no input and only requests the fixed targets below.

interface Target {
  name: string;
  url: string;
  /** true for the public control, which must answer; every other target must not. */
  control?: boolean;
  /** true when failing to resolve the name already means it cannot be reached. */
  unresolvableIsBlocked?: boolean;
}

export const TARGETS: Target[] = [
  { name: "public control", url: "https://example.com/", control: true },
  { name: "cloud metadata IPv4", url: "http://169.254.169.254/latest/meta-data/" },
  { name: "cloud metadata IPv6", url: "http://[fd00:ec2::254]/latest/meta-data/" },
  {
    name: "metadata hostname",
    url: "http://metadata.google.internal/",
    unresolvableIsBlocked: true,
  },
  { name: "public name resolving to metadata", url: "http://169.254.169.254.nip.io/" },
  { name: "public name resolving to private", url: "http://10.0.0.1.nip.io/" },
  { name: "private 10/8", url: "http://10.0.0.1/" },
  { name: "private 172.16/12", url: "http://172.16.0.1/" },
  { name: "private 192.168/16", url: "http://192.168.0.1/" },
  { name: "loopback IPv4", url: "http://127.0.0.1/" },
  { name: "loopback IPv6", url: "http://[::1]/" },
];

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
    // The cause tells "connection refused" (reachable) apart from "unreachable" or DNS errors.
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

  const results = [];
  for (const target of TARGETS) {
    results.push({ ...target, outcome: await attempt(target.url) });
  }

  return Response.json({
    forwardedFor,
    createHttpClient: "createHttpClient" in Deno,
    results,
  });
});
