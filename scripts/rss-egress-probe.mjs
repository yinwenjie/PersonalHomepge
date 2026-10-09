#!/usr/bin/env node

// rss-proxy go-live checks that need the hosted runtime (Phase2_2_RssWidgetDesign.md):
// 1. Egress: the Edge runtime must not reach private, loopback or cloud metadata addresses,
//    including through public names that resolve to them.
// 2. Client address: with spoofed client-address headers, some header must still carry
//    exactly the real caller address, so rss-proxy can key its rate limit on it. The report
//    lists every candidate.
// Deploys the egress-probe function and calls it once. The workflow deletes it in a separate
// always() step, so cleanup also happens when this process is cancelled or times out.

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TARGETS } from "../supabase/functions/egress-probe/targets.ts";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const functionName = "egress-probe";
const spoofedAddress = "198.51.100.7";

function fail(message) {
  console.error(`Egress probe error: ${message}`);
  process.exit(1);
}

function run(args, { capture = false } = {}) {
  console.log(`\n> supabase ${args.join(" ")}`);
  const result = spawnSync("supabase", args, {
    cwd: rootDir,
    env: process.env,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit"
  });
  if (result.error) {
    throw new Error(`unable to run supabase: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`supabase ${args[0]} ${args[1] ?? ""} exited with ${result.status}`);
  }
  return result.stdout ?? "";
}

/** Reads the anon key without printing it; it is masked in the log in case anything echoes it. */
function anonKey(projectRef) {
  const output = run(["projects", "api-keys", "--project-ref", projectRef, "-o", "json"], {
    capture: true
  });
  let key;
  try {
    const rows = JSON.parse(output);
    key = (Array.isArray(rows) ? rows : []).find((row) => row?.name === "anon")?.api_key;
  } catch {
    key = output.match(/\banon\b\s*[|│]\s*(eyJ[\w.-]+)/)?.[1];
  }
  if (!key) {
    throw new Error("could not read the project's anon key.");
  }
  console.log(`::add-mask::${key}`);
  return key;
}

async function runnerAddress() {
  const response = await fetch("https://api.ipify.org");
  const text = (await response.text()).trim();
  if (!response.ok || !/^[0-9a-f.:]+$/i.test(text)) {
    throw new Error("could not determine the runner's public address.");
  }
  return text;
}

/**
 * Classifies one internal target. Only positive evidence of blocking passes: an answer, a
 * refused/reset connection or a TLS failure proves the address is routable, and anything
 * else (a timeout, "no route to host", or a DNS failure on a name that should resolve)
 * leaves it untested.
 */
function verdict(result) {
  const outcome = String(result.outcome);
  // A TLS failure means the TCP connection was made, so the target is reachable.
  if (
    outcome.startsWith("response")
    || /refused|reset|os error (104|111)\b|certificate|tls|ssl|handshake/i.test(outcome)
  ) {
    return "reachable";
  }
  // Blocked means the runtime refused the connection (EPERM/EACCES, Deno's own permission
  // error, or EINVAL, which the hosted sandbox returns for link-local addresses) or has no
  // route to the whole network (ENETUNREACH). A timeout, or "no route to
  // host" (EHOSTUNREACH), can just mean nothing lives at the sampled address of a routable
  // range, so neither counts.
  if (
    /not permitted|permission denied|PermissionDenied|requires net access|not allowed|network is unreachable|os error (1|13|22|101)\b/i
      .test(outcome)
  ) {
    return "blocked";
  }
  if (/dns|lookup|resolve|name or service|nodename/i.test(outcome)) {
    return result.unresolvableIsBlocked ? "blocked" : "untested";
  }
  return "untested";
}

function judge(report, runnerIp) {
  const problems = [];

  // Judge the expected inventory, not whatever came back: a stale or partial report (for
  // example an older version still being served) must not pass by omission.
  const reported = Array.isArray(report?.results) ? report.results : [];
  const byName = new Map(reported.map((result) => [result?.name, result]));
  if (reported.length !== TARGETS.length || byName.size !== TARGETS.length) {
    problems.push(`the report has ${reported.length} results, expected ${TARGETS.length} distinct targets`);
  }

  console.log("\nEgress results:");
  for (const target of TARGETS) {
    const result = byName.get(target.name);
    if (!result || result.url !== target.url) {
      console.log(`  FAIL ${target.name}: missing from the report`);
      problems.push(`${target.name} is missing from the report`);
      continue;
    }
    if (target.control) {
      const ok = String(result.outcome).startsWith("response");
      console.log(`  ${ok ? "ok  " : "FAIL"} ${result.name}: ${result.outcome}`);
      if (!ok) {
        problems.push(`the public control did not answer (${result.outcome})`);
      }
      continue;
    }
    const status = verdict({ ...result, unresolvableIsBlocked: target.unresolvableIsBlocked });
    console.log(`  ${status === "blocked" ? "ok  " : "FAIL"} ${result.name}: ${status} (${result.outcome})`);
    if (status !== "blocked") {
      problems.push(`${result.name} is ${status}: ${result.outcome}`);
    }
  }
  console.log(`  Deno.createHttpClient available: ${report.createHttpClient === true}`);

  const forwarded = Array.isArray(report.forwardedFor) ? report.forwardedFor : [];
  const headers = report.clientHeaders && typeof report.clientHeaders === "object"
    ? report.clientHeaders
    : {};
  console.log(`\nRunner address: ${runnerIp} (X-Forwarded-For, X-Real-IP and X-Client-IP were spoofed as ${spoofedAddress})`);
  console.log("Client-address headers seen by the function:");
  for (const [name, value] of Object.entries(headers)) {
    console.log(`  ${name}: ${value}`);
  }
  // A usable source carries exactly the caller's address and none of the forged value.
  const candidates = Object.entries(headers)
    .filter(([, value]) => String(value).trim() === runnerIp)
    .map(([name]) => name);
  if (forwarded[0] === runnerIp && !forwarded.includes(spoofedAddress)) {
    candidates.push("x-forwarded-for (first entry)");
  }
  if (forwarded.at(-1) === runnerIp) {
    candidates.push("x-forwarded-for (last entry)");
  }
  console.log(`Trustworthy client-address sources: ${candidates.join(", ") || "(none)"}`);
  if (candidates.length === 0) {
    problems.push("no header carries exactly the caller's real address");
  }

  return problems;
}

const projectRef = String(process.env.SUPABASE_PROJECT_ID ?? "").trim();
const confirmation = String(process.env.PROBE_CONFIRM_PROJECT_REF ?? "").trim();
if (!/^[a-z0-9]{20}$/.test(projectRef)) {
  fail("SUPABASE_PROJECT_ID must be the exact 20-character hosted project ref.");
}
if (!String(process.env.SUPABASE_ACCESS_TOKEN ?? "").trim()) {
  fail("SUPABASE_ACCESS_TOKEN is required.");
}
if (confirmation !== projectRef) {
  fail("the confirmation input must exactly match the target project ref.");
}

let problems = [];
try {
  run(["functions", "deploy", functionName, "--project-ref", projectRef, "--use-api"]);
  const key = anonKey(projectRef);
  const runnerIp = await runnerAddress();

  let report = null;
  for (let attempt = 1; attempt <= 6 && !report; attempt += 1) {
    const response = await fetch(`https://${projectRef}.supabase.co/functions/v1/${functionName}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        apikey: key,
        "X-Forwarded-For": spoofedAddress,
        // Cloudflare-owned headers (CF-Connecting-IP, True-Client-IP) are not forged: the edge
        // may reject such requests outright, and it sets them itself.
        "X-Real-IP": spoofedAddress,
        "X-Client-IP": spoofedAddress
      }
    });
    if (response.ok) {
      report = await response.json();
    } else {
      console.log(`  probe attempt ${attempt}: HTTP ${response.status}`);
      await response.body?.cancel();
      await new Promise((done) => setTimeout(done, 5000));
    }
  }
  if (!report) {
    throw new Error("the probe never answered.");
  }
  problems = judge(report, runnerIp);
} catch (error) {
  problems.push(error.message);
}

if (problems.length > 0) {
  console.error("\nGo-live checks FAILED:");
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
  process.exit(1);
}
console.log("\nGo-live checks passed: egress is blocked and a client-address header is trustworthy.");
