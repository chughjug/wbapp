/**
 * Pulling searchable text out of a scene.
 *
 * The shelf's search box only ever matched a document's title, course and
 * tags, so "which notebook did I write about eigenvalues in?" had no answer
 * short of opening them one by one. This module is the other half: the text
 * that is actually *inside* a notebook.
 *
 * Four sources, all of them already in the scene — nothing new is stored on
 * elements for this:
 *
 * 1. **Text elements.** What the student typed.
 * 2. **Imported PDF pages.** `goodnotes/import-pdf` stashes each page's
 *    extracted text on the page frame's `customData`, explicitly so a search
 *    feature would have something to read. This is that feature.
 * 3. **Graphs.** The alt text describing the plotted equation.
 * 4. **Page frame names**, when a page has been given a real name rather
 *    than the default `page:<n>`.
 *
 * Handwriting is NOT searchable: these are stroke paths, and nothing here
 * does recognition. A page of pure ink contributes nothing, which is worth
 * knowing before wondering why a notebook does not come up.
 */

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { PAGE_FRAME_PREFIX } from "../types";

import type { DocScene } from "../types";

/** PDF import's `customData` key. Duplicated rather than imported so this
 * module stays free of the pdf.js-adjacent one. */
const PDF_IMPORT_KEY = "goodnotesPdfImport";
/** Graph insert's namespace and key on `customData`. */
const GOODNOTES_NAMESPACE = "goodnotes";
const GRAPH_KEY = "graph";

/** One page's worth of searchable text. */
export interface PageText {
  /** 1-based page number, or 0 for anything not inside a page frame. */
  page: number;
  /** The page's own name, when it has one beyond `page:<n>`. */
  name: string | null;
  /** Everything readable on the page, joined with newlines. */
  text: string;
}

const customDataOf = (element: ExcalidrawElement): Record<string, unknown> =>
  (element.customData as Record<string, unknown> | undefined) ?? {};

/** `"page:7"` -> 7. Returns null for a frame that is not a page. */
const pageNumberOf = (name: string | null | undefined): number | null => {
  if (typeof name !== "string" || !name.startsWith(PAGE_FRAME_PREFIX)) {
    return null;
  }
  const n = Number.parseInt(name.slice(PAGE_FRAME_PREFIX.length), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const pdfTextOf = (element: ExcalidrawElement): string | null => {
  const data = customDataOf(element)[PDF_IMPORT_KEY] as
    | { text?: unknown }
    | undefined;
  return typeof data?.text === "string" && data.text.trim() !== ""
    ? data.text
    : null;
};

const graphTextOf = (element: ExcalidrawElement): string | null => {
  const namespace = customDataOf(element)[GOODNOTES_NAMESPACE] as
    | Record<string, unknown>
    | undefined;
  const graph = namespace?.[GRAPH_KEY] as { alt?: unknown } | undefined;
  return typeof graph?.alt === "string" && graph.alt.trim() !== ""
    ? graph.alt
    : null;
};

/** Collapses runs of whitespace; PDF text arrives full of them. */
export const normalizeText = (value: string): string =>
  value.replace(/\s+/g, " ").trim();

/**
 * Searchable text per page, in page order, skipping pages with nothing to
 * read. Page 0 collects anything outside a page frame (a whiteboard, or ink
 * dropped beside the paper).
 */
export const extractPageTexts = (scene: DocScene): PageText[] => {
  const elements = scene.elements ?? [];

  // frame id -> page number, so a child element can find its page
  const pageOfFrame = new Map<string, number>();
  const nameOfPage = new Map<number, string | null>();
  const chunks = new Map<number, string[]>();

  const push = (page: number, value: string | null) => {
    const text = value ? normalizeText(value) : "";
    if (!text) {
      return;
    }
    const list = chunks.get(page);
    if (list) {
      list.push(text);
    } else {
      chunks.set(page, [text]);
    }
  };

  for (const element of elements) {
    if (element.isDeleted || element.type !== "frame") {
      continue;
    }
    const page = pageNumberOf(element.name);
    if (page === null) {
      continue;
    }
    pageOfFrame.set(element.id, page);
    nameOfPage.set(page, null);
    // a page that only holds a scanned PDF still has its text here
    push(page, pdfTextOf(element));
  }

  for (const element of elements) {
    if (element.isDeleted) {
      continue;
    }
    const page = element.frameId ? pageOfFrame.get(element.frameId) ?? 0 : 0;

    if (element.type === "text") {
      push(page, element.text);
    } else if (element.type === "image") {
      push(page, graphTextOf(element));
    }
  }

  return [...chunks.entries()]
    .map(([page, parts]) => ({
      page,
      name: nameOfPage.get(page) ?? null,
      text: parts.join("\n"),
    }))
    .sort((a, b) => a.page - b.page);
};

/**
 * A short piece of `text` around the first occurrence of `query`, for showing
 * under a result. Falls back to the opening of the text when the match is a
 * fuzzy or prefix one with no literal occurrence.
 */
export const snippetAround = (
  text: string,
  query: string,
  radius = 40,
): string => {
  const haystack = normalizeText(text);
  const needle = normalizeText(query).toLowerCase();
  const at = needle ? haystack.toLowerCase().indexOf(needle) : -1;

  if (at === -1) {
    return haystack.length > radius * 2
      ? `${haystack.slice(0, radius * 2).trimEnd()}…`
      : haystack;
  }

  const start = Math.max(0, at - radius);
  const end = Math.min(haystack.length, at + needle.length + radius);
  return `${start > 0 ? "…" : ""}${haystack.slice(start, end).trim()}${
    end < haystack.length ? "…" : ""
  }`;
};
