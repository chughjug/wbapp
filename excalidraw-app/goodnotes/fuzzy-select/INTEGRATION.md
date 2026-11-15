# Integrating `goodnotes/fuzzy-select`

Freehand lasso over the canvas → Copy the loop to the clipboard as a PNG, or Duplicate it back into the page as a new image element.

Two things to wire up:

1. mount `<FuzzySelectOverlay />` once, as a **sibling of `<Excalidraw>`**
2. call `activateFuzzySelect()` from whatever turns the tool on (the centralized taskbar)

Nothing else. The module owns its own state, keyboard handling and styling.

---

## 1. `App.tsx` — copy-pasteable changes

### 1a. Import

Add next to the other `./goodnotes/*` imports (around line 84–98, where `ExportDialog`, `PenTray` and `PaperBackgroundLayer` are imported):

```tsx
import { FuzzySelectOverlay } from "./goodnotes/fuzzy-select";
```

### 1b. Mount the overlay

`ExcalidrawWrapper` returns

```tsx
<div
  style={{ height: "100%", position: "relative" }}
  className={clsx("excalidraw-app", { "is-collaborating": isCollaborating })}
>
  <PaperBackgroundLayer … />
  <Excalidraw …>
    …
  </Excalidraw>
  {isPdfExportOpen && excalidrawAPI && (
    <ExportDialog … />
  )}
</div>
```

Add the overlay **immediately after `</Excalidraw>`**:

```tsx
      </Excalidraw>
      <FuzzySelectOverlay excalidrawAPI={excalidrawAPI} />
      {isPdfExportOpen && excalidrawAPI && (
```

That is the whole change. The complete diff is three lines:

```diff
@@ imports @@
+import { FuzzySelectOverlay } from "./goodnotes/fuzzy-select";

@@ render @@
       </Excalidraw>
+      <FuzzySelectOverlay excalidrawAPI={excalidrawAPI} />
       {isPdfExportOpen && excalidrawAPI && (
```

`excalidrawAPI` may be `null` on the first render; the overlay renders nothing until it isn't.

---

## 2. Layering — why _there_, and why it doesn't steal pointer events

### Placement

- **Sibling of `<Excalidraw>`, not a child.** Children of `<Excalidraw>` are consumed as UI slots (`<Footer>`, `<Sidebar>`, `<MainMenu>`…), and a bare child joins the editor container's layout flow — the same trap that made `PenTray` push the static canvas sideways until it was moved into `<Footer>`. The overlay must float over the whole app instead.
- **After `</Excalidraw>` in the DOM.** The overlay is `position: absolute; inset: 0` inside the `.excalidraw-app` wrapper, which is already `position: relative` — no change needed there.
- **`z-index: 4`**, the same value the editor gives its own `--zIndex-layerUI`. Since the overlay comes later in document order it paints _above_ the canvas and above the side islands (so the action bar is never hidden behind the properties panel), while the editor's menus (`110`), context menu (`90`) and dialogs (`1000`) still paint above the overlay, because those live in the same root stacking context with higher values. Verified in the browser: with a selection showing, the action bar is the top element at its own position.

### Pointer events

```scss
.excalidraw.gn-fuzzy-select {
  pointer-events: none;
} // always
.gn-fuzzy-select__surface {
  pointer-events: none;
} // inactive
.gn-fuzzy-select--active .gn-fuzzy-select__surface {
  pointer-events: auto;
} // active
.gn-fuzzy-select__actions {
  pointer-events: auto;
} // the bar
```

So:

- **tool off** — the root, the capture surface and the (absent) SVG are all `pointer-events: none`. `document.elementFromPoint()` over the canvas returns Excalidraw's interactive canvas, not the overlay. Drawing, panning, erasing and normal selection behave exactly as before. No `keydown` listener is bound either.
- **tool on** — only the capture surface and the action-bar buttons take input. The rendered lasso path is `pointer-events: none`, so the ants never swallow a click.

Because the overlay covers the window while active, the editor's own toolbars are not clickable until the tool is turned off (Escape with no selection, or the taskbar button). That is deliberate — it is a modal tool — but if you'd rather the toolbars stayed live, pass `deactivateOnAction` and/or shrink the root to the canvas area in your own stylesheet.

---

## 3. Turning the tool on from the taskbar

The activation entry point is callback-shaped and framework-free, so the taskbar needs no props, context or imports from the component:

```tsx
import {
  activateFuzzySelect,
  deactivateFuzzySelect,
  toggleFuzzySelect,
  useFuzzySelectActive,
} from "../fuzzy-select";

const FuzzySelectButton = () => {
  const active = useFuzzySelectActive();

  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={toggleFuzzySelect}
      title="Fuzzy select — lasso a region to copy or duplicate it"
    >
      Fuzzy select
    </button>
  );
};
```

Non-React callers can use the store directly:

```ts
import { fuzzySelectActivation } from "../fuzzy-select";

fuzzySelectActivation.activate();
const stop = fuzzySelectActivation.subscribe((on) => updateButton(on));
```

The overlay turns the tool off itself when the user presses `Escape` with no selection showing; subscribe (or pass `onActiveChange`) to keep a taskbar button's pressed state in sync.

### Mutual exclusion with other tools

The overlay does **not** touch `appState.activeTool`. If your taskbar has other modal tools, switch them off in the same click handler, and call `deactivateFuzzySelect()` when another tool is picked:

```tsx
const pickPen = () => {
  deactivateFuzzySelect();
  excalidrawAPI.setActiveTool({ type: "freedraw" });
};
```

---

## 4. Useful props

| prop | default | what it does |
| --- | --- | --- |
| `excalidrawAPI` | — | required; the overlay is inert until non-null |
| `active` / `onActiveChange` | — | controlled mode; omit to use the shared store |
| `selectionOptions` | `{ mode: "contain", includeOverlappingImages: true }` | hit-testing rules (see `lasso.ts`) |
| `rasterScale` | `2` | device pixels per scene unit in the PNG |
| `duplicateOffset` | `{ x: 24, y: 24 }` | where the duplicate lands |
| `deactivateOnAction` | `false` | turn the tool off after a Copy/Duplicate |
| `onCopy` / `onDuplicate` | — | hooks for analytics or your own toast |

Example: touch-to-select instead of full containment, and a crisper raster:

```tsx
<FuzzySelectOverlay
  excalidrawAPI={excalidrawAPI}
  selectionOptions={{ mode: "intersect" }}
  rasterScale={3}
/>
```

---

## 5. Keyboard & accessibility contract

Already implemented inside the module — nothing to wire up, but worth knowing when you test it:

| key | behaviour |
| --- | --- |
| `Escape` | aborts an in-progress stroke → else clears the selection → else turns the tool off |
| `Tab` / `Shift+Tab` | moves between Copy, Duplicate and Dismiss |
| `Enter` / `Space` | activates the focused button |
| `Ctrl`/`⌘` + `C` | Copy (only while a selection exists) |
| `Ctrl`/`⌘` + `D` | Duplicate (only while a selection exists) |

- Copy is focused automatically as soon as a selection exists, so the flow is reachable from the keyboard without hunting for the floating bar.
- The bar is a `role="toolbar"` labelled "Fuzzy selection actions" containing three real `<button>`s with visible text labels.
- Outcomes are announced through an `aria-live="polite"` status region.
- Focus rings are `:focus-visible` only, in `--color-primary`.
- `@media (prefers-reduced-motion: reduce)` stops the marching-ants animation and the bar's pop-in.
- The shortcuts are bound in the **capture** phase while the tool is active, so the editor's own `Ctrl+C` / `Escape` don't fire as well. They are unbound the moment the tool is off.

---

## 6. Clipboard caveat

`navigator.clipboard.write()` needs a **secure context** (`https://`, or `http://localhost`). When it isn't available the Copy button automatically becomes **Save PNG** (a plain download) instead of failing silently. When a write is attempted and rejected — permission denied, document not focused — the reason is shown in the status region in plain language.

If you want to pre-empt this in your own UI, `canCopyImageToClipboard()` reports the capability without attempting anything.

---

## 7. Persistence note

Duplicates are inserted as `image` elements plus a matching `BinaryFileData` registered through `excalidrawAPI.addFiles()`, with a SHA-1 content-hashed `fileId`, `mimeType: "image/png"`, a PNG `dataURL`, and `created` / `lastRetrieved` timestamps. That is the shape `excalidraw-app/data/FileManager.ts` expects, so the app's normal file-save path picks them up — no extra wiring in `App.tsx`.
