# Integration — Active Tool Menu (`goodnotes/tool-menu`)

> **Changed again (chrome reduction):** the default is now `placement="anchored"` — a **compact popover pinned to the tool button that opened it**, portalled onto `document.body` and mounted only while open. The docked band cost 1194×53 px (62,685 px²) of permanent chrome on an iPad Pro 11"; the popover costs **0 px² when closed**.
>
> - It opens when you tap the tool that is **already active** (`NavBar` / `FloatingBar` → `onActiveToolMenu(tool, anchorElement)` → `toolMenu.onToolSelect(tool, anchor)`). Selecting a *different* tool just switches tool, as on paper.
> - It dismisses on an outside click, on <kbd>Esc</kbd>, and **as soon as a mark is made** (element count rises).
> - It is a `role="dialog"` with a focus trap; <kbd>Esc</kbd> and the close button return focus to the anchor, while dismissal caused by going back to the page deliberately does **not** move focus (`onClose({ restoreFocus: false })`).
> - Content is two rows — colours and widths, nothing nested. Everything else for the tool is behind **More**, which makes the *same* popover taller rather than opening a submenu.
> - `placement="docked"` (the band) and `placement="floating"` (the edge-snapped overlay) are unchanged and still selectable; the header button cycles anchored → docked → floating, and the choice persists in `localStorage` and is subscribable (`subscribeToolMenuPlacement`).
> - Because it portals itself, `<ToolMenu {...toolMenu.menuProps} />` may be rendered anywhere in the tree; it no longer has to sit between the bar and `.gn-shell-body`. `menuProps` now carries `anchor`.

Self-contained app-level module. **No `packages/` patch is required** — it is built entirely on the documented `ExcalidrawImperativeAPI` surface (`setActiveTool`, `updateScene({ appState })`, `onChange`, `getAppState`).

It does depend on one `packages/` change that `goodnotes/pens` already shipped: `appState.currentItemCustomData`, which is what makes a freedraw stroke a highlighter. That is already on `main` (`packages/excalidraw/types.ts`, `appState.ts`, `components/App.tsx`, `element/src/renderElement.ts`).

---

## 1. `App.tsx` changes — exact diff

### 1a. Import

```tsx
import { ToolMenu, useActiveToolMenu } from "./goodnotes/tool-menu";
```

### 1b. Create the controller next to the other GoodNotes hooks

`excalidrawAPI` already exists in `ExcalidrawWrapper` (`const excalidrawAPI = useExcalidrawAPI();`, ~line 397). Add below it:

```tsx
const toolMenu = useActiveToolMenu({ excalidrawAPI });
```

`excalidrawAPI` may be `null` on the first render — the hook handles that and subscribes as soon as the API arrives.

### 1c. Render the panel — as band 3 of the shell

**This is the change to make.** The panel is now a flow-layout band, so it must be a child of `.gn-shell-layout`, _between_ `<NavBar …/>` and `<div className="gn-shell-body">`. Today it is rendered as a floating sibling **after** the body (just before `<ObjectMenu …/>`, ~line 1396); move that one element up:

```diff
       <NavBar
         …
       />
+      {/* band 3 — the active tool's settings, docked under the bar */}
+      <ToolMenu {...toolMenu.menuProps} />
-      {/* band 3 — page panel + canvas */}
+      {/* band 4 — page panel + canvas */}
       <div className="gn-shell-body">
         <PagePanel … />
         <div className="gn-shell-canvas">
           …
         </div>
       </div>
-      <ToolMenu {...toolMenu.menuProps} />
       <ObjectMenu … />
```

Nothing else changes: no props to add, no layout classes to write. The band is `flex: 0 0 auto` inside `gn-shell-layout`, so it takes its own height and `gn-shell-body` (page panel + canvas) shrinks to fit below it. Measured at 1400×900: nav bar `y 37.7 → 89.7`, band `y 89.7 → 142.2` full-width, body `y 142.2 → 900` — contiguous, zero overlap with the page panel or the canvas.

Where the element sits in the tree only matters for `"docked"`. In `"floating"` the root is `position: fixed` and can be mounted anywhere; the single call site above works for both, which is why the band position is the one to use.

**It unmounts when closed.** Like before, the panel renders `null` when no supported tool is active, so the band disappears and the canvas grows into the space. If you would rather the canvas never resized, give `.gn-shell-layout` a reserved row — but the band's height is tool-dependent (52px for pen, more when "More" is open), so reserving is a worse trade than the reflow.

### 1d. Wire the nav bar (the other agent's three-zone bar)

The hook exposes a **callback-shaped entry point**; hand it straight to a tool button's `onClick`:

```tsx
<button onClick={(event) => toolMenu.onToolSelect("pen", event)}>Pen</button>
```

`onToolSelect(tool, event)`

- activates the tool in the editor (`freedraw` / `freedraw` + highlighter marker / `eraser` / `rectangle` / `text`),
- opens the panel on that tool,
- **closes** it if it was already open on the same tool (tapping the active tool twice is how a GoodNotes tool button behaves),
- remembers `event.currentTarget` as the trigger, so Escape and the close button return focus there.

Pass the element instead of the event if you prefer: `toolMenu.onToolSelect("pen", buttonRef.current)`.

And the imperative pair, for anything else:

```tsx
toolMenu.open("highlighter", { trigger: buttonEl }); // open (and activate)
toolMenu.open(); // open on the current tool
toolMenu.close(); // close + restore focus
toolMenu.toggle("eraser", { trigger: buttonEl });
toolMenu.isOpen; // for the bar's own state
toolMenu.tool; // the editor's real tool
```

### 1e. Retiring the PenTray

This panel replaces `goodnotes/pens`' `PenTray` and reads/writes the **same** `goodnotes-pens` localStorage payload through `goodnotes/pens/presets.ts`, so saved pens are not orphaned. To retire the tray, delete these two lines from `App.tsx` (~1163) and the `PenTray` import:

```tsx
<Footer>
  <PenTray excalidrawAPI={excalidrawAPI} />
</Footer>
```

Note the tray also owns the global `1`–`9` preset shortcuts. This module does **not** install any global key handler (it would collide with the nav bar and with Excalidraw's own digit shortcuts). If you want the shortcuts back, call `applyPreset(excalidrawAPI, preset)` from the host.

### 1f. Nothing else

No provider, no context, no state lifting. Placement, edge position and presets persist themselves.

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
  placement?: ToolMenuPlacement;           // "docked" (default) | "floating"
  onPlacementChange?: (p: ToolMenuPlacement) => void;
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

// ── placement: docked band vs floating overlay ─────────────────────────────
type ToolMenuPlacement = "docked" | "floating";
const DEFAULT_TOOL_MENU_PLACEMENT: "docked";
const TOOL_MENU_PLACEMENTS: readonly ["docked", "floating"];
const TOOL_MENU_PLACEMENT_STORAGE_KEY: "goodnotes-tool-menu-placement";
const loadToolMenuPlacement: () => ToolMenuPlacement;   // never throws
const saveToolMenuPlacement: (p: ToolMenuPlacement) => boolean;

// ── edge model for placement="floating" (pure; tests / host resets) ────────
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

Every control writes a real `AppState` key that Excalidraw reads when it creates an element. Verified in the running app by reading `getAppState()` back after the click (see § 5).

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

Three things the brief asked for have no honest backing in this editor. None of them ships as a dead control; the pen and eraser panels say so in plain text.

1. **Pencil nib.** `fountain` and `ballpoint` map cleanly onto `currentItemStrokeVariability` (`variable` tapers the stroke with pressure/velocity, `constant` does not — it is Excalidraw's own "pressure" setting). A _pencil_ needs a grain/texture pass in the freedraw renderer; there is no element property, no `appState` key and no `customData` hook for it. Shipping a third radio would have been a dial wired to nothing, so the panel ships two and prints one sentence explaining the third's absence. _If you want it:_ `packages/element/src/shape.ts` (`getFreeDrawShape`) plus a per-element flag, i.e. a real renderer change.

2. **Eraser size, and "erase highlighter only".** Excalidraw's eraser is an _element_ eraser, not a raster one: `App.handleCanvasPointerMove` hit-tests elements under the cursor and `eraseElements()` deletes whole elements. There is no radius and no predicate — nothing in `AppState` to set. _If you want them:_ both are a `packages/excalidraw/components/App.tsx` change (a radius on the eraser hit test, and a filter in `elementsPendingErasure`/`eraseElements` that could read the same `customData.goodnotes.highlighter` marker). That is core-editor work and is explicitly outside this module's ownership, so it was not done.

3. **Highlighter "straight line" toggle.** The obvious implementation is to switch to the `line` tool while the highlighter is active. It does not work: `currentItemCustomData` is only stamped onto **freedraw** elements (`App.tsx`, the `newFreeDrawElement({ … })` call), so a `line` drawn in "highlighter mode" would come out as an ordinary translucent line that _washes out_ the ink underneath instead of multiplying over it — visibly different from every other highlighter stroke in the document. A toggle that silently changes the blend mode is worse than no toggle. _If you want it:_ one line in the linear-element branch of `handleCanvasPointerDown`, mirroring the freedraw one, plus the `isHighlighterElement` check already present in `renderElement.ts`.

Smaller, deliberate omissions: the shape and text panels have no custom-colour `+` (the five stroke picks plus the editor's own property panel cover it), and no global `1`–`9` preset shortcuts (see § 1e).

---

## 4. Behaviour worth knowing

- **Opens from the editor, not from the bar.** `useActiveToolMenu` subscribes with `excalidrawAPI.onChange` and derives the tool from `appState.activeTool` + the highlighter marker, so pressing `p`, `r`, `e`, `8`… on the keyboard retargets and opens the panel exactly like a tap. For tools with nothing genuine to offer (selection, lasso, hand, frame, laser, image, embeddable) the panel _closes_ rather than showing an empty shell. Pass `openOnToolChange: false` to make opening purely explicit.
- **Docked is the default.** The band sits in flow under the nav bar, spans the content width and overlaps nothing. It carries no drag handle and no edge model — there is nothing to drag a band to, so no dead affordance is shown (`[data-testid="gn-tool-menu-handle"]` simply does not exist while docked) and the live region / arrow-key drag go with it.
- **The band is a relayout, not a squeeze.** Each group becomes a compact _label over controls_ cell (`INK`, `WIDTH`, `NIB`, `SAVED PENS`, …), cells run in one row separated by vertical rules, the trailing cluster (More / Keep tool active / Undock / ×) is pinned right. Measured heights: 52px for pen, highlighter, eraser and text; 52px for shape at ≥1400px wide.
- **Overflow: a disclosure, never a submenu.** When the row no longer fits, it is clipped behind a soft right-edge fade and a **More** button appears; pressing it wraps the row onto as many lines as it needs (`aria-expanded`, `aria-controls` the row) and reveals the explanatory note. No control is moved into a nested menu — the whole point of the panel. Measured at 760px: pen clips, `More` shown, expanded band 208px tall with every control visible; at 420px the same, band still 52px collapsed.
- **Undock if you prefer floating.** The **Undock** button (both placements carry its counterpart) switches to `placement="floating"`: the original fixed overlay with the drag grip, edge snapping, per-edge `localStorage` memory (0–1 ratio, survives resize/rotation), the arrow-key drag with its `aria-live` announcements, and the default **left edge, 68% down**. The docked/floating choice itself persists under `goodnotes-tool-menu-placement`; pass the `placement` prop to override the stored choice and `onPlacementChange` to observe it.
- **Live preset editing.** Click a saved-pen chip and it becomes the live target: subsequent colour / width / opacity changes are written back onto that preset and persisted to `goodnotes-pens` immediately. "Reset pens" restores the shipped defaults via `resetPenPresets()`.
- **Escape** closes and returns focus to the trigger that opened the panel. Clicking the canvas does _not_ close it — it is a persistent surface, like GoodNotes'.

## 5. Accessibility

Native semantics throughout: `<fieldset>`/`<legend>` groups of real `<input type="radio">` for every swatch, width, nib, shape, size and font (arrow-key roving and group semantics come free); `<button aria-pressed>` for preset chips; `role="dialog"` + `aria-labelledby` on the panel; an accessible name on every single control (audited in the browser — zero unnamed buttons or inputs); `:focus-visible` rings at specificity (0,3,0) so they beat Excalidraw's own 1px `box-shadow` override (measured: `2px solid rgb(165, 216, 255)`); `@media (prefers-reduced-motion: reduce)` drops the transitions (measured: `transition-property: none`); Escape closes and restores focus.

Docked, the band's root is a `role="region"` labelled by its heading (not a `dialog` — it is a persistent, non-modal strip of the page chrome); floating, it stays a `role="dialog"`. Re-audited in the band at 1400px: **zero** unnamed buttons or inputs, focus ring measured `2px solid rgb(165, 216, 255)`, `transition-property: none` under `prefers-reduced-motion: reduce`, Escape closes the band and returns focus to the nav bar button that opened it (`#r1-pen`). At ≤640px the "Keep tool active" caption is clipped visually but stays in the accessibility tree as the checkbox's name.

Colour comes only from Excalidraw's custom properties, verified in both themes: band/panel `rgb(255,255,255)` / `rgb(35,35,41)`, body text `rgb(27,27,31)` / `rgb(227,227,232)`, group labels and the band title `rgb(73,80,87)` / `rgb(233,236,239)`, band bottom rule `rgb(197,197,208)` / `rgb(70,70,79)`. `--color-muted` is deliberately unused — it is a _background_ grey and fails as text; de-emphasised text uses `--input-label-color`.
