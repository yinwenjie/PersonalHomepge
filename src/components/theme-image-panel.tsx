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
import { useI18n } from "@/hooks/use-i18n";
import { captureClientError } from "@/infrastructure/error-monitoring-repository";
import { HomeAssetStorageRepository } from "@/infrastructure/home-asset-storage-repository";
import { trackProductEvent } from "@/infrastructure/product-analytics-repository";
import {
  formatSettingsImageAsset,
  formatSettingsImageSlot
} from "@/i18n/settings-presentation";

const THEME_IMAGE_SLOTS = ["banner", "background"] as const satisfies HomeThemeAssetSlot[];

interface ThemeImagePanelProps {
  documentValue: HomeDocumentV2;
  embedded?: boolean;
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
  embedded = false,
  storageReady,
  userId,
  onCommitDocument
}: ThemeImagePanelProps) {
  const { t } = useI18n();
  const repositoryRef = useRef(new HomeAssetStorageRepository());
  const bannerInputRef = useRef<HTMLInputElement | null>(null);
  const backgroundInputRef = useRef<HTMLInputElement | null>(null);
  const [busySlot, setBusySlot] = useState<HomeThemeAssetSlot | null>(null);
  const [message, setMessage] = useState<ThemeImagePanelMessage>(() => ({
    text: t("settings.images.initial"),
    tone: "neutral"
  }));

  async function handleUpload(slot: HomeThemeAssetSlot, file: File | undefined) {
    if (!file) {
      return;
    }

    if (!storageReady) {
      setMessage({ text: t("settings.common.storageNotReady"), tone: "warning" });
      return;
    }

    if (!userId) {
      setMessage({ text: t("settings.images.signInToUpload"), tone: "warning" });
      return;
    }

    const slotLabel = formatSettingsImageSlot(slot, t);
    setBusySlot(slot);
    setMessage({ text: t("settings.images.uploading", { slot: slotLabel }), tone: "neutral" });

    try {
      const prepared = await prepareHomeThemeAssetFile(file);
      const asset = await repositoryRef.current.upload(userId, slot, prepared);
      commitThemeAsset(slot, asset, t("settings.images.updated", { slot: slotLabel }));
      setMessage({ text: t("settings.images.uploaded", { slot: slotLabel }), tone: "success" });
    } catch (error) {
      console.error(error);
      captureClientError(error, {
        eventType: "async_operation_failed",
        operation: "storage.asset_upload",
        properties: {
          resourceKind: "image",
          source: "theme-image-panel",
          storageReady
        },
        severity: "error"
      });
      setMessage({
        text: error instanceof Error ? error.message : t("settings.images.uploadFailed", { slot: slotLabel }),
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
    const slotLabel = formatSettingsImageSlot(slot, t);

    commitThemeAsset(slot, null, t("settings.images.clearedCommit", { slot: slotLabel }));
    void repositoryRef.current.invalidateLocalAsset(currentAsset, userId);
    setMessage({ text: t("settings.images.cleared", { slot: slotLabel }), tone: "success" });

    if (currentAsset?.source === "storage") {
      try {
        await repositoryRef.current.remove(currentAsset);
      } catch (error) {
        console.warn(error);
        captureClientError(error, {
          eventType: "async_operation_failed",
          operation: "storage.asset_remove",
          properties: {
            resourceKind: "image",
            source: "theme-image-panel",
            storageReady
          },
          severity: "warning"
        });
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
      const slotLabel = formatSettingsImageSlot(slot, t);
      commitThemeAsset(slot, createExternalHomeThemeAsset(url), t("settings.images.externalCommit", { slot: slotLabel }));
      setMessage({ text: t("settings.images.externalSaved", { slot: slotLabel }), tone: "success" });
    } catch (error) {
      const slotLabel = formatSettingsImageSlot(slot, t);
      setMessage({
        text: error instanceof Error ? error.message : t("settings.images.externalFailed", { slot: slotLabel }),
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
    const slotLabel = formatSettingsImageSlot(slot, t);

    onCommitDocument({
      ...documentValue,
      theme: {
        ...documentValue.theme,
        [maskKey]: normalizedValue
      }
    }, t("settings.images.maskCommit", { slot: slotLabel, value: normalizedValue }));

    setMessage({ text: t("settings.images.maskUpdated", { slot: slotLabel, value: normalizedValue }), tone: "success" });
  }

  function resetFileInput(slot: HomeThemeAssetSlot) {
    const input = slot === "banner" ? bannerInputRef.current : backgroundInputRef.current;

    if (input) {
      input.value = "";
    }
  }

  const content = (
    <>
      <div className="theme-image-grid">
        {THEME_IMAGE_SLOTS.map((slot) => {
          const asset = getThemeAsset(documentValue.theme, slot);
          const uploadDisabled = !storageReady || !userId || busySlot !== null;
          const disabledReason = getUploadDisabledReason(storageReady, Boolean(userId), busySlot, t);
          const inputRef = slot === "banner" ? bannerInputRef : backgroundInputRef;
          const inputId = `themeImage${slot}`;
          const externalUrl = asset?.source === "external" ? asset.url ?? "" : "";
          const maskOpacity = getThemeMaskOpacity(documentValue.theme, slot);
          const slotLabel = formatSettingsImageSlot(slot, t);

          return (
            <article className="theme-image-card" key={slot}>
              <div className="theme-image-card-head">
                <strong>{slotLabel}</strong>
              </div>
              <div className={`theme-image-preview theme-image-preview-${slot}${asset ? "" : " is-empty"}`} aria-hidden="true" />
              <div className="theme-image-controls">
                <div className="theme-image-main-controls">
                  <div className="theme-image-action-row">
                    <span className="theme-image-state">{formatSettingsImageAsset(asset, t)}</span>
                    <div className="settings-actions">
                      <button
                        className="utility-button"
                        type="button"
                        disabled={uploadDisabled}
                        title={uploadDisabled ? disabledReason : t("settings.images.uploadTitle", { slot: slotLabel })}
                        onClick={() => inputRef.current?.click()}
                      >
                        {t("settings.images.upload")}
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
                        title={asset ? t("settings.images.clearTitle", { slot: slotLabel }) : t("settings.images.noImageTitle")}
                        onClick={() => handleClear(slot)}
                      >
                        {t("settings.images.clear")}
                      </button>
                    </div>
                  </div>
                  <form className="theme-image-url-form" onSubmit={(event) => handleExternalSubmit(slot, event)}>
                    <input
                      key={`${slot}-${externalUrl}-${asset?.updatedAt ?? "empty"}`}
                      name="themeImageUrl"
                      type="url"
                      defaultValue={externalUrl}
                      placeholder={t("settings.images.urlPlaceholder", { slot: slotLabel })}
                      aria-label={t("settings.images.urlPlaceholder", { slot: slotLabel })}
                      disabled={!storageReady || busySlot !== null}
                    />
                    <button
                      className="utility-button"
                      type="submit"
                      disabled={!storageReady || busySlot !== null}
                      title={storageReady ? t("settings.images.saveExternalTitle", { slot: slotLabel }) : t("settings.common.storageNotReady")}
                    >
                      {t("settings.images.apply")}
                    </button>
                  </form>
                </div>
                <label className="theme-image-mask-control">
                  <span>
                    <strong>{t("settings.images.maskStrength")}</strong>
                    <em>{maskOpacity}%</em>
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    value={maskOpacity}
                    disabled={!storageReady || busySlot !== null}
                    aria-label={`${slotLabel} ${t("settings.images.maskStrength")}`}
                    onChange={(event) => commitMaskOpacity(slot, Number(event.target.value))}
                  />
                  <span className="theme-image-mask-scale" aria-hidden="true">
                    <small>{t("settings.images.maskClear")}</small>
                    <small>{t("settings.images.maskReadable")}</small>
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
    </>
  );

  if (embedded) {
    return <div className="theme-image-panel-content">{content}</div>;
  }

  return (
    <section className="settings-panel" aria-label={t("settings.section.themeImages.title")}>
      <div className="panel-header">
        <h2>{t("settings.section.themeImages.title")}</h2>
        <span>{t("settings.section.themeImages.kicker")}</span>
      </div>
      {content}
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

function getUploadDisabledReason(storageReady: boolean, signedIn: boolean, busySlot: HomeThemeAssetSlot | null, t: ReturnType<typeof useI18n>["t"]): string {
  if (!storageReady) {
    return t("settings.common.storageNotReady");
  }

  if (!signedIn) {
    return t("settings.images.signInToUpload");
  }

  if (busySlot) {
    return t("settings.images.busy");
  }

  return "";
}
