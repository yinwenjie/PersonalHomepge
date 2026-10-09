#!/usr/bin/env node

// Protected Edge Function deployment: one allowlisted function per run, from master,
// after its database checks and required secrets are confirmed on the target project.
// Database migrations ship separately through scripts/deploy-supabase-remote.mjs.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");
const manifestPath = resolve(rootDir, "supabase/remote-deploy.json");
const configPath = resolve(rootDir, "supabase/config.toml");
const workflowFile = ".github/workflows/deploy-edge-function.yml";
const allowedModes = new Set(["check", "deploy", "delete"]);
const smokeAttempts = 6;
const smokeDelayMs = 5000;

function fail(message) {
  console.error(`Edge Function deployment error: ${message}`);
  process.exit(1);
}

function readManifest() {
  if (!existsSync(manifestPath)) {
    fail("supabase/remote-deploy.json is missing.");
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    fail(`unable to parse supabase/remote-deploy.json: ${error.message}`);
  }

  const functions = manifest.edgeFunctions;
  if (!Array.isArray(functions) || functions.length === 0) {
    fail("edgeFunctions must be a non-empty list.");
  }

  // Only checks that already run after migrations (rollback-scoped, reviewed) may gate a deploy.
  const reviewedChecks = new Set((manifest.postMigrationChecks ?? []).map((entry) => entry.file));
  const config = readFileSync(configPath, "utf8");
  const seen = new Set();

  for (const entry of functions) {
    if (!entry || typeof entry.name !== "string" || !/^[a-z][a-z0-9-]{1,62}$/.test(entry.name)) {
      fail("edgeFunctions contains an invalid function name.");
    }
    if (seen.has(entry.name)) {
      fail(`edgeFunctions lists ${entry.name} twice.`);
    }
    seen.add(entry.name);

    const entryPoint = resolve(rootDir, "supabase/functions", entry.name, "index.ts");
    if (!existsSync(entryPoint) || !statSync(entryPoint).isFile()) {
      fail(`supabase/functions/${entry.name}/index.ts does not exist.`);
    }

    if (!verifyJwtEnabled(config, entry.name)) {
      fail(`supabase/config.toml must set verify_jwt = true for [functions.${entry.name}].`);
    }

    if (typeof entry.purpose !== "string" || entry.purpose.trim().length < 12) {
      fail(`${entry.name} must document its purpose.`);
    }

    if (!Array.isArray(entry.requiredSecrets)
      || entry.requiredSecrets.some((name) => !/^[A-Z][A-Z0-9_]{2,63}$/.test(name) || name.startsWith("SUPABASE_"))) {
      fail(`${entry.name} requiredSecrets must list custom secret names (built-in SUPABASE_* are always present).`);
    }

    if (!Array.isArray(entry.preflightChecks) || entry.preflightChecks.length === 0) {
      fail(`${entry.name} must list at least one database preflight check.`);
    }
    for (const file of entry.preflightChecks) {
      if (!reviewedChecks.has(file)) {
        fail(`${entry.name} preflight ${file} must also be a postMigrationChecks entry.`);
      }
    }
  }

  const workflowPath = resolve(rootDir, workflowFile);
  if (!existsSync(workflowPath)) {
    fail(`${workflowFile} is missing.`);
  }
  const workflow = readFileSync(workflowPath, "utf8");
  for (const boundary of [
    "workflow_dispatch:",
    `version: ${manifest.supabaseCliVersion}`,
    "group: supabase-production",
    "name: supabase-production",
    "github.ref != 'refs/heads/master'",
    "SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}",
    "SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}",
    "SUPABASE_PROJECT_ID: ${{ vars.SUPABASE_PROJECT_ID }}"
  ]) {
    if (!workflow.includes(boundary)) {
      fail(`${workflowFile} is missing boundary: ${boundary}`);
    }
  }
  if (workflow.includes("--no-verify-jwt")) {
    fail(`${workflowFile} must never disable JWT verification.`);
  }
  for (const entry of functions) {
    if (!workflow.includes(`- ${entry.name}`)) {
      fail(`${workflowFile} must offer ${entry.name} as a function choice.`);
    }
  }

  return manifest;
}

/** True when the [functions.<name>] table in config.toml has verify_jwt = true. */
function verifyJwtEnabled(config, name) {
  const header = `[functions.${name}]`;
  const start = config.indexOf(header);
  if (start < 0) {
    return false;
  }
  const rest = config.slice(start + header.length);
  const nextTable = rest.search(/^\s*\[/m);
  const table = nextTable < 0 ? rest : rest.slice(0, nextTable);
  return /^\s*verify_jwt\s*=\s*true\s*$/m.test(table);
}

function runCommand(command, args) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { cwd: rootDir, env: process.env, stdio: "inherit" });

  if (result.error) {
    fail(`unable to run ${command}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function captureCommand(command, args) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { cwd: rootDir, env: process.env, encoding: "utf8" });

  if (result.error) {
    fail(`unable to run ${command}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    console.error(result.stderr ?? "");
    process.exit(result.status ?? 1);
  }
  return result.stdout ?? "";
}

function installedSupabaseVersion() {
  const output = captureCommand("supabase", ["--version"]);
  const version = output.match(/\d+\.\d+\.\d+/)?.[0];
  if (!version) {
    fail("unable to parse the installed Supabase CLI version.");
  }
  return version;
}

/** Reports which required secrets exist by name only; values and digests are never printed. */
function assertSecretsPresent(projectRef, required) {
  if (required.length === 0) {
    console.log("No custom secrets are required.");
    return;
  }

  const output = captureCommand("supabase", ["secrets", "list", "--project-ref", projectRef]);
  const names = new Set(
    output
      .split("\n")
      .map((line) => line.split("|")[0].trim())
      .filter((cell) => /^[A-Z][A-Z0-9_]*$/.test(cell))
  );

  const missing = required.filter((name) => !names.has(name));
  for (const name of required) {
    console.log(`  ${name}: ${names.has(name) ? "present" : "MISSING"}`);
  }
  if (missing.length > 0) {
    fail(`set ${missing.join(", ")} in the Supabase Dashboard (Edge Functions -> Secrets) before deploying.`);
  }
}

/** Calls the public URL without credentials: 401 means deployed with JWT verification, 404 means absent. */
async function smokeStatus(projectRef, name, expected) {
  const url = `https://${projectRef}.supabase.co/functions/v1/${name}`;
  let status = 0;
  for (let attempt = 1; attempt <= smokeAttempts; attempt += 1) {
    try {
      const response = await fetch(url, { method: "POST" });
      status = response.status;
      await response.body?.cancel();
    } catch (error) {
      console.log(`  attempt ${attempt}: request failed (${error.message})`);
    }
    if (status === expected) {
      console.log(`Unauthenticated POST returned ${status} as expected.`);
      return;
    }
    console.log(`  attempt ${attempt}: got ${status || "no response"}, expecting ${expected}`);
    await new Promise((done) => setTimeout(done, smokeDelayMs));
  }
  fail(`unauthenticated POST to ${name} returned ${status || "no response"}, expected ${expected}.`);
}

const manifest = readManifest();

if (process.argv.includes("--validate-config")) {
  console.log(
    `Edge Function deployment manifest verified: ${manifest.edgeFunctions.map((entry) => entry.name).join(", ")}.`
  );
  process.exit(0);
}

const name = String(process.env.EDGE_FUNCTION_NAME ?? "").trim();
const mode = String(process.env.EDGE_FUNCTION_MODE ?? "check").trim();
const projectRef = String(process.env.SUPABASE_PROJECT_ID ?? "").trim();
const confirmation = String(process.env.EDGE_FUNCTION_CONFIRM_PROJECT_REF ?? "").trim();
const target = manifest.edgeFunctions.find((entry) => entry.name === name);

if (!target) {
  fail(`EDGE_FUNCTION_NAME must be one of: ${manifest.edgeFunctions.map((entry) => entry.name).join(", ")}.`);
}
if (!allowedModes.has(mode)) {
  fail(`mode must be one of: ${[...allowedModes].join(", ")}.`);
}
if (!/^[a-z0-9]{20}$/.test(projectRef)) {
  fail("SUPABASE_PROJECT_ID must be the exact 20-character hosted project ref.");
}
if (!String(process.env.SUPABASE_ACCESS_TOKEN ?? "").trim()) {
  fail("SUPABASE_ACCESS_TOKEN is required and must be provided through the environment.");
}
if (!process.env.SUPABASE_DB_PASSWORD) {
  fail("SUPABASE_DB_PASSWORD is required and must be provided through the environment.");
}
if (mode !== "check" && confirmation !== projectRef) {
  fail(`${mode} mode requires the confirmation input to exactly match the target project ref.`);
}

const cliVersion = installedSupabaseVersion();
if (cliVersion !== manifest.supabaseCliVersion) {
  fail(`Supabase CLI ${cliVersion} does not match the pinned version ${manifest.supabaseCliVersion}.`);
}

console.log(`Edge Function: ${name}`);
console.log(`Mode: ${mode}`);
console.log(`Target project ref: ${projectRef}`);

if (mode === "delete") {
  // The emergency path is deliberately not gated on database checks or secrets.
  runCommand("supabase", ["functions", "delete", name, "--project-ref", projectRef, "--yes"]);
  await smokeStatus(projectRef, name, 404);
  runCommand("supabase", ["functions", "list", "--project-ref", projectRef]);
  console.log(`\n${name} was deleted. Redeploy it from master with mode=deploy when ready.`);
  process.exit(0);
}

runCommand("supabase", ["link", "--project-ref", projectRef, "--yes"]);
for (const file of target.preflightChecks) {
  runCommand("supabase", ["db", "query", "--linked", "--file", file]);
}
assertSecretsPresent(projectRef, target.requiredSecrets);
runCommand("supabase", ["functions", "list", "--project-ref", projectRef]);

if (mode === "check") {
  console.log(`\nCheck completed. ${name} was not deployed.`);
  process.exit(0);
}

runCommand("supabase", ["functions", "deploy", name, "--project-ref", projectRef, "--use-api"]);
await smokeStatus(projectRef, name, 401);
runCommand("supabase", ["functions", "list", "--project-ref", projectRef]);
console.log(`\n${name} deployed from master.`);
