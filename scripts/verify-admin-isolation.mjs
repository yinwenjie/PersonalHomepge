#!/usr/bin/env node

// Phase 1.18 page isolation (Phase1_18_Implement.md, 1.18.4 and 1.18.6): this public
// repository and the sites built from it (mylinker.net and the GitHub Pages legacy site)
// must never contain admin pages, an admin entry point or code that calls the admin API.
// The admin UI lives in a separate private repository. Edge Functions and migrations under
// supabase/ are server code and are not checked here.
//
// Always checks the site source. When out/ exists (after `npm run build`), also checks the
// static export, for the base path given as the first argument or NEXT_PUBLIC_BASE_PATH.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const rootDir = process.cwd();
const SOURCE_ROOTS = ["app", "src", "public"];
const SOURCE_FILES = ["next.config.ts", "next.config.mjs", "next.config.js"];
const TEXT_FILE = /\.(?:[cm]?[jt]sx?|css|html?|json|txt|xml|md|webmanifest|svg)$|(?:^|\/)_headers$|(?:^|\/)_redirects$/i;

// Strings that only admin code would contain. Matched case-insensitively.
const FORBIDDEN_MARKERS = [
  { pattern: /admin-read/i, label: "the admin-read Edge Function" },
  { pattern: /(?:["'`(]|mylinker\.net|\/PersonalHomepge)\/admin(?![\w-])/i, label: "a link or path to /admin" },
  { pattern: /admin\.mylinker\.net/i, label: "the admin site hostname" },
  { pattern: /preview-snapshot|list-admin-audit-events|get-admin-context/i, label: "an admin API operation" },
  { pattern: /admin_users|admin_audit_events/i, label: "an admin table" },
  { pattern: /admin_list_users|admin_read_stats|admin_mask_email/i, label: "an admin database function" },
  { pattern: /service[_-]?role/i, label: "a service role reference" },
  { pattern: /supabase\/functions\//i, label: "an import of server-only Edge Function code" }
];

const failures = [];

verifySource();

const outputDirectory = path.join(rootDir, "out");
if (existsSync(outputDirectory)) {
  verifyExport(outputDirectory);
} else {
  console.log("No out/ directory; checked the site source only.");
}

if (failures.length > 0) {
  console.error("Admin isolation verification failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Admin isolation verified: no admin pages, entry points or admin API calls in the public site.");

function verifySource() {
  for (const root of SOURCE_ROOTS) {
    const directory = path.join(rootDir, root);
    if (!existsSync(directory)) {
      continue;
    }

    for (const filePath of collectEntries(directory)) {
      const relative = path.relative(rootDir, filePath);
      if (hasAdminSegment(path.relative(directory, filePath))) {
        failures.push(`${relative} looks like an admin route or asset; admin UI belongs in the private Admin repository.`);
      }
      if (statSync(filePath).isFile() && TEXT_FILE.test(filePath)) {
        checkMarkers(relative, readFileSync(filePath, "utf8"));
      }
    }
  }

  for (const file of SOURCE_FILES) {
    const filePath = path.join(rootDir, file);
    if (existsSync(filePath)) {
      const content = readFileSync(filePath, "utf8");
      checkMarkers(file, content);
      if (/["'`]\/admin\b/i.test(content)) {
        failures.push(`${file} configures an /admin path (rewrite, redirect or header).`);
      }
    }
  }
}

function verifyExport(directory) {
  const basePath = normalizeBasePath(process.argv[2] ?? process.env.NEXT_PUBLIC_BASE_PATH ?? "");

  for (const filePath of collectEntries(directory)) {
    const relative = path.relative(directory, filePath);
    if (hasAdminSegment(relative)) {
      failures.push(`out/${relative} is an admin page or asset in the static export.`);
    }
    if (statSync(filePath).isFile() && TEXT_FILE.test(filePath)) {
      checkMarkers(`out/${relative}`, readFileSync(filePath, "utf8"));
    }
  }

  for (const file of ["sitemap.xml", "robots.txt"]) {
    const filePath = path.join(directory, file);
    if (existsSync(filePath) && new RegExp(`${escapeRegExp(basePath)}/admin\\b`, "i").test(readFileSync(filePath, "utf8"))) {
      failures.push(`out/${file} lists an admin path.`);
    }
  }

  console.log(`Checked the static export for ${basePath || "/"} base path.`);
}

/** True for any path segment named admin (admin, admin.html, admin/index.html, (admin)). */
function hasAdminSegment(relativePath) {
  return relativePath
    .split(path.sep)
    .some((segment) => /^\(?admin\)?(?:\.[a-z0-9]+)?$/i.test(segment));
}

function checkMarkers(label, content) {
  for (const marker of FORBIDDEN_MARKERS) {
    if (marker.pattern.test(content)) {
      failures.push(`${label} contains ${marker.label}.`);
    }
  }
}

function collectEntries(directory) {
  const entries = [];
  for (const name of readdirSync(directory)) {
    if (name === "node_modules" || name === ".next") {
      continue;
    }
    const entryPath = path.join(directory, name);
    entries.push(entryPath);
    if (statSync(entryPath).isDirectory()) {
      entries.push(...collectEntries(entryPath));
    }
  }
  return entries;
}

function normalizeBasePath(value) {
  const trimmed = String(value).trim().replace(/\/+$/, "");
  if (!trimmed) {
    return "";
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
