/**
 * Eraser brush radius (scene units). Excalidraw's stock eraser was a
 * zero-width stroke hit-test; this module lets the UI pick a real brush
 * size that widens both the hit tolerance and the cursor.
 *
 * Stored as a module singleton (not AppState) so the goodnotes shell can
 * drive it without a restore/schema migration — the size is a session
 * preference that the shell also persists to localStorage.
 */

export type EraserSizeId = "s" | "m" | "l" | "xl";

export interface EraserSizeOption {
  id: EraserSizeId;
  label: string;
  /** Scene-unit radius used as the eraser hit threshold. */
  radius: number;
  /** Cursor circle diameter in CSS pixels (approx). */
  cursorPx: number;
}

/** Shipped sizes. Medium matches the previous hard-coded freedraw threshold. */
export const ERASER_SIZE_OPTIONS: readonly EraserSizeOption[] = [
  { id: "s", label: "Small", radius: 8, cursorPx: 14 },
  { id: "m", label: "Medium", radius: 15, cursorPx: 20 },
  { id: "l", label: "Large", radius: 28, cursorPx: 32 },
  { id: "xl", label: "Extra large", radius: 44, cursorPx: 44 },
] as const;

export const DEFAULT_ERASER_SIZE_ID: EraserSizeId = "m";

const byId = (id: EraserSizeId): EraserSizeOption =>
  ERASER_SIZE_OPTIONS.find((option) => option.id === id) ??
  ERASER_SIZE_OPTIONS[1];

let currentId: EraserSizeId = DEFAULT_ERASER_SIZE_ID;

export const getEraserSizeId = (): EraserSizeId => currentId;

export const getEraserSize = (): EraserSizeOption => byId(currentId);

export const getEraserRadius = (): number => byId(currentId).radius;

export const setEraserSizeId = (id: EraserSizeId): EraserSizeOption => {
  currentId = byId(id).id;
  return byId(currentId);
};
