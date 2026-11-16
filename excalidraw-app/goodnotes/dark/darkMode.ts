/**
 * TRUE DARK MODE — mode state + colour transform.
 *
 * WHY THIS EXISTS
 * ---------------
 * Excalidraw already has a `theme` ("light" | "dark"). That theme does three
 * useful things for us, and one dangerous one:
 *
 *   1. it darkens the chrome (CSS `theme--dark`),
 *   2. it darkens the canvas background — `bootstrapCanvas()` paints
 *      `applyDarkModeFilter(viewBackgroundColor, theme === "dark")`,
 *   3. it inverts ink at render time — `shape.ts` / `renderElement.ts` run
 *      every stroke/background colour through `applyDarkModeFilter()`, which
 *      is the colour-space equivalent of `invert(93%) hue-rotate(180deg)`,
 *   4. DANGEROUS: `App.tsx` mirrors the view theme into
 *      `appState.exportWithDarkMode`, so turning the lights off also turns
 *      every PNG/SVG/PDF the student submits black.
 *
 * So TRUE DARK MODE is *not* a second dark mode. It is:
 *   - this module, which owns the tri-state preference (and persists it to
 *     the SAME localStorage key the built-in app theme uses, so there is
 *     exactly one source of truth),
 *   - the dark paper (the paper layer is already theme-aware — free),
 *   - a surgical patch in `packages/` that (a) unhooks export theme from view
 *     theme and (b) stops highlighters from vanishing on dark paper.
 *
 * See ./INTEGRATION.md for the exact wiring and the `packages/` diff.
 */

import { STORAGE_KEYS } from "../../app_constants";

/** Tri-state user preference. "system" follows `prefers-color-scheme`. */
export type DarkModePreference = "light" | "dark" | "system";

/** The resolved theme, i.e. what Excalidraw's `theme` prop should be. */
export type ResolvedTheme = "light" | "dark";

export const DARK_MODE_PREFERENCES: readonly DarkModePreference[] = [
  "light",
  "dark",
  "system",
];

/**
 * Deliberately the SAME key `useHandleAppTheme` uses
 * (`app_constants.ts` → "excalidraw-theme"). Two dark modes with two keys is
 * how you end up with dark chrome and a white page — exactly the GoodNotes
 * failure we are fixing.
 */
export const DARK_MODE_STORAGE_KEY = STORAGE_KEYS.LOCAL_STORAGE_THEME;

const isDarkModePreference = (value: unknown): value is DarkModePreference =>
  value === "light" || value === "dark" || value === "system";

/** Read the persisted preference. Never throws (private mode / quota). */
export const getStoredDarkModePreference = (): DarkModePreference => {
  try {
    const raw = localStorage.getItem(DARK_MODE_STORAGE_KEY);
    return isDarkModePreference(raw) ? raw : "light";
  } catch {
    return "light";
  }
};

/** Persist the preference. Never throws. */
export const setStoredDarkModePreference = (
  preference: DarkModePreference,
): void => {
  try {
    localStorage.setItem(DARK_MODE_STORAGE_KEY, preference);
  } catch {
    /* storage unavailable — the in-memory state is still correct */
  }
};

const darkMediaQuery = (): MediaQueryList | undefined =>
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : undefined;

/** Is the OS currently asking for dark? */
export const prefersSystemDark = (): boolean =>
  darkMediaQuery()?.matches ?? false;

/** Preference -> the theme to actually render with. */
export const resolveDarkModeTheme = (
  preference: DarkModePreference,
): ResolvedTheme => {
  if (preference === "system") {
    return prefersSystemDark() ? "dark" : "light";
  }
  return preference;
};

/** Subscribe to OS theme flips. Returns an unsubscribe fn. */
export const subscribeToSystemTheme = (
  onChange: (theme: ResolvedTheme) => void,
): (() => void) => {
  const query = darkMediaQuery();
  if (!query) {
    return () => {};
  }
  const handler = (event: MediaQueryListEvent) =>
    onChange(event.matches ? "dark" : "light");
  query.addEventListener?.("change", handler);
  return () => query.removeEventListener?.("change", handler);
};

/* -------------------------------------------------------------------------
 * Colour transform
 *
 * WHY NOT NAIVE RGB INVERSION (`255 - c`)
 * ---------------------------------------
 * Channel inversion rotates hue by 180°: a red correction mark becomes cyan,
 * a blue pen becomes orange. Students colour-code their notes, so destroying
 * hue destroys meaning. It also maps *light* ink (a yellow highlighter,
 * #ffd43b) to a dark navy — invisible on a dark page.
 *
 * Excalidraw's built-in `applyDarkModeFilter()` is `invert(93%)
 * hue-rotate(180deg)`: the hue-rotate undoes *most* of the 180° flip, but the
 * CSS hue-rotate matrix is a linear approximation that shifts saturated hues
 * noticeably, and it still maps light colours to dark ones.
 *
 * WHAT WE DO INSTEAD
 * ------------------
 * Work in HSL, keep H exactly, and branch on lightness:
 *
 *   - dark ink  (L < 0.5): invert lightness, L' = 1 - L, then clamp into
 *     [0.55, 0.90]. Pure black ink becomes a light grey, NOT pure white:
 *     #000 on #000 → #fff is a 21:1 glare bomb, which is the eye-strain we
 *     are trying to remove. ~0.88 lightness lands around 12-14:1 on OLED
 *     black: far above WCAG AAA (7:1) and much kinder at 2am.
 *   - light ink (relative luminance >= 0.42): do NOT invert — desaturate
 *     and dim it.
 *     L' = L * 0.66, S' = S * 0.75. A yellow highlighter stays yellow, just
 *     muted, instead of either glaring or disappearing.
 *
 * This is the transform the UI uses for previews, and the rule the
 * `packages/` highlighter patch implements with compositing. It is a *view*
 * transform only: nothing here ever runs on an export.
 * ---------------------------------------------------------------------- */

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const HEX_SHORT = /^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])?$/i;
const HEX_LONG = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/i;
const RGB_FN = /^rgba?\(([^)]+)\)$/i;

/** Parse #rgb / #rgba / #rrggbb / #rrggbbaa / rgb() / rgba(). */
export const parseColor = (color: string): RGBA | null => {
  const value = color.trim().toLowerCase();

  if (value === "transparent") {
    return { r: 0, g: 0, b: 0, a: 0 };
  }

  const short = HEX_SHORT.exec(value);
  if (short) {
    return {
      r: parseInt(short[1] + short[1], 16),
      g: parseInt(short[2] + short[2], 16),
      b: parseInt(short[3] + short[3], 16),
      a: short[4] ? parseInt(short[4] + short[4], 16) / 255 : 1,
    };
  }

  const long = HEX_LONG.exec(value);
  if (long) {
    return {
      r: parseInt(long[1], 16),
      g: parseInt(long[2], 16),
      b: parseInt(long[3], 16),
      a: long[4] ? parseInt(long[4], 16) / 255 : 1,
    };
  }

  const fn = RGB_FN.exec(value);
  if (fn) {
    const parts = fn[1]
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map(Number);
    if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) {
      return {
        r: clamp(parts[0], 0, 255),
        g: clamp(parts[1], 0, 255),
        b: clamp(parts[2], 0, 255),
        a: parts.length > 3 && Number.isFinite(parts[3]) ? parts[3] : 1,
      };
    }
  }

  return null;
};

export const toHex = ({ r, g, b, a }: RGBA): string => {
  const channel = (n: number) =>
    Math.round(clamp(n, 0, 255)).toString(16).padStart(2, "0");
  const base = `#${channel(r)}${channel(g)}${channel(b)}`;
  return a >= 1 ? base : `${base}${channel(a * 255)}`;
};

interface HSL {
  h: number;
  s: number;
  l: number;
}

export const rgbToHsl = ({ r, g, b }: RGBA): HSL => {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const delta = max - min;

  if (delta === 0) {
    return { h: 0, s: 0, l };
  }

  const s = delta / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) {
    h = 60 * (((gn - bn) / delta) % 6);
  } else if (max === gn) {
    h = 60 * ((bn - rn) / delta + 2);
  } else {
    h = 60 * ((rn - gn) / delta + 4);
  }

  return { h: (h + 360) % 360, s, l };
};

export const hslToRgb = ({ h, s, l }: HSL, a = 1): RGBA => {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r1, g1, b1] =
    h < 60
      ? [c, x, 0]
      : h < 120
      ? [x, c, 0]
      : h < 180
      ? [0, c, x]
      : h < 240
      ? [0, x, c]
      : h < 300
      ? [x, 0, c]
      : [c, 0, x];
  return {
    r: (r1 + m) * 255,
    g: (g1 + m) * 255,
    b: (b1 + m) * 255,
    a,
  };
};

/** Tunables for {@link invertInkForDarkMode}. */
export const INK_TRANSFORM = {
  /**
   * Branch on WCAG *relative luminance*, not HSL lightness: a saturated red
   * (#e03131) sits at HSL L 0.53 but relative luminance 0.19 — it is dark
   * ink to the eye and must be lifted, not dimmed.
   */
  lightInkLuminanceThreshold: 0.42,
  /** Inverted dark ink is clamped here — never pure white (glare). */
  minInvertedLightness: 0.55,
  maxInvertedLightness: 0.9,
  /** Light ink keeps its hue; lightness and saturation are scaled down. */
  lightInkLightnessScale: 0.66,
  lightInkSaturationScale: 0.75,
  /** ...but never below this, or it drops off a dark page. */
  minLightInkLightness: 0.38,
} as const;

/**
 * Hue-preserving dark-mode ink transform. See the block comment above for
 * the rationale. Unparseable colours are returned untouched.
 */
export const invertInkForDarkMode = (color: string): string => {
  const rgba = parseColor(color);
  if (!rgba || rgba.a === 0) {
    return color;
  }

  const { h, s, l } = rgbToHsl(rgba);
  const isLightInk =
    relativeLuminance(rgba) >= INK_TRANSFORM.lightInkLuminanceThreshold;

  const next = isLightInk
    ? {
        h,
        s: s * INK_TRANSFORM.lightInkSaturationScale,
        l: Math.max(
          l * INK_TRANSFORM.lightInkLightnessScale,
          INK_TRANSFORM.minLightInkLightness,
        ),
      }
    : {
        h,
        s,
        l: clamp(
          1 - l,
          INK_TRANSFORM.minInvertedLightness,
          INK_TRANSFORM.maxInvertedLightness,
        ),
      };

  return toHex(hslToRgb(next, rgba.a));
};

/**
 * Highlighter-specific: keep the hue, drop the glare. Used for UI previews;
 * on canvas the same intent is achieved by compositing (see the `packages/`
 * patch), because a highlighter must *lighten* the dark page, not paint over
 * it.
 */
export const desaturateHighlightForDarkMode = (color: string): string => {
  const rgba = parseColor(color);
  if (!rgba || rgba.a === 0) {
    return color;
  }
  const { h, s, l } = rgbToHsl(rgba);
  return toHex(hslToRgb({ h, s: s * 0.7, l: Math.min(l, 0.55) }, rgba.a));
};

/* -------------------------------------------------------------------------
 * Contrast measurement (so accessibility claims are numbers, not vibes)
 * ---------------------------------------------------------------------- */

const srgbToLinear = (channel: number) => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance. */
export const relativeLuminance = ({ r, g, b }: RGBA): number =>
  0.2126 * srgbToLinear(r) +
  0.7152 * srgbToLinear(g) +
  0.0722 * srgbToLinear(b);

/** WCAG 2.x contrast ratio between two opaque colours (1..21). */
export const contrastRatio = (
  foreground: string,
  background: string,
): number => {
  const fg = parseColor(foreground);
  const bg = parseColor(background);
  if (!fg || !bg) {
    return 1;
  }
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const [light, dark] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (light + 0.05) / (dark + 0.05);
};

/* -------------------------------------------------------------------------
 * The dark-mode palette the app can use for its own surfaces.
 * Paper colours mirror `goodnotes/paper/templates.ts` so page and chrome
 * agree; OLED_BLACK is offered for OLED tablets where true black saves power.
 * ---------------------------------------------------------------------- */

export const DARK_MODE_PALETTE = {
  /** Matches `getPaperPalette("dark").paper`. */
  paper: "#1e1f24",
  /** For OLED panels; pair with slightly dimmer ink. */
  oledPaper: "#000000",
  /** Canvas behind/between pages (Excalidraw's filtered background). */
  canvas: "#121212",
  defaultInk: "#e3e3e8",
} as const;
