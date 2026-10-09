import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1.0.14";
import { FeedError } from "../rss-proxy/contract.ts";
import {
  assertHostAllowed,
  checkFetchTarget,
  ipLiteral,
  isBlockedAddress,
  normalizeFeedUrl,
} from "../rss-proxy/url-guard.ts";

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return error instanceof FeedError ? error.code : "other";
  }
  return "allowed";
}

function blocked(address: string): boolean {
  const parsed = ipLiteral(address);
  if (!parsed) {
    throw new Error(`not an IP: ${address}`);
  }
  return isBlockedAddress(parsed);
}

Deno.test("normalizeFeedUrl keeps http(s) on default ports and drops the fragment", () => {
  assertEquals(
    normalizeFeedUrl("  HTTPS://Example.COM:443/feed.xml?x=1#top ").href,
    "https://example.com/feed.xml?x=1",
  );
  assertEquals(normalizeFeedUrl("http://example.com:80/rss").href, "http://example.com/rss");
});

Deno.test("normalizeFeedUrl rejects other schemes, ports, credentials and long URLs", () => {
  for (
    const raw of [
      "ftp://example.com/feed",
      "javascript:alert(1)",
      "file:///etc/passwd",
      "https://example.com:8443/feed",
      "https://user:pass@example.com/feed",
      "https://user@example.com/feed",
      "not a url",
      `https://example.com/${"a".repeat(2050)}`,
    ]
  ) {
    assertEquals(code(() => normalizeFeedUrl(raw)), "invalid_url", raw);
  }
});

Deno.test("assertHostAllowed blocks local names and private IP literals in every spelling", () => {
  for (
    const raw of [
      "http://localhost/feed",
      "http://localhost./feed",
      "http://api.localhost/feed",
      "http://printer.local/feed",
      "http://metadata.google.internal/feed",
      "http://router.home.arpa/feed",
      "http://intranet/feed",
      "http://127.0.0.1/feed",
      "http://2130706433/feed", // decimal 127.0.0.1
      "http://0177.0.0.1/feed", // octal
      "http://0x7f.1/feed", // hex shorthand
      "http://10.1.2.3/feed",
      "http://172.16.0.1/feed",
      "http://192.168.1.1/feed",
      "http://169.254.169.254/latest/meta-data",
      "http://100.64.0.1/feed",
      "http://0.0.0.0/feed",
      "http://[::1]/feed",
      "http://[::ffff:127.0.0.1]/feed",
      "http://[::ffff:a9fe:a9fe]/feed",
      "http://[fd00::1]/feed",
      "http://[fe80::1]/feed",
      "http://[64:ff9b::a00:1]/feed",
      "http://[2002:c0a8:101::1]/feed",
    ]
  ) {
    assertEquals(code(() => assertHostAllowed(normalizeFeedUrl(raw))), "blocked_address", raw);
  }
});

Deno.test("assertHostAllowed lets public names and addresses through", () => {
  for (
    const raw of [
      "https://example.com/feed",
      "https://8.8.8.8/feed",
      "https://[2606:4700:4700::1111]/feed",
    ]
  ) {
    assertEquals(code(() => assertHostAllowed(normalizeFeedUrl(raw))), "allowed", raw);
  }
});

Deno.test("isBlockedAddress covers special IPv4 and IPv6 ranges", () => {
  for (
    const address of [
      "192.0.0.8",
      "192.0.2.1",
      "198.18.0.1",
      "198.51.100.1",
      "203.0.113.1",
      "224.0.0.1",
      "255.255.255.255",
      "::",
      "::ffff:10.0.0.1",
      "::10.0.0.1",
      "ff02::1",
      "fc00::1",
      "fec0::1",
      "2001::1",
      "2001:db8::1",
      "100::1",
    ]
  ) {
    assertEquals(blocked(address), true, address);
  }
  for (const address of ["1.1.1.1", "93.184.216.34", "2606:4700::1", "::ffff:8.8.8.8"]) {
    assertEquals(blocked(address), false, address);
  }
});

Deno.test("ipLiteral rejects malformed addresses", () => {
  for (const value of ["1.2.3", "256.1.1.1", "1::2::3", "12345::", "1:2:3:4:5:6:7:8:9", "g::1"]) {
    assertEquals(ipLiteral(value), null, value);
  }
  assertEquals(ipLiteral("1:2:3:4:5:6:7:8") !== null, true);
});

Deno.test("checkFetchTarget checks every resolved address and fails closed", async () => {
  const url = normalizeFeedUrl("https://feeds.example.com/rss");
  await checkFetchTarget(url, () => Promise.resolve(["93.184.216.34", "2606:4700::1"]));

  for (
    const answer of [
      ["93.184.216.34", "10.0.0.5"],
      ["2606:4700::1", "::1"],
      ["169.254.169.254"],
      ["not-an-ip"],
    ]
  ) {
    const error = await assertRejects(
      () => checkFetchTarget(url, () => Promise.resolve(answer)),
      FeedError,
    );
    assertEquals(error.code, "blocked_address", answer.join(","));
  }

  const empty = await assertRejects(
    () => checkFetchTarget(url, () => Promise.resolve([])),
    FeedError,
  );
  assertEquals(empty.code, "fetch_failed");

  const failing = await assertRejects(
    () => checkFetchTarget(url, () => Promise.reject(new Error("nxdomain"))),
    FeedError,
  );
  assertEquals(failing.code, "fetch_failed");
});

Deno.test("checkFetchTarget never resolves a blocked hostname", async () => {
  let resolved = false;
  const error = await assertRejects(
    () =>
      checkFetchTarget(normalizeFeedUrl("http://localhost/feed"), () => {
        resolved = true;
        return Promise.resolve(["93.184.216.34"]);
      }),
    FeedError,
  );
  assertEquals(error.code, "blocked_address");
  assertEquals(resolved, false);
  assertThrows(() => assertHostAllowed(normalizeFeedUrl("http://[::]/")), FeedError);
});
