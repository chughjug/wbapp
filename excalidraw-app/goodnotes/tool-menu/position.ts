/**
 * Where the panel sits, and how that survives a reload.
 *
 * Three placements. `"anchored"` (the default) is a small popover pinned to
 * the tool button that opened it — it costs nothing when closed and never
 * covers the page panel, because it is only up while you are choosing a
 * colour. `"docked"` is a band in normal document flow under the nav bar and
 * has no geometry to model at all — the layout does it. Everything else in
 * this file is the `"floating"` placement's edge model, plus the small
 * anchored-popover solver at the bottom.
 *
 * Design note (this is the second GoodNotes failure the panel exists to fix):
 * GoodNotes' floating tool menu snaps to the exact *centre* of a screen edge,
 * so someone holding a tablet by the bottom bezel has to reach a long way up
 * to change pen. Here the panel still snaps to an edge — free-floating panels
 * drift into the drawing area — but the position *along* that edge is the
 * user's, and is remembered per edge, so "left edge, down by my thumb" sticks.
 *
 * The along-edge position is stored as a 0–1 ratio of the available travel,
 * not pixels, so it survives window resizes and rotation.
 */

/* -------------------------------------------------------------------------- */
/*  Placement: anchored popover vs docked band vs floating panel                */
/* -------------------------------------------------------------------------- */

/**
 * Where the panel lives.
 *
 * - `"anchored"` (**default**) — a compact popover pinned under (or over) the
 *   nav bar button that opened it. Colours and widths in two rows, nothing
 *   nested. It is mounted only while open, so the chrome costs **zero** screen
 *   space at rest; it dismisses on an outside click, on Escape, and as soon as
 *   a mark is made.
 * - `"docked"` — a horizontal band in normal document flow, directly under the
 *   nav bar and above `.gn-shell-body`. It spans the content width and shows
 *   every control for the tool at once, but it is permanent chrome: 1194×53 px
 *   of an iPad Pro 11" screen that is never drawing surface.
 * - `"floating"` — the original edge-snapped overlay, draggable and remembered
 *   per edge (everything below in this file).
 */
export type ToolMenuPlacement = "anchored" | "docked" | "floating";

/**
 * The placements a user can actually cycle to.
 *
 * `"docked"` is deliberately absent. It was the default before the floating
 * bar landed, and it cannot work alongside it: the band renders in flow at
 * the top of the shell, so it paints over the floating bar (the bar's pill
 * sits at y=10, the band spans y=0..77) and, because its height depends on
 * the active tool, it resizes the canvas on every tool change — measured at
 * 1194x834: canvas height 834 -> 758 for the pen, -> 782 for the eraser.
 * That is the "the header disappears and the page resizes when I switch
 * tools" bug. The value is still accepted by the type and still renders, so
 * nothing that passes `placement="docked"` explicitly breaks, but the UI no
 * longer offers it and a stored one is migrated away (see
 * {@link loadToolMenuPlacement}).
 */
export const TOOL_MENU_PLACEMENTS: readonly ToolMenuPlacement[] = [
  "anchored",
  "floating",
];

/** The shipped default. */
export const DEFAULT_TOOL_MENU_PLACEMENT: ToolMenuPlacement = "anchored";

/** localStorage key holding the user's {@link ToolMenuPlacement} choice. */
export const TOOL_MENU_PLACEMENT_STORAGE_KEY = "goodnotes-tool-menu-placement";

const isPlacement = (value: unknown): value is ToolMenuPlacement =>
  value === "anchored" || value === "docked" || value === "floating";

const placementListeners = new Set<(placement: ToolMenuPlacement) => void>();

/**
 * Read the saved placement. Never throws; falls back to `"anchored"`.
 *
 * A stored `"docked"` is migrated to the default. Everyone who used the app
 * before the floating bar has that value persisted, because it was then both
 * the default and one step of the header button's cycle — so without this
 * they are silently upgraded into the broken layout described on
 * {@link TOOL_MENU_PLACEMENTS}. The stored value is rewritten rather than
 * just ignored, so the migration happens once.
 */
export const loadToolMenuPlacement = (): ToolMenuPlacement => {
  try {
    const raw = localStorage.getItem(TOOL_MENU_PLACEMENT_STORAGE_KEY);
    if (raw === "docked") {
      saveToolMenuPlacement(DEFAULT_TOOL_MENU_PLACEMENT);
      return DEFAULT_TOOL_MENU_PLACEMENT;
    }
    return isPlacement(raw) ? raw : DEFAULT_TOOL_MENU_PLACEMENT;
  } catch {
    return DEFAULT_TOOL_MENU_PLACEMENT;
  }
};

/** Persist the placement. Returns `false` if storage rejected the write. */
export const saveToolMenuPlacement = (
  placement: ToolMenuPlacement,
): boolean => {
  let stored = true;
  try {
    localStorage.setItem(TOOL_MENU_PLACEMENT_STORAGE_KEY, placement);
  } catch {
    stored = false;
  }
  // notify either way: the session still honours the change
  placementListeners.forEach((listener) => listener(placement));
  return stored;
};

/**
 * Subscribe to placement changes — this tab's writes and another tab's (via
 * the `storage` event). Returns an unsubscribe function. The hook that owns
 * the panel's open state uses this so flipping placement from inside the
 * panel is picked up without the host having to wire a callback.
 */
export const subscribeToolMenuPlacement = (
  listener: (placement: ToolMenuPlacement) => void,
): (() => void) => {
  placementListeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === TOOL_MENU_PLACEMENT_STORAGE_KEY) {
      listener(loadToolMenuPlacement());
    }
  };
  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }
  return () => {
    placementListeners.delete(listener);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
  };
};

/* -------------------------------------------------------------------------- */
/*  Edge model (floating placement only)                                        */
/* -------------------------------------------------------------------------- */

/** Edges the panel can dock to. "top" is excluded: the app's nav bar lives there. */
export type ToolMenuEdge = "left" | "right" | "bottom";

export const TOOL_MENU_EDGES: readonly ToolMenuEdge[] = [
  "left",
  "right",
  "bottom",
];

export interface ToolMenuPosition {
  edge: ToolMenuEdge;
  /** Per-edge along-edge position, 0 = start of the edge, 1 = end. */
  offsets: Record<ToolMenuEdge, number>;
}

/** localStorage key holding {@link ToolMenuPosition}. */
export const TOOL_MENU_POSITION_STORAGE_KEY = "goodnotes-tool-menu-position";

/** Gap kept between the panel and the viewport edge, in px. */
export const EDGE_MARGIN = 16;

/**
 * Default placement: left edge, low (68% of the travel). Deliberately *not*
 * centred — it keeps the middle of the canvas, where people actually write,
 * completely clear, and it sits within thumb reach of a hand holding the
 * bottom-left of a tablet.
 */
export const DEFAULT_TOOL_MENU_POSITION: ToolMenuPosition = {
  edge: "left",
  offsets: { left: 0.68, right: 0.68, bottom: 0.5 },
};

/**
 * Below this viewport width the panel is about half the screen tall, so no
 * along-edge position on a side edge can keep the centre of the canvas clear.
 * Phones therefore default to the bottom edge, which does clear it (and is
 * where a thumb already is).
 */
export const NARROW_VIEWPORT_WIDTH = 600;

/** The shipped default for a given viewport. */
export const defaultPositionForViewport = (
  viewportWidth: number,
): ToolMenuPosition => ({
  edge: viewportWidth < NARROW_VIEWPORT_WIDTH ? "bottom" : "left",
  offsets: { ...DEFAULT_TOOL_MENU_POSITION.offsets },
});

const clamp01 = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5;

const isEdge = (value: unknown): value is ToolMenuEdge =>
  value === "left" || value === "right" || value === "bottom";

/** Read the saved position. Never throws; falls back to the default. */
export const loadToolMenuPosition = (
  viewportWidth: number = typeof window === "undefined"
    ? 1024
    : window.innerWidth,
): ToolMenuPosition => {
  const fallback = () => defaultPositionForViewport(viewportWidth);
  try {
    const raw = localStorage.getItem(TOOL_MENU_POSITION_STORAGE_KEY);
    if (!raw) {
      return fallback();
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      throw new Error("malformed");
    }
    const value = parsed as Partial<ToolMenuPosition>;
    const base = fallback();
    const offsets = (value.offsets ?? {}) as Partial<
      Record<ToolMenuEdge, number>
    >;
    return {
      edge: isEdge(value.edge) ? value.edge : base.edge,
      offsets: {
        left: clamp01(offsets.left ?? DEFAULT_TOOL_MENU_POSITION.offsets.left),
        right: clamp01(
          offsets.right ?? DEFAULT_TOOL_MENU_POSITION.offsets.right,
        ),
        bottom: clamp01(
          offsets.bottom ?? DEFAULT_TOOL_MENU_POSITION.offsets.bottom,
        ),
      },
    };
  } catch {
    return fallback();
  }
};

/** Persist the position. Returns `false` if storage rejected the write. */
export const saveToolMenuPosition = (position: ToolMenuPosition): boolean => {
  try {
    localStorage.setItem(
      TOOL_MENU_POSITION_STORAGE_KEY,
      JSON.stringify(position),
    );
    return true;
  } catch {
    return false;
  }
};

export interface Rect {
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

/** Turn an edge + along-edge ratio into viewport pixel coordinates. */
export const placementToPixels = (
  position: ToolMenuPosition,
  panel: Rect,
  viewport: Viewport,
): { left: number; top: number } => {
  const ratio = clamp01(position.offsets[position.edge]);
  if (position.edge === "bottom") {
    const travel = Math.max(0, viewport.width - 2 * EDGE_MARGIN - panel.width);
    return {
      left: EDGE_MARGIN + ratio * travel,
      top: Math.max(EDGE_MARGIN, viewport.height - EDGE_MARGIN - panel.height),
    };
  }
  const travel = Math.max(0, viewport.height - 2 * EDGE_MARGIN - panel.height);
  return {
    left:
      position.edge === "left"
        ? EDGE_MARGIN
        : Math.max(EDGE_MARGIN, viewport.width - EDGE_MARGIN - panel.width),
    top: EDGE_MARGIN + ratio * travel,
  };
};

/**
 * Snap a free-dragged top-left point back onto the nearest edge, returning the
 * new edge and the along-edge ratio for it.
 */
export const snapToEdge = (
  point: { left: number; top: number },
  panel: Rect,
  viewport: Viewport,
): { edge: ToolMenuEdge; offset: number } => {
  const distances: Record<ToolMenuEdge, number> = {
    left: Math.max(0, point.left),
    right: Math.max(0, viewport.width - (point.left + panel.width)),
    bottom: Math.max(0, viewport.height - (point.top + panel.height)),
  };
  let edge: ToolMenuEdge = "left";
  let best = Infinity;
  for (const candidate of TOOL_MENU_EDGES) {
    if (distances[candidate] < best) {
      best = distances[candidate];
      edge = candidate;
    }
  }
  if (edge === "bottom") {
    const travel = Math.max(1, viewport.width - 2 * EDGE_MARGIN - panel.width);
    return { edge, offset: clamp01((point.left - EDGE_MARGIN) / travel) };
  }
  const travel = Math.max(1, viewport.height - 2 * EDGE_MARGIN - panel.height);
  return { edge, offset: clamp01((point.top - EDGE_MARGIN) / travel) };
};

/** Step, as a fraction of the edge travel, used by the keyboard drag. */
export const keyboardStep = (travelPx: number, coarse: boolean): number => {
  const px = coarse ? 96 : 24;
  return travelPx > 0 ? px / travelPx : 0;
};

export interface KeyboardMoveResult {
  position: ToolMenuPosition;
  /** Short sentence for the live region, e.g. "Left edge, 72% down". */
  announcement: string;
}

const percent = (ratio: number): number => Math.round(clamp01(ratio) * 100);

const describe = (position: ToolMenuPosition): string => {
  const pct = percent(position.offsets[position.edge]);
  switch (position.edge) {
    case "left":
      return `Left edge, ${pct}% down`;
    case "right":
      return `Right edge, ${pct}% down`;
    default:
      return `Bottom edge, ${pct}% across`;
  }
};

/** Human-readable current placement, for the handle's accessible name. */
export const describePosition = describe;

/**
 * The keyboard-draggable alternative to the pointer drag.
 *
 * - The arrows that run *along* the current edge move the panel by 24px
 *   (96px with Shift), clamped to the edge.
 * - The arrows that run *across* dock the panel to the edge in that direction.
 * - Pushing past the bottom of a vertical edge wraps onto the bottom edge, and
 *   `ArrowUp` on the bottom edge returns to the nearer vertical edge — so every
 *   edge is reachable with arrows alone.
 */
export const moveByKeyboard = (
  position: ToolMenuPosition,
  key: string,
  shiftKey: boolean,
  panel: Rect,
  viewport: Viewport,
): KeyboardMoveResult | null => {
  const next: ToolMenuPosition = {
    edge: position.edge,
    offsets: { ...position.offsets },
  };
  const verticalTravel = Math.max(
    1,
    viewport.height - 2 * EDGE_MARGIN - panel.height,
  );
  const horizontalTravel = Math.max(
    1,
    viewport.width - 2 * EDGE_MARGIN - panel.width,
  );

  const isVerticalEdge = position.edge !== "bottom";
  const current = position.offsets[position.edge];

  if (isVerticalEdge) {
    const step = keyboardStep(verticalTravel, shiftKey);
    if (key === "ArrowUp") {
      next.offsets[position.edge] = clamp01(current - step);
    } else if (key === "ArrowDown") {
      if (current >= 1) {
        // already at the bottom of this edge — wrap around the corner
        next.edge = "bottom";
      } else {
        next.offsets[position.edge] = clamp01(current + step);
      }
    } else if (key === "ArrowLeft") {
      next.edge = "left";
    } else if (key === "ArrowRight") {
      next.edge = "right";
    } else {
      return null;
    }
  } else {
    const step = keyboardStep(horizontalTravel, shiftKey);
    if (key === "ArrowLeft") {
      next.offsets.bottom = clamp01(current - step);
    } else if (key === "ArrowRight") {
      next.offsets.bottom = clamp01(current + step);
    } else if (key === "ArrowUp") {
      next.edge = current < 0.5 ? "left" : "right";
      next.offsets[next.edge] = 1;
    } else {
      return null;
    }
  }

  return { position: next, announcement: describe(next) };
};

/* -------------------------------------------------------------------------- */
/*  Anchored placement: a popover pinned to the button that opened it           */
/* -------------------------------------------------------------------------- */

/** Gap between the anchor button and the popover, in px. */
export const ANCHOR_GAP = 8;

/** Smallest gap kept between the popover and the viewport edge, in px. */
export const ANCHOR_VIEWPORT_MARGIN = 8;

export interface AnchoredPlacement {
  left: number;
  top: number;
  /** Which way it opened — drives the little arrow and the slide direction. */
  side: "below" | "above";
  /**
   * Horizontal distance from the popover's left edge to the anchor's centre,
   * so the arrow can point at the button even when the popover was clamped.
   */
  arrowLeft: number;
}

/**
 * Solve the popover's viewport position from its anchor.
 *
 * Below the anchor by default (the nav bar is at the top); flipped above when
 * there is no room below and more room above; always clamped into the
 * viewport, which is why the arrow offset is returned separately.
 */
export const anchoredPlacement = (
  anchor: { left: number; top: number; width: number; height: number },
  panel: { width: number; height: number },
  viewport: { width: number; height: number },
): AnchoredPlacement => {
  const spaceBelow = viewport.height - (anchor.top + anchor.height);
  const spaceAbove = anchor.top;
  const needed = panel.height + ANCHOR_GAP + ANCHOR_VIEWPORT_MARGIN;
  const side: "below" | "above" =
    spaceBelow >= needed || spaceBelow >= spaceAbove ? "below" : "above";

  const top =
    side === "below"
      ? Math.min(
          anchor.top + anchor.height + ANCHOR_GAP,
          Math.max(
            ANCHOR_VIEWPORT_MARGIN,
            viewport.height - panel.height - ANCHOR_VIEWPORT_MARGIN,
          ),
        )
      : Math.max(
          ANCHOR_VIEWPORT_MARGIN,
          anchor.top - ANCHOR_GAP - panel.height,
        );

  const centred = anchor.left + anchor.width / 2 - panel.width / 2;
  const left = Math.min(
    Math.max(ANCHOR_VIEWPORT_MARGIN, centred),
    Math.max(
      ANCHOR_VIEWPORT_MARGIN,
      viewport.width - panel.width - ANCHOR_VIEWPORT_MARGIN,
    ),
  );

  return {
    left,
    top,
    side,
    arrowLeft: Math.min(
      Math.max(12, anchor.left + anchor.width / 2 - left),
      Math.max(12, panel.width - 12),
    ),
  };
};
