# Integrating the document library into `excalidraw-app/App.tsx`

Everything below is a change the **integrator** makes. Nothing in `goodnotes/library/` needs to be edited to wire this up.

> **If you already integrated the previous version of this module: there is nothing to change.** > `<Shelf theme={editorTheme} onOpenDocument={openDocument} />` is still the entry point, with the same props and the same behaviour. The restructure (sidebar, course folders, grid/list, favourites, in-app delete confirmation) is entirely internal. The only removed export is the internal `ShelfCard` type helper, which was never exported. Skip to §9 for the new optional props and exports.

---

## 1. Where the shelf-vs-editor routing decision belongs

**In `ExcalidrawApp` (bottom of `App.tsx`), _not_ inside `ExcalidrawWrapper`.**

Reasons:

- `ExcalidrawWrapper` is hard-wired to the single-scene `LocalData` lifecycle (`initialStatePromiseRef`, `LocalData.save`, collab). Routing above it means the editor is only ever mounted _for a chosen document_, and a `key={docId}` gives you a clean remount — and therefore a clean `initialData` promise — every time the user opens a different document.
- The shelf must render with no Excalidraw instance alive at all (it is a full-viewport screen, not a sidebar/overlay).

## 2. Imports to add at the top of `App.tsx`

```tsx
import {
  Shelf,
  getScene,
  saveSceneDebounced,
  flushSceneSaves,
} from "./goodnotes/library";
import type { DocMeta } from "./goodnotes/types";
```

(`useState` / `useCallback` are already imported.)

## 3. Replace the body of `ExcalidrawApp`

```tsx
const ExcalidrawApp = () => {
  const isCloudExportWindow =
    window.location.pathname === "/excalidraw-plus-export";
  if (isCloudExportWindow) {
    return <ExcalidrawPlusIframeExport />;
  }

  return (
    <TopErrorBoundary>
      <Provider store={appJotaiStore}>
        <ExcalidrawAPIProvider>
          <GoodNotesRoot />
        </ExcalidrawAPIProvider>
      </Provider>
    </TopErrorBoundary>
  );
};
```

…and add `GoodNotesRoot` just above it:

```tsx
const GoodNotesRoot = () => {
  // deep-link support: /d/<docId>
  const [docId, setDocId] = useState<string | null>(() => {
    const match = window.location.pathname.match(/^\/d\/([^/]+)$/);
    return match ? decodeURIComponent(match[1]) : null;
  });
  const { editorTheme } = useHandleAppTheme();

  const openDocument = useCallback((doc: DocMeta) => {
    window.history.pushState({}, "", `/d/${encodeURIComponent(doc.id)}`);
    setDocId(doc.id);
  }, []);

  const closeDocument = useCallback(() => {
    void flushSceneSaves();
    window.history.pushState({}, "", "/");
    setDocId(null);
  }, []);

  // keep the back button honest
  useEffect(() => {
    const onPopState = () => {
      const match = window.location.pathname.match(/^\/d\/([^/]+)$/);
      setDocId(match ? decodeURIComponent(match[1]) : null);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  if (!docId) {
    return <Shelf theme={editorTheme} onOpenDocument={openDocument} />;
  }

  return (
    <ExcalidrawWrapper
      key={docId}
      docId={docId}
      onCloseDocument={closeDocument}
    />
  );
};
```

> `Shelf` stamps `lastOpenedAt` via `touchDoc` when a card is activated, so `openDocument` does not need to. That stamp is what populates the sidebar's **Recent** filter.

## 4. `ExcalidrawWrapper` props

Change the signature (currently `const ExcalidrawWrapper = () => {`) to:

```tsx
const ExcalidrawWrapper = ({
  docId,
  onCloseDocument,
}: {
  docId: string;
  onCloseDocument: () => void;
}) => {
```

## 5. Load the document's scene instead of `LocalData`

Inside `ExcalidrawWrapper`'s `initializeScene` effect, where the initial data is resolved:

```tsx
initialStatePromiseRef.current.promise.resolve(data.scene);
```

becomes:

```tsx
const docScene = await getScene(docId);
initialStatePromiseRef.current.promise.resolve(
  docScene
    ? {
        elements: docScene.elements,
        appState: { ...docScene.appState, theme: editorTheme },
        files: docScene.files,
      }
    : data.scene,
);
```

## 6. Save into the document, not the global key

In `onChange`, alongside (or instead of) the `LocalData.save` call:

```tsx
saveSceneDebounced(docId, { elements, appState, files });
```

and flush on unload:

```tsx
useEffect(() => {
  const flush = () => void flushSceneSaves();
  window.addEventListener("pagehide", flush);
  return () => {
    window.removeEventListener("pagehide", flush);
    flush();
  };
}, []);
```

## 7. A way back to the shelf

```tsx
<MainMenu.Item onSelect={onCloseDocument} icon={...}>
  All documents
</MainMenu.Item>
```

## 8. Thumbnails (optional)

```tsx
await setThumbnail(docId, dataUrl);
```

`setThumbnail` deliberately does **not** bump `updatedAt`.

---

## 9. What the restructured shelf adds

### New optional prop

```tsx
<Shelf
  theme={editorTheme}
  onOpenDocument={openDocument}
  defaultView="list" // NEW, optional: "grid" (default) | "list"
  headerExtra={<MyMenu />} // unchanged
/>
```

`defaultView` is only the _initial_ value. The user's last choice is remembered in `localStorage` under `goodnotes-library-view` and wins on subsequent loads.

### Screen anatomy

```
┌───────────────┬──────────────────────────────────────────────┐
│ All documents │ <filter name>      [grid|list]  [New document]│
│ Favourites    │ [search ........]  [Sort by ▾]  [Course ▾]    │
│ Recent        ├──────────────────────────────────────────────┤
│ Due this week │ COURSES                                       │
│               │ ┌─🧪 Biology 201─┐ ┌─📐 Math 310─┐  …  each ▾ │
│ COURSES       │ └ 2 documents  ▾┘ └ 2 documents ▾┘            │
│ ● Biology 201 ├──────────────────────────────────────────────┤
│ ● Math 310    │ grid of cover cards  —or—  dense list rows    │
│ ● History 110 │                                               │
│ ─────────────  │                                              │
│ Storage 4.2 MB│                                               │
└───────────────┴──────────────────────────────────────────────┘
```

### Favourites are a reserved tag

Starring a document appends the reserved tag **`"favourite"`** to `DocMeta.tags`. The shared contract is untouched; `FAVOURITE_TAG`, `isFavourite(doc)` and `visibleTags(doc)` are exported.

**If you consume `DocMeta.tags` anywhere else** (tabs, export, search), filter the reserved tag out for display:

```ts
import { visibleTags, isFavourite } from "./goodnotes/library";

const chips = visibleTags(doc); // user tags only
const starred = isFavourite(doc); // the flag
```

Rationale: a star is a one-bit label, and `tags` is the contract's label field. One source of truth means the flag can never drift from the document, `duplicateDoc` carries it for free, and `deleteDoc` (which this module must not change) needs no extra bookkeeping. The cost is that the literal tag name `favourite` is reserved.

### Course colour + emoji live in their own IndexedDB database

A course is identified only by the free-text `DocMeta.course` string and has no row of its own, so its presentation is stored separately — same `idb-keyval` pattern as `store.ts`:

```
db "goodnotes-courses" / store "styles"  ->  { color: "#rrggbb", emoji: string | null }
                                             keyed by course name
```

Nothing has to be migrated or seeded: a course with no stored row gets a stable colour derived from its name (`defaultCourseColor`). Renaming a course in a document's details creates a new key; the old row is harmless and `resetCourseStyle(name)` removes it.

API: `useCourseStyles()`, `listCourseStyles()`, `setCourseStyle()`, `resetCourseStyle()`, `subscribeCourseStyles()`.

**Deleting all documents of a course does not delete its style row** — reopen the course later and its colour is still there. If you add a "clean up unused courses" action, call `resetCourseStyle` yourself.

### Delete confirmation

`window.confirm` is gone. Delete now opens `ConfirmDialog` — a modal `role="dialog"` with focus trapping, Escape/backdrop cancel, and focus restoration. It is exported if you want it elsewhere.

### Three new storage keys to know about

| key | where | what |
| --- | --- | --- |
| `goodnotes` → `docs` | IndexedDB | document metadata (unchanged) |
| `goodnotes-scenes` → `scenes` | IndexedDB | scene payloads (unchanged) |
| `goodnotes-courses` → `styles` | IndexedDB | **new** — course colour/emoji |
| `goodnotes-library-view` | localStorage | **new** — last grid/list choice |

---

## 10. Public API

```ts
import {
  // screen
  Shelf,
  // composable pieces, if you build your own home screen
  Sidebar,
  CourseFolders,
  DocumentCard,
  DocumentRow,
  ConfirmDialog,

  // filter model
  FAVOURITE_TAG,
  RECENT_WINDOW_MS,
  FILTER_ALL,
  isFavourite,
  visibleTags,
  isDueThisWeek,
  isRecent,
  endOfDueWeek,
  matchesFilter,
  matchesQuery,
  filterId,
  filterLabel,
  filtersEqual,

  // formatting
  getDueUrgency,
  formatDueDate,
  formatUpdatedAt,
  formatShortDate,
  formatBytes,

  // react state
  useDocuments,
  useCourseStyles,

  // course styles
  listCourseStyles,
  setCourseStyle,
  resetCourseStyle,
  subscribeCourseStyles,
  resolveCourseStyle,
  defaultCourseColor,
  normalizeHex,
  hexToRgbChannels,
  describeColor,
  COURSE_COLOR_PRESETS,
  COURSE_EMOJI_PRESETS,

  // persistence — UNCHANGED, same signatures as before
  listDocs,
  getDoc,
  getScene,
  createDoc,
  updateDocMeta,
  saveScene,
  saveSceneDebounced,
  flushSceneSaves,
  setThumbnail,
  touchDoc,
  duplicateDoc,
  deleteDoc,
  subscribe,
  DEFAULT_DOC_TITLE,
  SCENE_SAVE_DEBOUNCE_MS,
} from "./goodnotes/library";

import type {
  ShelfProps,
  LibraryView,
  LibraryFilter,
  DueUrgency,
  SidebarProps,
  SidebarCourse,
  CourseFoldersProps,
  CourseFolder,
  DocumentItemProps,
  ConfirmDialogProps,
  CourseStyle,
  CourseStyleMap,
  UseCourseStylesResult,
  UseDocumentsResult,
  DocumentActions,
} from "./goodnotes/library";
```

`DocumentActions` gained two members: `setFavourite(id, boolean)` and `toggleFavourite(id)`. Everything else is as it was.

---

## Notes / gotchas

- **Theme.** `Shelf` renders a root element with `className="excalidraw theme--dark? gn-shelf"` so it inherits Excalidraw's CSS custom properties. Pass `theme="dark"` (the `editorTheme` value) or the dark palette will not apply. The stylesheet is imported by the component.
- **Colour tokens.** The stylesheet uses `--color-danger-color` / `--color-warning-color` with their matching `-background`, never `--color-danger-text` (identical to `--color-danger-background` in dark theme), and never `--color-muted` for text (it is a background grey). Course colours are injected as `--gn-course-rgb: "r g b"` and only ever used for fills and borders — text stays on `--text-primary-color`, so a user-chosen hex can never destroy contrast.
- **Keyboard.** The document container keeps a roving tabindex; Arrow keys/Home/End move the anchor. The row step is measured from the live layout (`offsetTop` run length), so it is correct for the responsive `auto-fill` grid and degrades to 1 in list view automatically.
- **"Due this week" includes overdue** documents on purpose.
- **"Recent"** means `lastOpenedAt` within 30 days (`RECENT_WINDOW_MS`), which is populated by `touchDoc` — so it only fills up once documents are actually opened through the shelf or your router.
- **Storage line** uses `navigator.storage.estimate()`; where that is unavailable it degrades to a plain "stored on this device" sentence.
- **No migration** from the legacy `excalidraw` localStorage scene is included.
