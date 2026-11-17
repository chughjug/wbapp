/**
 * Page model: discrete, GoodNotes-style pages implemented on top of
 * Excalidraw's native `frame` element.
 *
 * Invariants maintained by this module:
 *
 *  - A page is an `ExcalidrawFrameElement` whose `name` is
 *    `` `${PAGE_FRAME_PREFIX}${n}` `` with `n` being its 1-based position.
 *  - All page frames share x = {@link PAGE_ORIGIN_X} and are stacked top to
 *    bottom in document order, separated by {@link PAGE_GAP}.
 *  - Every element whose `frameId` points at a page frame travels with that
 *    frame when the stack is re-laid out.
 *
 * Elements are treated as immutable: every helper returns a NEW array and
 * produces changed elements through `newElementWith`, which bumps
 * `version` / `versionNonce` / `updated` the same way the editor itself does.
 * (`mutateElement` is the in-place variant used inside the editor where a
 * `Scene` is at hand; from the host app we only have arrays, so
 * `newElementWith` is the correct convention — without the version bump the
 * scene/collab layer may skip the update.)
 */

import { newElementWith, newFrameElement } from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawFrameElement,
  NonDeleted,
} from "@excalidraw/element/types";

import {
  getPageImageBackground,
  withPageImageBackground,
  type PageImageBackground,
} from "../paper/pageImages";

import {
  PAGE_FRAME_PREFIX,
  PAGE_GAP,
  PAGE_SIZES,
  type Page,
  type PageSizeName,
  type PaperTemplateId,
} from "../types";

/** All page frames live on this x coordinate so the stack is a clean column. */
export const PAGE_ORIGIN_X = 0;
/** y of the first page in the stack. */
export const PAGE_ORIGIN_Y = 0;

/**
 * Key under which page metadata is kept in the frame's `customData`.
 * `customData` is the sanctioned place for host-app data on an element and
 * survives save/load and collaboration.
 */
export const PAGE_CUSTOM_DATA_KEY = "goodnotesPage";

export interface PageCustomData {
  template: PaperTemplateId;
  size: PageSizeName;
  /**
   * Landscape pages swap the preset's width and height. Optional so every
   * page frame written before this existed still reads back correctly.
   */
  landscape?: boolean;
}

/** The geometry of a size preset, honouring orientation. */
export const getPageDimensions = (
  size: PageSizeName,
  landscape = false,
): { width: number; height: number } => {
  const preset = PAGE_SIZES[size];
  return landscape
    ? { width: preset.height, height: preset.width }
    : { width: preset.width, height: preset.height };
};

type Elements = readonly ExcalidrawElement[];

// ---------------------------------------------------------------------------
// reading
// ---------------------------------------------------------------------------

/** Type guard: is this element a page frame (as opposed to a plain frame)? */
export const isPageFrame = (
  element: ExcalidrawElement,
): element is ExcalidrawFrameElement =>
  element.type === "frame" &&
  !element.isDeleted &&
  typeof element.name === "string" &&
  element.name.startsWith(PAGE_FRAME_PREFIX);

const readCustomData = (
  frame: ExcalidrawFrameElement,
): Partial<PageCustomData> => {
  const data = (frame.customData as Record<string, unknown> | undefined)?.[
    PAGE_CUSTOM_DATA_KEY
  ];
  return (data as Partial<PageCustomData>) ?? {};
};

/**
 * The paper template chosen for a page (defaults to `"blank"`).
 *
 * CONVENTION (deliberate): the template lives in the frame's `customData`,
 * NOT in the frame `name`. The name is user-visible (Excalidraw renders it as
 * a label above the frame and lets the user rename it inline), so packing
 * fields into it would show "page:3:cornell" on the canvas and would break
 * the moment anyone edits the label. Frame names therefore stay `page:<n>`.
 */
export const getPageTemplate = (
  frame: ExcalidrawFrameElement,
): PaperTemplateId => readCustomData(frame).template ?? "blank";

/**
 * Template of the page at `index` — the accessor to wire into the paper-
 * template module's `templateForPage` callback.
 */
export const getTemplateForPage = (
  elements: Elements,
  index: number,
): PaperTemplateId => getPageAt(elements, index)?.template ?? "blank";

/** The page-size preset a page was created with (best-effort). */
export const getPageSizeName = (
  frame: ExcalidrawFrameElement,
): PageSizeName => {
  const stored = readCustomData(frame).size;
  if (stored && stored in PAGE_SIZES) {
    return stored;
  }
  // fall back to matching the geometry, in either orientation
  for (const name of Object.keys(PAGE_SIZES) as PageSizeName[]) {
    const size = PAGE_SIZES[name];
    if (
      (size.width === frame.width && size.height === frame.height) ||
      (size.height === frame.width && size.width === frame.height)
    ) {
      return name;
    }
  }
  return "A4";
};

/** Whether a page frame was created in landscape orientation. */
export const isLandscapePage = (frame: ExcalidrawFrameElement): boolean => {
  const stored = readCustomData(frame).landscape;
  return typeof stored === "boolean" ? stored : frame.width > frame.height;
};

/**
 * A page's image background (`customData.goodnotesPageImage`), or
 * `undefined`. Owned by `../paper`; re-exported here for convenience.
 */
export const getPageImage = (
  frame: ExcalidrawFrameElement,
): PageImageBackground | undefined => getPageImageBackground(frame);

/**
 * All pages in the scene, sorted by vertical position (top first). `index` is
 * the true document order, regardless of what the frame name currently says.
 */
export const getPages = (elements: Elements): Page[] => {
  const frames = elements.filter(isPageFrame);
  frames.sort((a, b) => a.y - b.y || a.x - b.x);
  return frames.map((frame, index) => ({
    frame,
    index,
    template: getPageTemplate(frame),
  }));
};

/** Number of pages in the scene. */
export const getPageCount = (elements: Elements): number =>
  elements.reduce(
    (count, element) => count + (isPageFrame(element) ? 1 : 0),
    0,
  );

/** The page frame at `index`, or `null`. */
export const getPageAt = (elements: Elements, index: number): Page | null =>
  getPages(elements)[index] ?? null;

/** `y` the page at `index` should sit at, given the sizes of the pages above. */
export const getPageTop = (pages: readonly Page[], index: number): number => {
  let y = PAGE_ORIGIN_Y;
  for (let i = 0; i < index && i < pages.length; i++) {
    y += pages[i].frame.height + PAGE_GAP;
  }
  return y;
};

/** Total height of the stack, gaps included. */
export const getStackHeight = (pages: readonly Page[]): number =>
  pages.length === 0
    ? 0
    : getPageTop(pages, pages.length - 1) +
      pages[pages.length - 1].frame.height;

/**
 * The index of the page whose band contains `sceneY` (the viewport centre, in
 * scene coordinates). Gaps are attributed to the nearest page, so the result
 * is always a valid index when at least one page exists; `-1` when there are
 * none.
 */
export const getPageIndexAtSceneY = (
  pages: readonly Page[],
  sceneY: number,
): number => {
  if (pages.length === 0) {
    return -1;
  }
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < pages.length; i++) {
    const { y, height } = pages[i].frame;
    if (sceneY >= y && sceneY <= y + height) {
      return i;
    }
    const distance = sceneY < y ? y - sceneY : sceneY - (y + height);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
};

// ---------------------------------------------------------------------------
// creating
// ---------------------------------------------------------------------------

/** The canonical frame name for a 0-based page index. */
export const pageFrameName = (index: number): string =>
  `${PAGE_FRAME_PREFIX}${index + 1}`;

/**
 * Creates (but does not insert) the frame element backing a page.
 *
 * `index` is the 0-based position the page will occupy; it determines the
 * name only — the caller (or the restack pass) owns the final `y`.
 *
 * The frame is explicitly transparent. Excalidraw renders a frame as an
 * outline only (see `renderElement.ts` → `case "frame"`, which strokes with
 * `FRAME_STYLE` and never fills from `element.backgroundColor`), but we set
 * it anyway so a page can never occlude the paper-template layer painted
 * *behind* the canvas.
 */
export const createPageFrame = (
  index: number,
  size: PageSizeName,
  opts?: {
    template?: PaperTemplateId;
    y?: number;
    /** Swap the preset's width and height. Default `false`. */
    landscape?: boolean;
    /**
     * Image background for the page. The bytes must already be in the
     * editor's `BinaryFiles` (see `createImagePageFile`); only the SHA-1
     * `fileId` is recorded here.
     */
    image?: PageImageBackground | null;
  },
): NonDeleted<ExcalidrawFrameElement> => {
  const landscape = opts?.landscape ?? false;
  const { width, height } = getPageDimensions(size, landscape);
  return newFrameElement({
    x: PAGE_ORIGIN_X,
    y: opts?.y ?? PAGE_ORIGIN_Y,
    width,
    height,
    backgroundColor: "transparent",
    name: pageFrameName(index),
    customData: withPageImageBackground(
      {
        [PAGE_CUSTOM_DATA_KEY]: identityPageCustomData({
          template: opts?.template ?? "blank",
          size,
          ...(landscape ? { landscape: true } : {}),
        }),
      },
      opts?.image ?? null,
    ),
  });
};

/**
 * Identity function that pins its argument to `PageCustomData`.
 *
 * This is what `satisfies PageCustomData` would express, written as a call
 * because the repo's eslint runs an older @typescript-eslint parser that
 * cannot parse the `satisfies` operator (it fails with "',' expected"),
 * even though tsc accepts it.
 */
const identityPageCustomData = (data: PageCustomData): PageCustomData => data;

// ---------------------------------------------------------------------------
// restacking — the core of the module
// ---------------------------------------------------------------------------

/**
 * Re-lays out every page frame in the scene:
 *
 *  1. pages are ordered by their current `y` (so callers express a reorder
 *     simply by handing us frames in the desired order, see
 *     {@link restackPages}'s `order` argument),
 *  2. each frame is moved to its slot in the column,
 *  3. **every child of that frame is translated by the same delta**, so the
 *     ink/shapes on a page travel with the page, and
 *  4. frame names are renumbered to `page:1 … page:n`.
 *
 * Children are found by `frameId`. That covers bound text elements too, since
 * Excalidraw assigns the container's `frameId` to its bound label. Linear
 * elements keep their points relative to `x`/`y`, so translating `x`/`y` is
 * sufficient for them as well.
 *
 * @param order optional explicit order of page frame ids. Ids not listed keep
 *   their relative vertical order after the listed ones' slots are filled;
 *   pass a full list for a deterministic result.
 */
export const restackPages = (
  elements: Elements,
  order?: readonly string[],
): ExcalidrawElement[] => {
  const pages = getPages(elements);
  if (pages.length === 0) {
    return elements.slice();
  }

  const ordered = order ? orderPages(pages, order) : pages;

  // frameId -> translation to apply to that frame AND all of its children
  const deltas = new Map<string, { dx: number; dy: number }>();
  const names = new Map<string, string>();

  let y = PAGE_ORIGIN_Y;
  ordered.forEach((page, index) => {
    const dx = PAGE_ORIGIN_X - page.frame.x;
    const dy = y - page.frame.y;
    if (dx !== 0 || dy !== 0) {
      deltas.set(page.frame.id, { dx, dy });
    }
    const name = pageFrameName(index);
    if (page.frame.name !== name) {
      names.set(page.frame.id, name);
    }
    y += page.frame.height + PAGE_GAP;
  });

  if (deltas.size === 0 && names.size === 0) {
    return elements.slice();
  }

  const translate = (element: ExcalidrawElement, id: string) => {
    const delta = deltas.get(id)!;
    return { x: element.x + delta.dx, y: element.y + delta.dy };
  };

  return elements.map((element) => {
    // the frame itself: move and/or rename
    if (isPageFrame(element)) {
      const moved = deltas.has(element.id);
      const renamed = names.has(element.id);
      if (!moved && !renamed) {
        return element;
      }
      return newElementWith(element, {
        ...(moved ? translate(element, element.id) : {}),
        ...(renamed ? { name: names.get(element.id)! } : {}),
      });
    }
    // a child of a moved frame: translate by exactly the same delta, so the
    // page's content stays put relative to its page
    if (element.frameId && deltas.has(element.frameId)) {
      return newElementWith(element, translate(element, element.frameId));
    }
    return element;
  });
};

const orderPages = (pages: readonly Page[], order: readonly string[]) => {
  const byId = new Map(pages.map((page) => [page.frame.id, page]));
  const result: Page[] = [];
  for (const id of order) {
    const page = byId.get(id);
    if (page) {
      result.push(page);
      byId.delete(id);
    }
  }
  // anything the caller forgot keeps its vertical order, appended at the end
  for (const page of pages) {
    if (byId.has(page.frame.id)) {
      result.push(page);
    }
  }
  return result;
};

// ---------------------------------------------------------------------------
// mutations
// ---------------------------------------------------------------------------

export interface AddPageOptions {
  /** Insert position (0-based). Defaults to the end of the document. */
  at?: number;
  /** Defaults to the size of the page it is inserted after, else `"A4"`. */
  size?: PageSizeName;
  /** Defaults to the template of the page it is inserted after, else blank. */
  template?: PaperTemplateId;
  /** Defaults to the orientation of the page it is inserted after. */
  landscape?: boolean;
  /** Image background for the new page. Not inherited from the neighbour. */
  image?: PageImageBackground | null;
}

export interface AddPageResult {
  elements: ExcalidrawElement[];
  page: NonDeleted<ExcalidrawFrameElement>;
  index: number;
}

/**
 * Inserts a new page and restacks the document. The new frame is appended at
 * the end of the elements array (highest in z-order, with no children yet) —
 * document order is expressed by geometry, not by array position.
 */
export const addPage = (
  elements: Elements,
  opts: AddPageOptions = {},
): AddPageResult => {
  const pages = getPages(elements);
  const at = clamp(opts.at ?? pages.length, 0, pages.length);
  const reference = pages[at - 1] ?? pages[at] ?? null;
  const size =
    opts.size ?? (reference ? getPageSizeName(reference.frame) : "A4");
  const template = opts.template ?? (reference ? reference.template : "blank");
  const landscape =
    opts.landscape ?? (reference ? isLandscapePage(reference.frame) : false);

  // y is provisional; restackPages assigns the real slot. We place it just
  // above the page currently at `at` so the sort puts it in the right place.
  const provisionalY =
    pages.length === 0
      ? PAGE_ORIGIN_Y
      : at === pages.length
      ? getStackHeight(pages) + PAGE_GAP
      : pages[at].frame.y - PAGE_GAP / 2;

  const frame = createPageFrame(at, size, {
    template,
    y: provisionalY,
    landscape,
    image: opts.image ?? null,
  });

  return {
    elements: restackPages([...elements, frame]),
    page: frame,
    index: at,
  };
};

/**
 * Deletes the page at `index` together with its contents (soft delete, the
 * editor's own convention), then restacks the remaining pages so the gap
 * closes and names stay contiguous.
 */
export const deletePage = (
  elements: Elements,
  index: number,
): ExcalidrawElement[] => {
  const pages = getPages(elements);
  const page = pages[index];
  if (!page) {
    return elements.slice();
  }
  const frameId = page.frame.id;
  const next = elements.map((element) =>
    element.id === frameId || element.frameId === frameId
      ? newElementWith(element, { isDeleted: true })
      : element,
  );
  return restackPages(next);
};

/**
 * Moves the page at `from` to position `to`, restacking (and moving each
 * page's children) accordingly.
 */
export const movePage = (
  elements: Elements,
  from: number,
  to: number,
): ExcalidrawElement[] => {
  const pages = getPages(elements);
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= pages.length ||
    to >= pages.length
  ) {
    return elements.slice();
  }
  const ids = pages.map((page) => page.frame.id);
  const [moved] = ids.splice(from, 1);
  ids.splice(to, 0, moved);
  return restackPages(elements, ids);
};

/** Changes a page's paper template (stored in the frame's `customData`). */
export const setPageTemplate = (
  elements: Elements,
  index: number,
  template: PaperTemplateId,
): ExcalidrawElement[] => {
  const page = getPageAt(elements, index);
  if (!page) {
    return elements.slice();
  }
  return elements.map((element) =>
    element.id === page.frame.id
      ? newElementWith(element, {
          customData: {
            ...(element.customData ?? {}),
            [PAGE_CUSTOM_DATA_KEY]: identityPageCustomData({
              ...readCustomData(page.frame),
              size: getPageSizeName(page.frame),
              landscape: isLandscapePage(page.frame),
              template,
            }),
          },
        })
      : element,
  );
};

/**
 * Sets (or clears, with `null`) a page's image background. The bytes must
 * already live in the editor's `BinaryFiles`; only the `fileId` is stored.
 */
export const setPageImage = (
  elements: Elements,
  index: number,
  image: PageImageBackground | null,
): ExcalidrawElement[] => {
  const page = getPageAt(elements, index);
  if (!page) {
    return elements.slice();
  }
  return elements.map((element) =>
    element.id === page.frame.id
      ? newElementWith(element, {
          customData: withPageImageBackground(
            element.customData as Record<string, unknown> | undefined,
            image,
          ),
        })
      : element,
  );
};

/**
 * Ensures the document has at least one page. Returns the original array
 * (same identity) when it already does, so it is safe to call on every load.
 */
export const ensureFirstPage = (
  elements: Elements,
  opts?: {
    size?: PageSizeName;
    template?: PaperTemplateId;
    landscape?: boolean;
    image?: PageImageBackground | null;
  },
): ExcalidrawElement[] => {
  if (getPageCount(elements) > 0) {
    return elements as ExcalidrawElement[];
  }
  return addPage(elements, {
    size: opts?.size ?? "A4",
    template: opts?.template ?? "blank",
    landscape: opts?.landscape ?? false,
    image: opts?.image ?? null,
  }).elements;
};

/** All non-deleted elements belonging to a page (excluding the frame). */
export const getPageChildren = (
  elements: Elements,
  frameId: string,
): ExcalidrawElement[] =>
  elements.filter(
    (element) => element.frameId === frameId && !element.isDeleted,
  );

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);
