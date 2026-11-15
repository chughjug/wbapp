# Integrating `goodnotes/pages` into `excalidraw-app/App.tsx`

Everything below goes into `excalidraw-app/App.tsx`. This module does **not**
edit it itself.

---

## 0. Which host should render the sidebar?

Investigated options:

| Host | Verdict |
| --- | --- |
| `<Sidebar name="…">` (exported from `@excalidraw/excalidraw`, rendered as a **child** of `<Excalidraw>`) | **Use this.** It is the supported host-app sidebar API. It renders into the editor's own sidebar slot, is dockable (`docked` + `onDock`), closes on outside click / Escape, is excluded from the canvas pointer handling, participates in `appState.openSidebar`, can be toggled from `excalidrawAPI.toggleSidebar({ name: "goodnotes-pages" })`, and — importantly for us — is measured by `getViewportOffsets()`, so `setViewport`/`scrollToPage` will not centre a page underneath it. |
| `renderSidebar` prop | **Does not exist** in this codebase. (`props.children` is the sidebar mechanism; there is no `renderSidebar`.) |
| A plain absolutely-positioned child of `<Excalidraw>` | Works, but you lose docking, the open/close state machine, Escape handling, and the viewport-offset measurement. Only worth it if you want the strip permanently visible with no toggle. |
| `<DefaultSidebar>` | Wrong host — it is the editor's own library/canvas sidebar; adding a tab to it mixes our pages with editor UI. |

Note the editor sidebar is anchored to the **right** edge (left in RTL). If you
want GoodNotes' left-hand strip, use the plain-child variant in §4.

---

## 1. Imports

```tsx
// add to the existing `@excalidraw/excalidraw` import
import { Sidebar } from "@excalidraw/excalidraw";

// new import
import { PageSidebar, usePages } from "./goodnotes/pages";
```

## 2. Seed a brand-new document with its first page

`excalidraw-app` resolves `initialData` through
`initialStatePromiseRef.current.promise`. The simplest, collaboration-safe
place to seed is right after the API exists, using the hook's idempotent
`seedFirstPage()` (it is a no-op when the scene already has a page, so it is
safe to run on every load and after a remote scene arrives).

Inside `ExcalidrawWrapper`, next to the other hooks:

```tsx
const { seedFirstPage } = usePages(excalidrawAPI);

useEffect(() => {
  if (!excalidrawAPI) {
    return;
  }
  // wait for the initial scene to be applied, then ensure page 1 exists
  initialStatePromiseRef.current.promise.then(() => {
    seedFirstPage({ size: "A4", template: "blank" });
  });
}, [excalidrawAPI, seedFirstPage]);
```

`seedFirstPage` applies the change with `CaptureUpdateAction.NEVER`, so it is
not an undoable user edit.

> If you prefer to seed *before* first paint instead, build the elements in
> `initializeScene`:
>
> ```tsx
> import { ensureFirstPage } from "./goodnotes/pages";
> // …where the initial scene data is assembled:
> scene.elements = ensureFirstPage(scene.elements ?? []);
> ```

## 3. Render the sidebar (recommended: editor `Sidebar` host)

Add as a child of `<Excalidraw>` — e.g. just after `<AppMainMenu …/>`:

```tsx
{excalidrawAPI && (
  <Sidebar name="goodnotes-pages" docked onDock={() => {}}>
    <Sidebar.Header />
    <PageSidebar excalidrawAPI={excalidrawAPI} />
  </Sidebar>
)}
```

and a trigger — e.g. inside `renderTopRightUI`:

```tsx
<Sidebar.Trigger
  name="goodnotes-pages"
  title="Pages"
  icon={<span aria-hidden="true">▤</span>}
>
  Pages
</Sidebar.Trigger>
```

(or open it programmatically:
`excalidrawAPI.toggleSidebar({ name: "goodnotes-pages", force: true })`.)

`PageSidebar` fills its container (`height: 100%`), so nothing else is needed.

## 4. Alternative: always-visible left strip

```tsx
<Excalidraw …>
  {excalidrawAPI && (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        bottom: 0,
        width: 180,
        zIndex: 4,
        borderRight: "1px solid var(--sidebar-border-color)",
      }}
    >
      <PageSidebar excalidrawAPI={excalidrawAPI} />
    </div>
  )}
</Excalidraw>
```

With this variant pass an explicit left offset when navigating, since the
editor cannot measure your strip:

```tsx
scrollToPage(excalidrawAPI, index, /* … */);
// or call excalidrawAPI.setViewport({ target, offsets: { left: 180, ui: true } })
```

## 5. Optional extras

```tsx
const { pages, activePageIndex, addPage, goToPage } = usePages(excalidrawAPI);
```

- page counter in the footer: `` `${activePageIndex + 1} / ${pages.length}` ``
- "new page" command in the command palette: `() => addPage()`
- jump to the page of a clicked element:
  `scrollToPageOfElement(excalidrawAPI, elementId)`

## 6. Things worth knowing

- **This fork has no `excalidrawAPI.scrollToContent`.** The replacement is
  `excalidrawAPI.setViewport(opts)`; `scrollToPage` wraps it.
- `PageSidebar.scss` is imported by the component — no extra CSS wiring.
- Pages are ordinary frames, so Excalidraw's own frame behaviour (clipping,
  reparenting of newly drawn elements, per-frame export) applies for free.
- Nothing in this module registers keyboard shortcuts or touches `appState`
  beyond `updateScene`/`setViewport`.
