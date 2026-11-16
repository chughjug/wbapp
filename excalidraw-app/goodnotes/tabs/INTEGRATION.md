# Integrating the document tab bar

Everything below lives in `excalidraw-app/goodnotes/tabs/`. The only file you need to change to adopt it is `excalidraw-app/App.tsx` (plus three lines of CSS in `excalidraw-app/index.scss`, if you want the band to push the editor down rather than float over it).

## 0. The strip only renders with more than one document open

**This changed.** With a single document the strip was pure cost: a full-width band (1152x29 = 33,012 px², 3.3% of an iPad Pro 11" viewport) whose only job was to name the document you were already looking at. `TabBar` now returns `null` when `tabs.length <= 1`, so there is no band, no height and no node in the DOM.

The title it used to carry lives in `goodnotes/shell`'s floating bar instead: pass `documentTitle` and it heads the "…" menu and describes the Home control. See `goodnotes/shell/INTEGRATION.md` §2c.

Two consequences for the host:

- **The strip's "+" disappears with one document.** `onNewTab` sent the user back to the library to pick a document; with one document open that route is the bar's **Home** control, and "a brand-new document" is the bar's "…" → **New document**. Both are already wired, so nothing is lost — but do not rely on the strip's "+" being there.
- **Nothing else changes.** Open a second document and the strip comes back, with every tab, drag-reorder and keyboard behaviour it had.

Pass `showWhenSingle` if you want the old always-on behaviour:

```tsx
<TabBar … showWhenSingle />
```

No other prop changed.

## What this module is, and is not

It is **the tab strip and the open-document model**: an ordered list of open document ids with an active one, persisted to `localStorage`, plus a bar that renders them.

It is **not** scene multiplexing. The host remounts the editor per document by design — `ExcalidrawWrapper` is keyed on `docId`, so switching tabs unmounts one editor and mounts the next. Do not try to keep several editors alive to make switching feel instant: the scene, the files and the undo stack are all per-document, upstream's editor is not built to be instanced many times over, and the memory cost scales with the number of open notebooks. Fast switching comes from the scene load being cheap, not from keeping mounts around.

Because of that, activating a tab is _navigation_. The strip never touches `window.history`; it calls `onActivate(docId)` and the host does exactly what it already does when the shelf opens a document.

## 1. Import

```tsx
import { TabBar, useOpenDocs } from "./goodnotes/tabs";
```

## 2. `GoodNotesRoot`

Replace the body of `GoodNotesRoot` with this. The only real changes are: a reusable `openDocumentById`, the `useOpenDocs(docId)` call, and the two returns being wrapped in a shell that puts the bar above the content.

```tsx
const GoodNotesRoot = () => {
  const [docId, setDocId] = useState<string | null>(() => {
    const match = window.location.pathname.match(/^\/d\/([^/]+)$/);
    return match ? decodeURIComponent(match[1]) : null;
  });
  // the editor, not the shelf, is what a shared link resolves to
  const [isTransientScene] = useState(hasTransientSceneInUrl);
  const { editorTheme } = useHandleAppTheme();

  // navigation by id — what a tab click does. `openDocument` (the shelf's
  // callback, which takes a DocMeta) now delegates to it.
  const openDocumentById = useCallback((id: string) => {
    window.history.pushState({}, "", `/d/${encodeURIComponent(id)}`);
    setDocId(id);
  }, []);

  const openDocument = useCallback(
    (doc: DocMeta) => openDocumentById(doc.id),
    [openDocumentById],
  );

  const closeDocument = useCallback(() => {
    void flushSceneSaves();
    window.history.pushState({}, "", "/");
    setDocId(null);
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const match = window.location.pathname.match(/^\/d\/([^/]+)$/);
      setDocId(match ? decodeURIComponent(match[1]) : null);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Passing `docId` is what ties routing to the strip: whatever the host is
  // showing is opened (or focused) as a tab, whether the user got there from
  // the shelf, a link or the back button. Hooks must not be conditional, so
  // this call sits above the early return for the shelf.
  const { tabs, activeId, actions } = useOpenDocs(docId);

  const tabBar = (
    <TabBar
      tabs={tabs}
      activeId={activeId}
      theme={editorTheme}
      // activation is navigation, and navigation is the host's job
      onActivate={openDocumentById}
      onClose={(closedId) => {
        actions.close(closedId);
        // the model has already picked the neighbour to activate; follow it
        const next = getOpenDocs().activeId;
        if (next) {
          openDocumentById(next);
        } else {
          closeDocument();
        }
      }}
      onReorder={actions.reorder}
      onCloseOthers={actions.closeOthers}
      // "+" goes back to the shelf to pick a document
      onNewTab={closeDocument}
    />
  );

  if (!docId && !isTransientScene) {
    return (
      <div className="gn-app-shell">
        {tabBar}
        <div className="gn-app-shell__body">
          <Shelf theme={editorTheme} onOpenDocument={openDocument} />
        </div>
      </div>
    );
  }

  return (
    <div className="gn-app-shell">
      {tabBar}
      <div className="gn-app-shell__body">
        <ExcalidrawWrapper
          key={docId ?? "transient"}
          docId={docId}
          onCloseDocument={closeDocument}
        />
      </div>
    </div>
  );
};
```

`getOpenDocs` comes from the same module:

```tsx
import { TabBar, getOpenDocs, useOpenDocs } from "./goodnotes/tabs";
```

### Why `onClose` navigates

Closing the active tab must both drop it from the strip _and_ move the host to whichever document took its place — otherwise the editor would keep showing a document that no longer has a tab. `actions.close` applies the neighbour rule (right neighbour, else left), so reading `getOpenDocs().activeId` straight afterwards tells you where to go. When the last tab is closed, there is nowhere to go but the shelf.

If you would rather keep `App.tsx` free of that logic, the equivalent one-liner is `onClose={actions.close}` plus an effect that follows the model:

```tsx
useEffect(() => {
  if (activeId && activeId !== docId) {
    openDocumentById(activeId);
  }
}, [activeId, docId, openDocumentById]);
```

Pick one of the two, not both.

## 3. Layout CSS

Add to `excalidraw-app/index.scss` (the bar is a normal block element, so the host decides where it sits; this makes it a band above a full-height editor):

```scss
.gn-app-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.gn-app-shell__body {
  flex: 1 1 auto;
  min-height: 0;
  position: relative;
}
```

If you would rather overlay the bar than reflow the editor, skip the CSS above and give `TabBar` a `className` that positions it (`position: fixed; top: 0; left: 0; right: 0;`). It brings no positioning of its own.

### Known collision

`goodnotes/taskbar` floats at `position: fixed; top: 0.75rem` with `z-index: 125`. With the band layout above, the taskbar will overlap the strip by about half its height, because it positions against the viewport rather than against its container. Either nudge the taskbar's `top` (that file is owned by the taskbar module) or give `.gn-app-shell__body` a `padding-top`. The tab bar itself sits at `z-index: 5` and never covers editor UI.

## 4. Behaviour you get

| Interaction | Result |
| --- | --- |
| Click a tab | `onActivate(docId)` → host pushes `/d/<id>` → editor remounts |
| Click × | Tab closes; right neighbour activates (left, if it was last) |
| Middle-click a tab | Same as × |
| Alt+click × | Closes every _other_ tab (`onCloseOthers`) |
| Drag a tab | Reorder, with a drop indicator on the target edge |
| Click + | `onNewTab()` → back to the shelf |
| Open a document already open | Activated, not duplicated |
| Reload | Strip and active tab restored from `localStorage` |
| Document deleted elsewhere | Its tab disappears on the library's next change event |
| Second browser window | Strips stay in sync via the `storage` event |

## 5. Keyboard and screen readers

The strip is a WAI-ARIA tablist with **manual activation** — arrows move focus, they do not switch documents, because switching remounts the editor and that is far too heavy to do on every keypress.

| Key | Action |
| --- | --- |
| `Left` / `Right` | Move focus between tabs (wraps) |
| `Home` / `End` | First / last tab |
| `Enter` / `Space` | Activate the focused tab |
| `Delete` / `Backspace` | Close the focused tab, focus its neighbour |
| `Ctrl`/`Cmd`+`Shift`+`Left`/`Right` | Move the focused tab within the strip |

Other details: roving tabindex (exactly one tab in the page tab order); `aria-selected` on the active tab; each close button is named `Close <document title>`; `:focus-visible` rings in both themes; `@media (prefers-reduced-motion: reduce)` disables the smooth scroll and the hover transitions; a `@media (forced-colors: active)` block keeps the active tab and the focus rings visible in Windows high contrast.

## 6. Theming

The bar reads Excalidraw's own custom properties and so applies the `excalidraw` / `theme--dark` classes to its own root — those properties are scoped to `.excalidraw`. Pass `theme` (`"light" | "dark"`); `useHandleAppTheme` already gives you `editorTheme`.

Colour is funnelled through local `--gn-tab-*` properties whose values are Excalidraw tokens (`--color-surface-mid`, `--island-bg-color`, `--color-border-outline-variant`, `--input-label-color`, `--color-on-surface`, `--color-primary`), each with a theme-correct literal fallback for the case where the strip is mounted outside the token scope. `--color-muted` is deliberately unused: it is a _background_ grey with no contrast guarantee as text.

The dot colour is derived from the document's course (so every "CHEM 240" notebook shares a dot) or, when it has none, from its id. The function is exported if you need the same colour elsewhere:

```tsx
import { docDotColor } from "./goodnotes/tabs";

docDotColor(docMeta, editorTheme); // -> "hsl(263 50% 46%)"
```

## 7. Using the model without the bar

`openDoc` / `closeDoc` / `activateDoc` / `reorderDoc` / `closeOtherDocs` / `getOpenDocs` / `subscribeOpenDocs` are plain functions with no React dependency — a command palette or a keyboard shortcut handler can drive the strip directly. The pure reducers (`openDocIn`, `closeDocIn`, …) are exported too, for tests.
