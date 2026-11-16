/**
 * `goodnotes/settings` — one Settings screen, and the gestures reference that
 * makes the rest of the app discoverable.
 *
 * ## What this module is for
 *
 * Two problems, one surface.
 *
 * **Scattered settings.** Pen/touch lived in a modal behind an overflow menu,
 * theme was a single menu item that cycled through three states, paper could
 * only be chosen while adding a page, view mode was an unlabelled toggle in
 * the page controls, and pens had no settings surface at all. This module
 * collects them into one screen with real sections.
 *
 * **Undiscoverable gestures.** The app answers to a two-finger flick, a
 * two-finger tap, a three-finger tap, a second tap on the active tool and a
 * long press on a course folder — and nothing anywhere told the user. The
 * {@link GesturesReference} section is that telling, and
 * {@link GesturesFirstRunHint} points at it once.
 *
 * ## What it does NOT own
 *
 * Every setting on the screen except two belongs to the module that
 * implements the behaviour, and is read and written through that module's own
 * API — `goodnotes/input`, `goodnotes/dark`, `goodnotes/paged`,
 * `goodnotes/pens`. No value is mirrored into local state, so flipping a
 * switch here and flipping it in the old modal are the same act. The two
 * exceptions are in `prefs.ts`: the default paper for new pages, and whether
 * the first-run hint has been seen. Both had no home anywhere else.
 *
 * ## Quick start
 *
 * ```tsx
 * import { useSettingsScreen } from "./goodnotes/settings";
 *
 * const settings = useSettingsScreen({ theme: editorTheme });
 *
 * // replaces the overflow menu's "Pen & touch…" entry
 * moreItems={[{ id: "settings", label: "Settings…", onSelect: () => settings.open() }]}
 *
 * // near the end of the tree
 * {settings.screen}
 * {settings.firstRunHint}
 * ```
 *
 * See `INTEGRATION.md` for the exact, copy-pasteable `App.tsx` changes.
 */

// ---------------------------------------------------------------------------
// React entry points
// ---------------------------------------------------------------------------

/**
 * The hook a host should reach for first: owns open/close, renders the
 * screen and the first-run hint, and opens the screen at a named section.
 */
export { useSettingsScreen } from "./useSettingsScreen";
export type {
  UseSettingsScreenOptions,
  UseSettingsScreenResult,
} from "./useSettingsScreen";

/**
 * The screen itself, for a host that wants to own its own open state or
 * render it inline (`presentation="inline"`) rather than as a modal.
 * As a modal it traps focus, restores it on close and closes on Escape.
 */
export { SettingsScreen, SETTINGS_SECTIONS } from "./SettingsScreen";
export type { SettingsScreenProps, SettingsSectionId } from "./SettingsScreen";

/**
 * The gestures and shortcuts list on its own — for a help page, an onboarding
 * sheet, or a printable cheat sheet. Pass live `InputSettings` and it marks
 * the gestures that are currently switched off.
 */
export { GesturesReference } from "./GesturesReference";
export type { GesturesReferenceProps } from "./GesturesReference";

/** The one-time, dismissible hint pointing at the gestures section. */
export { GesturesFirstRunHint } from "./FirstRunHint";
export type { GesturesFirstRunHintProps } from "./FirstRunHint";

/** The storage figures + backup/restore controls, usable standalone. */
export { StorageSection } from "./StorageSection";
export type { StorageSectionProps } from "./StorageSection";

// ---------------------------------------------------------------------------
// The gesture/shortcut reference, as data
// ---------------------------------------------------------------------------

/**
 * Derived from `goodnotes/input`'s exported constants and settings model, so
 * re-tuning a threshold or renaming a switch updates (or type-errors) the
 * reference instead of silently stranding it.
 */
export {
  /** Touch and stylus gestures. */
  GESTURE_GROUP,
  /** Keyboard shortcuts, grouped. */
  KEYBOARD_GROUPS,
  /** Everything, in display order. */
  REFERENCE_GROUPS,
  /** Which rows document which `InputSettings` key. */
  GESTURE_SETTING_COVERAGE,
  /** Switches with no documented row — empty means the list is complete. */
  UNDOCUMENTED_GESTURE_SETTINGS,
} from "./gestureList";
export type { ReferenceEntry, ReferenceGroup } from "./gestureList";

// ---------------------------------------------------------------------------
// Backup / restore (framework-free; usable without the UI)
// ---------------------------------------------------------------------------

export {
  /** Build the bundle as a `Blob`, one document at a time, with progress. */
  exportBackup,
  /** Trigger a browser download of a built bundle. */
  downloadBackup,
  /** `notebook-backup-<YYYY-MM-DD>.json`. */
  backupFileName,
  /** Read + validate a bundle file without writing anything. */
  readBundleFile,
  /** Validate an already-parsed object. Throws with a user-facing message. */
  validateBundle,
  /** Write a validated bundle into the library (`merge` or `replace`). */
  importBackup,
  /** Verify the library's IndexedDB stores are where restore expects them. */
  checkStoreLayout,
  /** Format marker and schema version written into every bundle. */
  BACKUP_FORMAT,
  BACKUP_VERSION,
  /** The `localStorage` keys a bundle carries. */
  BACKED_UP_PREFERENCE_KEYS,
  /** `navigator.storage.estimate()` + a document count. */
  getStorageReport,
  /** Human-readable byte counts. */
  formatBytes,
} from "./backup";
export type {
  BackupBundle,
  BackupDocument,
  BackupPhase,
  BackupProgress,
  ExportBackupResult,
  ImportBackupOptions,
  ImportBackupResult,
  ProgressCallback,
  RestoreMode,
  StorageReport,
} from "./backup";

// ---------------------------------------------------------------------------
// Preferences this module owns
// ---------------------------------------------------------------------------

/**
 * The default paper template for new pages. `goodnotes/pages` remembers the
 * *last* choice per document; this is the "always start lined" preference it
 * had no room for. The host seeds the new-page dialog from it — see
 * `INTEGRATION.md`.
 */
export {
  DEFAULT_PAPER_STORAGE_KEY,
  DEFAULT_PAPER_TEMPLATE,
  loadDefaultPaper,
  saveDefaultPaper,
  subscribeDefaultPaper,
  resetDefaultPaperCache,
} from "./prefs";

/** First-run hint state, readable and resettable without React. */
export {
  GESTURES_HINT_STORAGE_KEY,
  isGesturesHintDismissed,
  dismissGesturesHint,
  resetGesturesHint,
  subscribeGesturesHint,
} from "./firstRun";

/** Modal focus plumbing, exported for hosts building their own sheets. */
export { useFocusTrap } from "./useFocusTrap";
