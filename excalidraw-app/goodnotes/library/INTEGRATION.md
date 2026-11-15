# Integrating the document library into `excalidraw-app/App.tsx`

Everything below is a change the **integrator** makes. Nothing in `goodnotes/library/` needs to be edited to wire this up.

The module exports:

```ts
import {
  Shelf, // full-screen home screen component
  useDocuments, // React hook over the store
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
} from "./goodnotes/library";
import type {
  ShelfProps,
  DocumentActions,
  UseDocumentsResult,
} from "./goodnotes/library";
```

---

## 1. Where the shelf-vs-editor routing decision belongs

**In `ExcalidrawApp` (bottom of `App.tsx`, currently ~line 1313), _not_ inside `ExcalidrawWrapper`.**

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
  touchDoc,
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

> `Shelf` already stamps `lastOpenedAt` via `touchDoc` when a card is activated, so `openDocument` does not need to.

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

Inside `ExcalidrawWrapper`'s `initializeScene` effect, the line that currently resolves the initial data (~line 567):

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

(Keeping the `data.scene` fallback means a brand-new document still gets the usual defaults / `#json=` import path.)

## 6. Save into the document, not the global key

In `onChange` (~line 715), alongside (or instead of) the `LocalData.save` call:

```tsx
saveSceneDebounced(docId, { elements, appState, files });
```

`saveSceneDebounced` coalesces writes per document (750 ms), strips deleted elements and non-serialisable `appState` keys, bumps `updatedAt`, and derives `pageCount` from `page:`-prefixed frames. Call `flushSceneSaves()` on unload:

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

If you keep upstream `LocalData.save` as well, scope it off for GoodNotes docs or the two will fight over the same `excalidraw` localStorage key.

## 7. A way back to the shelf

Add a menu item to `AppMainMenu` (or any toolbar you own):

```tsx
<MainMenu.Item onSelect={onCloseDocument} icon={...}>
  All documents
</MainMenu.Item>
```

## 8. Thumbnails (optional, owned by whoever renders the export)

When page 1 has been exported to a PNG data URL:

```tsx
await setThumbnail(docId, dataUrl);
```

`setThumbnail` deliberately does **not** bump `updatedAt`.

---

## Notes / gotchas

- **Theme.** `Shelf` renders a root element with `className="excalidraw theme--dark? gn-shelf"` so it inherits Excalidraw's CSS custom properties. Pass `theme="dark"` (the `editorTheme` value) or the dark palette will not apply. The stylesheet is imported by the component; no extra CSS import.
- **Storage.** Two IndexedDB databases: `goodnotes` → `docs` (metadata) and `goodnotes-scenes` → `scenes` (elements/appState/files). Separate databases, not two stores in one, because `idb-keyval`'s `createStore` only ever creates the single object store it is given.
- **No migration** from the legacy `excalidraw` localStorage scene is included. If you want one, call `createDoc({ title: "My notes" })` once on first run and `saveScene(doc.id, legacyScene)`.
- `Shelf` uses `window.confirm` for delete confirmation; swap it for a dialog component if you have one.
