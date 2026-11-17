/**
 * Stash the first-page format chosen in the "New document" dialog so the
 * editor can seed page 1 after navigation + remount.
 *
 * The dialog runs *before* `/d/<id>` mounts Excalidraw, so an optional image
 * `File` cannot be written into `BinaryFiles` yet. It rides along here and is
 * consumed exactly once by the new document's seed effect.
 */

import type { PageImageFit } from "../paper/pageImages";
import type { PageSizeName, PaperTemplateId } from "../types";

export interface PendingNewDocumentSeed {
  template: PaperTemplateId;
  size: PageSizeName;
  landscape: boolean;
  imageFile?: File | null;
  imageFit?: PageImageFit;
}

const pendingByDocId = new Map<string, PendingNewDocumentSeed>();

/** Remember the create-dialog choice until the new editor mounts. */
export const setPendingNewDocumentSeed = (
  docId: string,
  seed: PendingNewDocumentSeed,
): void => {
  pendingByDocId.set(docId, seed);
};

/** Take (and clear) a pending seed. Returns `null` when none was stashed. */
export const takePendingNewDocumentSeed = (
  docId: string | null | undefined,
): PendingNewDocumentSeed | null => {
  if (!docId) {
    return null;
  }
  const seed = pendingByDocId.get(docId) ?? null;
  if (seed) {
    pendingByDocId.delete(docId);
  }
  return seed;
};

/** Test helper — empty the stash between cases. */
export const clearPendingNewDocumentSeeds = (): void => {
  pendingByDocId.clear();
};
