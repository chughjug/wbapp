/**
 * Paper templates: plain Canvas2D renderers for page backgrounds.
 *
 * Every template implements the shared `PaperTemplate` contract from
 * `../types`. `render()` is called with a context that has ALREADY been
 * translated to the page origin and scaled to the current zoom *and* device
 * pixel ratio, so templates draw in page-local CSS pixels (0,0 .. w,h).
 *
 * Templates never fill the page body — the page "sheet" (paper color, border,
 * shadow) is drawn by the layer; templates only add the rulings. This keeps
 * them reusable for the mini previews in the picker.
 */

import type { ExcalidrawElement } from "@excalidraw/element/types";

import {
  drawPageImageBackground,
  getPageImageBackground,
  type PageImageBackground,
} from "./pageImages";

import type { PaperTemplate, PaperTemplateId } from "../types";

export type PaperTheme = "light" | "dark";

/** Palette for one theme. Lines stay low-contrast so they never fight ink. */
interface PaperPalette {
  /** Paper sheet fill. */
  paper: string;
  /** Primary ruling (horizontal rules, grid lines, dots, staff lines). */
  rule: string;
  /** Secondary / heavier ruling (margins, Cornell dividers). */
  accent: string;
  /** Page border. */
  border: string;
}

const PALETTES: Record<PaperTheme, PaperPalette> = {
  light: {
    paper: "#ffffff",
    rule: "rgba(37, 65, 112, 0.18)",
    accent: "rgba(200, 72, 72, 0.38)",
    border: "rgba(20, 24, 33, 0.14)",
  },
  dark: {
    paper: "#1e1f24",
    rule: "rgba(190, 210, 245, 0.16)",
    accent: "rgba(235, 130, 130, 0.30)",
    border: "rgba(235, 240, 255, 0.12)",
  },
};

/** Theme-aware palette used by the templates and by the background layer. */
export const getPaperPalette = (theme: PaperTheme): PaperPalette =>
  PALETTES[theme];

/* -------------------------------------------------------------------------
 * geometry constants
 * ---------------------------------------------------------------------- */

/** Rule spacing for `lined` (and the Cornell note area). */
export const LINE_SPACING = 32;
/** Square size for `grid`. */
export const GRID_SPACING = 24;
/** Dot pitch for `dotted`. */
export const DOT_SPACING = 24;
/** Dot radius for `dotted`, in CSS px. */
export const DOT_RADIUS = 1.1;
/** Inner padding kept clear of rulings on every template. */
export const PAGE_PADDING = 40;

/** Cornell layout ratios. */
const CORNELL_CUE_RATIO = 0.3;
const CORNELL_SUMMARY_RATIO = 0.2;

/** Music staff metrics, in CSS px. */
const STAFF_LINE_GAP = 11; // between the 5 lines of one stave
const STAFF_GROUP_GAP = 56; // blank space between staves
const STAFF_LINES = 5;

/* -------------------------------------------------------------------------
 * crisp-line helpers
 * ---------------------------------------------------------------------- */

/**
 * Snap a 1px-ish stroke to the pixel grid.
 *
 * The context may be scaled (zoom * dpr), so "half a device pixel" in local
 * units depends on the current transform. We read the effective vertical /
 * horizontal scale off the transform and offset by half a device pixel.
 */
const halfPixelOffset = (ctx: CanvasRenderingContext2D, axis: "x" | "y") => {
  const t = ctx.getTransform();
  const scale = axis === "x" ? Math.abs(t.a) || 1 : Math.abs(t.d) || 1;
  return 0.5 / scale;
};

/** Hairline width that stays visible (>= ~1 device px) at any zoom. */
const hairline = (ctx: CanvasRenderingContext2D) => {
  const t = ctx.getTransform();
  const scale = Math.max(Math.abs(t.a), Math.abs(t.d)) || 1;
  return 1 / scale;
};

const strokeHLine = (
  ctx: CanvasRenderingContext2D,
  x1: number,
  x2: number,
  y: number,
) => {
  const snapped = Math.round(y) + halfPixelOffset(ctx, "y");
  ctx.beginPath();
  ctx.moveTo(x1, snapped);
  ctx.lineTo(x2, snapped);
  ctx.stroke();
};

const strokeVLine = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y1: number,
  y2: number,
) => {
  const snapped = Math.round(x) + halfPixelOffset(ctx, "x");
  ctx.beginPath();
  ctx.moveTo(snapped, y1);
  ctx.lineTo(snapped, y2);
  ctx.stroke();
};

/* -------------------------------------------------------------------------
 * shared primitives
 * ---------------------------------------------------------------------- */

/** Horizontal rules across [x, x + w], starting at `top`. */
const drawRules = (
  ctx: CanvasRenderingContext2D,
  x: number,
  top: number,
  w: number,
  bottom: number,
  spacing: number,
  color: string,
) => {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = hairline(ctx);
  for (let y = top; y <= bottom + 0.01; y += spacing) {
    strokeHLine(ctx, x, x + w, y);
  }
  ctx.restore();
};

/* -------------------------------------------------------------------------
 * templates
 * ---------------------------------------------------------------------- */

const blank: PaperTemplate = {
  id: "blank",
  label: "Blank",
  render: () => {
    /* intentionally empty — the sheet itself is the whole template */
  },
};

const lined: PaperTemplate = {
  id: "lined",
  label: "Lined",
  render: (ctx, width, height, opts) => {
    const p = getPaperPalette(opts.theme);
    const pad = Math.min(PAGE_PADDING, width * 0.08, height * 0.08);
    const marginX = Math.min(pad * 2, width * 0.18);

    drawRules(
      ctx,
      pad,
      pad + LINE_SPACING,
      width - pad * 2,
      height - pad,
      LINE_SPACING,
      p.rule,
    );

    // left margin rule
    ctx.save();
    ctx.strokeStyle = p.accent;
    ctx.lineWidth = hairline(ctx);
    strokeVLine(ctx, marginX, pad * 0.5, height - pad * 0.5);
    ctx.restore();
  },
};

const grid: PaperTemplate = {
  id: "grid",
  label: "Grid",
  render: (ctx, width, height, opts) => {
    const p = getPaperPalette(opts.theme);
    ctx.save();
    ctx.strokeStyle = p.rule;
    ctx.lineWidth = hairline(ctx);
    for (let y = GRID_SPACING; y < height; y += GRID_SPACING) {
      strokeHLine(ctx, 0, width, y);
    }
    for (let x = GRID_SPACING; x < width; x += GRID_SPACING) {
      strokeVLine(ctx, x, 0, height);
    }
    ctx.restore();
  },
};

const dotted: PaperTemplate = {
  id: "dotted",
  label: "Dotted",
  render: (ctx, width, height, opts) => {
    const p = getPaperPalette(opts.theme);
    const r = Math.max(DOT_RADIUS, hairline(ctx) * 0.8);
    ctx.save();
    ctx.fillStyle = p.rule;
    ctx.beginPath();
    for (let y = DOT_SPACING; y < height; y += DOT_SPACING) {
      for (let x = DOT_SPACING; x < width; x += DOT_SPACING) {
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, Math.PI * 2);
      }
    }
    ctx.fill();
    ctx.restore();
  },
};

const cornell: PaperTemplate = {
  id: "cornell",
  label: "Cornell",
  render: (ctx, width, height, opts) => {
    const p = getPaperPalette(opts.theme);
    const pad = Math.min(PAGE_PADDING, width * 0.08, height * 0.08);
    const cueX = width * CORNELL_CUE_RATIO;
    const summaryY = height * (1 - CORNELL_SUMMARY_RATIO);
    const headerY = pad * 1.5;

    // ruled note area (right of the cue column, above the summary band)
    const noteTop = headerY + LINE_SPACING;
    drawRules(
      ctx,
      cueX,
      noteTop,
      width - cueX - pad * 0.5,
      summaryY - LINE_SPACING * 0.5,
      LINE_SPACING,
      p.rule,
    );

    ctx.save();
    ctx.strokeStyle = p.accent;
    ctx.lineWidth = hairline(ctx);
    // header rule
    strokeHLine(ctx, pad * 0.5, width - pad * 0.5, headerY);
    // cue column divider
    strokeVLine(ctx, cueX, headerY, summaryY);
    // summary band divider
    strokeHLine(ctx, pad * 0.5, width - pad * 0.5, summaryY);
    ctx.restore();
  },
};

const staff: PaperTemplate = {
  id: "staff",
  label: "Staff",
  render: (ctx, width, height, opts) => {
    const p = getPaperPalette(opts.theme);
    const pad = Math.min(PAGE_PADDING, width * 0.08, height * 0.08);
    const x1 = pad;
    const x2 = width - pad;
    const staveHeight = STAFF_LINE_GAP * (STAFF_LINES - 1);
    const stride = staveHeight + STAFF_GROUP_GAP;

    ctx.save();
    ctx.strokeStyle = p.rule;
    ctx.lineWidth = hairline(ctx);
    for (let top = pad; top + staveHeight <= height - pad; top += stride) {
      for (let i = 0; i < STAFF_LINES; i++) {
        strokeHLine(ctx, x1, x2, top + i * STAFF_LINE_GAP);
      }
      // barlines closing the stave at both ends
      ctx.save();
      ctx.strokeStyle = p.accent;
      strokeVLine(ctx, x1, top, top + staveHeight);
      strokeVLine(ctx, x2, top, top + staveHeight);
      ctx.restore();
    }
    ctx.restore();
  },
};

/** Every template, keyed by id. */
export const PAPER_TEMPLATES: Record<PaperTemplateId, PaperTemplate> = {
  blank,
  lined,
  grid,
  dotted,
  cornell,
  staff,
};

/** Stable display order for pickers. */
export const PAPER_TEMPLATE_ORDER: PaperTemplateId[] = [
  "blank",
  "lined",
  "grid",
  "dotted",
  "cornell",
  "staff",
];

/** Ordered list of all templates. */
export const PAPER_TEMPLATE_LIST: PaperTemplate[] = PAPER_TEMPLATE_ORDER.map(
  (id) => PAPER_TEMPLATES[id],
);

/** Lookup with a safe fallback to `blank` for unknown/legacy ids. */
export const getPaperTemplate = (
  id: PaperTemplateId | string | null | undefined,
): PaperTemplate =>
  (id && PAPER_TEMPLATES[id as PaperTemplateId]) || PAPER_TEMPLATES.blank;

/**
 * Quickdraw-style zoom fade for paper rulings: quiet when zoomed out so the
 * page reads as a sheet, full strength near reading zoom.
 */
export const rulingOpacityForZoom = (zoom: number): number => {
  if (!Number.isFinite(zoom) || zoom <= 0) {
    return 1;
  }
  if (zoom <= 0.35) {
    return 0.28;
  }
  if (zoom >= 1.25) {
    return 1;
  }
  return 0.28 + ((zoom - 0.35) / (1.25 - 0.35)) * 0.72;
};

/** Options accepted by {@link renderPaper}. */
export interface RenderPaperOptions {
  theme: PaperTheme;
  /** Fill the page with the paper colour first. Default `true`. */
  sheet?: boolean;
  /**
   * Optional image background, drawn between the sheet and the rulings.
   *
   * ADDITIVE and OPTIONAL: every existing `renderPaper(ctx, id, w, h, {
   * theme, sheet })` call site keeps working unchanged. Drawing is
   * synchronous — see `./pageImages`: a decoded bitmap is used when the
   * cache has it, otherwise a neutral placeholder is painted and
   * `onPageImageReady` fires once the decode lands.
   */
  image?: PageImageBackground;
  /**
   * Multiplier applied only to the template rulings (not the sheet/border).
   * Defaults to `1`. Prefer {@link rulingOpacityForZoom}.
   */
  rulingOpacity?: number;
}

/**
 * Draw one complete page: sheet fill + (optional image) + the template's
 * rulings + border. `ctx` must already be translated to the page origin and
 * scaled. Used by the background layer, the picker previews, the page
 * thumbnails and the PDF export.
 */
export const renderPaper = (
  ctx: CanvasRenderingContext2D,
  templateId: PaperTemplateId,
  width: number,
  height: number,
  opts: RenderPaperOptions,
) => {
  const p = getPaperPalette(opts.theme);

  if (opts.sheet !== false) {
    ctx.save();
    ctx.fillStyle = p.paper;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  if (opts.image) {
    drawPageImageBackground(ctx, opts.image, width, height, opts.theme);
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();
  const rulingOpacity = opts.rulingOpacity ?? 1;
  if (rulingOpacity !== 1) {
    ctx.globalAlpha *= Math.max(0, Math.min(1, rulingOpacity));
  }
  getPaperTemplate(templateId).render(ctx, width, height, {
    theme: opts.theme,
  });
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = p.border;
  ctx.lineWidth = hairline(ctx);
  ctx.strokeRect(
    halfPixelOffset(ctx, "x"),
    halfPixelOffset(ctx, "y"),
    width - halfPixelOffset(ctx, "x") * 2,
    height - halfPixelOffset(ctx, "y") * 2,
  );
  ctx.restore();
};

/**
 * `renderPaper` for a page FRAME: reads both the ruling (from the pages
 * module's `customData.goodnotesPage.template`, falling back to
 * `defaultTemplate`) and the image background (from
 * `customData.goodnotesPageImage`) off the element itself.
 *
 * This is the call every page-background renderer should prefer, because it
 * cannot forget the image. Still fully synchronous.
 */
export const renderPaperForFrame = (
  ctx: CanvasRenderingContext2D,
  frame: Pick<ExcalidrawElement, "customData" | "width" | "height">,
  opts: {
    theme: PaperTheme;
    sheet?: boolean;
    /** Used when the frame records no template. Default `"blank"`. */
    defaultTemplate?: PaperTemplateId;
    /** Override the frame's own geometry (e.g. when drawing a preview). */
    width?: number;
    height?: number;
  },
) => {
  const stored = (frame.customData as Record<string, unknown> | undefined)
    ?.goodnotesPage as { template?: PaperTemplateId } | undefined;

  renderPaper(
    ctx,
    stored?.template ?? opts.defaultTemplate ?? "blank",
    opts.width ?? frame.width,
    opts.height ?? frame.height,
    {
      theme: opts.theme,
      sheet: opts.sheet,
      image: getPageImageBackground(frame),
    },
  );
};
