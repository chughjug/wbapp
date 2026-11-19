/**
 * What a notebook looks like from above.
 *
 * Thumbnails already answer "which page was that?" when you recognise the
 * shape of a page. They are no help at all when you don't — forty pages of
 * lecture notes all look like forty pages of lecture notes, and finding the
 * one about Lagrange multipliers means flicking through them.
 *
 * This builds a contents list instead: one line per page, naming what is on
 * it. Nothing new is stored for it — the headings are inferred from what is
 * already in the scene, so an outline exists for notebooks written long
 * before this feature did.
 *
 * Where a page's title comes from, in precedence order:
 *
 *   1. The biggest text on the page, if it is meaningfully bigger than the
 *      rest — that is what a heading *is*, written by hand or typed.
 *   2. The first line of an imported PDF page's extracted text.
 *   3. Nothing. The page is listed by number with no title, which is
 *      honest: a page of pure handwriting has no readable title, and
 *      inventing one would be worse than leaving it blank.
 *
 * A page's *frame name* is deliberately not a source. Excalidraw renders
 * that label on the canvas and lets it be edited inline, so it looks like
 * somewhere to write a page title — but `goodnotes/pages` rewrites every
 * frame name back to `page:<n>` on its next sync (measured: the edit shows
 * on screen and is gone from the stored scene by the following save). A
 * title read from there would vanish without warning.
 *
 * Handwriting is not read. Same limitation as search, for the same reason:
 * these are stroke paths and nothing here does recognition.
 */

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { PAGE_FRAME_PREFIX } from "../types";

import type { DocScene } from "../types";

/** PDF import's `customData` key; see `search/extract.ts` for why it is
 * duplicated rather than imported. */
const PDF_IMPORT_KEY = "goodnotesPdfImport";

/**
 * How much bigger than the page's typical text a line must be to count as a
 * heading. 1.25 rather than something tighter: body text on a page varies a
 * little by itself, and promoting an ordinary sentence to a heading makes
 * the outline actively misleading.
 */
const HEADING_SIZE_RATIO = 1.25;

/** Longest title shown; longer ones are cut on a word boundary. */
const MAX_TITLE_LENGTH = 72;

export interface OutlineEntry {
  /** 1-based page number. */
  page: number;
  /** Inferred heading, or null when the page has no readable title. */
  title: string | null;
  /** Where `title` came from, so the panel can style it differently. */
  source: "heading" | "pdf" | null;
  /** Does the page have any readable text at all? */
  hasText: boolean;
}

const customDataOf = (element: ExcalidrawElement): Record<string, unknown> =>
  (element.customData as Record<string, unknown> | undefined) ?? {};

const pageNumberOf = (name: string | null | undefined): number | null => {
  if (typeof name !== "string" || !name.startsWith(PAGE_FRAME_PREFIX)) {
    return null;
  }
  const n = Number.parseInt(name.slice(PAGE_FRAME_PREFIX.length), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Collapse whitespace and cut to length on a word boundary. */
export const tidyTitle = (value: string): string => {
  const flat = value.replace(/\s+/g, " ").trim();
  if (flat.length <= MAX_TITLE_LENGTH) {
    return flat;
  }
  const cut = flat.slice(0, MAX_TITLE_LENGTH);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > MAX_TITLE_LENGTH / 2
    ? cut.slice(0, lastSpace)
    : cut
  ).trimEnd()}…`;
};

interface PageText {
  text: string;
  fontSize: number;
  y: number;
}

/**
 * The heading of one page, from its text elements.
 *
 * Picks the largest font size present, then the topmost element at that
 * size — on a page whose heading and body happen to be the same size this
 * returns null rather than promoting the first sentence, because a wrong
 * title is worse than none.
 */
const headingFrom = (texts: readonly PageText[]): string | null => {
  if (texts.length === 0) {
    return null;
  }
  const sizes = texts.map((t) => t.fontSize);
  const largest = Math.max(...sizes);
  const rest = sizes.filter((size) => size < largest);

  if (texts.length > 1) {
    const typical = rest.length > 0 ? Math.max(...rest) : largest;
    if (largest < typical * HEADING_SIZE_RATIO) {
      return null;
    }
  }

  const candidates = texts
    .filter((t) => t.fontSize === largest)
    .sort((a, b) => a.y - b.y);
  const title = candidates[0] ? tidyTitle(candidates[0].text) : "";
  return title === "" ? null : title;
};

/** The first line of a block of extracted PDF text. */
const firstLineOf = (value: string): string | null => {
  const line = value
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find((part) => part !== "");
  return line ? tidyTitle(line) : null;
};

/**
 * One entry per page frame, in page order.
 *
 * Pages with nothing readable on them are still listed — a contents list
 * that silently skips pages would misnumber everything after the first gap.
 */
export const buildOutline = (scene: DocScene): OutlineEntry[] => {
  const elements = (scene.elements ?? []).filter((el) => !el.isDeleted);

  const pageOfFrame = new Map<string, number>();
  const pdfOfPage = new Map<number, string>();
  const textsOfPage = new Map<number, PageText[]>();

  for (const element of elements) {
    if (element.type !== "frame") {
      continue;
    }
    const page = pageNumberOf(element.name);
    if (page === null) {
      continue;
    }
    pageOfFrame.set(element.id, page);

    const pdf = customDataOf(element)[PDF_IMPORT_KEY] as
      | { text?: unknown }
      | undefined;
    if (typeof pdf?.text === "string" && pdf.text.trim() !== "") {
      pdfOfPage.set(page, pdf.text);
    }
  }

  for (const element of elements) {
    if (element.type !== "text" || !element.frameId) {
      continue;
    }
    const page = pageOfFrame.get(element.frameId);
    if (page === undefined) {
      continue;
    }
    const text = typeof element.text === "string" ? element.text.trim() : "";
    if (text === "") {
      continue;
    }
    const list = textsOfPage.get(page);
    const entry: PageText = {
      text,
      fontSize: typeof element.fontSize === "number" ? element.fontSize : 20,
      y: typeof element.y === "number" ? element.y : 0,
    };
    if (list) {
      list.push(entry);
    } else {
      textsOfPage.set(page, [entry]);
    }
  }

  return [...pageOfFrame.values()]
    .filter((page, index, all) => all.indexOf(page) === index)
    .sort((a, b) => a - b)
    .map((page) => {
      const texts = textsOfPage.get(page) ?? [];
      const pdf = pdfOfPage.get(page) ?? null;

      let title: string | null = null;
      let source: OutlineEntry["source"] = null;

      const heading = headingFrom(texts);
      if (heading) {
        title = heading;
        source = "heading";
      } else if (pdf) {
        title = firstLineOf(pdf);
        source = title ? "pdf" : null;
      }

      return {
        page,
        title,
        source,
        hasText: texts.length > 0 || pdf !== null,
      };
    });
};
