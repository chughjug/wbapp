/**
 * Export presets, the settings they stand for, and the "last export" memory
 * that powers one-click re-export.
 *
 * The dialog leads with presets because almost every real export is one of
 * four things. The knobs still exist, behind "More options" — picking one
 * just moves the preset to `custom`.
 */

export type ExportFormat = "pdf" | "png";

export type PageRangeMode = "all" | "current" | "custom";

/** How the finished files reach the student. */
export type ExportDelivery =
  /** OS share sheet when the browser supports files, else download. */
  | "auto"
  /** Always save to disk. */
  | "download";

export interface ExportSettings {
  format: ExportFormat;
  pageMode: PageRangeMode;
  /** Only meaningful when `pageMode === "custom"`. */
  customRange: string;
  /** Raster multiplier. */
  scale: number;
  /** Composite the paper template + sheet under the ink. */
  includeBackground: boolean;
  delivery: ExportDelivery;
}

export type ExportPresetId = "submit" | "share" | "images" | "current";

export interface ExportPreset {
  id: ExportPresetId;
  label: string;
  /** One line under the label — what the student gets. */
  description: string;
  settings: ExportSettings;
  /** Disabled when the host doesn't know which page is in view. */
  needsCurrentPage?: boolean;
}

const base: ExportSettings = {
  format: "pdf",
  pageMode: "all",
  customRange: "1",
  scale: 2,
  includeBackground: true,
  delivery: "download",
};

export const EXPORT_PRESETS: readonly ExportPreset[] = [
  {
    id: "submit",
    label: "Submit",
    description: "PDF · every page · print quality · white paper",
    settings: { ...base, format: "pdf", pageMode: "all", scale: 2 },
  },
  {
    id: "share",
    label: "Share",
    description: "Smaller PDF · every page · opens the share sheet",
    settings: {
      ...base,
      format: "pdf",
      pageMode: "all",
      scale: 1,
      delivery: "auto",
    },
  },
  {
    id: "images",
    label: "Images",
    description: "One PNG per page, to paste elsewhere",
    settings: { ...base, format: "png", pageMode: "all", scale: 2 },
  },
  {
    id: "current",
    label: "This page only",
    description: "PDF of the page you're on",
    settings: { ...base, format: "pdf", pageMode: "current", scale: 2 },
    needsCurrentPage: true,
  },
];

export const DEFAULT_PRESET_ID: ExportPresetId = "submit";

export const getPreset = (id: ExportPresetId | null): ExportPreset =>
  EXPORT_PRESETS.find((preset) => preset.id === id) ??
  EXPORT_PRESETS.find((preset) => preset.id === DEFAULT_PRESET_ID)!;

/** Settings equality, used to decide whether a preset is still "on". */
export const settingsEqual = (a: ExportSettings, b: ExportSettings): boolean =>
  a.format === b.format &&
  a.pageMode === b.pageMode &&
  a.scale === b.scale &&
  a.includeBackground === b.includeBackground &&
  a.delivery === b.delivery &&
  (a.pageMode !== "custom" || a.customRange.trim() === b.customRange.trim());

/** The preset these settings match exactly, or `null` for a custom mix. */
export const matchPreset = (
  settings: ExportSettings,
): ExportPresetId | null =>
  EXPORT_PRESETS.find((preset) => settingsEqual(preset.settings, settings))
    ?.id ?? null;

// ---------------------------------------------------------------------------
// "Last export" memory
// ---------------------------------------------------------------------------

export const LAST_EXPORT_STORAGE_KEY = "goodnotes:export:last";

export interface LastExport {
  /** `null` when the student hand-tuned the options. */
  presetId: ExportPresetId | null;
  settings: ExportSettings;
  /** Base name (no extension) last exported under. */
  fileName: string;
  /** Epoch ms. */
  at: number;
}

const listeners = new Set<(value: LastExport | null) => void>();
let cache: LastExport | null | undefined;

const isSettings = (value: unknown): value is ExportSettings => {
  const s = value as Partial<ExportSettings> | null;
  return (
    !!s &&
    (s.format === "pdf" || s.format === "png") &&
    (s.pageMode === "all" ||
      s.pageMode === "current" ||
      s.pageMode === "custom") &&
    typeof s.customRange === "string" &&
    typeof s.scale === "number" &&
    Number.isFinite(s.scale) &&
    typeof s.includeBackground === "boolean" &&
    (s.delivery === "auto" || s.delivery === "download")
  );
};

const read = (): LastExport | null => {
  try {
    const raw = window.localStorage.getItem(LAST_EXPORT_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<LastExport>;
    if (!isSettings(parsed.settings)) {
      return null;
    }
    return {
      presetId:
        parsed.presetId && EXPORT_PRESETS.some((p) => p.id === parsed.presetId)
          ? parsed.presetId
          : null,
      settings: parsed.settings,
      fileName:
        typeof parsed.fileName === "string" && parsed.fileName
          ? parsed.fileName
          : "document",
      at: typeof parsed.at === "number" ? parsed.at : 0,
    };
  } catch {
    // private mode / corrupt value / no localStorage — just forget it
    return null;
  }
};

/** The last successful export's settings, or `null` if there wasn't one. */
export const getLastExport = (): LastExport | null => {
  if (cache === undefined) {
    cache = read();
  }
  return cache;
};

/** Records a successful export so it can be repeated with one click. */
export const setLastExport = (value: LastExport): void => {
  cache = value;
  try {
    window.localStorage.setItem(
      LAST_EXPORT_STORAGE_KEY,
      JSON.stringify(value),
    );
  } catch {
    // storage full / blocked — the in-memory value still works this session
  }
  listeners.forEach((listener) => listener(value));
};

/** Forgets the last export (the quick-export button then hides itself). */
export const clearLastExport = (): void => {
  cache = null;
  try {
    window.localStorage.removeItem(LAST_EXPORT_STORAGE_KEY);
  } catch {
    // ignore
  }
  listeners.forEach((listener) => listener(null));
};

/** Subscribe to changes, including from another tab. Returns an unsubscribe. */
export const subscribeLastExport = (
  listener: (value: LastExport | null) => void,
): (() => void) => {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === LAST_EXPORT_STORAGE_KEY) {
      cache = undefined;
      listener(getLastExport());
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
};

/** Short label for a remembered export: `"Submit"` / `"Custom PDF (3 pages)"`. */
export const describeLastExport = (last: LastExport): string => {
  if (last.presetId) {
    return getPreset(last.presetId).label;
  }
  return last.settings.format === "png" ? "Custom images" : "Custom PDF";
};
