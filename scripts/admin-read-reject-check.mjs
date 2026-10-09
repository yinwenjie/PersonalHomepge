#!/usr/bin/env node

// Post-deploy check for admin-read (Phase 1.18 execution plan, step 2): every request
// without an administrator session must be refused, from the right place, without data.
// Uses only the project's public anon key; no administrator or user token is involved,
// so nothing is read and no admin audit row is written.
// 1. Missing or forged JWTs are stopped by the gateway (verify_jwt = true) and never reach
//    the function.
// 2. With the anon key (a valid JWT that is not a user session) the function itself answers:
//    - public product origins and a missing Origin get 403 not_authorized with no CORS headers;
//    - the admin origin gets 401 not_authenticated, also for an oversized body and an unknown
//      operation, so request bodies are never processed before authentication.
// 3. CORS preflight from the admin origin is allowed and from mylinker.net is not (reported;
//    the gateway may answer preflights itself).
// Size and operation validation for authenticated administrators is covered by the
// Edge Function unit tests and by the step 3 localhost tests with test administrators.

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ADMIN_ORIGIN = "https://admin.mylinker.net";
const PUBLIC_ORIGINS = ["https://mylinker.net", "https://www.mylinker.net", "https://yinwenjie.github.io"];
const CONTEXT_BODY = JSON.stringify({ operation: "get-admin-context" });
const ENVELOPE_KEYS = ["apiVersion", "error", "ok", "requestId"];

function fail(message) {
  console.error(`admin-read reject check error: ${message}`);
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

/** A well-formed HS256 JWT signed with a random key, so the gateway must reject it. */
function forgedJwt() {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({
    sub: "00000000-0000-4000-8000-000000000000",
    role: "authenticated",
    aud: "authenticated",
    iat: now,
    exp: now + 300
  });
  const signature = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

async function call(url, { method = "POST", key = null, apikey = key, origin = ADMIN_ORIGIN,
  body = CONTEXT_BODY, headers = {} } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      ...(apikey ? { apikey } : {}),
      ...(origin ? { Origin: origin } : {}),
      ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
      ...headers
    },
    body: method === "POST" ? body : undefined
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Not JSON: a gateway or edge response.
  }
  return { status: response.status, json, allowOrigin: response.headers.get("access-control-allow-origin") };
}

/** True when admin-read itself produced the response (its fixed error envelope). */
function fromFunction(result) {
  return result.json !== null && typeof result.json === "object" && result.json.ok === false
    && typeof result.json.error === "string" && typeof result.json.requestId === "string";
}

function describe(result) {
  const source = fromFunction(result) ? `function ${result.json.error}` : "not the function";
  return `HTTP ${result.status}, ${source}, CORS ${result.allowOrigin ?? "none"}`;
}

const projectRef = String(process.env.SUPABASE_PROJECT_ID ?? "").trim();
const confirmation = String(process.env.CHECK_CONFIRM_PROJECT_REF ?? "").trim();
if (!/^[a-z0-9]{20}$/.test(projectRef)) {
  fail("SUPABASE_PROJECT_ID must be the exact 20-character hosted project ref.");
}
if (confirmation !== projectRef) {
  fail("the confirmation input must exactly match the target project ref.");
}

const url = `https://${projectRef}.supabase.co/functions/v1/admin-read`;
const problems = [];

function expect(label, result, { status, error = null, cors = null }) {
  console.log(`${label}: ${describe(result)}`);
  if (result.status !== status) {
    problems.push(`${label}: expected HTTP ${status}, got ${result.status}`);
  }
  if (error !== null) {
    if (!fromFunction(result) || result.json.error !== error) {
      problems.push(`${label}: expected the function's ${error} error`);
    } else if (Object.keys(result.json).sort().join(",") !== ENVELOPE_KEYS.join(",")) {
      problems.push(`${label}: the error envelope carries extra fields`);
    }
  }
  if (result.allowOrigin !== cors) {
    problems.push(`${label}: expected CORS origin ${cors ?? "none"}, got ${result.allowOrigin ?? "none"}`);
  }
}

try {
  const key = anonKey(projectRef);

  // 1. Gateway. The anon key goes in apikey so only the Authorization JWT is wrong; reaching
  // the function at all would mean JWT verification is off.
  for (const [label, token] of [["No JWT", null], ["Forged JWT", forgedJwt()]]) {
    const result = await call(url, { key: token, apikey: key });
    console.log(`${label}: ${describe(result)}`);
    if (result.status !== 401) {
      problems.push(`${label}: expected HTTP 401 from the gateway, got ${result.status}`);
    }
    if (fromFunction(result)) {
      problems.push(`${label}: reached the function, so gateway JWT verification is off`);
    }
  }

  // 2. The function, with a valid JWT that is not a user session.
  for (const origin of PUBLIC_ORIGINS) {
    expect(`Origin ${origin}`, await call(url, { key, origin }),
      { status: 403, error: "not_authorized" });
  }
  expect("No Origin", await call(url, { key, origin: null }),
    { status: 403, error: "not_authorized" });
  expect("Admin origin, anon key", await call(url, { key }),
    { status: 401, error: "not_authenticated", cors: ADMIN_ORIGIN });
  expect("Admin origin, oversized body", await call(url, {
    key,
    body: JSON.stringify({ operation: "find-user", reason: "x".repeat(200 * 1024) })
  }), { status: 401, error: "not_authenticated", cors: ADMIN_ORIGIN });
  expect("Admin origin, unknown operation", await call(url, {
    key,
    body: JSON.stringify({ operation: "export-everything", reason: "check" })
  }), { status: 401, error: "not_authenticated", cors: ADMIN_ORIGIN });

  // 3. Preflight, for information.
  for (const origin of [ADMIN_ORIGIN, PUBLIC_ORIGINS[0]]) {
    const result = await call(url, {
      method: "OPTIONS",
      origin,
      headers: {
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization, content-type"
      }
    });
    console.log(`Preflight from ${origin}: HTTP ${result.status}, CORS ${result.allowOrigin ?? "none"}`);
    if (origin !== ADMIN_ORIGIN && result.allowOrigin) {
      problems.push(`Preflight from ${origin} was allowed`);
    }
  }
} catch (error) {
  problems.push(error.message);
}

if (problems.length > 0) {
  console.error("\nadmin-read reject check FAILED:");
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
  console.error("If a public origin or a missing session got anything but a refusal, run the deploy "
    + "workflow in delete mode for admin-read now.");
  process.exit(1);
}
console.log("\nadmin-read reject check passed: requests without an administrator session are refused.");
