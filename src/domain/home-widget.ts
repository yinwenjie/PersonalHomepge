import {
  createId,
  type HomeWidget,
  type HomeWidgetType,
  normalizeText,
  renumberWidgets
} from "@/domain/home-document";
import { getWidgetDefinition, normalizeWidgetConfig } from "@/domain/widget-registry";

export interface HomeWidgetPreset {
  type: HomeWidgetType;
  title?: string;
  collapsed?: boolean;
  config?: Record<string, unknown>;
}

export function createHomeWidget(
  type: HomeWidgetType,
  options: Omit<HomeWidgetPreset, "type"> & { order?: number } = {}
): HomeWidget {
  const definition = getWidgetDefinition(type);
  const defaultConfig = definition.defaultConfig();
  const title = normalizeText(options.title) || definition.defaultTitle;

  return {
    id: createId("widget"),
    type,
    title,
    order: Number.isFinite(Number(options.order)) ? Number(options.order) : 1,
    layout: {
      collapsed: Boolean(options.collapsed)
    },
    config: normalizeWidgetConfig(type, {
      ...defaultConfig,
      ...options.config
    })
  };
}

export function createHomeWidgetsFromPresets(presets: HomeWidgetPreset[]): HomeWidget[] {
  const seenSingletonTypes = new Set<HomeWidgetType>();
  const widgets: HomeWidget[] = [];

  for (const preset of presets) {
    const definition = getWidgetDefinition(preset.type);

    if (!definition.allowMultiple) {
      if (seenSingletonTypes.has(preset.type)) {
        continue;
      }

      seenSingletonTypes.add(preset.type);
    }

    widgets.push(createHomeWidget(preset.type, {
      ...preset,
      order: widgets.length + 1
    }));
  }

  return renumberWidgets(widgets);
}

export function getWidgetPresetTitle(preset: HomeWidgetPreset): string {
  return normalizeText(preset.title) || getWidgetDefinition(preset.type).defaultTitle;
}
