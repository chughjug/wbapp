/**
 * Stash the page a search hit was found on, so the editor can scroll there
 * once the document has mounted.
 *
 * The shelf knows the page (`../search` indexes text per page) but cannot
 * act on it: the jump has to happen inside a live editor, and opening a
 * document navigates to `/d/<id>` and remounts Excalidraw. Rather than widen
 * `onOpenDocument` through the dashboard, the course browser and the tab
 * strip, the intent rides along here and is consumed exactly once — the same
 * shape as `./pendingNewDocument`.
 */

export interface PendingPageJump {
  /** 1-based page number, as `../search` reports it. */
  page: number;
  /** What the user searched for, so the editor can say why it moved. */
  query: string;
}

const pendingByDocId = new Map<string, PendingPageJump>();

/**
 * Remember which page to land on. Page 0 means "text that is not on any
 * page", which is not somewhere to scroll to, so it is dropped here rather
 * than leaving every caller to check.
 */
export const setPendingPageJump = (
  docId: string,
  jump: PendingPageJump,
): void => {
  if (jump.page >= 1) {
    pendingByDocId.set(docId, jump);
  } else {
    pendingByDocId.delete(docId);
  }
};

/** Take (and clear) a pending jump. Returns `null` when none was stashed. */
export const takePendingPageJump = (
  docId: string | null | undefined,
): PendingPageJump | null => {
  if (!docId) {
    return null;
  }
  const jump = pendingByDocId.get(docId) ?? null;
  if (jump) {
    pendingByDocId.delete(docId);
  }
  return jump;
};

/** Test helper — empty the stash between cases. */
export const clearPendingPageJumps = (): void => {
  pendingByDocId.clear();
};
