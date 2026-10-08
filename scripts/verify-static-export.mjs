#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const outputDirectory = path.join(process.cwd(), "out");
const basePath = normalizeBasePath(
  process.argv[2] ?? process.env.NEXT_PUBLIC_BASE_PATH ?? "",
  "base path"
);
const expectedAssetPrefix = `${basePath}/_next/`;
const BINARY_ASSET_PATTERN = /\.(?:png|jpe?g|gif|webp|avif|ico|bmp|woff2?|ttf|otf|eot|mp4|webm|mp3|wav|pdf|zip|gz|br|wasm)$/i;

const failures = [];

if (!existsSync(outputDirectory)) {
  fail(`Missing static export directory: ${outputDirectory}`);
} else {
  verifyStaticExport(outputDirectory);
}

if (failures.length > 0) {
  console.error("Static export verification failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Static export verified for ${basePath || "/"} base path.`);

function verifyStaticExport(directory) {
  const indexPath = path.join(directory, "index.html");
  const shareIndexPath = path.join(directory, "share", "index.html");
  const nextDirectory = path.join(directory, "_next");
  const headersPath = path.join(directory, "_headers");

  if (!existsSync(indexPath)) {
    fail("Missing out/index.html.");
  }

  if (!existsSync(nextDirectory)) {
    fail("Missing out/_next directory.");
  }

  verifyPublicShareEntry(shareIndexPath);

  verifyCloudflareHeaders(headersPath);

  verifyReleaseSafety(directory);

  const htmlFiles = collectFiles(directory, (filePath) => filePath.endsWith(".html"));
  if (htmlFiles.length === 0) {
    fail("No HTML files found in out/.");
    return;
  }

  const nextAssetReferences = [];
  const invalidAssetReferences = [];
  const repeatedBasePathReferences = [];
  const malformedReferences = [];

  for (const htmlFile of htmlFiles) {
    const content = readFileSync(htmlFile, "utf8");
    const references = extractAssetReferences(content);

    for (const reference of references) {
      const pathname = getReferencePathname(reference.value);

      if (!pathname.includes("/_next/")) {
        continue;
      }

      nextAssetReferences.push(reference.value);

      if (!pathname.startsWith(expectedAssetPrefix)) {
        invalidAssetReferences.push(formatReference(htmlFile, reference.value));
      }

      if (basePath && pathname.startsWith(`${basePath}${basePath}/`)) {
        repeatedBasePathReferences.push(formatReference(htmlFile, reference.value));
      }

      if (pathname.includes("//")) {
        malformedReferences.push(formatReference(htmlFile, reference.value));
      }
    }
  }

  if (nextAssetReferences.length === 0) {
    fail("No _next asset references found in exported HTML.");
  }

  if (invalidAssetReferences.length > 0) {
    fail(`Expected _next references to start with "${expectedAssetPrefix}". Invalid references: ${invalidAssetReferences.join(", ")}`);
  }

  if (repeatedBasePathReferences.length > 0) {
    fail(`Found repeated base path references: ${repeatedBasePathReferences.join(", ")}`);
  }

  if (malformedReferences.length > 0) {
    fail(`Found malformed references with repeated slashes: ${malformedReferences.join(", ")}`);
  }
}

function verifyPublicShareEntry(shareIndexPath) {
  if (!existsSync(shareIndexPath)) {
    fail("Missing out/share/index.html public-share entry.");
    return;
  }

  const content = readFileSync(shareIndexPath, "utf8");
  const robotsContent = content.match(/<meta[^>]+name=["']robots["'][^>]+content=["']([^"']+)["'][^>]*>/i)?.[1]
    ?? content.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']robots["'][^>]*>/i)?.[1]
    ?? "";

  for (const directive of ["noindex", "nofollow", "noarchive"]) {
    if (!robotsContent.includes(directive)) {
      fail(`out/share/index.html robots metadata should contain ${directive}.`);
    }
  }
}

function verifyCloudflareHeaders(headersPath) {
  if (!existsSync(headersPath)) {
    fail("Missing out/_headers Cloudflare Pages security headers file.");
    return;
  }

  const content = readFileSync(headersPath, "utf8");
  const requiredHeaders = [
    "X-Content-Type-Options: nosniff",
    "X-Frame-Options: DENY",
    "Referrer-Policy: strict-origin-when-cross-origin",
    "Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()"
  ];

  for (const header of requiredHeaders) {
    if (!content.includes(header)) {
      fail(`Missing required Cloudflare Pages security header: ${header}`);
    }
  }
}

function verifyReleaseSafety(directory) {
  const allFiles = collectFiles(directory, () => true);
  const sourceMapFiles = [];
  const envFiles = [];
  const sourceMapComments = [];
  const secretMarkers = [];

  for (const filePath of allFiles) {
    const fileName = path.basename(filePath);

    if (fileName.endsWith(".map")) {
      sourceMapFiles.push(path.relative(process.cwd(), filePath));
    }

    if (fileName.startsWith(".env")) {
      envFiles.push(path.relative(process.cwd(), filePath));
    }

    if (BINARY_ASSET_PATTERN.test(fileName)) {
      continue;
    }

    const content = readFileSync(filePath, "utf8");
    const relativePath = path.relative(process.cwd(), filePath);

    if (/[#@]\s*sourceMappingURL=/.test(content)) {
      sourceMapComments.push(relativePath);
    }

    for (const marker of findSecretMarkers(content)) {
      secretMarkers.push(`${relativePath} (${marker})`);
    }
  }

  if (sourceMapFiles.length > 0) {
    fail(`Source maps must not be published: ${sourceMapFiles.join(", ")}`);
  }

  if (envFiles.length > 0) {
    fail(`Environment files must not be published: ${envFiles.join(", ")}`);
  }

  if (sourceMapComments.length > 0) {
    fail(`Published assets must not reference source maps: ${sourceMapComments.join(", ")}`);
  }

  if (secretMarkers.length > 0) {
    fail(`Possible server-only secrets found in the static export: ${secretMarkers.join(", ")}`);
  }
}

function findSecretMarkers(content) {
  const markers = new Set();

  if (/service_role/i.test(content)) {
    markers.add("service_role");
  }

  if (/\bsb_secret_[A-Za-z0-9_-]+/.test(content)) {
    markers.add("Supabase secret key");
  }

  const jwtPattern = /\beyJ[A-Za-z0-9_-]+\.(eyJ[A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g;
  let match = jwtPattern.exec(content);
  while (match) {
    const role = readJwtRole(match[1]);
    if (role !== "anon") {
      markers.add(`JWT with role ${role ?? "unknown"}`);
    }
    match = jwtPattern.exec(content);
  }

  return markers;
}

function readJwtRole(encodedPayload) {
  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

function normalizeBasePath(value, sourceName) {
  const trimmedValue = value.trim();

  if (!trimmedValue || trimmedValue === "/") {
    return "";
  }

  if (!trimmedValue.startsWith("/")) {
    throw new Error(`${sourceName} must be empty, "/", or start with "/". Received: ${value}`);
  }

  if (trimmedValue.includes("//")) {
    throw new Error(`${sourceName} must not contain repeated slashes. Received: ${value}`);
  }

  return trimmedValue.replace(/\/+$/, "");
}

function collectFiles(directory, predicate) {
  const entries = readdirSync(directory);
  const files = [];

  for (const entry of entries) {
    const filePath = path.join(directory, entry);
    const stats = statSync(filePath);

    if (stats.isDirectory()) {
      files.push(...collectFiles(filePath, predicate));
      continue;
    }

    if (predicate(filePath)) {
      files.push(filePath);
    }
  }

  return files;
}

function extractAssetReferences(content) {
  const references = [];
  const referencePattern = /\b(?:href|src)=["']([^"']+)["']/g;

  let match = referencePattern.exec(content);
  while (match) {
    references.push({
      value: match[1]
    });
    match = referencePattern.exec(content);
  }

  return references;
}

function getReferencePathname(reference) {
  try {
    if (/^https?:\/\//i.test(reference)) {
      return new URL(reference).pathname;
    }
  } catch {
    return reference;
  }

  return reference.split("?")[0]?.split("#")[0] ?? reference;
}

function formatReference(htmlFile, reference) {
  return `${path.relative(process.cwd(), htmlFile)} -> ${reference}`;
}

function fail(message) {
  failures.push(message);
}
