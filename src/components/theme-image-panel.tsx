"use client";

import type { ChangeEvent, FormEvent } from "react";
import { useRef, useState } from "react";
import { StatusMessage, type StatusTone } from "@/components/status-message";
import {
  assertValidExternalHomeThemeAssetUrl,
  createExternalHomeThemeAsset,
  HOME_THEME_ASSET_ALLOWED_TYPES,
  prepareHomeThemeAssetFile
} from "@/domain/home-theme-asset";
import type {
  HomeDocumentV2,
  HomeTheme,
  HomeThemeAsset,
  HomeThemeAssetSlot
} from "@/domain/home-document";
import { HomeAssetStorageRepository } from "@/infrastructure/home-asset-storage-repository";
import { trackProductEvent } from "@/infrastructure/product-analytics-repository";

const THEME_IMAGE_SLOTS = ["banner", "background"] as const satisfies HomeThemeAssetSlot[];

interface ThemeImagePanelProps {
  documentValue: HomeDocumentV2;
  storageReady: boolean;
  userId: string | null;
  onCommitDocument: (documentValue: HomeDocumentV2, message?: string) => void;
}

interface ThemeImagePanelMessage {
  text: string;
  tone: StatusTone;
}

export function ThemeImagePanel({
  documentValue,
  storageReady,
  userId,
  onCommitDocument
}: ThemeImagePanelProps) {
  const repositoryRef = useRef(new HomeAssetStorageRepository());
  const bannerInputRef = useRef<HTMLInputElement | null>(null);
  const backgroundInputRef = useRef<HTMLInputElement | null>(null);
  const [busySlot, setBusySlot] = useState<HomeThemeAssetSlot | null>(null);
  const [message, setMessage] = useState<ThemeImagePanelMessage>({
    text: "可设置 Banner 或背景图片。",
    tone: "neutral"
  });

  async function handleUpload(slot: HomeThemeAssetSlot, file: File | undefined) {
    if (!file) {
      return;
    }

    if (!storageReady) {
      setMessage({ text: "本地存储尚未就绪，请稍后重试。", tone: "warning" });
      return;
    }

    if (!userId) {
      setMessage({ text: "登录后才能上传图片并跨设备恢复。", tone: "warning" });
      return;
    }

    setBusySlot(slot);
    setMessage({ text: `${getSlotLabel(slot)} 图片上传中...`, tone: "neutral" });

    try {
      const prepared = await prepareHomeThemeAssetFile(file);
      const asset = await repositoryRef.current.upload(userId, slot, prepared);
      commitThemeAsset(slot, asset, `已更新${getSlotLabel(slot)}图片`);
      setMessage({ text: `${getSlotLabel(slot)} 图片已上传。`, tone: "success" });
    } catch (error) {
      console.error(error);
      setMessage({
        text: error instanceof Error ? error.message : `${getSlotLabel(slot)} 图片上传失败。`,
        tone: "danger"
      });
    } finally {
      setBusySlot(null);
      resetFileInput(slot);
    }
  }

  async function handleClear(slot: HomeThemeAssetSlot) {
    if (!storageReady || busySlot) {
      return;
    }

    const currentAsset = getThemeAsset(documentValue.theme, slot);

    commitThemeAsset(slot, null, `已清除${getSlotLabel(slot)}图片`);
    setMessage({ text: `${getSlotLabel(slot)} 图片已清除。`, tone: "success" });

    if (currentAsset?.source === "storage") {
      try {
        await repositoryRef.current.remove(currentAsset);
      } catch (error) {
        console.warn(error);
      }
    }
  }

  function handleExternalSubmit(slot: HomeThemeAssetSlot, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!storageReady || busySlot) {
      return;
    }

    try {
      const formData = new FormData(event.currentTarget);
      const url = String(formData.get("themeImageUrl") ?? "").trim();
      assertValidExternalHomeThemeAssetUrl(url);
      commitThemeAsset(slot, createExternalHomeThemeAsset(url), `已设置${getSlotLabel(slot)}外链`);
      setMessage({ text: `${getSlotLabel(slot)} 外链已保存。`, tone: "success" });
    } catch (error) {
      setMessage({
        text: error instanceof Error ? error.message : `${getSlotLabel(slot)} 外链保存失败。`,
        tone: "danger"
      });
    }
  }

  function commitThemeAsset(slot: HomeThemeAssetSlot, asset: HomeThemeAsset | null, commitMessage: string) {
    const assetKey = getThemeAssetKey(slot);
    const urlKey = getThemeUrlKey(slot);

    onCommitDocument({
      ...documentValue,
      theme: {
        ...documentValue.theme,
        [assetKey]: asset,
        [urlKey]: asset?.source === "external" ? asset.url : null
      }
    }, commitMessage);
    trackProductEvent("theme_image.changed", {
      assetSlot: slot,
      assetSource: asset?.source ?? "none"
    });
  }

  function commitMaskOpacity(slot: HomeThemeAssetSlot, value: number) {
    const maskKey = getThemeMaskKey(slot);
    const normalizedValue = Math.min(100, Math.max(0, Math.round(value)));

    onCommitDocument({
      ...documentValue,
      theme: {
        ...documentValue.theme,
        [maskKey]: normalizedValue
      }
    }, `${getSlotLabel(slot)}遮罩强度 ${normalizedValue}%`);

    setMessage({ text: `${getSlotLabel(slot)} 遮罩强度已调整为 ${normalizedValue}%。`, tone: "success" });
  }

  function resetFileInput(slot: HomeThemeAssetSlot) {
    const input = slot === "banner" ? bannerInputRef.current : backgroundInputRef.current;

    if (input) {
      input.value = "";
    }
  }

  return (
    <section className="settings-panel" aria-label="Banner 和背景图片">
      <div className="panel-header">
        <h2>Banner / 背景</h2>
        <span>Images</span>
      </div>

      <div className="theme-image-grid">
        {THEME_IMAGE_SLOTS.map((slot) => {
          const asset = getThemeAsset(documentValue.theme, slot);
          const uploadDisabled = !storageReady || !userId || busySlot !== null;
          const disabledReason = getUploadDisabledReason(storageReady, Boolean(userId), busySlot);
          const inputRef = slot === "banner" ? bannerInputRef : backgroundInputRef;
          const inputId = `themeImage${slot}`;
          const externalUrl = asset?.source === "external" ? asset.url ?? "" : "";
          const maskOpacity = getThemeMaskOpacity(documentValue.theme, slot);

          return (
            <article className="theme-image-card" key={slot}>
              <div className="theme-image-card-head">
                <strong>{getSlotLabel(slot)}</strong>
              </div>
              <div className={`theme-image-preview theme-image-preview-${slot}${asset ? "" : " is-empty"}`} aria-hidden="true" />
              <div className="theme-image-controls">
                <div className="theme-image-main-controls">
                  <div className="theme-image-action-row">
                    <span className="theme-image-state">{getAssetLabel(asset)}</span>
                    <div className="settings-actions">
                      <button
                        className="utility-button"
                        type="button"
                        disabled={uploadDisabled}
                        title={uploadDisabled ? disabledReason : `上传${getSlotLabel(slot)}图片`}
                        onClick={() => inputRef.current?.click()}
                      >
                        上传
                      </button>
                      <input
                        ref={inputRef}
                        id={inputId}
                        type="file"
                        accept={HOME_THEME_ASSET_ALLOWED_TYPES.join(",")}
                        hidden
                        onChange={(event: ChangeEvent<HTMLInputElement>) => handleUpload(slot, event.target.files?.[0])}
                      />
                      <button
                        className="utility-button"
                        type="button"
                        disabled={!storageReady || !asset || busySlot !== null}
                        title={asset ? `清除${getSlotLabel(slot)}图片` : "当前未设置图片"}
                        onClick={() => handleClear(slot)}
                      >
                        清除
                      </button>
                    </div>
                  </div>
                  <form className="theme-image-url-form" onSubmit={(event) => handleExternalSubmit(slot, event)}>
                    <input
                      key={`${slot}-${externalUrl}-${asset?.updatedAt ?? "empty"}`}
                      name="themeImageUrl"
                      type="url"
                      defaultValue={externalUrl}
                      placeholder={`${getSlotLabel(slot)} 图片 URL`}
                      aria-label={`${getSlotLabel(slot)} 图片 URL`}
                      disabled={!storageReady || busySlot !== null}
                    />
                    <button
                      className="utility-button"
                      type="submit"
                      disabled={!storageReady || busySlot !== null}
                      title={storageReady ? `保存${getSlotLabel(slot)}外链` : "本地存储尚未就绪，请稍后重试。"}
                    >
                      应用
                    </button>
                  </form>
                </div>
                <label className="theme-image-mask-control">
                  <span>
                    <strong>遮罩强度</strong>
                    <em>{maskOpacity}%</em>
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    value={maskOpacity}
                    disabled={!storageReady || busySlot !== null}
                    aria-label={`${getSlotLabel(slot)} 遮罩强度`}
                    onChange={(event) => commitMaskOpacity(slot, Number(event.target.value))}
                  />
                  <span className="theme-image-mask-scale" aria-hidden="true">
                    <small>清晰</small>
                    <small>易读</small>
                  </span>
                </label>
              </div>
            </article>
          );
        })}
      </div>

      <StatusMessage role={message.tone === "danger" ? "alert" : "status"} tone={message.tone}>
        {message.text}
      </StatusMessage>
    </section>
  );
}

function getThemeAsset(theme: HomeTheme, slot: HomeThemeAssetSlot): HomeThemeAsset | null {
  return slot === "banner" ? theme.bannerAsset : theme.backgroundAsset;
}

function getThemeAssetKey(slot: HomeThemeAssetSlot): "bannerAsset" | "backgroundAsset" {
  return slot === "banner" ? "bannerAsset" : "backgroundAsset";
}

function getThemeUrlKey(slot: HomeThemeAssetSlot): "bannerUrl" | "backgroundUrl" {
  return slot === "banner" ? "bannerUrl" : "backgroundUrl";
}

function getThemeMaskKey(slot: HomeThemeAssetSlot): "bannerMaskOpacity" | "backgroundMaskOpacity" {
  return slot === "banner" ? "bannerMaskOpacity" : "backgroundMaskOpacity";
}

function getThemeMaskOpacity(theme: HomeTheme, slot: HomeThemeAssetSlot): number {
  return slot === "banner" ? theme.bannerMaskOpacity : theme.backgroundMaskOpacity;
}

function getSlotLabel(slot: HomeThemeAssetSlot): string {
  return slot === "banner" ? "Banner" : "背景";
}

function getAssetLabel(asset: HomeThemeAsset | null): string {
  if (!asset) {
    return "未设置";
  }

  return asset.source === "storage" ? "已上传" : "外链";
}

function getUploadDisabledReason(storageReady: boolean, signedIn: boolean, busySlot: HomeThemeAssetSlot | null): string {
  if (!storageReady) {
    return "本地存储尚未就绪，请稍后重试。";
  }

  if (!signedIn) {
    return "登录后才能上传图片并跨设备恢复。";
  }

  if (busySlot) {
    return "图片操作进行中，请稍后。";
  }

  return "";
}
