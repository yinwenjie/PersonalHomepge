import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const rootDir = process.cwd();
const failures = [];
const shareModule = loadTypeScriptModule("src/domain/public-home-share.ts");

verifyTokens(shareModule);
verifyDatabaseContract();
verifyAcceptanceHardening();
verifyClientPrivacyContract();

if (failures.length > 0) {
  console.error("Public home share verification failed:\n");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Public home share token and database contract verified.");

function verifyTokens(share) {
  const tokens = new Set();

  for (let index = 0; index < 24; index += 1) {
    const token = share.createPublicHomeShareToken();
    tokens.add(token);
    expectEqual(token.length, share.PUBLIC_HOME_SHARE_TOKEN_LENGTH, "tokens should use the v1 Base64URL length");
    expectTrue(share.isPublicHomeShareToken(token), "generated tokens should pass the strict v1 parser");
    expectTrue(/^[A-Za-z0-9_-]+$/.test(token), "generated tokens should be unpadded Base64URL");
    expectEqual(
      share.buildPublicHomeShareUrl(token),
      `${share.PUBLIC_HOME_SHARE_CANONICAL_PREFIX}${token}`,
      "public links should use the canonical fragment route"
    );
  }

  expectEqual(tokens.size, 24, "test tokens should be independently generated");
  expectFalse(share.isPublicHomeShareToken("A".repeat(42)), "short tokens should fail");
  expectFalse(share.isPublicHomeShareToken("A".repeat(44)), "long tokens should fail");
  expectFalse(share.isPublicHomeShareToken(`${"A".repeat(42)}=`), "padding should fail");
  expectFalse(share.isPublicHomeShareToken("not-a-token"), "arbitrary values should fail");
  expectEqual(
    share.PUBLIC_HOME_SHARE_CANONICAL_PREFIX,
    "https://mylinker.net/share/#",
    "public links should always target the canonical production host"
  );

  const testToken = "A".repeat(share.PUBLIC_HOME_SHARE_TOKEN_LENGTH);
  expectEqual(
    share.buildPublicHomeShareUrl(testToken, "http://localhost:3000"),
    `http://localhost:3000/share/#${testToken}`,
    "localhost testing should keep the share route on the local service"
  );
  expectEqual(
    share.buildPublicHomeShareUrl(testToken, "http://127.0.0.1:3000"),
    `http://127.0.0.1:3000/share/#${testToken}`,
    "IPv4 loopback testing should keep the share route on the local service"
  );
  expectEqual(
    share.buildPublicHomeShareUrl(testToken, "https://preview.example.com"),
    `${share.PUBLIC_HOME_SHARE_CANONICAL_PREFIX}${testToken}`,
    "non-loopback deployments should keep the canonical production URL"
  );
}

function verifyDatabaseContract() {
  const migration = fs.readFileSync(
    path.join(rootDir, "supabase/migrations/017_public_home_shares.sql"),
    "utf8"
  );
  const check = fs.readFileSync(
    path.join(rootDir, "supabase/checks/019_public_home_shares_verify.sql"),
    "utf8"
  );
  const hotfixMigration = fs.readFileSync(
    path.join(rootDir, "supabase/migrations/018_public_home_share_upsert_conflict_fix.sql"),
    "utf8"
  );
  const hotfixCheck = fs.readFileSync(
    path.join(rootDir, "supabase/checks/020_public_home_share_upsert_conflict_fix_verify.sql"),
    "utf8"
  );

  for (const fragment of [
    "create table if not exists public.public_home_shares",
    "foreign key (home_space_id, user_id)",
    "references public.home_spaces(id, user_id)",
    "unique (home_space_id)",
    "unique (token_hash)",
    "alter table public.public_home_shares enable row level security",
    "revoke all on table public.public_home_shares from public",
    "create or replace function public.public_home_document_v1_valid",
    "create or replace function public.hash_public_home_share_token",
    "mylinker-public-share-v1:",
    "create or replace function public.upsert_public_home_share",
    "create or replace function public.get_public_home_share_metadata",
    "create or replace function public.revoke_public_home_share",
    "create or replace function public.read_public_home_share",
    "grant execute on function public.read_public_home_share(text) to anon, authenticated"
  ]) {
    expectTrue(migration.includes(fragment), `migration should contain ${fragment}`);
  }

  expectFalse(
    /grant execute on function public\.(upsert_public_home_share|get_public_home_share_metadata|revoke_public_home_share)\([^\n]+\) to [^\n]*\banon\b/i.test(migration),
    "owner RPCs must not grant anon execution"
  );
  expectTrue(check.includes("Optional A/B functional verification"), "check script should contain the rollback A/B verification");
  for (const [sourceName, source] of [
    ["base migration", migration],
    ["hotfix migration", hotfixMigration]
  ]) {
    const executableSql = source.replace(/^\s*--.*$/gm, "");
    expectTrue(
      executableSql.includes("on conflict on constraint public_home_shares_one_per_home_space"),
      `${sourceName} should use the unambiguous named conflict constraint`
    );
    expectFalse(
      /on conflict\s*\(\s*home_space_id\s*\)/i.test(executableSql),
      `${sourceName} must not reintroduce the PL/pgSQL output-variable ambiguity`
    );
  }
  expectTrue(
    hotfixCheck.includes("conflict_target_is_unambiguous"),
    "hotfix check should verify the live function definition"
  );
}

function verifyAcceptanceHardening() {
  const check = fs.readFileSync(
    path.join(rootDir, "supabase/checks/019_public_home_shares_verify.sql"),
    "utf8"
  );
  const deploymentCheck = fs.readFileSync(
    path.join(rootDir, "scripts/verify-public-home-share-deployment.mjs"),
    "utf8"
  );
  const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));

  for (const fragment of [
    "public_home_share_verify_context",
    "public_home_share_verify_baseline",
    "USER_A_UUID and USER_B_UUID must be different",
    "HOME_SPACE_A_UUID must be owned by USER_A_UUID and account-managed",
    "HOME_SPACE_B_UUID must be owned by USER_B_UUID and account-managed",
    "owner B metadata count for A expected 0",
    "owner B metadata count for B expected 1",
    "anon unexpectedly read public_home_shares directly",
    "active token A read count expected 1",
    "active token B read count expected 1",
    "random token read count expected 0",
    "revoked original token read count expected 0",
    "expired token read count expected 0",
    "published_at = now() - interval '2 hours'",
    "expires_at = now() - interval '1 hour'",
    "rollback;"
  ]) {
    expectTrue(check.includes(fragment), `A/B SQL check should contain ${fragment}`);
  }

  for (const url of [
    "https://personalhomepge.pages.dev/share/",
    "https://mylinker.net/share/",
    "https://yinwenjie.github.io/PersonalHomepge/share/"
  ]) {
    expectTrue(deploymentCheck.includes(url), `deployment check should cover ${url}`);
  }

  for (const fragment of [
    "response.status !== 200",
    "noindex",
    "nofollow",
    "noarchive",
    "token_hash"
  ]) {
    expectTrue(deploymentCheck.includes(fragment), `deployment check should verify ${fragment}`);
  }

  expectEqual(
    packageJson.scripts?.["verify:public-share-deployment"],
    "node scripts/verify-public-home-share-deployment.mjs",
    "package scripts should expose the deployment smoke check"
  );
}

function verifyClientPrivacyContract() {
  const settingsPanel = fs.readFileSync(
    path.join(rootDir, "src/components/public-home-share-panel.tsx"),
    "utf8"
  );
  const sharePage = fs.readFileSync(
    path.join(rootDir, "src/components/public-home-share-page.tsx"),
    "utf8"
  );
  const route = fs.readFileSync(path.join(rootDir, "app/share/page.tsx"), "utf8");
  const repository = fs.readFileSync(
    path.join(rootDir, "src/infrastructure/public-home-share-repository.ts"),
    "utf8"
  );

  for (const forbidden of ["localStorage", "sessionStorage", "trackProductEvent", "captureClientError", "recordLocalAuditEvent"]) {
    expectFalse(
      settingsPanel.includes(forbidden),
      `share management should not use ${forbidden}`
    );
    expectFalse(
      sharePage.includes(forbidden),
      `public share page should not use ${forbidden}`
    );
  }

  expectTrue(
    sharePage.includes("window.location.hash.slice(1)"),
    "public share page should read the token from the URL fragment"
  );
  expectFalse(
    /useState[^\n]*(?:token|shareToken)/i.test(sharePage),
    "public share page should not copy the fragment token into React state"
  );
  expectTrue(
    /<ReadOnlyHomeRenderer[^>]*applyThemeToDocument=\{false\}/s.test(settingsPanel),
    "the settings preview should not overwrite the settings page theme or background image"
  );
  expectTrue(route.includes("noarchive: true"), "share route metadata should disable archiving");
  expectTrue(route.includes("index: false"), "share route metadata should disable indexing");
  expectTrue(route.includes("follow: false"), "share route metadata should disable link following");
  expectTrue(
    repository.includes('code === "42702"')
      && repository.includes('"database-outdated"'),
    "repository should classify the live PL/pgSQL ambiguity without exposing raw RPC errors"
  );
  expectFalse(
    /super\([^)]*(?:error\.message|message)\)/.test(repository),
    "repository errors must not retain raw database messages"
  );
}

function loadTypeScriptModule(relativePath) {
  const source = fs.readFileSync(path.join(rootDir, relativePath), "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    }
  }).outputText;
  const sandbox = {
    Uint8Array,
    URL,
    crypto: globalThis.crypto,
    btoa: globalThis.btoa,
    module: { exports: {} },
    exports: {}
  };

  vm.runInNewContext(transpiled, sandbox, { filename: relativePath });
  return sandbox.exports;
}

function expectEqual(actual, expected, message) {
  if (actual !== expected) {
    failures.push(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function expectTrue(value, message) {
  if (!value) {
    failures.push(message);
  }
}

function expectFalse(value, message) {
  if (value) {
    failures.push(message);
  }
}
