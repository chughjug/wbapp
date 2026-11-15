/**
 * <BackdropPanel /> — pick and tune the backdrop of the selected image.
 *
 * Accessibility notes (these are requirements, not decoration):
 *  - the preset list is a real `radiogroup` with roving tabindex, arrow /
 *    Home / End keys and `aria-checked`; each option has an accessible name
 *    and an `aria-describedby` description;
 *  - every slider is a labelled `input[type=range]` with a live value;
 *  - every colour well is a labelled `input[type=color]`;
 *  - all controls are keyboard reachable and show a `:focus-visible` ring;
 *  - `Escape` closes the panel; errors are announced via `role="alert"`;
 *  - animations are disabled under `prefers-reduced-motion: reduce`.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import {
  BACKDROP_PARAM_RANGES,
  BACKDROP_PRESETS,
  computeBackdropGeometry,
  getPresetParams,
  renderBackdrop,
} from "./backdrops";
import {
  applyBackdrop,
  getBackdropState,
  isBackdropTarget,
  loadImageFromDataURL,
  removeBackdrop,
  resolveOriginal,
} from "./applyBackdrop";

import "./BackdropPanel.scss";

import type {
  BackdropNumericParam,
  BackdropParams,
  BackdropPresetId,
  BackdropTheme,
} from "./backdrops";
import type { ExcalidrawImageElement } from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

/* -------------------------------------------------------------------------- */
/* selection                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The single selected image element, or `null`. Re-evaluated on every scene
 * change, so the panel follows the canvas selection.
 */
export const useSelectedImageElement = (
  excalidrawAPI: ExcalidrawImperativeAPI | null,
): ExcalidrawImageElement | null => {
  const [element, setElement] = useState<ExcalidrawImageElement | null>(null);

  useEffect(() => {
    if (!excalidrawAPI) {
      setElement(null);
      return;
    }
    const read = () => {
      const appState = excalidrawAPI.getAppState();
      const ids = Object.keys(appState.selectedElementIds ?? {}).filter(
        (id) => appState.selectedElementIds[id],
      );
      const selected = excalidrawAPI
        .getSceneElements()
        .filter((el) => ids.includes(el.id));
      const images = selected.filter(isBackdropTarget);
      setElement(
        selected.length === 1 && images.length === 1
          ? (images[0] as ExcalidrawImageElement)
          : null,
      );
    };
    read();
    return excalidrawAPI.onChange(read);
  }, [excalidrawAPI]);

  return element;
};

/** The editor's current theme, kept in sync as the user toggles it. */
export const useEditorTheme = (
  excalidrawAPI: ExcalidrawImperativeAPI | null,
): BackdropTheme => {
  const [theme, setTheme] = useState<BackdropTheme>("light");
  useEffect(() => {
    if (!excalidrawAPI) {
      return;
    }
    const read = () =>
      setTheme(
        (excalidrawAPI.getAppState()?.theme ?? "light") as BackdropTheme,
      );
    read();
    return excalidrawAPI.onChange(read);
  }, [excalidrawAPI]);
  return theme;
};

/* -------------------------------------------------------------------------- */
/* preview                                                                     */
/* -------------------------------------------------------------------------- */

const PREVIEW_IMAGE_W = 160;
const PREVIEW_IMAGE_H = 112;

export interface BackdropPreviewProps {
  params: BackdropParams;
  /** Real source image, when one is available. */
  image?: HTMLImageElement | null;
  width?: number;
  height?: number;
  className?: string;
}

/** Mini-preview drawn with the *same* renderer the bake uses. */
export const BackdropPreview = ({
  params,
  image,
  width = 72,
  height = 56,
  className,
}: BackdropPreviewProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const natW = image?.naturalWidth || PREVIEW_IMAGE_W;
    const natH = image?.naturalHeight || PREVIEW_IMAGE_H;
    // normalise the source to a constant preview size so previews of tiny and
    // huge images look the same
    const fit = Math.min(PREVIEW_IMAGE_W / natW, PREVIEW_IMAGE_H / natH);
    const imageWidth = Math.max(1, natW * fit);
    const imageHeight = Math.max(1, natH * fit);
    const geometry = computeBackdropGeometry(imageWidth, imageHeight, params);
    const scale = Math.min(
      width / geometry.canvasWidth,
      height / geometry.canvasHeight,
    );
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.translate(
      (width - geometry.canvasWidth * scale) / 2,
      (height - geometry.canvasHeight * scale) / 2,
    );
    ctx.scale(scale, scale);
    renderBackdrop(ctx, {
      image: image ?? null,
      imageWidth,
      imageHeight,
      params,
      geometry,
    });
  }, [params, image, width, height]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`goodnotes-backdrop-preview${className ? ` ${className}` : ""}`}
    />
  );
};

/* -------------------------------------------------------------------------- */
/* controls                                                                    */
/* -------------------------------------------------------------------------- */

const SLIDERS: Array<{ key: BackdropNumericParam; label: string }> = [
  { key: "padding", label: "Padding" },
  { key: "bottomExtra", label: "Extra bottom margin" },
  { key: "cornerRadius", label: "Panel corner radius" },
  { key: "imageRadius", label: "Image corner radius" },
  { key: "shadowOpacity", label: "Shadow strength" },
  { key: "shadowBlur", label: "Shadow blur" },
  { key: "shadowOffsetY", label: "Shadow offset" },
  { key: "borderWidth", label: "Border width" },
];

const Slider = ({
  id,
  label,
  param,
  value,
  onChange,
}: {
  id: string;
  label: string;
  param: BackdropNumericParam;
  value: number;
  onChange: (value: number) => void;
}) => {
  const range = BACKDROP_PARAM_RANGES[param];
  const display = `${Number(value.toFixed(2))}${range.unit}`;
  return (
    <div className="goodnotes-backdrop-panel__field">
      <label className="goodnotes-backdrop-panel__field-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="goodnotes-backdrop-panel__slider"
        type="range"
        min={range.min}
        max={range.max}
        step={range.step}
        value={value}
        aria-valuetext={display}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <output className="goodnotes-backdrop-panel__value" htmlFor={id}>
        {display}
      </output>
    </div>
  );
};

const ColorField = ({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) => (
  <div className="goodnotes-backdrop-panel__field goodnotes-backdrop-panel__field--color">
    <label className="goodnotes-backdrop-panel__field-label" htmlFor={id}>
      {label}
    </label>
    <input
      id={id}
      className="goodnotes-backdrop-panel__color"
      type="color"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
    <span className="goodnotes-backdrop-panel__value" aria-hidden="true">
      {value.toUpperCase()}
    </span>
  </div>
);

/* -------------------------------------------------------------------------- */
/* panel                                                                       */
/* -------------------------------------------------------------------------- */

export interface BackdropPanelProps {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  /** Controlled visibility. The taskbar flips this. */
  open: boolean;
  onClose: () => void;
  /** Theme for preset defaults and panel chrome. Defaults to the editor's. */
  theme?: BackdropTheme;
  /** Called after a successful apply / reset. */
  onApplied?: (elementId: string, presetId: BackdropPresetId | null) => void;
  className?: string;
}

export const BackdropPanel = ({
  excalidrawAPI,
  open,
  onClose,
  theme: themeProp,
  onApplied,
  className,
}: BackdropPanelProps) => {
  const uid = useId();
  const element = useSelectedImageElement(excalidrawAPI);
  const elementId = element?.id ?? null;

  const editorTheme = useEditorTheme(excalidrawAPI);
  const theme = themeProp ?? editorTheme;

  const existing = getBackdropState(element);
  const [presetId, setPresetId] = useState<BackdropPresetId>("matte");
  const [params, setParams] = useState<BackdropParams>(() =>
    getPresetParams("matte", theme),
  );
  const [focusedPreset, setFocusedPreset] = useState<BackdropPresetId>("matte");
  const [sourceImage, setSourceImage] = useState<HTMLImageElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const optionRefs = useRef(new Map<BackdropPresetId, HTMLButtonElement>());

  // adopt the element's stored backdrop (or the default preset) on selection
  useEffect(() => {
    if (!element) {
      return;
    }
    const state = getBackdropState(element);
    const nextPreset = state?.presetId ?? "matte";
    setPresetId(nextPreset);
    setFocusedPreset(nextPreset);
    setParams(state?.params ?? getPresetParams(nextPreset, theme));
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elementId]);

  // load the *original* raster so previews show the real picture, never a
  // picture that already has a backdrop baked in
  useEffect(() => {
    let cancelled = false;
    setSourceImage(null);
    if (!excalidrawAPI || !element) {
      return;
    }
    const state = getBackdropState(element);
    const files = excalidrawAPI.getFiles();
    const dataURL =
      (state && files[state.original.fileId]?.dataURL) ||
      (element.fileId ? files[element.fileId]?.dataURL : undefined);
    if (!dataURL) {
      return;
    }
    loadImageFromDataURL(dataURL)
      .then(async (image) => {
        if (cancelled) {
          return;
        }
        if (state && !files[state.original.fileId]?.dataURL) {
          // baked raster: crop it back so the preview shows the original
          const recovered = await resolveOriginal(excalidrawAPI, element);
          if (!cancelled) {
            setSourceImage(recovered.image);
          }
          return;
        }
        setSourceImage(image);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [excalidrawAPI, elementId, element?.fileId]);

  // follow the editor's theme while the user has not tweaked anything
  const prevThemeRef = useRef(theme);
  useEffect(() => {
    const prevTheme = prevThemeRef.current;
    prevThemeRef.current = theme;
    if (prevTheme === theme) {
      return;
    }
    setParams((prev) =>
      JSON.stringify(prev) === JSON.stringify(getPresetParams(presetId, prevTheme))
        ? getPresetParams(presetId, theme)
        : prev,
    );
  }, [theme, presetId]);

  const selectPreset = useCallback(
    (id: BackdropPresetId, moveFocus: boolean) => {
      setPresetId(id);
      setFocusedPreset(id);
      setParams(getPresetParams(id, theme));
      if (moveFocus) {
        optionRefs.current.get(id)?.focus();
      }
    },
    [theme],
  );

  const onPresetKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const ids = BACKDROP_PRESETS.map((p) => p.id);
      const index = ids.indexOf(focusedPreset);
      let next = -1;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        next = (index + 1) % ids.length;
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        next = (index - 1 + ids.length) % ids.length;
      } else if (event.key === "Home") {
        next = 0;
      } else if (event.key === "End") {
        next = ids.length - 1;
      }
      if (next >= 0) {
        event.preventDefault();
        selectPreset(ids[next], true);
      }
    },
    [focusedPreset, selectPreset],
  );

  const setParam = useCallback(
    <K extends keyof BackdropParams>(key: K, value: BackdropParams[K]) => {
      setParams((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const onApply = useCallback(async () => {
    if (!excalidrawAPI || !elementId) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await applyBackdrop({
        excalidrawAPI,
        elementId,
        presetId,
        params,
        theme,
      });
      onApplied?.(elementId, presetId === "none" ? null : presetId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not apply backdrop.");
    } finally {
      setBusy(false);
    }
  }, [excalidrawAPI, elementId, presetId, params, theme, onApplied]);

  const onReset = useCallback(async () => {
    if (!excalidrawAPI || !elementId) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await removeBackdrop({ excalidrawAPI, elementId });
      selectPreset("none", false);
      onApplied?.(elementId, null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset image.");
    } finally {
      setBusy(false);
    }
  }, [excalidrawAPI, elementId, onApplied, selectPreset]);

  const presetItems = useMemo(
    () =>
      BACKDROP_PRESETS.map((preset) => ({
        preset,
        params:
          preset.id === presetId ? params : getPresetParams(preset.id, theme),
      })),
    [presetId, params, theme],
  );

  if (!open) {
    return null;
  }

  const titleId = `${uid}-title`;
  const descId = `${uid}-desc`;

  return (
    <section
      className={`goodnotes-backdrop-panel${className ? ` ${className}` : ""}`}
      data-theme={theme}
      role="dialog"
      aria-labelledby={titleId}
      aria-modal="false"
      onKeyDown={(event) => {
        // Excalidraw listens for keys on the document: arrow keys nudge the
        // selected element, Delete removes it, digits switch tools. While
        // focus is inside the panel those must not reach the editor.
        event.stopPropagation();
        if (event.key === "Escape") {
          onClose();
        }
      }}
    >
      <header className="goodnotes-backdrop-panel__header">
        <h2 className="goodnotes-backdrop-panel__title" id={titleId}>
          Image backdrop
        </h2>
        <button
          type="button"
          className="goodnotes-backdrop-panel__close"
          onClick={onClose}
        >
          <span aria-hidden="true">×</span>
          <span className="goodnotes-backdrop-panel__sr-only">
            Close backdrop panel
          </span>
        </button>
      </header>

      {!element ? (
        <p className="goodnotes-backdrop-panel__empty">
          Select a single image on the canvas to give it a backdrop.
        </p>
      ) : (
        <>
          <div
            className="goodnotes-backdrop-panel__presets"
            role="radiogroup"
            aria-labelledby={`${uid}-presets-label`}
            onKeyDown={onPresetKeyDown}
          >
            <span
              className="goodnotes-backdrop-panel__group-label"
              id={`${uid}-presets-label`}
            >
              Preset
            </span>
            <div className="goodnotes-backdrop-panel__options">
              {presetItems.map(({ preset, params: previewParams }) => {
                const selected = preset.id === presetId;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-describedby={`${descId}-${preset.id}`}
                    tabIndex={preset.id === focusedPreset ? 0 : -1}
                    ref={(node) => {
                      if (node) {
                        optionRefs.current.set(preset.id, node);
                      } else {
                        optionRefs.current.delete(preset.id);
                      }
                    }}
                    className={`goodnotes-backdrop-panel__option${
                      selected ? " goodnotes-backdrop-panel__option--selected" : ""
                    }`}
                    data-preset={preset.id}
                    onClick={() => selectPreset(preset.id, false)}
                    disabled={busy}
                  >
                    <BackdropPreview
                      params={previewParams}
                      image={sourceImage}
                    />
                    <span className="goodnotes-backdrop-panel__option-label">
                      {preset.label}
                    </span>
                    <span
                      id={`${descId}-${preset.id}`}
                      className="goodnotes-backdrop-panel__sr-only"
                    >
                      {preset.description}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <fieldset className="goodnotes-backdrop-panel__fieldset">
            <legend className="goodnotes-backdrop-panel__group-label">
              Fill
            </legend>
            <div
              className="goodnotes-backdrop-panel__segmented"
              role="radiogroup"
              aria-label="Fill style"
            >
              {(["solid", "gradient"] as const).map((style) => (
                <button
                  key={style}
                  type="button"
                  role="radio"
                  aria-checked={params.fillStyle === style}
                  className={`goodnotes-backdrop-panel__segment${
                    params.fillStyle === style
                      ? " goodnotes-backdrop-panel__segment--selected"
                      : ""
                  }`}
                  onClick={() => setParam("fillStyle", style)}
                  disabled={busy}
                >
                  {style === "solid" ? "Solid" : "Gradient"}
                </button>
              ))}
            </div>
            <ColorField
              id={`${uid}-fill`}
              label={params.fillStyle === "gradient" ? "Gradient start" : "Fill colour"}
              value={params.fillColor}
              onChange={(value) => setParam("fillColor", value)}
            />
            {params.fillStyle === "gradient" && (
              <>
                <ColorField
                  id={`${uid}-fill-end`}
                  label="Gradient end"
                  value={params.fillColorEnd}
                  onChange={(value) => setParam("fillColorEnd", value)}
                />
                <Slider
                  id={`${uid}-angle`}
                  label="Gradient angle"
                  param="gradientAngle"
                  value={params.gradientAngle}
                  onChange={(value) => setParam("gradientAngle", value)}
                />
              </>
            )}
          </fieldset>

          <fieldset className="goodnotes-backdrop-panel__fieldset">
            <legend className="goodnotes-backdrop-panel__group-label">
              Shape, shadow &amp; border
            </legend>
            {SLIDERS.map(({ key, label }) => (
              <Slider
                key={key}
                id={`${uid}-${key}`}
                label={label}
                param={key}
                value={params[key]}
                onChange={(value) => setParam(key, value)}
              />
            ))}
            <ColorField
              id={`${uid}-shadow-color`}
              label="Shadow colour"
              value={params.shadowColor}
              onChange={(value) => setParam("shadowColor", value)}
            />
            <ColorField
              id={`${uid}-border-color`}
              label="Border colour"
              value={params.borderColor}
              onChange={(value) => setParam("borderColor", value)}
            />
          </fieldset>

          <div className="goodnotes-backdrop-panel__actions">
            <button
              type="button"
              className="goodnotes-backdrop-panel__button goodnotes-backdrop-panel__button--primary"
              onClick={onApply}
              disabled={busy || !excalidrawAPI}
              data-testid="backdrop-apply"
            >
              {busy ? "Working…" : "Apply backdrop"}
            </button>
            <button
              type="button"
              className="goodnotes-backdrop-panel__button"
              onClick={onReset}
              disabled={busy || !existing}
              data-testid="backdrop-reset"
            >
              Reset to original
            </button>
          </div>

          {error && (
            <p className="goodnotes-backdrop-panel__error" role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </section>
  );
};

/* -------------------------------------------------------------------------- */
/* controller                                                                  */
/* -------------------------------------------------------------------------- */

export interface BackdropPanelController {
  isOpen: boolean;
  /** Callback-shaped entry point for the taskbar. */
  open: () => void;
  close: () => void;
  toggle: () => void;
  /** True when a single image element is selected (enable the taskbar button). */
  hasImageSelection: boolean;
  /** True when that image already carries a baked backdrop. */
  hasBackdrop: boolean;
  /** Spread onto <BackdropPanel />. */
  panelProps: Pick<BackdropPanelProps, "excalidrawAPI" | "open" | "onClose">;
}

/**
 * Owns the panel's open state and the selection lookup, so the host only has
 * to render `<BackdropPanel {...controller.panelProps} />` and hand
 * `controller.open` to the taskbar.
 */
export const useBackdropPanel = (
  excalidrawAPI: ExcalidrawImperativeAPI | null,
): BackdropPanelController => {
  const [isOpen, setIsOpen] = useState(false);
  const element = useSelectedImageElement(excalidrawAPI);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((value) => !value), []);

  return useMemo(
    () => ({
      isOpen,
      open,
      close,
      toggle,
      hasImageSelection: !!element,
      hasBackdrop: !!getBackdropState(element),
      panelProps: { excalidrawAPI, open: isOpen, onClose: close },
    }),
    [isOpen, open, close, toggle, element, excalidrawAPI],
  );
};
