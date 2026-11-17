/**
 * CRDT offline layer (Yjs + y-indexeddb).
 *
 * Complements — does not replace — Excalidraw socket collab and Supabase sync.
 */

export {
  openCrdtDoc,
  crdtStorageKey,
  readRole,
  setRole,
  listSnapshots,
  appendSnapshot,
} from "./docStore";
export type { CrdtDocHandle, CrdtRole, CrdtSnapshot } from "./docStore";

export { useCrdtDoc } from "./useCrdtDoc";
export type { UseCrdtDocResult } from "./useCrdtDoc";

export { HistoryPanel } from "./HistoryPanel";
export type { HistoryPanelProps } from "./HistoryPanel";
