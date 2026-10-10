import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import ts from "typescript";

// Uses a fresh Chrome profile and synthetic images only; never opens the user's browser or Supabase.
const chrome = process.env.CHROME_BIN ?? [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser"
].find((candidate) => fs.existsSync(candidate));
assert(chrome, "Chrome/Chromium is required. Set CHROME_BIN to its executable path.");
const sources = Object.fromEntries([
  "home-asset-cache-repository", "home-asset-storage-repository", "home-theme-image-loader", "home-theme-image-controller"
].map((name) => [
  `@/infrastructure/${name}`,
  ts.transpileModule(fs.readFileSync(`src/infrastructure/${name}.ts`, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
]));
sources["@/components/home-theme-style-bridge"] = ts.transpileModule(
  fs.readFileSync("src/components/home-theme-style-bridge.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }
).outputText;
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
let imageRequests = 0;
const server = http.createServer((request, response) => {
  if (request.url.startsWith("/image.png")) {
    imageRequests += 1;
    response.writeHead(200, { "content-type": "image/png", "cache-control": "no-store" });
    response.flushHeaders();
    const delay = Number(new URL(request.url, "http://localhost").searchParams.get("delay")) || 0;
    if (delay) setTimeout(() => response.end(png), delay);
    else response.end(png);
    return;
  }
  response.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
  response.end(`<html><body><script>
    window.themeImageSources = ${JSON.stringify(sources).replaceAll("<", "\\u003c")};
    (${browserTests.toString()})();
  </script></body></html>`);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(path.join(os.tmpdir(), "homepage-theme-image-test-"));
let browser;
let connection;
try {
  browser = spawn(chrome, [
    "--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe"] });
  const endpoint = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("Chrome startup timed out.")), 15000);
    browser.once("error", (error) => { clearTimeout(timer); reject(error); });
    browser.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Chrome exited (${code}).`)); });
    browser.stderr.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  connection = await connect(endpoint);
  const { targetId } = await connection.send("Target.createTarget", { url: origin });
  const { sessionId } = await connection.send("Target.attachToTarget", { targetId, flatten: true });
  const evaluate = async (expression) => {
    const result = await connection.send("Runtime.evaluate", {
      expression, awaitPromise: true, returnByValue: true
    }, sessionId);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? "Browser test failed.");
    return result.result.value;
  };
  const waitForPage = async () => {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (await evaluate("typeof window.runThemeImageTests === 'function'")) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("Browser test fixture did not initialize.");
  };
  await waitForPage();
  const first = await evaluate("window.runThemeImageTests(false)");
  console.log(`Theme image checks passed: ${first.join(", ")}.`);
  const beforeReload = imageRequests;
  const previousDocument = await evaluate("window.themeImageTestInstance");
  await evaluate("sessionStorage.setItem('theme-test-reloaded', '1')");
  await connection.send("Page.reload", { ignoreCache: true }, sessionId);
  // Wait for the new document rather than accepting the previous execution context.
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      if (await evaluate(`window.themeImageTestInstance !== ${JSON.stringify(previousDocument)} && typeof window.runThemeImageTests === 'function'`)) break;
    } catch { /* Navigation destroys the previous execution context. */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await evaluate("window.runThemeImageTests(true)");
  assert.equal(imageRequests, beforeReload, "A real page reload must not download the cached image again.");
  console.log("Real page reload passed: cached private image displayed with zero signing or image requests.");
  await evaluate("window.verifyCorsFallbackAfterReload()");
  console.log("Real page reload passed: remembered direct-image fallback skips the failing CORS fetch.");
} finally {
  connection?.close();
  if (browser && browser.exitCode === null) {
    const exited = new Promise((resolve) => browser.once("exit", resolve));
    browser.kill();
    await exited;
  }
  await new Promise((resolve) => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}

async function connect(endpoint) {
  const socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    const callback = pending.get(message.id);
    if (!callback) return;
    pending.delete(message.id);
    clearTimeout(callback.timer);
    if (message.error) callback.reject(new Error(message.error.message));
    else callback.resolve(message.result);
  });
  return {
    send(method, params = {}, sessionId) {
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Browser command timed out: ${method}`));
        }, 45000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params, sessionId }));
      });
    },
    close() {
      for (const entry of pending.values()) clearTimeout(entry.timer);
      socket.close();
    }
  };
}

function browserTests() {
  window.themeImageTestInstance = crypto.randomUUID();
  const modules = {};
  let signing = 0;
  let signedUrlOverride = null;
  const project = "https://theme-images.test";
  const fakeClient = {
    storage: { from: () => ({
      upload: async () => ({ error: null }),
      remove: async () => ({ error: null }),
      createSignedUrl: async () => {
        signing += 1;
        if (sessionStorage.getItem("theme-test-reloaded")) throw new Error("No signing is allowed after reload.");
        return { data: { signedUrl: signedUrlOverride ?? `${location.origin}/image.png?signature=${signing}` }, error: null };
      }
    }) }
  };
  const mocks = {
    "@/domain/home-document": { HOME_THEME_ASSET_BUCKET: "home-assets" },
    "@/domain/home-theme-asset": {
      HOME_THEME_ASSET_SIGNED_URL_TTL_SECONDS: 3600,
      createHomeThemeAssetStoragePath: (userId, slot, extension) => `${userId}/${slot}/uploaded.${extension}`,
      createStorageHomeThemeAsset: (asset) => ({ ...asset, source: "storage", bucket: "home-assets", updatedAt: "upload-v1" })
    },
    "@/infrastructure/supabase-client": {
      getSupabaseAssetProjectScope: () => project,
      isSupabaseConfigured: () => true,
      getSupabaseBrowserClient: () => fakeClient
    }
  };
  const require = (name) => {
    if (mocks[name]) return mocks[name];
    if (modules[name]) return modules[name];
    const exports = {};
    modules[name] = exports;
    new Function("require", "exports", window.themeImageSources[name])(require, exports);
    return exports;
  };
  const cacheModule = require("@/infrastructure/home-asset-cache-repository");
  const { homeAssetCache: cache, getHomeAssetCacheIdentity: identity } = cacheModule;
  const { HomeThemeImageLoader } = require("@/infrastructure/home-theme-image-loader");
  const { HomeAssetStorageRepository } = require("@/infrastructure/home-asset-storage-repository");
  const { HomeThemeImageController } = require("@/infrastructure/home-theme-image-controller");
  const asset = (name, updatedAt = "v1") => ({
    source: "storage", bucket: "home-assets", path: `user-a/background/${name}.png`, updatedAt
  });
  const check = (value, message) => { if (!value) throw new Error(message); };
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  const load = (loader, image) => loader.load(image, "user-a", new AbortController().signal);
  const released = [];
  const image = (url) => ({ url, release: () => released.push(url) });
  const external = { source: "external", bucket: null, path: null, url: `${location.origin}/image.png?external=1`, updatedAt: "v1" };

  window.verifyCorsFallbackAfterReload = async () => {
    const originalFetch = window.fetch;
    let attempts = 0;
    window.fetch = async () => { attempts += 1; throw new TypeError("Synthetic CORS restriction"); };
    try {
      const result = await load(new HomeThemeImageLoader(), external);
      check(result?.url === external.url && attempts === 0, "Reload must skip a previously failed CORS fetch.");
      result.release();
    } finally {
      window.fetch = originalFetch;
    }
  };

  window.runThemeImageTests = async (reloaded) => {
    const loader = new HomeThemeImageLoader();
    const reloadAsset = asset("reload");
    if (reloaded) {
      const result = await load(loader, reloadAsset);
      check(result?.url.startsWith("blob:"), "Persisted Blob must display after real navigation/reload.");
      check(signing === 0, "Cached private image must not need a fresh signed URL.");
      result.release();
      return true;
    }

    check(identity(project, null, asset("private")) === null, "Signed-out user must not access private cache.");
    check(identity(project, "user-b", asset("private")) === null, "Another account must not access private cache.");
    const first = await load(loader, asset("first"));
    check(first?.url.startsWith("blob:"), "Cold download must display a decoded Blob.");
    first.release();
    await tick();
    const before = signing;
    const warm = await load(new HomeThemeImageLoader(), asset("first"));
    check(signing === before && warm?.url.startsWith("blob:"), "New loader must reuse persistent cache.");
    warm.release();
    check(await cache.get(identity("other-project", "user-a", asset("first"))) === null, "Projects must not share cache.");
    const updated = await load(loader, asset("first", "v2"));
    check(signing === before + 1, "Resource version change must download the new image.");
    updated.release();

    const fetchBeforeConcurrent = window.fetch;
    window.fetch = async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return fetchBeforeConcurrent(...args);
    };
    const beforeConcurrent = signing;
    try {
      const concurrent = await Promise.all([load(loader, asset("concurrent")), load(loader, asset("concurrent"))]);
      check(signing === beforeConcurrent + 1, "Concurrent requests for one resource must share the download/signing.");
      concurrent.forEach((result) => result.release());
    } finally {
      window.fetch = fetchBeforeConcurrent;
    }

    const blob = await (await fetch(`${location.origin}/image.png`)).blob();
    const storage = new HomeAssetStorageRepository();
    const uploaded = await storage.upload("user-a", "background", {
      file: new File([blob], "upload.png", { type: "image/png" }), extension: "png", contentType: "image/png", width: 1, height: 1
    });
    const beforeUploadDisplay = signing;
    (await load(loader, uploaded)).release();
    check(signing === beforeUploadDisplay, "Upload must seed local cache without a second download.");

    const corrupt = asset("corrupt");
    const corruptKey = identity(project, "user-a", corrupt);
    await cache.put(corruptKey, new Blob(["invalid image"], { type: "image/png" }), cache.accountVersion(project, "user-a"));
    (await load(loader, corrupt)).release();
    check(signing === beforeUploadDisplay + 1, "Corrupt image must be evicted and downloaded again.");

    const savedIndexedDB = Object.getOwnPropertyDescriptor(window, "indexedDB");
    Object.defineProperty(window, "indexedDB", { configurable: true, value: undefined });
    try {
      (await load(new HomeThemeImageLoader(), asset("no-indexeddb"))).release();
    } finally {
      if (savedIndexedDB) Object.defineProperty(window, "indexedDB", savedIndexedDB);
      else delete window.indexedDB;
    }
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = () => { throw new DOMException("Synthetic quota exhaustion", "QuotaExceededError"); };
    try {
      check(await cache.put(identity(project, "user-a", asset("quota")), blob, cache.accountVersion(project, "user-a")) === false,
        "Quota failure must be a non-fatal cache miss.");
      (await load(new HomeThemeImageLoader(), asset("quota-display"))).release();
      await tick();
    } finally {
      IDBObjectStore.prototype.put = originalPut;
    }

    // Accelerate only the production 15s budget, keeping native fetch/body/Image behavior.
    // The slow endpoint sends headers immediately but takes longer than that budget to send the body.
    const originalSetTimeout = window.setTimeout;
    const slowAsset = asset("slow-storage");
    signedUrlOverride = `${location.origin}/image.png?delay=150&slow-storage=1`;
    window.setTimeout = (callback, delay, ...args) => originalSetTimeout(callback, delay === 15000 ? 30 : delay, ...args);
    try {
      const slow = await load(loader, slowAsset);
      check(slow?.url === signedUrlOverride, "Storage body timeout must fall back to a direct image without another 15s cutoff.");
      check(await cache.get(identity(project, "user-a", slowAsset)) === null, "Partial Storage bodies must not be cached.");
      slow.release();
    } finally {
      window.setTimeout = originalSetTimeout;
      signedUrlOverride = null;
    }

    const originalFetch = window.fetch;
    for (const [name, fail] of [
      ["fetch-failure", async () => { throw new TypeError("Synthetic fetch failure"); }],
      ["body-failure", async () => new Response(new ReadableStream({
        start(stream) { stream.error(new Error("Synthetic body read failure")); }
      }), { headers: { "content-type": "image/png" } })]
    ]) {
      window.fetch = fail;
      try {
        const fallback = await load(loader, asset(name));
        check(fallback?.url.startsWith(`${location.origin}/image.png`), "Storage fetch/body failures must use the signed URL directly.");
        fallback.release();
      } finally {
        window.fetch = originalFetch;
      }
    }
    window.fetch = async () => { throw new TypeError("Synthetic fetch failure"); };
    signedUrlOverride = `${location.origin}/image.png?delay=150&cancel-storage=1`;
    try {
      const abort = new AbortController();
      const cancelled = loader.load(asset("cancel-direct"), "user-a", abort.signal).catch(() => null);
      originalSetTimeout(() => abort.abort(), 30);
      check(await cancelled === null, "Direct image fallback must remain cancellable during account/space changes.");
    } finally {
      window.fetch = originalFetch;
      signedUrlOverride = null;
    }

    let corsAttempts = 0;
    window.fetch = async () => { corsAttempts += 1; throw new TypeError("Synthetic CORS restriction"); };
    try {
      const fallback = await load(loader, external);
      check(fallback?.url === external.url, "CORS failure must fall back to direct image display.");
      fallback.release();
      (await load(new HomeThemeImageLoader(), external)).release();
      check(corsAttempts === 1, "Known direct-image fallbacks must skip repeated failing fetches.");
      (await load(loader, { ...external, updatedAt: "v2" })).release();
      check(corsAttempts === 2, "A new asset version must retry CORS caching.");
      const expiringExternal = { ...external, url: `${location.origin}/image.png?expiring-cors=1` };
      (await load(loader, expiringExternal)).release();
      const realNow = Date.now;
      Date.now = () => realNow() + 11 * 60 * 1000;
      try {
        (await load(loader, expiringExternal)).release();
        check(corsAttempts === 4, "Temporary direct-image fallback must expire and retry caching.");
      } finally {
        Date.now = realNow;
      }
    } finally {
      window.fetch = originalFetch;
    }
    const externalKey = identity(project, "user-a", external);
    await cache.put(externalKey, blob, cache.accountVersion(project, "user-a"));
    const realNow = Date.now;
    const tomorrow = realNow() + 24 * 60 * 60 * 1000;
    Date.now = () => tomorrow;
    try {
      check(await cache.get(externalKey) === null, "External image cache must expire after 24 hours.");
    } finally {
      Date.now = realNow;
    }

    let oversizedCancelled = false;
    const oversizedExternal = { ...external, url: `${location.origin}/image.png?oversized=1` };
    window.fetch = async () => new Response(new ReadableStream({
      pull(stream) { stream.enqueue(new Uint8Array(1024 * 1024)); },
      cancel() { oversizedCancelled = true; }
    }), { headers: { "content-type": "image/png" } });
    try {
      const oversized = await load(loader, oversizedExternal);
      check(oversizedCancelled && oversized?.url === oversizedExternal.url,
        "Unknown-length downloads over 5MB must stop buffering and fall back to direct display.");
      check(await cache.get(identity(project, "user-a", oversizedExternal)) === null,
        "Oversized external images must not enter the persistent cache.");
      oversized.release();
    } finally {
      window.fetch = originalFetch;
    }

    // Native IndexedDB eviction: both the count and total byte limit must be enforced.
    for (let index = 0; index < 22; index += 1) {
      await cache.put(identity(project, "user-a", asset(`lru-${index}`)), blob, cache.accountVersion(project, "user-a"));
    }
    check(await cache.get(identity(project, "user-a", asset("lru-0"))) === null, "Oldest cache entries must be evicted.");
    check(await cache.get(identity(project, "user-a", asset("lru-21"))) instanceof Blob, "Latest cache entry must be retained.");
    const largeBlob = new Blob([new Uint8Array(5 * 1024 * 1024)], { type: "image/png" });
    for (let index = 0; index < 11; index += 1) {
      await cache.put(identity(project, "user-a", asset(`bytes-${index}`)), largeBlob, cache.accountVersion(project, "user-a"));
    }
    check(await cache.get(identity(project, "user-a", asset("bytes-0"))) === null, "50MB byte budget must evict old large images.");

    const stale = identity(project, "user-a", asset("stale"));
    const accountVersion = cache.accountVersion(project, "user-a");
    await cache.clearAccount(project, "user-a");
    check(await cache.put(stale, blob, accountVersion) === false, "Late download must not recreate signed-out account cache.");
    const resourceVersion = cache.resourceVersion(stale);
    await cache.remove(stale);
    check(await cache.put(stale, blob, cache.accountVersion(project, "user-a"), resourceVersion) === false,
      "Late download must not recreate a cleared image.");

    const waiting = [];
    const controller = new HomeThemeImageController({
      load: (value, userId, signal) => new Promise((resolve, reject) => waiting.push({ value, userId, signal, resolve, reject }))
    });
    const background = asset("controller-background");
    const banner = asset("controller-banner");
    const theme = { bannerAsset: banner, backgroundAsset: background };
    controller.apply(theme, "document-a", "user-a");
    waiting[1].resolve(image("background-ready"));
    await tick();
    check(document.documentElement.style.getPropertyValue("--home-background-image").includes("background-ready"),
      "Background must display without waiting for Banner.");
    waiting[0].reject(new Error("Banner failed"));
    await tick();
    controller.apply({ bannerAsset: null, backgroundAsset: asset("replacement") }, "document-a", "user-a");
    check(document.documentElement.style.getPropertyValue("--home-background-image").includes("background-ready"),
      "Same-scope replacement must keep the displayed image until ready.");
    controller.apply({ bannerAsset: null, backgroundAsset: asset("other-space") }, "document-b", "user-a");
    check(document.documentElement.style.getPropertyValue("--home-background-image") === "none",
      "Space switch must clear the previous image immediately.");
    waiting[2].resolve(image("stale-image"));
    await tick();
    check(released.includes("stale-image"), "Outdated requests must release their object URL without displaying.");
    waiting[3].resolve(image("new-space"));
    await tick();
    document.documentElement.style.setProperty("--home-background-image", "none");
    controller.apply({ bannerAsset: null, backgroundAsset: asset("other-space") }, "document-b", "user-a");
    check(waiting.length === 4 && document.documentElement.style.getPropertyValue("--home-background-image").includes("new-space"),
      "Navigation must restore the retained image without another load.");
    controller.clearAccount("user-a");
    check(released.includes("new-space") && document.documentElement.style.getPropertyValue("--home-background-image") === "none",
      "Sign-out must clear displayed private images and release object URLs.");

    // Execute the real bridge with a minimal effect runner, including normalized asset copies.
    const effects = [];
    let effectIndex = 0;
    let bridgeLoads = 0;
    let bridgeAborts = 0;
    const bridgeMocks = {
      react: { useEffect: (callback, dependencies) => {
        const index = effectIndex++;
        const previous = effects[index];
        if (previous && dependencies.every((value, offset) => Object.is(value, previous.dependencies[offset]))) return;
        previous?.cleanup?.();
        effects[index] = { dependencies, cleanup: callback() };
      } },
      "@/infrastructure/home-theme-image-controller": { homeThemeImageController: {
        apply: () => { bridgeLoads += 1; return () => { bridgeAborts += 1; }; }
      } },
      "@/hooks/use-supabase-auth": { useSupabaseAuth: () => ({ user: { id: "user-a" }, loading: false }) },
      "@/hooks/use-ui-preferences": { useUiPreferences: () => ({ preferences: { themePreference: "light" } }) },
      "@/domain/theme-preset": { getHomeThemeCssVariables: () => ({}), getHomeThemeAppearanceAttribute: () => "test" }
    };
    const bridgeExports = {};
    new Function("require", "exports", window.themeImageSources["@/components/home-theme-style-bridge"])(
      (name) => bridgeMocks[name] ?? require(name), bridgeExports
    );
    const renderBridge = (theme) => {
      effectIndex = 0;
      bridgeExports.HomeThemeStyleBridge({ theme, documentId: "document-a", spaceId: null, storageReady: true });
    };
    renderBridge({ bannerAsset: null, backgroundAsset: background, backgroundMaskOpacity: 20 });
    renderBridge({ bannerAsset: null, backgroundAsset: { ...background }, backgroundMaskOpacity: 80, accent: "#123456" });
    check(bridgeLoads === 1 && bridgeAborts === 0, "Color/mask changes with normalized asset copies must not restart image loading.");
    renderBridge({ bannerAsset: null, backgroundAsset: { ...background, updatedAt: "v2" } });
    check(bridgeLoads === 2 && bridgeAborts === 1, "Changed image assets must restart image loading.");
    effects.forEach((effect) => effect.cleanup?.());

    // Seed the final fixture after eviction/sign-out tests, then navigate to a new JS context.
    const forReload = await load(loader, reloadAsset);
    forReload.release();
    check(await cache.get(identity(project, "user-a", reloadAsset)) instanceof Blob, "Reload fixture must be committed to IndexedDB.");
    return ["cold/warm/versioned cache", "concurrent deduplication", "upload seeding", "corruption recovery", "slow/error/cancelled Storage fallback",
      "CORS fallback/session memory/version/expiry",
      "IndexedDB/quota fallback", "bounded downloads", "LRU/count/byte limits", "account/project isolation", "late-write guards",
      "independent slots", "navigation/space/sign-out cleanup", "stale-response cleanup", "asset-only effect dependencies"];
  };
}
