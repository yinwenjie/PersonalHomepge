const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "";
const requestedBasePath = normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH, "NEXT_PUBLIC_BASE_PATH");
const isUserOrOrgSite = repositoryName.endsWith(".github.io");
const derivedBasePath = requestedBasePath !== undefined
  ? requestedBasePath
  : repositoryName && !isUserOrOrgSite
    ? normalizeBasePath(`/${repositoryName}`, "GITHUB_REPOSITORY")
    : "";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  basePath: derivedBasePath,
  assetPrefix: derivedBasePath || undefined,
  allowedDevOrigins: ["127.0.0.1"],
  images: {
    unoptimized: true
  },
  trailingSlash: true
};

export default nextConfig;

function normalizeBasePath(value, sourceName) {
  if (value === undefined) {
    return undefined;
  }

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
