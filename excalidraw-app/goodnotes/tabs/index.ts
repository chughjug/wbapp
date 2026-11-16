/**
 * GoodNotes document tabs — public API.
 *
 * Keeps several notebooks open at once and lets the student flick between
 * them without going back to the library shelf.
 *
 * Three layers, usable independently:
 *
 *   `openDocs.ts`   the model — an ordered list of open document ids plus the
 *                   active one, persisted to localStorage. Framework-free.
 *   `useOpenDocs`   a React hook over that model which hydrates each tab's
 *                   `DocMeta` from the library store and re-reads on its
 *                   `subscribe`.
 *   `TabBar`        the strip itself. Presentational: it calls `onActivate`
 *                   and friends, and never touches `history`.
 *
 * Typical integration (see INTEGRATION.md for the exact App.tsx diff):
 *
 * ```tsx
 * const { tabs, activeId, actions } = useOpenDocs(docId);
 *
 * <TabBar
 *   tabs={tabs}
 *   activeId={activeId}
 *   theme={editorTheme}
 *   onActivate={(id) => openDocumentById(id)}   // host pushes /d/<id>
 *   onClose={actions.close}
 *   onReorder={actions.reorder}
 *   onCloseOthers={actions.closeOthers}
 *   onNewTab={closeDocument}                    // back to the shelf
 * />
 * ```
 *
 * NOT in scope: keeping several editors mounted. The host remounts
 * `ExcalidrawWrapper` per document (it is keyed on `docId`) by design; this
 * module owns the strip and the open-document model, not scene multiplexing.
 */

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

/**
 * The tab strip. Render it above the editor; it is a full-width band, not an
 * overlay, and it scrolls horizontally rather than wrapping.
 *
 * It renders **only when more than one document is open**. With one document
 * a band that names the document you are already looking at is pure cost
 * (1152x29 = 33k px² on an iPad Pro 11"), and the title now lives in
 * `goodnotes/shell`'s floating bar — its "…" menu heads with it. Pass
 * `showWhenSingle` for the old always-on behaviour.
 */
export { TabBar, docDotColor } from "./TabBar";
export type { TabBarProps } from "./TabBar";

// ---------------------------------------------------------------------------
// React state
// ---------------------------------------------------------------------------

/**
 * Hook joining the open-tab model to the library store. Pass the host's
 * current `docId` so navigation opens/activates the matching tab.
 */
export { useOpenDocs, useActiveDocMeta } from "./useOpenDocs";
export type {
  OpenTab,
  OpenDocsActions,
  UseOpenDocsResult,
} from "./useOpenDocs";

// ---------------------------------------------------------------------------
// Model (use directly from outside React — e.g. a command palette)
// ---------------------------------------------------------------------------

export {
  /** Current snapshot of the strip. */
  getOpenDocs,
  /** Subscribe to strip changes; returns an unsubscribe function. */
  subscribeOpenDocs,
  /** Open a document, or focus it when it is already open. */
  openDoc,
  /** Close a tab; a neighbour is activated when the active tab goes. */
  closeDoc,
  /** Activate an open tab. */
  activateDoc,
  /** Move a tab to an index. */
  reorderDoc,
  /** Close every tab but one. */
  closeOtherDocs,
  /** Close every tab. */
  closeAllDocs,
  /** Drop tabs whose documents no longer exist. */
  pruneOpenDocs,
  /** Replace the whole strip (normalised on the way in). */
  setOpenDocs,
  /** Mirror strip changes made in another window of the app. */
  syncOpenDocsAcrossWindows,
  /** localStorage key the strip is persisted under. */
  OPEN_DOCS_STORAGE_KEY,
  /** Maximum simultaneously open tabs. */
  MAX_OPEN_DOCS,
} from "./openDocs";

export type { OpenDocsState } from "./openDocs";

// Pure reducers, exported for tests and for anyone who wants the behaviour
// without the singleton. Each takes a state and returns the next one.
export {
  normalizeOpenDocs,
  openDocIn,
  closeDocIn,
  activateDocIn,
  reorderDocIn,
  closeOthersIn,
  pruneDocsIn,
} from "./openDocs";
