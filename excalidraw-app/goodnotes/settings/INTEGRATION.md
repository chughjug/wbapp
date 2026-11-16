# `goodnotes/settings` — integration

One Settings screen that aggregates the preferences already scattered across the app, plus the two sections that had nowhere to live: a **Gestures & shortcuts** reference and **Storage & backup**.

This module owns only `excalidraw-app/goodnotes/settings/`. It reads and writes every other setting through the owning module's own public API, so nothing here shadows or duplicates state.

---

## 1. The `App.tsx` change (copy-pasteable)

Three edits. The first replaces the "Pen & touch…" overflow entry and its hand-rolled modal; the other two are the hook and the render slots.

### 1a. Import

Next to the other `goodnotes` imports (around line 78, where `./goodnotes/input` is imported):

```diff
-import { InputSettingsPanel, useInputGestures } from "./goodnotes/input";
+import { useInputGestures } from "./goodnotes/input";
+import { useSettingsScreen } from "./goodnotes/settings";
```

`InputSettingsPanel` is now rendered _inside_ the Settings screen, so the app no longer imports it directly. `useInputGestures` is still needed — it is what installs the gesture layer on the editor.

### 1b. The hook

Next to the other hooks in the editor component (anywhere after `const { editorTheme } = useDarkMode()` / wherever `editorTheme` is in scope):

```tsx
const settings = useSettingsScreen({
  theme: editorTheme,
  // A restore writes straight to IndexedDB; goodnotes/library's in-process
  // listeners do not see those writes, so the app has to re-read. A reload is
  // the honest, total answer.
  onRestored: () => window.location.reload(),
});
```

### 1c. The overflow menu entry

Replace the `"input-settings"` item (around line 1154) — the `"theme"` item goes too, because the Settings screen has a proper three-way theme control and a cycling menu label is exactly the discoverability problem this module exists to fix:

```diff
 moreItems={[
-  {
-    id: "input-settings",
-    label: "Pen & touch…",
-    onSelect: () => setIsInputSettingsOpen(true),
-  },
-  {
-    id: "theme",
-    label:
-      themePreference === "dark"
-        ? "Theme: Dark"
-        : themePreference === "light"
-        ? "Theme: Light"
-        : "Theme: Auto",
-    onSelect: () =>
-      setThemePreference(
-        themePreference === "light"
-          ? "dark"
-          : themePreference === "dark"
-          ? "system"
-          : "light",
-      ),
-  },
+  {
+    id: "settings",
+    label: "Settings…",
+    onSelect: () => settings.open(),
+  },
 ]}
```

### 1d. The old modal, and the render slots

Delete the whole `{isInputSettingsOpen && (…)}` block (around line 1440 — the `.gn-settings-backdrop` / `.gn-settings-dialog` wrapper around `<InputSettingsPanel>`), its `isInputSettingsOpen` state, and the `.gn-settings-backdrop` / `.gn-settings-dialog` rules in the app's own CSS if nothing else uses them. In its place:

```tsx
{
  settings.screen;
}
{
  settings.firstRunHint;
}
```

> **Name clash:** this module's modal also uses the class `.gn-settings-backdrop`. If the host's own rules for that class are left behind they will fight this one. Deleting them (as above) is the fix; the module ships everything it needs.

### 1e. Honour the default-paper preference (optional, one line)

The Settings screen has a "default paper for new pages" preference that `goodnotes/pages` cannot read by itself (this module does not own that module and did not edit it). To make it real, seed the new-page dialog from it — in whatever call sets up `useNewPage` / the new-page choice:

```tsx
import { loadDefaultPaper } from "./goodnotes/settings";

// …where the new-page default template is decided:
template: readNewPageChoice(docId).template ?? loadDefaultPaper(),
```

Until that line exists the preference is stored and shown but does not change what a new page looks like. See "Known gaps" below.

---

## 2. Public API

Everything is exported from `./goodnotes/settings`.

### React

| Export | What it is |
| --- | --- |
| `useSettingsScreen(options)` | The one-call entry point. Returns `{ isOpen, open(section?), close, screen, firstRunHint }`. |
| `SettingsScreen` | The screen itself. `presentation="modal"` (default, focus-trapped) or `"inline"`. Props: `onClose`, `theme`, `initialSection`, `onRestored`, `className`. |
| `SETTINGS_SECTIONS`, `SettingsSectionId` | `"input" \| "appearance" \| "paper" \| "pens" \| "gestures" \| "storage"`. |
| `GesturesReference` | The gestures/shortcuts list alone, for a help page. Pass live `InputSettings` and it marks what is currently switched off. |
| `GesturesFirstRunHint` | The one-time, dismissible hint. |
| `StorageSection` | Storage figures + backup/restore, standalone. |
| `useFocusTrap(ref, active)` | Trap Tab, restore focus on close. |

### The reference, as data

`GESTURE_GROUP`, `KEYBOARD_GROUPS`, `REFERENCE_GROUPS`, `GESTURE_SETTING_COVERAGE`, `UNDOCUMENTED_GESTURE_SETTINGS`, and the types `ReferenceEntry` / `ReferenceGroup`.

### Backup (framework-free)

`exportBackup(onProgress)`, `downloadBackup(blob, fileName)`, `backupFileName(date?)`, `readBundleFile(file)`, `validateBundle(raw)`, `importBackup(bundle, { mode, preferences, onProgress })`, `checkStoreLayout()`, `getStorageReport()`, `formatBytes(n)`, `BACKUP_FORMAT`, `BACKUP_VERSION`, `BACKED_UP_PREFERENCE_KEYS`.

### Preferences this module owns

`loadDefaultPaper` / `saveDefaultPaper` / `subscribeDefaultPaper` / `resetDefaultPaperCache` / `DEFAULT_PAPER_STORAGE_KEY` / `DEFAULT_PAPER_TEMPLATE`, and `isGesturesHintDismissed` / `dismissGesturesHint` / `resetGesturesHint` / `subscribeGesturesHint` / `GESTURES_HINT_STORAGE_KEY`.

---

## 3. The backup format

One JSON file, `notebook-backup-<YYYY-MM-DD>.json`. There is no zip library in this app's dependencies and adding one was out of scope, so the bundle is a single JSON document with a documented shape.

```jsonc
{
  "format": "goodnotes-notebook-backup",
  "version": 1,
  "createdAt": "2026-11-16T09:21:04.113Z",
  "app": "excalidraw-goodnotes",
  "documentCount": 2,
  "preferences": {
    // raw localStorage values, verbatim, for BACKED_UP_PREFERENCE_KEYS only
    "goodnotes:input-settings": "{\"pencilOnly\":false,…}",
    "goodnotes:view-mode": "continuous",
    "goodnotes-pens": "[…]",
    "excalidraw-theme": "dark",
    "goodnotes:settings:default-paper": "lined"
  },
  "documents": [
    {
      "meta": {
        /* the DocMeta from goodnotes/library, unchanged */
      },
      "scene": {
        "elements": [
          /* ExcalidrawElement[] */
        ],
        "appState": {
          /* Partial<AppState> */
        },
        "files": {
          "file-1": {
            "id": "file-1",
            "mimeType": "image/png",
            "created": 1700000000000,
            "dataURL": "data:image/png;base64,…"
          }
        }
      }
    }
  ]
}
```

`scene` is `null` for a document that was never written to. The reader tolerates a missing `elements` / `appState` / `files` and refuses anything without the `format` marker or with a `version` above its own.

### Size, and why it is streamed

`files` holds imported images and PDF pages as base64 data URLs. Base64 is already 4/3 of the bytes it encodes, so a library with scans runs to tens of megabytes. Export therefore:

- reads **one document's scene at a time** (`listDocs()` is metadata-only, so the count and the list are cheap);
- serialises each document and drops the reference before the next one;
- enqueues each chunk into a `ReadableStream` drained by `new Response(stream).blob()`, so bytes land in the browser's blob store (which can spill to disk) instead of the JS heap;
- yields between documents so the progress bar and the `aria-live` announcements actually render.

Measured on a 16 MB bundle (8 documents × 2 MB of base64): collecting the chunks in an array and building the `Blob` at the end peaked at **+32 MB** of JS heap. Streaming peaks at +18 MB uncollected and **+6 MB retained** (GC forced before each sample) — about three times _one_ document, flat in the size of the library — with 0.1 MB still held afterwards.

### Restore

`importBackup` takes `mode: "merge" | "replace"`:

- **merge** — existing documents are kept; a document in the bundle with the same id overwrites the one on the device.
- **replace** — both object stores are cleared first, then the bundle is restored exactly. The UI spells this out and uses a danger-styled button.

Preferences are restored too unless `preferences: false`.

---

## 4. Coupling you should know about

**Restore writes to IndexedDB directly.** `goodnotes/library`'s stable surface for this module is read-only (`listDocs`, `getScene`, `subscribe`), so the restore path opens the same two `idb-keyval` stores that `library/store.ts` documents:

```
db "goodnotes"        / store "docs"   -> DocMeta
db "goodnotes-scenes" / store "scenes" -> DocScene
```

Two consequences, both handled:

1. `checkStoreLayout()` round-trips a probe key through both stores **before** any write, and the restore aborts with "Nothing was changed" if either is not where it is expected. If `goodnotes/library` ever moves its stores, the restore fails loudly instead of silently writing to the wrong place.
2. The library's in-process `subscribe` listeners do not fire for these writes. The UI says "Reload the app to see them", and `onRestored` exists so the host can reload for the user (see §1b).

**Composed controls are re-themed, not edited.** Two tokens from other modules are wrong _on this surface_ and are re-pointed from this module's stylesheet: `--gn-input-muted` (4.29:1 on white — under AA) and `--gn-dark-toggle-active-fg` (white on Excalidraw's pale-lilac dark `--color-primary`, 2.2:1). Neither module was modified.

---

## 5. Accessibility

- One `<h1>` (the dialog name), one `<h2>` per section, `<h3>` below; no level is skipped. The embedded `InputSettingsPanel`'s own `<h2>` is `display: none` so it leaves the accessibility tree rather than duplicating the section heading (its `aria-labelledby` still resolves through the hidden node).
- `role="dialog" aria-modal="true"`, focus moved in on open, Tab and Shift+Tab trapped, focus returned to the opener on close, Escape closes.
- The section jump links move **focus**, not just scroll.
- Every control has an accessible name.
- Backup/restore progress and completion are announced through a `role="status" aria-live="polite" aria-atomic="true"` region that is in the DOM before the first message.
- `:focus-visible` draws a 2px outline; the selectors are one class more specific than Excalidraw's `button:focus-visible` rule, which otherwise replaces the ring with a near-invisible 1px box-shadow.
- `@media (prefers-reduced-motion: reduce)` turns off every animation, transition and smooth scroll.
- Light and dark both pass WCAG AA on all 116 text nodes (measured, see below). `--color-muted` is never used for text (it is a background grey) and `--keybinding-color` is never used at all (≈1.9:1 on white); the shortcut chips get their own ink and surface.

---

## 6. Verification

Run against the dev server with Playwright. Three suites, all passing:

- **Settings behaviour** — every toggle read back from the _owning module's_ persistence, not from component state: `goodnotes:input-settings` (`swipePages`, `palmRejection`), `goodnotes:view-mode`, `excalidraw-theme`, `goodnotes:settings:default-paper`, and pens via `loadPenPresets()`. Plus the heading outline, accessible names, and a real `navigator.storage.estimate()` (216 kB used of 3.0 GB).
- **Backup round-trip** — seed two documents (one with a 200 kB base64 image in `BinaryFiles`), export through the real button, assert the filename, the format marker, the preferences and the data URL in the file; **wipe both IndexedDB stores**; restore through the real file picker and confirmation; assert metadata, elements, appState and the image are byte-for-byte identical, and that `replace` mode really deletes. A non-backup file is refused with a plain message and nothing is written.
- **Memory** — 8 documents × 2 MB of base64 exported while sampling the heap with a forced GC: retained peak +6 MB against a 16 MB bundle, 0.1 MB after.
- **Accessibility** — focus trap over 120 Tab presses, Shift+Tab, focus return, Escape, jump-link focus, WCAG AA contrast in both themes, the focus ring, `prefers-reduced-motion`, and the first-run hint appearing once and being remembered.

---

## 7. Known gaps

1. **The default-paper preference is inert until §1e is applied.** This module cannot wire it itself without editing `goodnotes/pages`, which it does not own. It is stored, shown and exported correctly; it just does not yet change what a new page looks like.
2. **Restore parses the whole bundle into memory.** Export streams; import cannot, because the platform has no streaming `JSON.parse`. `importBackup` nulls each document slot as it writes, so the heap falls during the restore rather than peaking at the end — but a bundle larger than available memory will still fail. A chunked format (NDJSON, one document per line) would fix this and is the natural v2.
3. **The keyboard-shortcut rows are transcribed by hand.** The _gesture_ rows are derived from `goodnotes/input`'s exported constants and typed against `keyof InputSettings`, and `UNDOCUMENTED_GESTURE_SETTINGS` makes the screen admit it out loud when a switch has no row (this caught `oneFingerPan` being added mid-build). Nothing equivalent exists for Excalidraw's own shortcuts or the nav bar's tool keys; each group carries a `source` naming the file to check.
4. **No "reset everything" button.** Resetting pens is there because the pens module exports it; a global reset would have to clear other modules' storage behind their backs.
5. **The restore writes bypass `goodnotes/library`'s change notification** (see §4). The host reloads instead.
