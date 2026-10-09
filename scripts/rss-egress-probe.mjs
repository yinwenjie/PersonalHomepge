#!/usr/bin/env node

// rss-proxy go-live checks that need the hosted runtime (Phase2_2_RssWidgetDesign.md):
// 1. Egress: the Edge runtime must not reach private, loopback or cloud metadata addresses,
//    including through public names that resolve to them.
// 2. Client address: with a spoofed X-Forwarded-For, the gateway must append the real caller
//    address as the last entry, which is the only entry rss-proxy trusts.
// Deploys the egress-probe function and calls it once. The workflow deletes it in a separate
// always() step, so cleanup also happens when this process is cancelled or times out.

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
 * Classifies one internal target. Only positive evidence of blocking passes: an answer or a
 * refused/reset connection proves the address is routable, and anything unrecognised (for
 * example a DNS failure on a name that should resolve) leaves the target untested.
 */
function verdict(result) {
  const outcome = String(result.outcome);
  if (outcome.startsWith("response") || /refused|reset|os error (104|111)\b/i.test(outcome)) {
    return "reachable";
  }
  if (outcome === "timeout"
    || /unreachable|no route|not permitted|permission denied|os error (1|13|101|113)\b/i.test(outcome)) {
    return "blocked";
  }
  if (/dns|lookup|resolve|name or service|nodename/i.test(outcome)) {
    return result.unresolvableIsBlocked ? "blocked" : "untested";
  }
  return "untested";
}

function judge(report, runnerIp) {
  const problems = [];

  console.log("\nEgress results:");
  for (const result of report.results ?? []) {
    if (result.control) {
      const ok = String(result.outcome).startsWith("response");
      console.log(`  ${ok ? "ok  " : "FAIL"} ${result.name}: ${result.outcome}`);
      if (!ok) {
        problems.push(`the public control did not answer (${result.outcome})`);
      }
      continue;
    }
    const status = verdict(result);
    console.log(`  ${status === "blocked" ? "ok  " : "FAIL"} ${result.name}: ${status} (${result.outcome})`);
    if (status !== "blocked") {
      problems.push(`${result.name} is ${status}: ${result.outcome}`);
    }
  }
  console.log(`  Deno.createHttpClient available: ${report.createHttpClient === true}`);

  const forwarded = Array.isArray(report.forwardedFor) ? report.forwardedFor : [];
  console.log(`\nX-Forwarded-For seen by the function: ${forwarded.join(", ") || "(none)"}`);
  console.log(`Runner address: ${runnerIp}`);
  if (forwarded[forwarded.length - 1] !== runnerIp) {
    problems.push("the last X-Forwarded-For entry is not the caller's real address");
  }
  if (forwarded.length > 0 && forwarded[forwarded.length - 1] === spoofedAddress) {
    problems.push("the spoofed X-Forwarded-For value ended up as the trusted entry");
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
        "X-Forwarded-For": spoofedAddress
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
console.log("\nGo-live checks passed: egress is blocked and the last X-Forwarded-For entry is the caller.");
