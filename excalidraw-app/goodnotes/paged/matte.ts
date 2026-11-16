/**
 * The matte: paints out everything around the current page.
 *
 * WHY IT EXISTS. Fitting one page to the workspace is not quite enough to
 * kill the "PDF scroll" look. When the canvas box is *narrower* than the page
 * is tall (portrait tablets, or a desktop window with the page panel open),
 * the fit is width-constrained and leaves vertical slack above and below the
 * page. `PAGE_GAP` is only 48 scene px, so a sliver of the previous/next page
 * shows in that slack — the exact thing the user complained about.
 *
 * No amount of viewport maths removes it: the slack is a consequence of the
 * aspect ratios, and zooming in further would crop the page. So the slack is
 * painted over instead.
 *
 * HOW. One absolutely-positioned element sits exactly on the current page's
 * on-screen rect with a huge `box-shadow` spread in the canvas background
 * colour — a single node whose "hole" is the page, instead of four strips to
 * keep in sync. It is `pointer-events: none`, so it changes nothing about
 * input, and it is inserted as a sibling of the editor container with
 * `z-index: 3`: above the paper layer (0) and both canvases (2), below the
 * editor's own UI layer (4) and the eye dropper (5), which therefore keep
 * working and stay visible. (The editor container is `position: relative;
 * z-index: auto`, so it does not create a stacking context and those
 * z-indices all share one.)
 *
 * It is purely cosmetic and purely transient: no scene data, no appState, no
 * effect on export (which renders from the scene, not the screen).
 */

/** z-index: above the canvases (2), below the editor UI layer (4). */
const MATTE_Z_INDEX = 3;

/** How long a sampled desk colour is reused before re-sampling, in ms. */
const COLOR_SAMPLE_TTL_MS = 400;

/** Last-resort desk colours, if nothing can be sampled. */
const FALLBACK_COLOR = { light: "#f5f5f5", dark: "#121212" } as const;

const TRANSPARENT = /^(transparent|rgba\(0,\s*0,\s*0,\s*0\))$/;

/**
 * The colour to paint the matte with.
 *
 * It must match the "desk" the editor shows around a page — and in this app
 * that desk is NOT a CSS background and not `appState.viewBackgroundColor`
 * (which is `"transparent"` here, because `goodnotes/paper` paints the desk
 * and the paper itself into its own canvas behind the editor). So the colour
 * is SAMPLED from the rendered pixels, one pixel just outside the page edge,
 * which keeps the matte correct whatever the paper layer decides to paint,
 * in either theme, with no coupling to that module's internals.
 *
 * The sample point sits in the `PAGE_GAP` between two pages, a few px outside
 * the current page, so it reads desk rather than a neighbouring page.
 */
const sampleDeskColor = (
  doc: Document,
  hostRect: { left: number; top: number; width: number; height: number },
  hole: MatteRect,
): string | null => {
  const bands: [number, number][] = [
    [hole.left + hole.width / 2, hole.top - 3],
    [hole.left + hole.width / 2, hole.top + hole.height + 3],
    [hole.left - 3, hole.top + hole.height / 2],
    [hole.left + hole.width + 3, hole.top + hole.height / 2],
  ];
  const point = bands.find(
    ([x, y]) =>
      x >= 1 && y >= 1 && x <= hostRect.width - 1 && y <= hostRect.height - 1,
  );
  if (!point) {
    // the page covers the whole box: there is no ring to paint
    return null;
  }

  const canvas = doc.querySelector<HTMLCanvasElement>(
    "canvas.goodnotes-paper-layer",
  );
  if (canvas) {
    const rect = canvas.getBoundingClientRect();
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context && rect.width > 0 && rect.height > 0) {
      const x = Math.round(
        ((hostRect.left + point[0] - rect.left) * canvas.width) / rect.width,
      );
      const y = Math.round(
        ((hostRect.top + point[1] - rect.top) * canvas.height) / rect.height,
      );
      if (x >= 0 && y >= 0 && x < canvas.width && y < canvas.height) {
        try {
          const [r, g, b, a] = context.getImageData(x, y, 1, 1).data;
          if (a > 0) {
            return `rgb(${r}, ${g}, ${b})`;
          }
        } catch {
          // tainted canvas (shouldn't happen here) — fall through
        }
      }
    }
  }

  // nothing painted there: fall back to the nearest CSS background
  let element: HTMLElement | null = doc.querySelector(".excalidraw-container");
  while (element) {
    const background = getComputedStyle(element).backgroundColor;
    if (background && !TRANSPARENT.test(background.replace(/\s+/g, " "))) {
      return background;
    }
    element = element.parentElement;
  }
  return null;
};

export interface MatteRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PageMatte {
  /**
   * Place the hole over `rect` (CSS px, relative to the editor container).
   * `color` is the editor's `viewBackgroundColor`; when it is transparent
   * (as in this app) the desk colour is sampled from the rendered canvas.
   */
  update: (
    rect: MatteRect | null,
    color: string,
    theme?: "light" | "dark",
  ) => void;
  hide: () => void;
  destroy: () => void;
}

export const createPageMatte = (
  doc: Document,
  getContainer: () => HTMLElement | null,
): PageMatte => {
  let host: HTMLDivElement | null = null;
  let hole: HTMLDivElement | null = null;
  let signature = "";
  let sampledColor: string | null = null;
  let sampledAt = 0;

  const ensure = (): HTMLDivElement | null => {
    const container = getContainer();
    const parent = container?.parentElement;
    if (!container || !parent) {
      return null;
    }
    if (!host) {
      host = doc.createElement("div");
      host.className = "goodnotes-paged-matte";
      host.setAttribute("aria-hidden", "true");
      Object.assign(host.style, {
        position: "absolute",
        pointerEvents: "none",
        overflow: "hidden",
        zIndex: String(MATTE_Z_INDEX),
        contain: "strict",
      });

      hole = doc.createElement("div");
      Object.assign(hole.style, {
        position: "absolute",
        borderRadius: "2px",
      });
      host.appendChild(hole);
    }
    if (host.parentElement !== parent) {
      // appended LAST so React, which only ever inserts before its own
      // children, never trips over it
      parent.appendChild(host);
    }

    // follow the editor container's box inside its parent
    const containerRect = container.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    host.style.left = `${containerRect.left - parentRect.left}px`;
    host.style.top = `${containerRect.top - parentRect.top}px`;
    host.style.width = `${containerRect.width}px`;
    host.style.height = `${containerRect.height}px`;
    return host;
  };

  const hide = () => {
    if (host) {
      host.style.display = "none";
    }
    signature = "";
  };

  return {
    update: (rect, color, theme = "light") => {
      if (!rect) {
        hide();
        return;
      }
      const element = ensure();
      if (!element || !hole) {
        return;
      }

      let resolved = color;
      if (!resolved || TRANSPARENT.test(resolved.replace(/\s+/g, " "))) {
        const now = performance.now();
        if (!sampledColor || now - sampledAt > COLOR_SAMPLE_TTL_MS) {
          const hostRect = element.getBoundingClientRect();
          sampledColor =
            sampleDeskColor(doc, hostRect, rect) ??
            sampledColor ??
            FALLBACK_COLOR[theme];
          sampledAt = now;
        }
        resolved = sampledColor;
      }

      const next = `${Math.round(rect.left)}|${Math.round(
        rect.top,
      )}|${Math.round(rect.width)}|${Math.round(rect.height)}|${resolved}`;
      if (next === signature && element.style.display !== "none") {
        return;
      }
      signature = next;
      element.style.display = "block";
      hole.style.left = `${rect.left}px`;
      hole.style.top = `${rect.top}px`;
      hole.style.width = `${rect.width}px`;
      hole.style.height = `${rect.height}px`;
      // one shadow, spread far enough to cover any viewport
      hole.style.boxShadow = `0 0 0 100vmax ${resolved}`;
    },
    hide,
    destroy: () => {
      host?.remove();
      host = null;
      hole = null;
      signature = "";
    },
  };
};
