/**
 * `goodnotes/sync` — sign-in, and notebooks that survive the device.
 *
 * ## The problem
 *
 * Every notebook lives in this browser's IndexedDB. Clear site data and it
 * is gone; open the app on another device and it is not there. Safari caps
 * script-writable storage at seven days for sites that are not on the Home
 * Screen, so "local only" is not a conservative choice — it is a deadline.
 *
 * ## The shape of the fix
 *
 * Local-first, additively. The library remains the single source of truth
 * for the running app: the editor reads and writes IndexedDB exactly as it
 * did, and this module copies documents up and down in the background. With
 * no env vars, nobody signed in, or no network, **nothing changes**.
 *
 * ```tsx
 * const sync = useSync({ activeDocId: docId });
 * // somewhere in Settings:
 * <SyncPanel sync={sync} theme={editorTheme} />
 * ```
 *
 * ## Conflicts, in one sentence
 *
 * Each document carries a version counter; if two devices both edit from the
 * same version, the device that notices keeps its own copy untouched and
 * saves the other device's version alongside it as "Lecture 4 (conflict from
 * iPad)" — nothing is merged and nothing is thrown away. See `engine.ts`.
 *
 * ## Security
 *
 * Only the project URL and the **anon** key are used, both public by design
 * and both read from `VITE_`-prefixed env vars. Row Level Security is the
 * only thing separating users, so `supabase/schema.sql` locks both the
 * `documents` table and the storage buckets to `auth.uid()`. `config.ts`
 * refuses to start if something that looks like a `service_role` key is
 * pasted into the anon slot.
 */

// ---------------------------------------------------------------------------
// React
// ---------------------------------------------------------------------------

export { useSync, DEBOUNCE_MS, POLL_MS } from "./useSync";
export type { UseSyncOptions, UseSyncResult } from "./useSync";

export { SyncPanel } from "./SyncPanel";
export type { SyncPanelProps } from "./SyncPanel";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export {
  /** True when both env vars are present and sane. */
  isSyncConfigured,
  /** Why sync is off despite env vars being set, or null. */
  getConfigProblem,
  getSyncConfig,
  resetSyncConfigCache,
} from "./config";
export type { SyncConfig } from "./config";

// ---------------------------------------------------------------------------
// Auth (framework-free)
// ---------------------------------------------------------------------------

export {
  getCurrentUser,
  subscribeAuth,
  signIn,
  signUp,
  signOut,
  sendPasswordReset,
} from "./auth";
export type { SyncUser, AuthResult } from "./auth";

// ---------------------------------------------------------------------------
// The engine, for a host that wants to drive a pass itself
// ---------------------------------------------------------------------------

export { syncAll, countPending, CONFLICT_TAG, sanitizeMessage } from "./engine";
export type { SyncOptions } from "./engine";

export { createSupabaseBackend } from "./supabaseBackend";
export type {
  SyncBackend,
  CommitInput,
  CommitResult,
  BinaryFile,
} from "./backend";

export { getClient, AUTH_STORAGE_KEY } from "./client";

// ---------------------------------------------------------------------------
// Device label (used in conflict-copy titles)
// ---------------------------------------------------------------------------

export {
  getDeviceLabel,
  setDeviceLabel,
  DEVICE_LABEL_STORAGE_KEY,
} from "./device";

// ---------------------------------------------------------------------------
// Watermarks + types
// ---------------------------------------------------------------------------

export { clearStates, loadStates } from "./state";
export { contentHash } from "./hash";

export type {
  SyncStatus,
  SyncPhase,
  SyncReport,
  ConflictRecord,
  DocSyncState,
  RemoteDocRow,
  RemoteMeta,
  ScenePayload,
} from "./types";
