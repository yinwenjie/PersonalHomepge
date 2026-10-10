// Adds the admin site's sign-in redirect to Supabase Auth's Redirect URLs (Phase 1.18 step 5).
// Run only from .github/workflows/supabase-auth-redirects.yml.
//
//   check  read-only; prints the current list and whether the admin URL is in it
//   apply  adds the missing URL, keeping every existing entry, then reads the list back
//
// It never removes or reorders entries and never touches the Site URL.
const REQUIRED = ["https://admin.mylinker.net/"];

const token = String(process.env.SUPABASE_ACCESS_TOKEN ?? "").trim();
const projectRef = String(process.env.SUPABASE_PROJECT_ID ?? "").trim();
const mode = String(process.env.AUTH_REDIRECT_MODE ?? "").trim();
const confirmation = String(process.env.AUTH_REDIRECT_CONFIRM_PROJECT_REF ?? "").trim();

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

if (!token) fail("Missing SUPABASE_ACCESS_TOKEN.");
if (!/^[a-z0-9]{20}$/.test(projectRef)) fail("SUPABASE_PROJECT_ID must be a project ref.");
if (mode !== "check" && mode !== "apply") fail("Mode must be check or apply.");
if (mode === "apply" && confirmation !== projectRef) fail("Apply needs confirm_project_ref to match the target project.");

const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/config/auth`;

async function call(method, body) {
  const response = await fetch(endpoint, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!response.ok) fail(`${method} auth config failed with HTTP ${response.status}.`);
  return response.json();
}

const parse = (value) =>
  String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

const current = parse((await call("GET")).uri_allow_list);
console.log(`Current Redirect URLs (${current.length}):`);
for (const entry of current) console.log(`  ${entry}`);

const missing = REQUIRED.filter((url) => !current.includes(url));
if (missing.length === 0) {
  console.log("The admin redirect URL is already allowed.");
  process.exit(0);
}
if (mode === "check") {
  console.log(`Missing: ${missing.join(", ")}. Run again with mode=apply to add it.`);
  process.exit(0);
}

await call("PATCH", { uri_allow_list: [...current, ...missing].join(",") });
const after = parse((await call("GET")).uri_allow_list);
const lost = current.filter((url) => !after.includes(url));
if (lost.length > 0 || missing.some((url) => !after.includes(url))) {
  fail("The Redirect URLs did not read back as expected; check Authentication > URL Configuration.");
}
console.log(`Added: ${missing.join(", ")}. Redirect URLs now (${after.length}):`);
for (const entry of after) console.log(`  ${entry}`);
