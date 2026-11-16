/**
 * Page-frame discovery, ordering, units and page-range parsing.
 *
 * Deliberately local (not imported from `goodnotes/pages/`) so the export
 * module has no cross-feature dependency for something this small.
 *
 * Split out of `exportPdf.ts` so the rasteriser, the PDF writer and the
 * image writer can all share it without a cycle; `exportPdf` re-exports
 * everything here, so its public surface is unchanged.
 */

import type {
  ExcalidrawElement,
  ExcalidrawFrameElement,
  NonDeleted,
} from "@excalidraw/element/types";

import { PAGE_FRAME_PREFIX, PAGE_SIZES } from "../types";

import type { PageSizeName } from "../types";

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

/**
 * PAGE_SIZES are CSS px at 96dpi; PDF user space is points at 72dpi.
 * pt = px * 72 / 96 (i.e. px * 0.75).
 */
export const PX_PER_INCH = 96;
export const PT_PER_INCH = 72;

/** Convert CSS px (96dpi) to PDF points (72dpi). */
export const pxToPt = (px: number): number => (px * PT_PER_INCH) / PX_PER_INCH;

// ---------------------------------------------------------------------------
// Page frames
// ---------------------------------------------------------------------------

/** True if the element is a non-deleted frame acting as a document page. */
export const isPageFrame = (
  element: ExcalidrawElement,
): element is NonDeleted<ExcalidrawFrameElement> =>
  element.type === "frame" &&
  !element.isDeleted &&
  typeof element.name === "string" &&
  element.name.startsWith(PAGE_FRAME_PREFIX);

/**
 * Parses the trailing number out of a page frame name (`"page:3"` -> 3).
 * Returns `null` when the suffix isn't a plain positive integer.
 */
const parsePageFrameIndex = (frame: ExcalidrawFrameElement): number | null => {
  // name shapes: "page:", "page:3", "page:3:lined", "page:lined"
  const parts = (frame.name ?? "")
    .slice(PAGE_FRAME_PREFIX.length)
    .split(":")
    .map((part) => part.trim())
    .filter(Boolean);
  for (const part of parts) {
    if (/^\d+$/.test(part)) {
      return Number(part);
    }
  }
  return null;
};

/**
 * All page frames in document order.
 *
 * Ordered by the number embedded in the frame name when every frame has one
 * (so `page:10` sorts after `page:9`), otherwise by vertical position, which
 * is how pages are stacked on the canvas. Vertical position is always the
 * tie-breaker.
 */
export const getOrderedPageFrames = (
  elements: readonly ExcalidrawElement[],
): NonDeleted<ExcalidrawFrameElement>[] => {
  const frames = elements.filter(isPageFrame);

  return frames.slice().sort((a, b) => {
    const ai = parsePageFrameIndex(a);
    const bi = parsePageFrameIndex(b);
    if (ai !== null && bi !== null && ai !== bi) {
      return ai - bi;
    }
    if (a.y !== b.y) {
      return a.y - b.y;
    }
    return a.x - b.x;
  });
};

/**
 * The named page-size preset matching these dimensions, if any (1px
 * tolerance). Purely informational — export always uses the frame's real
 * geometry.
 */
export const matchPageSizeName = (
  width: number,
  height: number,
): PageSizeName | null => {
  for (const [name, size] of Object.entries(PAGE_SIZES) as [
    PageSizeName,
    { width: number; height: number },
  ][]) {
    if (
      Math.abs(size.width - width) <= 1 &&
      Math.abs(size.height - height) <= 1
    ) {
      return name;
    }
  }
  return null;
};

// ---------------------------------------------------------------------------
// Page range parsing
// ---------------------------------------------------------------------------

export type ParsePageRangeResult =
  | { ok: true; pages: number[] }
  | { ok: false; error: string };

/**
 * Parses a human page range such as `"1-3,5"` into sorted, de-duplicated,
 * 1-based page numbers. Rejects malformed input with a human-readable message
 * rather than silently dropping tokens.
 */
export const parsePageRange = (
  input: string,
  totalPages: number,
): ParsePageRangeResult => {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: false, error: "Enter a page range, for example 1-3,5." };
  }
  if (totalPages <= 0) {
    return { ok: false, error: "This document has no pages to export." };
  }

  const pages = new Set<number>();

  for (const rawPart of trimmed.split(",")) {
    const part = rawPart.trim();
    if (!part) {
      return {
        ok: false,
        error: `Empty entry in "${trimmed}" — remove the extra comma.`,
      };
    }

    const rangeMatch = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      const from = Number(rangeMatch[1]);
      const to = Number(rangeMatch[2]);
      if (from < 1 || to < 1) {
        return { ok: false, error: `Page numbers start at 1 ("${part}").` };
      }
      if (from > to) {
        return {
          ok: false,
          error: `"${part}" counts backwards — write ${to}-${from} instead.`,
        };
      }
      if (to > totalPages) {
        return {
          ok: false,
          error: `"${part}" is out of range — this document has ${totalPages} page${
            totalPages === 1 ? "" : "s"
          }.`,
        };
      }
      for (let page = from; page <= to; page++) {
        pages.add(page);
      }
      continue;
    }

    if (!/^\d+$/.test(part)) {
      return {
        ok: false,
        error: `"${part}" isn't a page number or range. Use numbers and ranges, for example 1-3,5.`,
      };
    }

    const page = Number(part);
    if (page < 1 || page > totalPages) {
      return {
        ok: false,
        error: `Page ${page} is out of range — this document has ${totalPages} page${
          totalPages === 1 ? "" : "s"
        }.`,
      };
    }
    pages.add(page);
  }

  if (pages.size === 0) {
    return { ok: false, error: "No pages selected." };
  }

  return { ok: true, pages: [...pages].sort((a, b) => a - b) };
};

/** Compact human summary of a page list: `[1,2,3,5]` -> `"1–3, 5"`. */
export const formatPageList = (pages: readonly number[]): string => {
  if (pages.length === 0) {
    return "none";
  }
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    const page = sorted[i];
    if (page === prev + 1) {
      prev = page;
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}–${prev}`);
    start = page;
    prev = page;
  }
  return parts.join(", ");
};
