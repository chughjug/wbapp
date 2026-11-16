# Insert a graph — integration

Plot a maths equation over a bounded range, or a bar / line chart from a small table, and drop the result into the page as an `image` element.

**Nothing to install.** No plotting or maths library is used: the expression parser and the Canvas2D renderer are in this folder. There is **no `eval` and no `new Function`** anywhere in the feature.

---

## 1. `App.tsx` changes (copy-pasteable)

### a) import — next to the other `goodnotes` imports

```tsx
import { useGraphDialog } from "./goodnotes/graph";
```

### b) the controller — inside the `ExcalidrawWrapper` component body, after

`excalidrawAPI` exists

```tsx
const graph = useGraphDialog(excalidrawAPI, {
  onInserted: (result) =>
    excalidrawAPI?.setToast({
      message: "Graph inserted",
      closable: true,
    }),
});
```

`useGraphDialog` accepts `ExcalidrawImperativeAPI | null`, so it is safe to call before the editor has mounted; `graph.dialog` is `null` until then.

### c) the trigger — wire any nav-bar / taskbar button to `graph.open`

```tsx
<button type="button" onClick={() => graph.open()}>
  Insert graph…
</button>
```

…or as a main-menu item next to the existing ones:

```tsx
<MainMenu.Item
  onSelect={() => graph.open()}
  icon={null}
  data-testid="insert-graph"
>
  Insert graph…
</MainMenu.Item>
```

### d) the dialog — render it once, anywhere in the tree

It portals to `document.body`, and renders `null` while closed, so placement does not matter:

```tsx
{
  graph.dialog;
}
```

That is the whole integration. Three lines plus a button.

---

## 2. Re-editing an existing graph (`object-menu`)

The full spec rides on the inserted element at `customData.goodnotes.graph`, so a selected graph can always be reopened. From `goodnotes/object-menu` (or any other chrome that knows the selection):

```tsx
import { editGraph, isGraphElement } from "../graph";

// show the item only when it can actually do something
if (isGraphElement(selectedElement)) {
  // …
  const handle = editGraph(excalidrawAPI, selectedElement);
  if (handle) {
    // either drive the dialog…
    graph.openForElement(selectedElement);
    // …or change the spec headlessly — this re-renders in place,
    // keeping the element's id, position, size, frame and z-order,
    // as one undo step:
    await handle.update({ ...handle.spec, xMax: 20 });
  }
}
```

`graph.editSelected()` does the selection lookup for you and returns `false` when the selection is not one of our graphs — handy for a keyboard shortcut.

---

## 3. What lands in the scene

|  |  |
| --- | --- |
| element | `type: "image"`, `status: "saved"`, 560 × 360 CSS px by default |
| raster | PNG rendered at **2×** (1120 × 720 device px) |
| `fileId` | the editor's own `generateIdFromFile` SHA-1 of the PNG bytes |
| files | registered with `excalidrawAPI.addFiles([...])` **before** the element is added — this ordering is what makes the picture survive a reload |
| position | centred on the current viewport, parented to a page frame when it lands inside one |
| `customData.goodnotes.graph` | `{ spec, alt, rendered, updatedAt }` |

Sibling GoodNotes keys (`page`, `backdrop`, the pens marker…) are preserved: the merge only ever touches `customData.goodnotes.graph`.

---

## 4. Accessibility notes for the host

- The dialog handles its own focus trap, focus restore, Escape, labelling and `role="alert"` error reporting. Mount it only while open (the controller already does this).
- The inserted image carries a **text alternative derived from its spec** — e.g. `"Graph of y = x^2 − 3x + 2 for x from 0 to 10"` — readable with `getGraphAltText(element)`. **Excalidraw's core image element has no native `alt` field**, so the description lives in `customData` next to the spec. If your object menu, export pipeline or PDF writer has somewhere to put a text alternative, read it from there:

  ```ts
  import { getGraphAltText } from "./goodnotes/graph";
  const alt = getGraphAltText(element); // string | null
  ```

- The rendered graph is always drawn on **white with dark ink**, in both UI themes, because it ends up as a picture on a white page and in exported PDFs. Only the dialog chrome follows the editor theme.

---

## 5. Headless use (no dialog)

```ts
import {
  createChartSpec,
  createFunctionSpec,
  insertGraphIntoScene,
} from "./goodnotes/graph";

await insertGraphIntoScene(
  excalidrawAPI,
  createFunctionSpec({
    series: [
      { id: "a", expression: "sin(x)" },
      { id: "b", expression: "cos(x)" },
    ],
    xMin: 0,
    xMax: 2 * Math.PI,
    title: "Trig",
  }),
  { width: 560, height: 360, pixelRatio: 2 },
);

await insertGraphIntoScene(
  excalidrawAPI,
  createChartSpec("bar", {
    data: [
      { label: "Mon", value: 12 },
      { label: "Tue", value: 19 },
    ],
    title: "Steps",
    yLabel: "thousands",
  }),
);
```

`renderGraphToFile(spec)` gives you the `BinaryFileData` without touching the scene, if you own the scene arrays yourself.

---

## 6. The expression language

|  |  |
| --- | --- |
| operators | `+ - * / ^` (`**` is accepted as `^`), parentheses, unary minus |
| implicit × | `2x`, `3sin(x)`, `2(x+1)`, `(x+1)(x-1)`, `x pi` |
| functions | sin cos tan asin acos atan sinh cosh tanh sqrt abs ln log exp floor ceil round (`log` is base 10) |
| constants | `pi`, `e` |
| variable | `x`; a leading `y =` or `f(x) =` is stripped |
| not supported | scientific literals (`1e3` — `e` is a constant, write `2*10^3`), multiple variables, comparisons, anything else |

Anything outside that grammar is rejected with the offending token and its character offset, surfaced under the field and in a `role="alert"`:

```
"foo(x)"  → I don't know what "foo" means. Use x, pi, e, or one of: sin, cos, …
"sin x"   → "sin" needs brackets around what it applies to, like sin(x).
"(x+1"    → This "(" is never closed.
```

---

## 7. Known limitations

- **One variable.** `x` only; no parameters or sliders.
- **No native `alt`** on Excalidraw images — see §4.
- The graph is a **raster**, like an imported PDF page: zooming past 2× shows interpolation, not sharper text. Re-open it (§2) and it re-renders at the element's current size, which is the fix when a graph has been scaled up a lot.
- Charts are **single-series**. Multi-series lives on the function side (several equations on one set of axes, with a legend).
