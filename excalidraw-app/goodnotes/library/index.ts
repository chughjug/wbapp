/**
 * GoodNotes document library — public API.
 *
 * This module owns the multi-document layer that replaces Excalidraw's single
 * `excalidraw` localStorage scene: a browsable shelf of assignments and
 * notebooks, plus the IndexedDB persistence behind it.
 *
 * Typical integration (see INTEGRATION.md for the exact App.tsx diff):
 *
 * ```tsx
 * const [docId, setDocId] = useState<string | null>(null);
 * if (!docId) {
 *   return <Shelf theme={appTheme} onOpenDocument={(doc) => setDocId(doc.id)} />;
 * }
 * ```
 */

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

/** Full-screen home shelf. Render it instead of the editor. */
export { Shelf, getDueUrgency, formatDueDate, formatUpdatedAt } from "./Shelf";
export type { ShelfProps, DueUrgency } from "./Shelf";

// ---------------------------------------------------------------------------
// React state
// ---------------------------------------------------------------------------

/** Hook exposing the document list plus stable mutation actions. */
export { useDocuments } from "./useDocuments";
export type { UseDocumentsResult, DocumentActions } from "./useDocuments";

// ---------------------------------------------------------------------------
// Persistence (use directly from the editor side: load/save a document)
// ---------------------------------------------------------------------------

export {
  /** All document metadata, newest-updated first. Never loads scenes. */
  listDocs,
  /** One document's metadata, or null. */
  getDoc,
  /** One document's scene payload (elements/appState/files), or null. */
  getScene,
  /** Create a document from a partial metadata seed. */
  createDoc,
  /** Merge a metadata patch; bumps updatedAt. */
  updateDocMeta,
  /** Persist a scene; bumps updatedAt and derives pageCount. */
  saveScene,
  /** Coalesced variant of saveScene, keyed per document. */
  saveSceneDebounced,
  /** Force-write anything saveSceneDebounced is still holding. */
  flushSceneSaves,
  /** Store a page-1 PNG data URL preview. */
  setThumbnail,
  /** Stamp lastOpenedAt. */
  touchDoc,
  /** Copy metadata + scene under a new id. */
  duplicateDoc,
  /** Delete metadata + scene. */
  deleteDoc,
  /** Subscribe to any library mutation. Returns an unsubscribe fn. */
  subscribe,
  DEFAULT_DOC_TITLE,
  SCENE_SAVE_DEBOUNCE_MS,
} from "./store";
