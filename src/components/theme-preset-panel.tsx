"use client";

import type { CSSProperties } from "react";
import { StatusMessage } from "@/components/status-message";
import type { HomeDocumentV2 } from "@/domain/home-document";
import {
  getHomeThemePreset,
  normalizeHomeThemePresetId,
  VISIBLE_HOME_THEME_PRESETS,
  type HomeThemePreset
} from "@/domain/theme-preset";
import { trackProductEvent } from "@/infrastructure/product-analytics-repository";

interface ThemePresetPanelProps {
  documentValue: HomeDocumentV2;
  embedded?: boolean;
  storageReady: boolean;
  onCommitDocument: (documentValue: HomeDocumentV2, message?: string) => void;
}

export function ThemePresetPanel({
  documentValue,
  embedded = false,
  storageReady,
  onCommitDocument
}: ThemePresetPanelProps) {
  const activePresetId = normalizeHomeThemePresetId(documentValue.theme.presetId, documentValue.theme.accent);
  const activePreset = getHomeThemePreset(activePresetId);
  const visiblePresets = activePreset.family === "v2"
    ? VISIBLE_HOME_THEME_PRESETS
    : [activePreset, ...VISIBLE_HOME_THEME_PRESETS];
  const disabledReason = storageReady ? undefined : "本地存储尚未就绪，请稍后重试。";

  function applyPreset(preset: HomeThemePreset) {
    if (preset.id === activePresetId || !storageReady) {
      return;
    }

    onCommitDocument({
      ...documentValue,
      theme: {
        ...documentValue.theme,
        presetId: preset.id,
        accent: preset.accent
      }
    }, `已切换为${preset.name}`);
    trackProductEvent("theme.changed", {
      source: "settings",
      themePresetId: preset.id
    });
  }

  const content = (
    <>
      <div className="theme-preset-grid">
        {visiblePresets.map((preset) => (
          <ThemePresetButton
            key={preset.id}
            disabled={!storageReady}
            disabledReason={disabledReason}
            preset={preset}
            selected={preset.id === activePresetId}
            onApply={applyPreset}
          />
        ))}
      </div>

      <StatusMessage tone="neutral">
        当前主题：{activePreset.name}
      </StatusMessage>
    </>
  );

  if (embedded) {
    return <div className="theme-preset-panel-content">{content}</div>;
  }

  return (
    <section className="settings-panel" aria-label="主题风格">
      <div className="panel-header">
        <h2>主题风格</h2>
        <span>Theme</span>
      </div>
      {content}
    </section>
  );
}

function ThemePresetButton({
  disabled,
  disabledReason,
  preset,
  selected,
  onApply
}: {
  disabled: boolean;
  disabledReason?: string;
  preset: HomeThemePreset;
  selected: boolean;
  onApply: (preset: HomeThemePreset) => void;
}) {
  const style = {
    "--theme-preview-bg": preset.preview.bg,
    "--theme-preview-surface": preset.preview.surface,
    "--theme-preview-accent": preset.preview.accent,
    "--theme-preview-radius": preset.preview.radius
  } as CSSProperties;

  return (
    <button
      className={`theme-preset-card${selected ? " is-selected" : ""}`}
      type="button"
      style={style}
      aria-pressed={selected}
      disabled={disabled}
      title={disabled ? disabledReason : `切换为${preset.name}`}
      onClick={() => onApply(preset)}
    >
      <span className="theme-preset-preview" aria-hidden="true">
        <span />
        <span />
      </span>
      <span className="theme-preset-copy">
        <strong>{preset.name}</strong>
        <span>{preset.description}</span>
      </span>
      <span className="theme-preset-family">{preset.family === "legacy" ? "旧版" : "v2"}</span>
      <span className="theme-preset-state">{selected ? "已使用" : "应用"}</span>
    </button>
  );
}
