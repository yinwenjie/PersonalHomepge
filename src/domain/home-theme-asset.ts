import {
  createId,
  HOME_THEME_ASSET_BUCKET,
  isValidUrl,
  normalizeUrl,
  type HomeThemeAsset,
  type HomeThemeAssetSlot
} from "@/domain/home-document";

export const HOME_THEME_ASSET_MAX_BYTES = 5 * 1024 * 1024;
export const HOME_THEME_ASSET_MAX_DIMENSION = 1600;
export const HOME_THEME_ASSET_SIGNED_URL_TTL_SECONDS = 60 * 60;

export const HOME_THEME_ASSET_ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif"
] as const;

type HomeThemeAssetAllowedType = (typeof HOME_THEME_ASSET_ALLOWED_TYPES)[number];

export interface PreparedHomeThemeAssetFile {
  file: File;
  contentType: HomeThemeAssetAllowedType;
  extension: "gif" | "jpg" | "png" | "webp";
  height: number | null;
  width: number | null;
}

export function createExternalHomeThemeAsset(url: string): HomeThemeAsset {
  return {
    source: "external",
    bucket: null,
    path: null,
    url: normalizeUrl(url),
    contentType: null,
    width: null,
    height: null,
    updatedAt: new Date().toISOString()
  };
}

export function assertValidExternalHomeThemeAssetUrl(url: string): void {
  if (!isValidUrl(url)) {
    throw new Error("请输入有效的 http 或 https 图片地址。");
  }
}

export function createStorageHomeThemeAsset({
  path,
  contentType,
  width,
  height
}: {
  contentType: string;
  height: number | null;
  path: string;
  width: number | null;
}): HomeThemeAsset {
  return {
    source: "storage",
    bucket: HOME_THEME_ASSET_BUCKET,
    path,
    url: null,
    contentType,
    width,
    height,
    updatedAt: new Date().toISOString()
  };
}

export function createHomeThemeAssetStoragePath(userId: string, slot: HomeThemeAssetSlot, extension: string): string {
  const assetId = globalThis.crypto?.randomUUID?.() ?? createId("asset").replace(/^asset-/, "");

  return `${userId}/${slot}/${assetId}.${extension}`;
}

export async function prepareHomeThemeAssetFile(file: File): Promise<PreparedHomeThemeAssetFile> {
  const contentType = normalizeAllowedContentType(file.type);

  if (!contentType) {
    throw new Error("仅支持 JPG、PNG、WebP 或 GIF 图片。");
  }

  if (file.size > HOME_THEME_ASSET_MAX_BYTES) {
    throw new Error("图片不能超过 5MB。");
  }

  const imageSize = await readImageSize(file).catch(() => ({ width: null, height: null }));
  if (contentType === "image/gif") {
    return {
      file,
      contentType,
      extension: "gif",
      width: imageSize.width,
      height: imageSize.height
    };
  }

  const compressed = imageSize.width && imageSize.height
    ? await compressImageToWebp(file, imageSize.width, imageSize.height).catch(() => null)
    : null;

  const uploadFile = compressed && compressed.size <= file.size ? compressed : file;
  if (uploadFile.size > HOME_THEME_ASSET_MAX_BYTES) {
    throw new Error("图片压缩后仍超过 5MB，请换一张更小的图片。");
  }

  const uploadContentType = normalizeAllowedContentType(uploadFile.type) ?? contentType;

  return {
    file: uploadFile,
    contentType: uploadContentType,
    extension: getExtensionForContentType(uploadContentType),
    width: imageSize.width,
    height: imageSize.height
  };
}

function normalizeAllowedContentType(contentType: string): HomeThemeAssetAllowedType | null {
  const normalized = contentType.toLowerCase();

  return HOME_THEME_ASSET_ALLOWED_TYPES.includes(normalized as HomeThemeAssetAllowedType)
    ? normalized as HomeThemeAssetAllowedType
    : null;
}

function getExtensionForContentType(contentType: HomeThemeAssetAllowedType): PreparedHomeThemeAssetFile["extension"] {
  if (contentType === "image/jpeg") {
    return "jpg";
  }

  if (contentType === "image/png") {
    return "png";
  }

  if (contentType === "image/gif") {
    return "gif";
  }

  return "webp";
}

async function readImageSize(file: File): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(file);

  try {
    const image = await loadImage(url);

    return {
      width: image.naturalWidth,
      height: image.naturalHeight
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function compressImageToWebp(file: File, sourceWidth: number, sourceHeight: number): Promise<File | null> {
  const scale = Math.min(1, HOME_THEME_ASSET_MAX_DIMENSION / Math.max(sourceWidth, sourceHeight));
  const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
  const targetHeight = Math.max(1, Math.round(sourceHeight * scale));
  const url = URL.createObjectURL(file);

  try {
    const image = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const context = canvas.getContext("2d");
    if (!context) {
      return null;
    }

    context.drawImage(image, 0, 0, targetWidth, targetHeight);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/webp", 0.86);
    });

    return blob
      ? new File([blob], replaceExtension(file.name, "webp"), {
          type: "image/webp",
          lastModified: Date.now()
        })
      : null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片读取失败。"));
    image.src = url;
  });
}

function replaceExtension(name: string, extension: string): string {
  const baseName = name.replace(/\.[^.]+$/, "") || "homepage-image";

  return `${baseName}.${extension}`;
}
