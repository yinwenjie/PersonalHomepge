#!/usr/bin/env node

// Post-deploy check for rss-proxy (Phase2_2_RssWidgetDesign.md, go-live checks):
// 1. One real read of several feeds on different hosts. Each feed's status and error code is
//    printed; the check fails unless at least one comes back with items, so the function, its
//    secrets, the database and outbound fetching all work.
// 2. The per-IP limit holds against forged client-address headers: 61 requests from this
//    runner, each with a different forged CF-Connecting-IP and X-Forwarded-For, must end
//    with the 61st rate limited. Requests 2-61 send an invalid body, which the limit counts
//    before the body is read, so they cause no outbound fetches.
// 3. Reports whether the gateway accepts the publishable key the website uses (information
//    for the frontend work; it does not fail the check).
// Changes nothing except rate-limit counters and one cached feed.

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = "https://mylinker.net";
const SAMPLE_FEEDS = [
  "https://github.blog/feed/",
  "https://blog.cloudflare.com/rss/",
  "https://hnrss.org/frontpage",
  "https://www.ruanyifeng.com/blog/atom.xml",
  "https://deno.com/feed"
];
const READ_BODY = JSON.stringify({ mode: "read", feeds: SAMPLE_FEEDS });
const REQUESTS = 61;

function fail(message) {
  console.error(`rss-proxy smoke check error: ${message}`);
  process.exit(1);
}

/** Reads the legacy anon JWT without printing it; masked in case anything echoes it. */
function anonKey(projectRef) {
  const result = spawnSync(
    "supabase",
    ["projects", "api-keys", "--project-ref", projectRef, "-o", "json"],
    { cwd: rootDir, env: process.env, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }
  );
  if (result.error || result.status !== 0) {
    throw new Error("could not list the project's API keys.");
  }
  let key;
  try {
    const rows = JSON.parse(result.stdout);
    key = (Array.isArray(rows) ? rows : []).find((row) => row?.name === "anon")?.api_key;
  } catch {
    key = result.stdout.match(/\banon\b\s*[|│]\s*(eyJ[\w.-]+)/)?.[1];
  }
  if (!key) {
    throw new Error("could not read the project's anon key.");
  }
  console.log(`::add-mask::${key}`);
  return key;
}

async function call(url, key, body, extraHeaders = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      Origin: ORIGIN,
      "Content-Type": "application/json",
      ...extraHeaders
    },
    body
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Not the function's JSON: a gateway or edge response.
  }
  return { status: response.status, json };
}

/** Prints one line per feed and returns how many came back with items. */
function reportFeeds(label, result) {
  console.log(`${label}: HTTP ${result.status}${result.json?.error ? ` ${result.json.error}` : ""}`);
  let withItems = 0;
  for (const feed of result.json?.feeds ?? []) {
    const items = Array.isArray(feed?.items) ? feed.items.length : 0;
    console.log(`  ${feed?.url ?? "?"}: status ${feed?.status ?? "-"}, `
      + `errorCode ${feed?.errorCode ?? "-"}, items ${items}`);
    if (items > 0) {
      withItems += 1;
    }
  }
  return withItems;
}

/** True when the response came from rss-proxy itself, not the gateway or Cloudflare. */
function fromFunction(result) {
  return result.json !== null && typeof result.json === "object"
    && (Array.isArray(result.json.feeds) || typeof result.json.error === "string");
}

const projectRef = String(process.env.SUPABASE_PROJECT_ID ?? "").trim();
const confirmation = String(process.env.SMOKE_CONFIRM_PROJECT_REF ?? "").trim();
const publishableKey = String(process.env.PUBLISHABLE_KEY ?? "").trim();
if (!/^[a-z0-9]{20}$/.test(projectRef)) {
  fail("SUPABASE_PROJECT_ID must be the exact 20-character hosted project ref.");
}
if (confirmation !== projectRef) {
  fail("the confirmation input must exactly match the target project ref.");
}

const url = `https://${projectRef}.supabase.co/functions/v1/rss-proxy`;
const problems = [];
try {
  const key = anonKey(projectRef);

  // 1. A real read.
  let read = await call(url, key, READ_BODY, {
    "CF-Connecting-IP": "198.51.100.1",
    "X-Forwarded-For": "203.0.113.1"
  });
  const forgeCf = fromFunction(read);
  if (!forgeCf) {
    // Cloudflare may refuse a forged CF-Connecting-IP outright, which also means it cannot be
    // forged. Retry the read without it so the rest of the check still runs.
    console.log(`The request with a forged CF-Connecting-IP did not reach the function `
      + `(HTTP ${read.status}); continuing without forging that header.`);
    read = await call(url, key, READ_BODY, { "X-Forwarded-For": "203.0.113.1" });
    if (!fromFunction(read)) {
      throw new Error(`the function did not answer a read (HTTP ${read.status}).`);
    }
  }
  const withItems = reportFeeds("Read", read);
  if (read.status !== 200) {
    problems.push(`the read returned HTTP ${read.status} (${read.json?.error ?? "?"})`);
  } else if (withItems === 0) {
    problems.push("no sample feed returned items, so outbound fetching is not working");
  }

  // 2. Requests 2..61 with a different forged address each.
  const outcomes = [];
  for (let index = 2; index <= REQUESTS; index += 1) {
    const headers = { "X-Forwarded-For": `203.0.113.${index}` };
    if (forgeCf) {
      headers["CF-Connecting-IP"] = `198.51.100.${index}`;
    }
    const result = await call(url, key, "{}", headers);
    if (!fromFunction(result)) {
      throw new Error(`request ${index} did not reach the function (HTTP ${result.status}).`);
    }
    outcomes.push({ index, status: result.status, error: result.json.error ?? null });
  }
  const limitedEarly = outcomes.filter((outcome) => outcome.index < REQUESTS
    && outcome.error === "rate_limited");
  const last = outcomes[outcomes.length - 1];
  console.log(`Requests 2-${REQUESTS - 1}: ${outcomes.length - 1 - limitedEarly.length} accepted, `
    + `${limitedEarly.length} rate limited.`);
  console.log(`Request ${REQUESTS}: HTTP ${last.status} ${last.error ?? ""}`);
  if (last.error !== "rate_limited") {
    problems.push(`request ${REQUESTS} was not rate limited, so forged headers create new buckets`);
  }
  if (limitedEarly.length > 0) {
    console.log(`Note: rate limiting started at request ${limitedEarly[0].index}; `
      + "earlier traffic from this runner's address counted too.");
  }

  // 3. The publishable key, for information. This runner is rate limited by now, so a
  // rate_limited answer means the gateway let the key through.
  if (publishableKey) {
    const result = await call(url, publishableKey, "{}");
    const verdict = fromFunction(result)
      ? "accepted by the gateway (the function answered)"
      : "rejected by the gateway";
    console.log(`Publishable key: HTTP ${result.status}, ${verdict}.`);
  } else {
    console.log("Publishable key: not configured, skipped.");
  }
} catch (error) {
  problems.push(error.message);
}

if (problems.length > 0) {
  console.error("\nrss-proxy smoke check FAILED:");
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
  console.error("If the rate limit failed, run the deploy workflow in delete mode now. "
    + "A failed read alone does not need a rollback: nothing calls the function yet.");
  process.exit(1);
}
console.log("\nrss-proxy smoke check passed: feeds are fetched and forged headers do not escape the rate limit.");
