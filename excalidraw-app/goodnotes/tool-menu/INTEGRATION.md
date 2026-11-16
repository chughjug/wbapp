# Integration — Active Tool Menu (`goodnotes/tool-menu`)

Self-contained app-level module. **No `packages/` patch is required** — it is
built entirely on the documented `ExcalidrawImperativeAPI` surface
(`setActiveTool`, `updateScene({ appState })`, `onChange`, `getAppState`).

It does depend on one `packages/` change that `goodnotes/pens` already shipped:
`appState.currentItemCustomData`, which is what makes a freedraw stroke a
highlighter. That is already on `main` (`packages/excalidraw/types.ts`,
`appState.ts`, `components/App.tsx`, `element/src/renderElement.ts`).

---

## 1. `App.tsx` changes — exact diff

### 1a. Import

```tsx
import { ToolMenu, useActiveToolMenu } from "./goodnotes/tool-menu";
```

### 1b. Create the controller next to the other GoodNotes hooks

`excalidrawAPI` already exists in `ExcalidrawWrapper` (`const excalidrawAPI =
useExcalidrawAPI();`, ~line 397). Add below it:

```tsx
const toolMenu = useActiveToolMenu({ excalidrawAPI });
```

`excalidrawAPI` may be `null` on the first render — the hook handles that and
subscribes as soon as the API arrives.

### 1c. Render the panel

It is a fixed-position, click-through layer, so it can go either inside or
outside `<Excalidraw>`. Simplest is next to `<Taskbar>` (~line 1309), i.e.
**after** the closing `</Excalidraw>`:

```tsx
      </Excalidraw>
      <ToolMenu {...toolMenu.menuProps} />
      <Taskbar … />
```

The panel's root carries the `excalidraw` (and `theme--dark`) class itself, so
Excalidraw's CSS custom properties are in scope wherever it is mounted. The
theme is read from `appState.theme`; pass `scopeTheme="light" | "dark"` to
override, or `scopeTheme={false}` if you mount it inside `<Excalidraw>` and
would rather not have the extra class.

### 1d. Wire the nav bar (the other agent's three-zone bar)

The hook exposes a **callback-shaped entry point**; hand it straight to a tool
button's `onClick`:

```tsx
<button onClick={(event) => toolMenu.onToolSelect("pen", event)}>Pen</button>
```

`onToolSelect(tool, event)`

- activates the tool in the editor (`freedraw` / `freedraw` + highlighter
  marker / `eraser` / `rectangle` / `text`),
- opens the panel on that tool,
- **closes** it if it was already open on the same tool (tapping the active
  tool twice is how a GoodNotes tool button behaves),
- remembers `event.currentTarget` as the trigger, so Escape and the close
  button return focus there.

Pass the element instead of the event if you prefer:
`toolMenu.onToolSelect("pen", buttonRef.current)`.

And the imperative pair, for anything else:

```tsx
toolMenu.open("highlighter", { trigger: buttonEl }); // open (and activate)
toolMenu.open();                                      // open on the current tool
toolMenu.close();                                     // close + restore focus
toolMenu.toggle("eraser", { trigger: buttonEl });
toolMenu.isOpen;                                      // for the bar's own state
toolMenu.tool;                                        // the editor's real tool
```

### 1e. Retiring the PenTray

This panel replaces `goodnotes/pens`' `PenTray` and reads/writes the **same**
`goodnotes-pens` localStorage payload through `goodnotes/pens/presets.ts`, so
saved pens are not orphaned. To retire the tray, delete these two lines from
`App.tsx` (~1163) and the `PenTray` import:

```tsx
<Footer>
  <PenTray excalidrawAPI={excalidrawAPI} />
</Footer>
```

Note the tray also owns the global `1`–`9` preset shortcuts. This module does
**not** install any global key handler (it would collide with the nav bar and
with Excalidraw's own digit shortcuts). If you want the shortcuts back, call
`applyPreset(excalidrawAPI, preset)` from the host.

### 1f. Nothing else

No provider, no context, no state lifting. Position and presets persist
themselves.

---

## 2. Public API

```ts
// excalidraw-app/goodnotes/tool-menu/index.ts

// ── component ───────────────────────────────────────────────────────────────
interface ToolMenuProps {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  open: boolean;
  tool: ToolMenuToolId | null;      // "pen"|"highlighter"|"eraser"|"shape"|"text"
  onClose: () => void;
  onToolChange?: (tool: ToolMenuToolId) => void;
  scopeTheme?: "light" | "dark" | false;   // default: follow appState.theme
  className?: string;
}
const ToolMenu: (props: ToolMenuProps) => JSX.Element | null;

// ── hook ────────────────────────────────────────────────────────────────────
interface UseActiveToolMenuOptions {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  openOnToolChange?: boolean; // default true
  disabled?: boolean;         // default false
}
interface ActiveToolMenuController {
  tool: ToolMenuToolId | null;
  isOpen: boolean;
  open: (tool?, { trigger?, shape? }?) => void;
  close: () => void;
  toggle: (tool?, { trigger?, shape? }?) => void;
  onToolSelect: (tool, eventOrElement?) => void;
  menuProps: Pick<ToolMenuProps,
    "excalidrawAPI" | "open" | "tool" | "onClose" | "onToolChange">;
}
const useActiveToolMenu: (o: UseActiveToolMenuOptions) => ActiveToolMenuController;

// ── headless editor driving (same code path the panel's controls use) ───────
const activateTool: (api, tool, opts?: { locked?; shape? }) => void;
const applyInk: (api, { color?, widthKey?, opacity?, variability? }) => void;
const applyShapeStyle: (api, { strokeColor?, backgroundColor?, widthKey?,
                               fillStyle?, roundness?, opacity? }) => void;
const applyTextStyle: (api, { color?, fontSize?, fontFamily?, opacity? }) => void;
const applyPreset: (api, preset: PenPreset) => void;
const setToolLocked: (api, locked: boolean) => void;
const toolFromAppState: (appState) => ToolMenuToolId | null;
const shapeFromAppState: (appState) => ToolMenuShapeId | null;
const isHighlighterActive: (appState) => boolean;
const widthKeyToPresetWidth: (key: ToolMenuWidthKey) => number;
const HIGHLIGHTER_MARKER: { goodnotes: { highlighter: true } };
const SHAPE_TOOL_TYPES: readonly ["rectangle","ellipse","diamond","arrow","line"];

// ── placement model (pure; exported for tests / host resets) ────────────────
const TOOL_MENU_POSITION_STORAGE_KEY: "goodnotes-tool-menu-position";
const DEFAULT_TOOL_MENU_POSITION: ToolMenuPosition; // left edge, 68% down
const TOOL_MENU_EDGES: readonly ["left","right","bottom"];
const EDGE_MARGIN: 16;
const loadToolMenuPosition / saveToolMenuPosition / placementToPixels /
      snapToEdge / moveByKeyboard / describePosition;

// ── re-exported from goodnotes/pens (not redefined) ─────────────────────────
PENS_STORAGE_KEY, PEN_WIDTHS, loadPenPresets, savePenPresets,
resetPenPresets, snapPenWidth, type PenPreset;
```

---

## 3. What each control is actually wired to

Every control writes a real `AppState` key that Excalidraw reads when it creates
an element. Verified in the running app by reading `getAppState()` back after
the click (see § 5).

| Panel | Control | Editor state |
| --- | --- | --- |
| pen / highlighter | 5 ink swatches + `+` custom picker | `currentItemStrokeColor` |
| pen / highlighter | 3 widths | `currentItemStrokeWidthKey` (→ `FREEDRAW_STROKE_WIDTH` 0.5/1/2) |
| pen / highlighter | saved-pen chips | tool + all three of the above, from `goodnotes-pens` |
| pen | nib: Fountain / Ballpoint | `currentItemStrokeVariability` = `"variable"` / `"constant"` |
| highlighter | opacity 10–100 | `currentItemOpacity` |
| highlighter | (activation) | `currentItemCustomData = { goodnotes: { highlighter: true } }` |
| shape | 5 shape kinds | `setActiveTool({ type })` |
| shape | stroke / fill swatches | `currentItemStrokeColor` / `currentItemBackgroundColor` |
| shape | width, edges, opacity | `currentItemStrokeWidthKey`, `currentItemRoundness`, `currentItemOpacity` |
| text | colour, size, font, opacity | `currentItemStrokeColor`, `currentItemFontSize`, `currentItemFontFamily`, `currentItemOpacity` |
| all | "Keep tool active" | `activeTool.locked` (Excalidraw's padlock) |

### What is NOT wired, and why

Three things the brief asked for have no honest backing in this editor. None of
them ships as a dead control; the pen and eraser panels say so in plain text.

1. **Pencil nib.** `fountain` and `ballpoint` map cleanly onto
   `currentItemStrokeVariability` (`variable` tapers the stroke with
   pressure/velocity, `constant` does not — it is Excalidraw's own "pressure"
   setting). A *pencil* needs a grain/texture pass in the freedraw renderer;
   there is no element property, no `appState` key and no `customData` hook for
   it. Shipping a third radio would have been a dial wired to nothing, so the
   panel ships two and prints one sentence explaining the third's absence.
   *If you want it:* `packages/element/src/shape.ts` (`getFreeDrawShape`) plus a
   per-element flag, i.e. a real renderer change.

2. **Eraser size, and "erase highlighter only".** Excalidraw's eraser is an
   *element* eraser, not a raster one: `App.handleCanvasPointerMove` hit-tests
   elements under the cursor and `eraseElements()` deletes whole elements. There
   is no radius and no predicate — nothing in `AppState` to set.
   *If you want them:* both are a `packages/excalidraw/components/App.tsx`
   change (a radius on the eraser hit test, and a filter in
   `elementsPendingErasure`/`eraseElements` that could read the same
   `customData.goodnotes.highlighter` marker). That is core-editor work and is
   explicitly outside this module's ownership, so it was not done.

3. **Highlighter "straight line" toggle.** The obvious implementation is to
   switch to the `line` tool while the highlighter is active. It does not work:
   `currentItemCustomData` is only stamped onto **freedraw** elements
   (`App.tsx`, the `newFreeDrawElement({ … })` call), so a `line` drawn in
   "highlighter mode" would come out as an ordinary translucent line that
   *washes out* the ink underneath instead of multiplying over it — visibly
   different from every other highlighter stroke in the document. A toggle that
   silently changes the blend mode is worse than no toggle.
   *If you want it:* one line in the linear-element branch of
   `handleCanvasPointerDown`, mirroring the freedraw one, plus the
   `isHighlighterElement` check already present in `renderElement.ts`.

Smaller, deliberate omissions: the shape and text panels have no custom-colour
`+` (the five stroke picks plus the editor's own property panel cover it), and
no global `1`–`9` preset shortcuts (see § 1e).

---

## 4. Behaviour worth knowing

- **Opens from the editor, not from the bar.** `useActiveToolMenu` subscribes
  with `excalidrawAPI.onChange` and derives the tool from
  `appState.activeTool` + the highlighter marker, so pressing `p`, `r`, `e`,
  `8`… on the keyboard retargets and opens the panel exactly like a tap. For
  tools with nothing genuine to offer (selection, lasso, hand, frame, laser,
  image, embeddable) the panel *closes* rather than showing an empty shell.
  Pass `openOnToolChange: false` to make opening purely explicit.
- **Draggable, remembered per edge.** Drag the grip; on release the panel snaps
  to the nearest of the left / right / bottom edges, and the position *along*
  that edge is stored per edge in `localStorage` as a 0–1 ratio (so it survives
  resize and rotation). Default is **left edge, 68% down** — never the centre of
  an edge, and measured never to overlap the centre of the canvas.
- **Keyboard drag.** With the grip focused: the arrows running along the current
  edge move the panel 24px (96px with Shift); the arrows running across dock it
  to that edge; `ArrowDown` at the bottom of a vertical edge wraps onto the
  bottom edge and `ArrowUp` on the bottom edge returns to the nearer vertical
  edge, so every edge is reachable with arrows alone. Each move is announced in
  an `aria-live="polite"` region and reflected in the grip's accessible name.
- **Live preset editing.** Click a saved-pen chip and it becomes the live
  target: subsequent colour / width / opacity changes are written back onto that
  preset and persisted to `goodnotes-pens` immediately. "Reset pens" restores
  the shipped defaults via `resetPenPresets()`.
- **Escape** closes and returns focus to the trigger that opened the panel.
  Clicking the canvas does *not* close it — it is a persistent surface, like
  GoodNotes'.

## 5. Accessibility

Native semantics throughout: `<fieldset>`/`<legend>` groups of real
`<input type="radio">` for every swatch, width, nib, shape, size and font
(arrow-key roving and group semantics come free); `<button aria-pressed>` for
preset chips; `role="dialog"` + `aria-labelledby` on the panel; an accessible
name on every single control (audited in the browser — zero unnamed buttons or
inputs); `:focus-visible` rings at specificity (0,3,0) so they beat Excalidraw's
own 1px `box-shadow` override (measured: `2px solid rgb(165, 216, 255)`);
`@media (prefers-reduced-motion: reduce)` drops the transitions (measured:
`transition-property: none`); Escape closes and restores focus.

Colour comes only from Excalidraw's custom properties, verified in both themes:
panel `#fff` / `rgb(35,35,41)`, body text `rgb(27,27,31)` / `rgb(227,227,232)`,
group labels `rgb(73,80,87)` / `rgb(233,236,239)`. `--color-muted` is
deliberately unused — it is a *background* grey and fails as text; de-emphasised
text uses `--input-label-color`.
