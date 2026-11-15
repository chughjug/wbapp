/**
 * GoodNotes-style **image backdrops**.
 *
 * Select an image on the canvas, pick a preset (solid matte, gradient, soft
 * shadow, bordered card, polaroid), tune padding / radius / shadow / border,
 * and the image is presented with that backdrop.
 *
 * ## Strategy
 *
 * The backdrop is **baked into a new PNG** and the image element is re-pointed
 * at it (strategy "a"). Sibling rectangle elements ("b") cannot express
 * gradients, drop shadows or a polaroid frame at all, and need continuous
 * move/resize syncing. The bake is made reversible by recording the preset,
 * its parameters, the original `fileId` and the rectangle the original pixels
 * occupy inside the baked raster, under
 * `element.customData.goodnotes.backdrop`. See `applyBackdrop.ts` for the full
 * rationale and the two reset routes.
 *
 * ## Usage
 *
 * ```tsx
 * const backdrops = useBackdropPanel(excalidrawAPI);
 *
 * // hand this callback to the taskbar:
 * <TaskbarButton
 *   onClick={backdrops.open}
 *   disabled={!backdrops.hasImageSelection}
 * />
 *
 * // render the panel inside <Excalidraw> so it inherits the theme tokens:
 * <BackdropPanel {...backdrops.panelProps} />
 * ```
 *
 * Headless callers can skip the UI entirely:
 *
 * ```ts
 * await applyBackdrop({
 *   excalidrawAPI,
 *   elementId,
 *   presetId: "polaroid",
 *   params: { padding: 7 },
 *   theme: "dark",
 * });
 * await removeBackdrop({ excalidrawAPI, elementId }); // reset to original
 * ```
 *
 * See `INTEGRATION.md` for copy-pasteable `App.tsx` changes.
 */

/* ---------------------------------- UI ----------------------------------- */

/**
 * The panel itself (controlled visibility) and the standalone mini-preview.
 * `useBackdropPanel` is the callback-shaped entry point for a taskbar: it owns
 * the open state and reports whether an image is selected.
 */
export {
  BackdropPanel,
  BackdropPreview,
  useBackdropPanel,
  useSelectedImageElement,
} from "./BackdropPanel";
export type {
  BackdropPanelProps,
  BackdropPanelController,
  BackdropPreviewProps,
} from "./BackdropPanel";

/* -------------------------------- actions -------------------------------- */

/**
 * Editor-mutating operations and the `customData` accessors. `applyBackdrop`
 * is non-compounding: it always undoes an existing backdrop first.
 */
export {
  applyBackdrop,
  removeBackdrop,
  resolveOriginal,
  getBackdropState,
  hasBackdrop,
  isBackdropTarget,
  loadImageFromDataURL,
  makeBinaryFileData,
  fileIdFromDataURL,
  GOODNOTES_CUSTOM_DATA_NAMESPACE,
  BACKDROP_CUSTOM_DATA_KEY,
  BACKDROP_STATE_VERSION,
  MAX_BAKED_RASTER_SIZE,
} from "./applyBackdrop";
export type {
  ApplyBackdropOptions,
  ApplyBackdropResult,
  RemoveBackdropOptions,
  BackdropState,
  ResolvedOriginal,
} from "./applyBackdrop";

/* --------------------------- model and renderer --------------------------- */

/**
 * Presets, parameter ranges and the canvas renderer shared by the previews
 * and the bake. All geometric parameters are percentages of the image's
 * shorter natural side.
 */
export {
  BACKDROP_PRESETS,
  BACKDROP_PRESET_BY_ID,
  BACKDROP_PARAM_RANGES,
  getBackdropPreset,
  getPresetParams,
  normalizeBackdropParams,
  isNoopBackdrop,
  computeBackdropGeometry,
  renderBackdrop,
} from "./backdrops";
export type {
  BackdropPreset,
  BackdropPresetId,
  BackdropParams,
  BackdropNumericParam,
  BackdropFillStyle,
  BackdropGeometry,
  BackdropTheme,
  RenderBackdropOptions,
} from "./backdrops";
