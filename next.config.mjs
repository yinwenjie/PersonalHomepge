const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "";
const requestedBasePath = process.env.NEXT_PUBLIC_BASE_PATH;
const isUserOrOrgSite = repositoryName.endsWith(".github.io");
const derivedBasePath = requestedBasePath !== undefined
  ? requestedBasePath
  : repositoryName && !isUserOrOrgSite
    ? `/${repositoryName}`
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
