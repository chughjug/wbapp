/**
 * Full-text search across every notebook.
 *
 * Two stores, deliberately:
 *
 *   db "goodnotes-search" / store "text" -> { updatedAt, pages } per doc id
 *
 * The scene store holds multi-megabyte element arrays and `BinaryFiles`;
 * reading all of them to answer a keystroke would be unusable on a tablet
 * with a term of PDF-backed notebooks. So each save also writes out the
 * *text* of a document — strings only, a rounding error next to the scene —
 * and searching reads only that.
 *
 * Matching is MiniSearch (github.com/lucaong/minisearch, MIT): prefix and
 * fuzzy matching with BM25 ranking, no dependencies of its own. A notebook
 * search wants "eigenvalu" and a typo to still find the page, which a
 * substring scan does not give you.
 */

import { createStore, del, entries, set } from "idb-keyval";
import MiniSearch from "minisearch";

import { extractPageTexts, snippetAround } from "./extract";

import type { PageText } from "./extract";
import type { DocMeta, DocScene } from "../types";

/** Text only. Never holds elements, appState or files. */
const textStore = createStore("goodnotes-search", "text");

/**
 * How many un-indexed documents one `ensureSearchIndex` call will read
 * scenes for. Each read deserialises a whole notebook, so this is the knob
 * between "the first search is slow" and "the first search misses things".
 */
const BACKFILL_PER_CALL = 8;

interface DocText {
  /** The `updatedAt` of the document this text was taken from. */
  updatedAt: number;
  pages: PageText[];
}

interface IndexedPage {
  /** `${docId}#${page}` */
  id: string;
  docId: string;
  page: number;
  text: string;
}

export interface SearchHit {
  docId: string;
  /** 1-based page, or 0 for content outside any page. */
  page: number;
  /** Text around the match, for showing under the result. */
  snippet: string;
  score: number;
}

const newIndex = () =>
  new MiniSearch<IndexedPage>({
    fields: ["text"],
    storeFields: ["docId", "page", "text"],
    searchOptions: {
      prefix: true,
      // tolerate a typo in longer words, but not in short ones where it
      // would match nearly everything
      fuzzy: (term) => (term.length > 4 ? 0.2 : false),
    },
  });

let index = newIndex();
/** Which `updatedAt` each document is indexed at. */
const indexedAt = new Map<string, number>();

/* -------------------------------------------------------------------------- */
/* writing                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Record a document's searchable text. Called from the store after a scene
 * is written, with the scene already in hand so nothing is read twice.
 */
export const indexSceneText = async (
  docId: string,
  scene: DocScene,
  updatedAt: number,
): Promise<void> => {
  const pages = extractPageTexts(scene);
  if (pages.length === 0) {
    // a notebook of pure ink has nothing to find; drop any stale entry
    await del(docId, textStore);
  } else {
    const record: DocText = { updatedAt, pages };
    await set(docId, record, textStore);
  }
  applyToIndex(docId, pages, updatedAt);
};

/** Drop a deleted document's text. */
export const forgetDocText = async (docId: string): Promise<void> => {
  await del(docId, textStore);
  removeFromIndex(docId);
  indexedAt.delete(docId);
};

/* -------------------------------------------------------------------------- */
/* the in-memory index                                                         */
/* -------------------------------------------------------------------------- */

/** The page ids currently in the index, per document. */
const indexedIds = new Map<string, string[]>();

const removeFromIndex = (docId: string) => {
  const ids = indexedIds.get(docId);
  if (!ids) {
    return;
  }
  // discardAll, not remove: MiniSearch's remove() needs the original
  // document to subtract its term counts, and we no longer hold it.
  index.discardAll(ids.filter((id) => index.has(id)));
  indexedIds.delete(docId);
};

const applyToIndex = (docId: string, pages: PageText[], updatedAt: number) => {
  removeFromIndex(docId);
  const records = pages.map((page) => ({
    id: `${docId}#${page.page}`,
    docId,
    page: page.page,
    text: page.text,
  }));
  index.addAll(records);
  indexedIds.set(
    docId,
    records.map((record) => record.id),
  );
  indexedAt.set(docId, updatedAt);
};

/* -------------------------------------------------------------------------- */
/* reading                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Bring the index up to date with the text store. Cheap after the first
 * call: only documents whose `updatedAt` moved are re-indexed, and the text
 * store holds no scenes.
 */
export const ensureSearchIndex = async (
  docs: DocMeta[],
  /**
   * Reads a document's scene, for the backfill below. Omit it and documents
   * with no text entry are simply skipped.
   */
  readScene?: (id: string) => Promise<DocScene | null>,
): Promise<void> => {
  const live = new Map(docs.map((doc) => [doc.id, doc]));
  const stored = (await entries(textStore)) as [string, DocText][];
  const storedIds = new Set<string>();

  for (const [docId, value] of stored) {
    storedIds.add(docId);
    if (!live.has(docId)) {
      continue;
    }
    if (indexedAt.get(docId) === value.updatedAt) {
      continue;
    }
    applyToIndex(docId, value.pages ?? [], value.updatedAt);
  }

  // documents that went away since we last indexed
  for (const docId of [...indexedAt.keys()]) {
    if (!live.has(docId)) {
      removeFromIndex(docId);
      indexedAt.delete(docId);
    }
  }

  if (!readScene) {
    return;
  }

  // Backfill. Text is written on save, so every notebook that existed
  // before this feature — which, on a real library, is all of them — has no
  // entry at all and would never turn up. Reading a scene is expensive, so
  // only a few per call: the next search picks up where this left off, and
  // the newest documents go first because those are the ones being looked
  // for.
  const pending = [...live.values()]
    .filter(
      (doc) =>
        !storedIds.has(doc.id) || indexedAt.get(doc.id) !== doc.updatedAt,
    )
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, BACKFILL_PER_CALL);

  for (const doc of pending) {
    try {
      const scene = await readScene(doc.id);
      if (scene) {
        await indexSceneText(doc.id, scene, doc.updatedAt);
      } else {
        // nothing saved yet; remember the version so we stop retrying it
        indexedAt.set(doc.id, doc.updatedAt);
      }
    } catch {
      // a scene we cannot read is one we cannot index; try again next time
    }
  }
};

/**
 * Best page hits for `query`, strongest first, at most one per document so
 * one long notebook cannot crowd out the rest.
 */
export const searchNotes = (query: string, limit = 50): SearchHit[] => {
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    return [];
  }

  const best = new Map<string, SearchHit>();
  for (const result of index.search(trimmed)) {
    const docId = result.docId as string;
    if (best.has(docId)) {
      continue;
    }
    best.set(docId, {
      docId,
      page: result.page as number,
      snippet: snippetAround(result.text as string, trimmed),
      score: result.score,
    });
    if (best.size >= limit) {
      break;
    }
  }
  return [...best.values()];
};

/** Test seam: forget everything held in memory. */
export const resetSearchIndexForTests = (): void => {
  index = newIndex();
  indexedAt.clear();
  indexedIds.clear();
};

export { extractPageTexts, snippetAround } from "./extract";
export type { PageText } from "./extract";
