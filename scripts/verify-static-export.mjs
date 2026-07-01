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
  const nextDirectory = path.join(directory, "_next");
  const headersPath = path.join(directory, "_headers");

  if (!existsSync(indexPath)) {
    fail("Missing out/index.html.");
  }

  if (!existsSync(nextDirectory)) {
    fail("Missing out/_next directory.");
  }

  verifyCloudflareHeaders(headersPath);

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
