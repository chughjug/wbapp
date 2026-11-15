/**
 * Backdrop model, presets and renderer.
 *
 * A *backdrop* is the panel drawn behind/around an image: a solid or gradient
 * matte, a soft shadow, rounded corners, a border, a polaroid frame.
 *
 * ## Units
 *
 * Every geometric parameter is a **percentage of the image's shorter natural
 * side**, never an absolute pixel count. A 6% padding therefore looks the same
 * on a 400px crop and on a 4000px screenshot, and a preset can be reused
 * across images without re-tuning. The only exceptions are `gradientAngle`
 * (degrees) and `shadowOpacity` (0..1).
 *
 * ## Single source of truth
 *
 * {@link renderBackdrop} is used both for the mini-previews in the panel and
 * for the real raster bake, so a preview can never drift from the result.
 */

export type BackdropTheme = "light" | "dark";

export type BackdropPresetId =
  | "none"
  | "matte"
  | "gradient"
  | "shadow"
  | "card"
  | "polaroid";

export type BackdropFillStyle = "solid" | "gradient";

/** Adjustable parameters of a backdrop. See "Units" above. */
export interface BackdropParams {
  /** Matte around the image, % of the image's shorter side. */
  padding: number;
  /** Extra padding below the image (polaroid caption space), %. */
  bottomExtra: number;
  /** Corner radius of the panel, %. */
  cornerRadius: number;
  /** Corner radius applied to the image itself, %. */
  imageRadius: number;
  fillStyle: BackdropFillStyle;
  /** Solid colour, or the first gradient stop. CSS colour string. */
  fillColor: string;
  /** Second gradient stop (ignored when `fillStyle === "solid"`). */
  fillColorEnd: string;
  /** Gradient direction in degrees; 0 = top-to-bottom, 90 = left-to-right. */
  gradientAngle: number;
  /** 0 disables the shadow entirely. */
  shadowOpacity: number;
  /** Shadow blur radius, %. */
  shadowBlur: number;
  /** Shadow vertical offset, %. */
  shadowOffsetY: number;
  /** Shadow colour, used at `shadowOpacity`. CSS colour string. */
  shadowColor: string;
  /** Border stroke width, %. 0 disables the border. */
  borderWidth: number;
  borderColor: string;
}

export interface BackdropPreset {
  id: BackdropPresetId;
  label: string;
  /** One-line description, used as the accessible description in the UI. */
  description: string;
  /** Theme-aware defaults. Always returns a fresh object. */
  defaults: (theme: BackdropTheme) => BackdropParams;
}

/** Inclusive UI bounds + step for each numeric parameter. */
export const BACKDROP_PARAM_RANGES = {
  padding: { min: 0, max: 40, step: 0.5, unit: "%" },
  bottomExtra: { min: 0, max: 40, step: 0.5, unit: "%" },
  cornerRadius: { min: 0, max: 25, step: 0.5, unit: "%" },
  imageRadius: { min: 0, max: 25, step: 0.5, unit: "%" },
  gradientAngle: { min: 0, max: 360, step: 1, unit: "°" },
  shadowOpacity: { min: 0, max: 1, step: 0.01, unit: "" },
  shadowBlur: { min: 0, max: 20, step: 0.25, unit: "%" },
  shadowOffsetY: { min: -10, max: 20, step: 0.25, unit: "%" },
  borderWidth: { min: 0, max: 5, step: 0.1, unit: "%" },
} as const;

export type BackdropNumericParam = keyof typeof BACKDROP_PARAM_RANGES;

/** Neutral starting point; every preset overrides what it cares about. */
const baseParams = (theme: BackdropTheme): BackdropParams => ({
  padding: 0,
  bottomExtra: 0,
  cornerRadius: 0,
  imageRadius: 0,
  fillStyle: "solid",
  fillColor: theme === "dark" ? "#2b2b33" : "#ffffff",
  fillColorEnd: theme === "dark" ? "#1b1b20" : "#eceaff",
  gradientAngle: 160,
  shadowOpacity: 0,
  shadowBlur: 4,
  shadowOffsetY: 1.5,
  shadowColor: theme === "dark" ? "#000000" : "#1b1b1f",
  borderWidth: 0,
  borderColor: theme === "dark" ? "#44444d" : "#d6d4f0",
});

export const BACKDROP_PRESETS: readonly BackdropPreset[] = [
  {
    id: "none",
    label: "None",
    description: "No backdrop — the plain image.",
    defaults: (theme) => baseParams(theme),
  },
  {
    id: "matte",
    label: "Solid matte",
    description: "A flat coloured panel with even padding around the image.",
    defaults: (theme) => ({
      ...baseParams(theme),
      padding: 6,
      cornerRadius: 4,
      imageRadius: 1.5,
      fillColor: theme === "dark" ? "#2b2b33" : "#f5f4fb",
    }),
  },
  {
    id: "gradient",
    label: "Gradient",
    description: "A two-colour gradient panel behind the image.",
    defaults: (theme) => ({
      ...baseParams(theme),
      padding: 8,
      cornerRadius: 5,
      imageRadius: 2,
      fillStyle: "gradient",
      fillColor: theme === "dark" ? "#3a3350" : "#e8e4ff",
      fillColorEnd: theme === "dark" ? "#1d2430" : "#d7f0fb",
      gradientAngle: 160,
    }),
  },
  {
    id: "shadow",
    label: "Soft shadow",
    description: "No matte — the image floats on a soft drop shadow.",
    defaults: (theme) => ({
      ...baseParams(theme),
      padding: 0,
      cornerRadius: 2,
      imageRadius: 2,
      fillColor: theme === "dark" ? "#1e1e23" : "#ffffff",
      shadowOpacity: theme === "dark" ? 0.55 : 0.3,
      shadowBlur: 6,
      shadowOffsetY: 2.5,
    }),
  },
  {
    id: "card",
    label: "Bordered card",
    description: "A padded card with a hairline border and a light shadow.",
    defaults: (theme) => ({
      ...baseParams(theme),
      padding: 4,
      cornerRadius: 3,
      imageRadius: 1.5,
      fillColor: theme === "dark" ? "#24242b" : "#ffffff",
      borderWidth: 0.6,
      borderColor: theme === "dark" ? "#4a4a55" : "#c9c7e8",
      shadowOpacity: theme === "dark" ? 0.4 : 0.18,
      shadowBlur: 3.5,
      shadowOffsetY: 1.25,
    }),
  },
  {
    id: "polaroid",
    label: "Polaroid",
    description: "White frame with a deep bottom margin for a caption.",
    defaults: (theme) => ({
      ...baseParams(theme),
      padding: 5,
      bottomExtra: 14,
      cornerRadius: 1,
      imageRadius: 0,
      fillColor: theme === "dark" ? "#e9e7df" : "#fffdf7",
      shadowOpacity: theme === "dark" ? 0.5 : 0.25,
      shadowBlur: 4,
      shadowOffsetY: 1.75,
    }),
  },
];

export const BACKDROP_PRESET_BY_ID: Readonly<
  Record<BackdropPresetId, BackdropPreset>
> = Object.fromEntries(
  BACKDROP_PRESETS.map((preset) => [preset.id, preset]),
) as Record<BackdropPresetId, BackdropPreset>;

export const getBackdropPreset = (id: BackdropPresetId): BackdropPreset =>
  BACKDROP_PRESET_BY_ID[id] ?? BACKDROP_PRESET_BY_ID.none;

export const getPresetParams = (
  id: BackdropPresetId,
  theme: BackdropTheme,
): BackdropParams => getBackdropPreset(id).defaults(theme);

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/** Clamps every numeric parameter into its UI range; drops NaN. */
export const normalizeBackdropParams = (
  params: BackdropParams,
): BackdropParams => {
  const next = { ...params };
  for (const key of Object.keys(
    BACKDROP_PARAM_RANGES,
  ) as BackdropNumericParam[]) {
    const range = BACKDROP_PARAM_RANGES[key];
    const raw = Number(next[key]);
    next[key] = clamp(
      Number.isFinite(raw) ? raw : range.min,
      range.min,
      range.max,
    );
  }
  if (next.fillStyle !== "gradient") {
    next.fillStyle = "solid";
  }
  return next;
};

/** True when the parameters would not change a single pixel of the image. */
export const isNoopBackdrop = (params: BackdropParams): boolean => {
  const p = normalizeBackdropParams(params);
  return (
    p.padding === 0 &&
    p.bottomExtra === 0 &&
    p.imageRadius === 0 &&
    p.borderWidth === 0 &&
    p.shadowOpacity === 0
  );
};

/**
 * Pixel geometry of one backdrop, in the *natural* pixel space of the source
 * image. All values are relative to the output canvas origin.
 */
export interface BackdropGeometry {
  /** Transparent margin kept around the panel so the shadow is not clipped. */
  bleed: number;
  canvasWidth: number;
  canvasHeight: number;
  panelX: number;
  panelY: number;
  panelWidth: number;
  panelHeight: number;
  /** Where the untouched source pixels land. Used by reset-to-original. */
  imageX: number;
  imageY: number;
  imageWidth: number;
  imageHeight: number;
}

export const computeBackdropGeometry = (
  imageWidth: number,
  imageHeight: number,
  rawParams: BackdropParams,
): BackdropGeometry => {
  const params = normalizeBackdropParams(rawParams);
  const unit = Math.max(1, Math.min(imageWidth, imageHeight)) / 100;

  const padding = params.padding * unit;
  const bottomExtra = params.bottomExtra * unit;
  const border = params.borderWidth * unit;

  const panelWidth = imageWidth + padding * 2;
  const panelHeight = imageHeight + padding * 2 + bottomExtra;

  const blur = params.shadowOpacity > 0 ? params.shadowBlur * unit : 0;
  const offsetY = params.shadowOpacity > 0 ? params.shadowOffsetY * unit : 0;
  // enough room for the blurred, offset shadow and for the (centred) stroke
  const bleed =
    Math.ceil(blur * 1.5 + Math.abs(offsetY) + border / 2 + 1) *
    (blur || offsetY || border ? 1 : 0);

  return {
    bleed,
    canvasWidth: Math.max(1, Math.round(panelWidth + bleed * 2)),
    canvasHeight: Math.max(1, Math.round(panelHeight + bleed * 2)),
    panelX: bleed,
    panelY: bleed,
    panelWidth,
    panelHeight,
    imageX: bleed + padding,
    imageY: bleed + padding,
    imageWidth,
    imageHeight,
  };
};

const roundRectPath = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) => {
  const r = clamp(radius, 0, Math.min(width, height) / 2);
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, width, height, r);
    return;
  }
  // Safari < 16 / jsdom fallback
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
};

const withAlpha = (color: string, alpha: number): string => {
  const a = clamp(alpha, 0, 1);
  const hex = color.trim();
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
  if (match) {
    const body = match[1];
    const full =
      body.length === 3
        ? body
            .split("")
            .map((c) => c + c)
            .join("")
        : body;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  // non-hex colour: let the canvas resolve it, approximate alpha via globalAlpha
  return hex;
};

export interface RenderBackdropOptions {
  /** Decoded source image. When omitted a neutral placeholder is drawn. */
  image?: CanvasImageSource | null;
  imageWidth: number;
  imageHeight: number;
  params: BackdropParams;
  /** Pre-computed geometry; recomputed when omitted. */
  geometry?: BackdropGeometry;
}

/**
 * Draws panel + image into `ctx` at scale 1, filling
 * `geometry.canvasWidth` x `geometry.canvasHeight`. The caller owns the
 * transform (previews scale down, the bake draws 1:1).
 */
export const renderBackdrop = (
  ctx: CanvasRenderingContext2D,
  options: RenderBackdropOptions,
): BackdropGeometry => {
  const params = normalizeBackdropParams(options.params);
  const geometry =
    options.geometry ??
    computeBackdropGeometry(options.imageWidth, options.imageHeight, params);
  const unit =
    Math.max(1, Math.min(options.imageWidth, options.imageHeight)) / 100;

  const panelRadius = params.cornerRadius * unit;
  const imageRadius = params.imageRadius * unit;
  const borderWidth = params.borderWidth * unit;

  ctx.save();

  // 1. panel (casts the shadow)
  ctx.save();
  if (params.shadowOpacity > 0) {
    ctx.shadowColor = withAlpha(params.shadowColor, params.shadowOpacity);
    ctx.shadowBlur = params.shadowBlur * unit;
    ctx.shadowOffsetY = params.shadowOffsetY * unit;
  }
  if (params.fillStyle === "gradient") {
    const angle = ((params.gradientAngle % 360) + 360) % 360;
    const rad = (angle * Math.PI) / 180;
    // 0deg = top -> bottom, growing clockwise
    const halfW = geometry.panelWidth / 2;
    const halfH = geometry.panelHeight / 2;
    const cx = geometry.panelX + halfW;
    const cy = geometry.panelY + halfH;
    const dx = Math.sin(rad) * halfW;
    const dy = -Math.cos(rad) * halfH;
    const gradient = ctx.createLinearGradient(
      cx - dx,
      cy - dy,
      cx + dx,
      cy + dy,
    );
    gradient.addColorStop(0, params.fillColor);
    gradient.addColorStop(1, params.fillColorEnd);
    ctx.fillStyle = gradient;
  } else {
    ctx.fillStyle = params.fillColor;
  }
  roundRectPath(
    ctx,
    geometry.panelX,
    geometry.panelY,
    geometry.panelWidth,
    geometry.panelHeight,
    panelRadius,
  );
  ctx.fill();
  ctx.restore();

  // 2. the image, clipped to its own rounded rect
  ctx.save();
  roundRectPath(
    ctx,
    geometry.imageX,
    geometry.imageY,
    geometry.imageWidth,
    geometry.imageHeight,
    imageRadius,
  );
  ctx.clip();
  if (options.image) {
    ctx.drawImage(
      options.image,
      geometry.imageX,
      geometry.imageY,
      geometry.imageWidth,
      geometry.imageHeight,
    );
  } else {
    // placeholder for previews without a loaded source
    const g = ctx.createLinearGradient(
      geometry.imageX,
      geometry.imageY,
      geometry.imageX + geometry.imageWidth,
      geometry.imageY + geometry.imageHeight,
    );
    g.addColorStop(0, "#9aa0b4");
    g.addColorStop(1, "#5b6276");
    ctx.fillStyle = g;
    ctx.fillRect(
      geometry.imageX,
      geometry.imageY,
      geometry.imageWidth,
      geometry.imageHeight,
    );
  }
  ctx.restore();

  // 3. border on top, so it is never hidden by the image
  if (borderWidth > 0) {
    ctx.save();
    ctx.strokeStyle = params.borderColor;
    ctx.lineWidth = borderWidth;
    roundRectPath(
      ctx,
      geometry.panelX + borderWidth / 2,
      geometry.panelY + borderWidth / 2,
      Math.max(0, geometry.panelWidth - borderWidth),
      Math.max(0, geometry.panelHeight - borderWidth),
      Math.max(0, panelRadius - borderWidth / 2),
    );
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
  return geometry;
};
