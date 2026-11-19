/**
 * Putting a snapshot back.
 *
 * Restoring is itself a destructive write — it replaces whatever is on the
 * page right now — so it takes a `before-restore` snapshot of the current
 * state first. That snapshot is pinned, which means thinning never takes it,
 * which means "undo the restore" is always available afterwards. Without
 * that, a mis-tap in the history panel would be exactly the kind of silent
 * loss the feature exists to prevent.
 *
 * Kept apart from `store.ts` because it is the only part of the feature that
 * reaches into the document library; the store itself knows nothing but its
 * own database.
 */

import { flushSceneSaves, getScene, saveScene } from "../library/store";

import { getSnapshot, takeSnapshot } from "./store";

import type { DocScene } from "../types";
import type { Snapshot } from "./store";

export interface RestoreResult {
  /** The scene now in the document. */
  scene: DocScene;
  /** The pinned snapshot of what was there before, for undoing this. */
  undo: Snapshot | null;
}

/**
 * Replace a document's scene with the one in snapshot `id`.
 *
 * Any debounced save still in flight is flushed first: it holds a scene
 * *newer* than what is on disk, and letting its timer fire after the restore
 * would quietly overwrite the restored page with the damage.
 */
export const restoreSnapshot = async (
  id: string,
  now: number = Date.now(),
): Promise<RestoreResult | null> => {
  const snapshot = await getSnapshot(id);
  if (!snapshot) {
    return null;
  }

  await flushSceneSaves();

  const current = await getScene(snapshot.docId);
  const undo = current
    ? await takeSnapshot(snapshot.docId, current, now, "before-restore")
    : null;

  await saveScene(snapshot.docId, snapshot.scene);

  return { scene: snapshot.scene, undo };
};
