# Integrating `goodnotes/paper` into `excalidraw-app/App.tsx`

Copy-pasteable changes. Everything below is in `excalidraw-app/App.tsx` unless
stated otherwise. **I did not make these edits** — the paper module owns only
`excalidraw-app/goodnotes/paper/`.

---

## 1. Import

Add near the other local imports:

```tsx
import {
  PaperBackgroundLayer,
  PaperPicker,
} from "./goodnotes/paper";
import type { PaperTemplateId } from "./goodnotes/types";
```

## 2. State inside `ExcalidrawWrapper`

The layer needs the scene elements + the viewport transform. Excalidraw already
calls `onChange(elements, appState, files)`, so mirror what you need into state.
Add next to the other `useState` calls:

```tsx
const [paperTemplate, setPaperTemplate] = useState<PaperTemplateId>("lined");
const [paperView, setPaperView] = useState({
  elements: [] as readonly OrderedExcalidrawElement[],
  scrollX: 0,
  scrollY: 0,
  zoom: 1,
  theme: "light" as "light" | "dark",
  offsetLeft: 0,
  offsetTop: 0,
});
```

Then, **inside the existing `onChange` callback** (it already has `elements`
and `appState` in scope), append:

```tsx
setPaperView((prev) =>
  prev.elements === elements &&
  prev.scrollX === appState.scrollX &&
  prev.scrollY === appState.scrollY &&
  prev.zoom === appState.zoom.value &&
  prev.theme === appState.theme &&
  prev.offsetLeft === appState.offsetLeft &&
  prev.offsetTop === appState.offsetTop
    ? prev
    : {
        elements,
        scrollX: appState.scrollX,
        scrollY: appState.scrollY,
        zoom: appState.zoom.value,
        theme: appState.theme,
        offsetLeft: appState.offsetLeft,
        offsetTop: appState.offsetTop,
      },
);
```

(The identity guard keeps React from re-rendering on unrelated appState churn;
the layer itself additionally coalesces every redraw into one
`requestAnimationFrame`.)

## 3. Mount the layer

The wrapper `<div className="excalidraw-app">` currently has
`style={{ height: "100%" }}`. It is **not positioned**, so an
`position: absolute; inset: 0` child would anchor to the document, not to the
editor. Make it a positioning context and render the layer as the **first**
child, before `<Excalidraw …>`:

```tsx
  return (
    <div
      style={{ height: "100%", position: "relative" }}   // <- add position
      className={clsx("excalidraw-app", {
        "is-collaborating": isCollaborating,
      })}
    >
      <PaperBackgroundLayer
        elements={paperView.elements}
        scrollX={paperView.scrollX}
        scrollY={paperView.scrollY}
        zoom={paperView.zoom}
        theme={paperView.theme}
        offsetLeft={paperView.offsetLeft}
        offsetTop={paperView.offsetTop}
        defaultTemplate={paperTemplate}
      />
      <Excalidraw
        …unchanged…
```

## 4. Make Excalidraw's own canvas transparent (REQUIRED)

Excalidraw's static canvas paints `appState.viewBackgroundColor` over the whole
viewport (`packages/excalidraw/renderer/helpers.ts` → `bootstrapCanvas`). If it
stays opaque, the paper underneath is simply invisible. The only value that
skips the fill is the literal string `"transparent"`:

```tsx
initialData={…}
// e.g. when resolving initialData, or once via excalidrawAPI:
excalidrawAPI?.updateScene({
  appState: { viewBackgroundColor: "transparent" },
});
```

With a transparent scene background, the page "sheet" (white in light theme,
`#1e1f24` in dark) is drawn by this module, and everything off-page shows the
app's own background colour — set it on `.excalidraw-app` if you want something
other than the browser default, e.g.

```scss
.excalidraw-app { background: var(--default-bg-color); }
```

## 5. Optional: the picker

Anywhere in your own UI (footer, sidebar, menu):

```tsx
<PaperPicker
  value={paperTemplate}
  onChange={setPaperTemplate}
  theme={paperView.theme}
/>
```

---

## Z-index / pointer-events caveats (please verify in the running app)

* **Stacking.** `.excalidraw` is `position: relative` with `z-index: auto`, so
  it does **not** create a stacking context: its canvases
  (`--zIndex-canvas: 1`, `--zIndex-interactiveCanvas: 2`) compete in the same
  stacking context as our sibling layer. `PaperBackgroundLayer.scss` therefore
  uses `z-index: 0`, which puts it below both canvases and above the wrapper's
  background. **If anyone later adds `transform`, `filter`, `opacity < 1`,
  `isolation: isolate` or a `z-index` to `.excalidraw` or `.excalidraw-app`,
  that assumption breaks** and the layer must move inside the new stacking
  context instead.
* **Pointer events.** The layer sets `pointer-events: none !important` and is
  `aria-hidden`. It cannot steal clicks, drags, or stylus input. Do not remove
  that rule; if you need a clickable page affordance, add a separate element.
* **Nesting alternative.** If you prefer, the layer can be mounted inside an
  `excalidraw-wrapper`-style container instead of as a sibling of
  `<Excalidraw>`; it sizes itself from `parentElement.getBoundingClientRect()`
  via a `ResizeObserver`, so any positioned, full-size parent works.
* **Offsets.** If the layer's box is not flush with the editor's box (docked
  sidebar, app chrome above the editor), pass `offsetLeft`/`offsetTop` from
  `appState` — otherwise leave them at 0. I could not verify the docked-sidebar
  case; worth a visual check.
* **Export.** This layer is DOM-only; it is **not** part of
  `exportToCanvas` / `exportToBlob` / PNG-SVG export. Scene exports will have a
  transparent (or white) background with no rulings. If exports need paper, the
  export module has to call `renderPaper()` itself — it is exported from
  `./goodnotes/paper` for exactly that.

## Page frames

Pages are read from frame elements whose `name` starts with `PAGE_FRAME_PREFIX`
(`"page:"`). Recognised name shapes:

| name            | index | template        |
| --------------- | ----- | --------------- |
| `page:`         | order | `defaultTemplate` prop |
| `page:3`        | 3     | `defaultTemplate` prop |
| `page:3:lined`  | 3     | `lined`         |
| `page:lined`    | order | `lined`         |

A per-page override is also available without touching frame names:

```tsx
<PaperBackgroundLayer … templateForPage={(page) => templates[page.id]} />
```
