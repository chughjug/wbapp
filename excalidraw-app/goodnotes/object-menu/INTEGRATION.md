# Integration — Universal Object Menu (`goodnotes/object-menu`)

A contextual action bar that appears directly above the selected object and offers only the actions that apply to it. Self-contained app-level module: **no changes under `packages/` are needed**, no new dependency, no CSS import (the component imports its own `.scss`).

---

## 1. `excalidraw-app/App.tsx`

### 1a. Import

Next to the other GoodNotes imports (`App.tsx` ~line 84):

```tsx
import { ObjectMenu } from "./goodnotes/object-menu";
```

### 1b. Render it **inside** `<Excalidraw>`

`ExcalidrawWrapper` already holds both things the menu needs — the editor API and the backdrops controller (`App.tsx` ~lines 397 / 405):

```tsx
const excalidrawAPI = useExcalidrawAPI();
const backdrops = useBackdropPanel(excalidrawAPI);
```

Add the bar as a child of the existing `<Excalidraw …>` element, next to the other GoodNotes children:

```tsx
<Excalidraw
/* …existing props… */
>
  {/* …existing children… */}

  <ObjectMenu excalidrawAPI={excalidrawAPI} onOpenBackdrop={backdrops.open} />
</Excalidraw>
```

That is the whole change. The menu subscribes to the scene itself (`excalidrawAPI.onChange`), so nothing else has to be wired, and it accepts `excalidrawAPI === null` on the first render.

**Why inside `<Excalidraw>`:** every colour it uses is one of the editor's own CSS custom properties (`--island-bg-color`, `--text-primary-color`, `--default-border-color`, `--color-primary`, `--color-danger`, `--shadow-island-stronger`, `--zIndex-*`), and those are declared on the `.excalidraw` container and redeclared under `.theme--dark`. Mounted outside it, the bar falls back to unstyled defaults and stops following the theme. It is a plain absolutely/fixed-positioned child, so it does not join the editor's layout flow (unlike, say, the pen tray, which has to live in `<Footer>`).

### 1c. Layering and pointer events

| concern | how it is handled |
| --- | --- |
| above the canvas | `position: fixed` + `z-index: var(--zIndex-hyperlinkContainer, 7)` — above both canvases (1, 2) and the layer UI (4), the same band the editor's own hyperlink popup uses. |
| **never steals events when hidden** | the component returns `null` whenever there is no selection, so there is no invisible hit area at all — nothing to disable, nothing to leak clicks. |
| during canvas gestures | the bar also honours `pointer-events: var(--ui-pointerEvents, all)`, which the editor flips to `none` while a canvas gesture is running. |
| clicks on the bar | `onPointerDown` is stopped on the container, so pressing a button never reaches the canvas as a "start drawing / deselect" gesture. |

No change to `index.scss`, `vite.config.mts` or `package.json`.

---

## 2. Coordinating with `goodnotes/fuzzy-select` (the modal lasso)

The lasso is a **modal tool whose overlay covers the window** while it is on. Two UIs fighting over the same screen is avoided without the host doing anything: `ObjectMenu` subscribes to that module's activation store (`useFuzzySelectActive()`) and renders `null` for as long as the tool is active, then comes back when it is switched off. Verified in the browser: visible → lasso on → gone → lasso off → visible.

For any **other** modal surface you add (a tour, a full-screen dialog of your own, a second lasso-like tool), hide the bar explicitly:

```tsx
<ObjectMenu
  excalidrawAPI={excalidrawAPI}
  onOpenBackdrop={backdrops.open}
  hidden={isPdfExportOpen || isImportOpen}
/>
```

The menu already hides itself for the editor's own modal states — text editing, image cropping, linear-element editing, an open editor dialog, view mode, an element being drawn — so those need no wiring.

---

## 3. Props

| prop | type | meaning |
| --- | --- | --- |
| `excalidrawAPI` | `ExcalidrawImperativeAPI \| null` | the editor. `null` renders nothing. |
| `onOpenBackdrop` | `() => void` (optional) | opens the backdrops panel. Pass `useBackdropPanel(api).open`. **Omit it and the "Backdrop…" item disappears** — the menu never offers an action it cannot perform. |
| `hidden` | `boolean` (optional) | force the bar out of the way. |
| `onAction` | `(action: string) => void` (optional) | fired after an action ran (`"duplicate"`, `"delete"`, `"group"`, `"crop"`, `"replace"`, `"open-backdrop"`, `"convert-to-shape"`, `"set-stroke-colour"`, `"set-fill-colour"`, `"set-stroke-width"`, `"set-font-size"`), for toasts or telemetry. |

---

## 4. What it shows, and what each item does

| selection | items |
| --- | --- |
| image | Duplicate · Backdrop… · Crop · Replace · Delete |
| freedraw / ink | Colour · Width · Convert to shape¹ · Duplicate · Delete |
| text | Size · Colour · Duplicate · Delete |
| shape (rectangle / diamond / ellipse) | Fill · Stroke · Width · Duplicate · Delete |
| 2+ elements | Group² · Duplicate · Delete |
| anything else (arrow, line, frame, embed…) | Duplicate · Delete |

¹ only when the editor's own shape recognizer actually recognizes the stroke (`recognizeShape(...) !== "freedraw"`); ² only when the elements are not already exactly one group — the editor's own Ctrl+G rule.

All mutations go through `newElementWith` (so `version` / `versionNonce` / `updated` are bumped and the change survives reconciliation, sync and persistence) and are committed with `CaptureUpdateAction.IMMEDIATELY`, i.e. **every menu action is one Ctrl+Z step**.

- Duplicate uses the editor's own `duplicateElements("in-place")`, the same helper `actionDuplicateSelection` uses (groups, bound labels and frame children follow, seeds randomized, z-order preserved).
- Delete marks elements `isDeleted: true` (plus their bound labels) exactly as the editor does, rather than removing them from the array.
- Crop sets `croppingElementId`, handing over to the editor's native crop editor.
- Replace opens an image picker, registers the bytes through `addFiles()` with a content-hashed (SHA-1) `fileId` — the same `BinaryFileData` shape image drops produce, so it survives a reload — keeps x/y/width, re-derives height from the new aspect ratio, and clears any stale crop and any baked `customData.goodnotes.backdrop`.
- Convert to shape replaces the stroke in place with the recognized element, keeping its colour, opacity and (doubled, because freedraw uses a halved scale) stroke width.

---

## 5. Headless use

Everything is exported, so a taskbar, a shortcut or a test can call the actions without the bar:

```ts
import {
  duplicateSelection,
  deleteSelection,
  setStrokeColor,
  useSelectedElements,
} from "./goodnotes/object-menu";

duplicateSelection(excalidrawAPI);
setStrokeColor(excalidrawAPI, "#e03131");

// or just follow the selection yourself:
const selection = useSelectedElements(excalidrawAPI);
// → { kind, elements, sceneBounds, viewportBounds, viewport, theme, … } | null
```

`useSelectedElements` coalesces `onChange` bursts into one recomputation per animation frame and only commits when a signature (ids + kind + box rounded to half a pixel + element versions + theme) changed, so the value is referentially stable and safe in dependency arrays.

---

## 6. Accessibility

`role="toolbar"` with an accessible name; real `<button type="button">`s, each with an `aria-label`; all tabbable once a selection exists; Left/Right/Home/End move focus along the bar; Escape closes an open sub-row and then dismisses the menu by clearing the selection; `:focus-visible` paints a visible ring (doubly-scoped so it beats the editor's global `button:focus-visible { outline: transparent }`); colour contrast comes from the theme tokens in both light and dark; the entrance animation is dropped under `@media (prefers-reduced-motion: reduce)`.
