# Integration — Active Tool Menu (`goodnotes/tool-menu`)

> **Changed again (chrome reduction):** the default is now `placement="anchored"` — a **compact popover pinned to the tool button that opened it**, portalled onto `document.body` and mounted only while open. The docked band cost 1194×53 px (62,685 px²) of permanent chrome on an iPad Pro 11"; the popover costs **0 px² when closed**.
>
> - It opens when you tap the tool that is **already active** (`NavBar` / `FloatingBar` → `onActiveToolMenu(tool, anchorElement)` → `toolMenu.onToolSelect(tool, anchor)`). Selecting a _different_ tool just switches tool, as on paper.
> - It dismisses on an outside click, on <kbd>Esc</kbd>, and **as soon as a mark is made** (element count rises).
> - It is a `role="dialog"` with a focus trap; <kbd>Esc</kbd> and the close button return focus to the anchor, while dismissal caused by going back to the page deliberately does **not** move focus (`onClose({ restoreFocus: false })`).
> - Content is two rows — colours and widths, nothing nested. Everything else for the tool is behind **More**, which makes the _same_ popover taller rather than opening a submenu.
> - `placement="docked"` (the band) and `placement="floating"` (the edge-snapped overlay) are unchanged and still selectable; the header button cycles anchored → docked → floating, and the choice persists in `localStorage` and is subscribable (`subscribeToolMenuPlacement`).
> - Because it portals itself, `<ToolMenu {...toolMenu.menuProps} />` may be rendered anywhere in the tree; it no longer has to sit between the bar and `.gn-shell-body`. `menuProps` now carries `anchor`.

> **Changed again (finer widths + hidden tools):** the Width row is now a **continuous control** — five one-tap stops (`0.2` / `0.5` / `1` / `2` / `3.5`) plus a real `<input type="range" min="0.1" max="6" step="0.1">` with a numeric readout. The old three keyed widths are still exactly reachable as three points on it. Behind **More**, a new **More tools** row exposes the **laser pointer** and the **eyedropper**, two things the engine has had all along and the bar never surfaced. Neither addition costs a single pixel when the popover is closed.

Self-contained app-level module, built on the documented `ExcalidrawImperativeAPI` surface (`setActiveTool`, `updateScene({ appState })`, `onChange`, `getAppState`).

It depends on two small `packages/` additions, both documented in `goodnotes/pens/INTEGRATION.md`:

1. `appState.currentItemCustomData` — what makes a freedraw stroke a highlighter (already on `main`).
2. `appState.currentItemFreedrawStrokeWidth` — what makes a freedraw stroke take an **exact** width instead of one of three. 3 files, **+23 lines, 0 removed**, default `null` = today's behaviour exactly. See `goodnotes/pens/INTEGRATION.md` § 5a for the line-by-line justification.

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

### 1g. Widths: what you must change, and what you need not

**Nothing is required.** `useActiveToolMenu` (already created at `App.tsx:433`) now also owns the ink width:

- on mount it calls `restoreRememberedInkWidth(excalidrawAPI)` — idempotent, and a no-op once an exact width is set, so it can never stomp a document's own saved `appState`;
- whenever the editor _arrives_ at an ink tool from anywhere (the nav bar, a keyboard shortcut, undo) it applies that tool's own remembered nib, so the highlighter never inherits the pen's 0.2.

Both are self-healing, which is why no `App.tsx` edit is needed.

**One thing worth changing, though.** `NavBar` activates ink through `goodnotes/taskbar/tools.ts`, whose private `applyInk()` writes only `currentItemStrokeWidthKey` (`snapStrokeWidth(preset.width)`) and never the exact width. The consequence is mild but real: a `PenPreset` handed to the bar has its `width` **rounded to 0.5 / 1 / 2**, and is then immediately overridden by the remembered nib. If you want a bar preset's exact width to win, route the bar's ink activation through this module instead — one import, same signature shape:

```tsx
// excalidraw-app/goodnotes/taskbar/tools.ts — inside activateTool()
import { applyPreset } from "../tool-menu";

case "pen":
  applyPreset(api, options.pen ?? DEFAULT_PEN);
  return;
case "highlighter":
  applyPreset(api, options.highlighter ?? DEFAULT_HIGHLIGHTER);
  return;
```

`applyPreset` sets the tool, the colour, the **exact** width, the opacity and the highlighter marker, and records the width as that tool's remembered nib. `goodnotes/taskbar/` is not owned by this module, so the change is left to you.

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

// ── continuous ink width ───────────────────────────────────────────────────
// applyInk({ width })  writes the EXACT width (clamped to 0.1 – 6) and keeps
// currentItemStrokeWidthKey on the nearest key.
// applyInk({ widthKey }) writes the key and CLEARS the exact width.
const readInkWidth: (appState) => number;             // what a stroke will use
const applyRememberedInkWidth: (api, "pen"|"highlighter") => number | null;
const restoreRememberedInkWidth: (api) => void;       // idempotent; on mount

// ── engine tools the bar never surfaced ────────────────────────────────────
const EXTRA_TOOLS: readonly ["laser", "lasso", "hand"];
const POPOVER_EXTRA_TOOLS: readonly ["laser"];        // what the popover shows
const EXTRA_TOOL_LABELS: Record<ExtraToolId, string>;
const activateExtraTool: (api, tool: ExtraToolId) => void;
const extraToolFromAppState: (appState) => ExtraToolId | null;
const openEyeDropper: (api, container?) => boolean;   // false = no editor found
const setObjectSnapping: (api, enabled: boolean) => void;
const isObjectSnappingEnabled: (appState) => boolean;
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
PENS_STORAGE_KEY, PEN_WIDTHS, PEN_WIDTH_STOPS, PEN_WIDTH_STEP,
PEN_WIDTH_STORAGE_KEY, MIN_PEN_WIDTH, MAX_PEN_WIDTH, clampPenWidth,
formatPenWidth, loadPenPresets, savePenPresets, resetPenPresets,
loadPenWidths, savePenWidth, snapPenWidth, type PenPreset;
```

---

## 3. What each control is actually wired to

Every control writes a real `AppState` key that Excalidraw reads when it creates an element. Verified in the running app by reading `getAppState()` back after the click (see § 5).

| Panel | Control | Editor state |
| --- | --- | --- |
| pen / highlighter | 5 ink swatches + `+` custom picker | `currentItemStrokeColor` |
| pen / highlighter | width: 5 stops + a 0.1–6.0 slider | `currentItemFreedrawStrokeWidth` (exact), with `currentItemStrokeWidthKey` kept at the nearest key |
| pen / highlighter | saved-pen chips | tool + all three of the above, from `goodnotes-pens` |
| pen | nib: Fountain / Ballpoint | `currentItemStrokeVariability` = `"variable"` / `"constant"` |
| highlighter | opacity 10–100 | `currentItemOpacity` |
| highlighter | (activation) | `currentItemCustomData = { goodnotes: { highlighter: true } }` |
| shape | 5 shape kinds | `setActiveTool({ type })` |
| shape | stroke / fill swatches | `currentItemStrokeColor` / `currentItemBackgroundColor` |
| shape | width, edges, opacity | `currentItemStrokeWidthKey`, `currentItemRoundness`, `currentItemOpacity` |
| text | colour, size, font, opacity | `currentItemStrokeColor`, `currentItemFontSize`, `currentItemFontFamily`, `currentItemOpacity` |
| all (behind **More**) | Laser pointer | `setActiveTool({ type: "laser" })` |
| all (behind **More**) | Match colour | Excalidraw's eye dropper, via its own <kbd>Shift</kbd>+<kbd>S</kbd> handler |
| all | "Keep tool active" | `activeTool.locked` (Excalidraw's padlock) |

### What is NOT wired, and why

Three things the brief asked for have no honest backing in this editor. None of them ships as a dead control; the pen and eraser panels say so in plain text.

1. **Pencil nib.** `fountain` and `ballpoint` map cleanly onto `currentItemStrokeVariability` (`variable` tapers the stroke with pressure/velocity, `constant` does not — it is Excalidraw's own "pressure" setting). A _pencil_ needs a grain/texture pass in the freedraw renderer; there is no element property, no `appState` key and no `customData` hook for it. Shipping a third radio would have been a dial wired to nothing, so the panel ships two and prints one sentence explaining the third's absence. _If you want it:_ `packages/element/src/shape.ts` (`getFreeDrawShape`) plus a per-element flag, i.e. a real renderer change.

2. **Eraser size, and "erase highlighter only".** Excalidraw's eraser is an _element_ eraser, not a raster one: `App.handleCanvasPointerMove` hit-tests elements under the cursor and `eraseElements()` deletes whole elements. There is no radius and no predicate — nothing in `AppState` to set. _If you want them:_ both are a `packages/excalidraw/components/App.tsx` change (a radius on the eraser hit test, and a filter in `elementsPendingErasure`/`eraseElements` that could read the same `customData.goodnotes.highlighter` marker). That is core-editor work and is explicitly outside this module's ownership, so it was not done.

3. **Highlighter "straight line" toggle.** The obvious implementation is to switch to the `line` tool while the highlighter is active. It does not work: `currentItemCustomData` is only stamped onto **freedraw** elements (`App.tsx`, the `newFreeDrawElement({ … })` call), so a `line` drawn in "highlighter mode" would come out as an ordinary translucent line that _washes out_ the ink underneath instead of multiplying over it — visibly different from every other highlighter stroke in the document. A toggle that silently changes the blend mode is worse than no toggle. _If you want it:_ one line in the linear-element branch of `handleCanvasPointerDown`, mirroring the freedraw one, plus the `isHighlighterElement` check already present in `renderElement.ts`.

Smaller, deliberate omissions: the shape and text panels have no custom-colour `+` (the five stroke picks plus the editor's own property panel cover it), and no global `1`–`9` preset shortcuts (see § 1e).

### Engine tools we did NOT surface, and why

`packages/excalidraw/actions/` and `components/Toolbar.tsx` were read end to end. Everything the engine implements and the GoodNotes bar hides was considered; two shipped, the rest did not, and each refusal below is a judgement call you can overrule.

**Shipped (behind More, 0 px of resting chrome):**

- **Laser pointer** — `setActiveTool({ type: "laser" })`. Genuinely the best of the lot for a student: pointing at your own notes while explaining them in a study group, with no mark left behind. Measured: `appState.activeTool.type` becomes `"laser"`, the trail SVG gains a path with a 1600-character `d` during the drag and is back to 0 paths 1.6 s later, and the element count does not move.
- **Eyedropper ("Match colour")** — matching the ink you used three pages ago. `App.openEyeDropper` is private and the imperative API has no wrapper, so this goes through the editor's own <kbd>Shift</kbd>+<kbd>S</kbd> handler: a `KeyboardEvent` dispatched on `.excalidraw-container`, i.e. literally the path a user pressing the key takes, with no `packages/` patch and no reach into editor internals. Measured: the overlay (`.excalidraw-eye-dropper-backdrop` / `-preview`) appears, and a pick moves `currentItemStrokeColor` from `#1e1e1e` to `#000000`.

**Left out, with the reason:**

| Feature | Verdict |
| --- | --- |
| **Shape snapping** (`objectsSnapModeEnabled`) | `setObjectSnapping()` is exported and **does** flip the real `appState` flag (measured `false → true`), but the popover ships no toggle. Reason: in this app a click on a shape with the selection tool selects nothing (measured: `selectedElementIds` stays `{}` after clicking a rectangle's centre at the correct screen coordinates), so nothing can be dragged and `appState.snapLines` never leaves `0`. A switch whose effect cannot be observed is a dead control. The export is there for whenever element selection works; alignment snapping also has thin value in a handwriting-first app. |
| **Pan / hand tool** | In `EXTRA_TOOLS` and `activateExtraTool`, but **not** in the popover. Measured: the paged surface pins the viewport — `scrollX/scrollY` read `378.07 / 21.07` before _and_ after a wheel scroll, a space-drag and a hand-tool drag. A Pan button would be a dial wired to nothing today; it becomes real the moment a free-scrolling (whiteboard) mode ships. |
| **Lasso select** | Real and useful — and the nav bar already has it ("Lasso select (smart selection)"). A second entry behind More is duplicate chrome. Still in `EXTRA_TOOLS`. |
| **Search (`actionToggleSearchMenu`)** | Only finds _typed_ text. In a handwriting-first notebook that is a small slice of the page, and it opens Excalidraw's own sidebar, which fights the GoodNotes shell. Not worth the chrome. |
| **Grid mode (`actionToggleGridMode`)** | The paper templates (`goodnotes/paper`) already draw ruling, grid and dots per page. A second, differently-aligned grid on top would be confusing. |
| **Zen mode / view mode** | The shell _is_ zen mode — it is already on. |
| **Stats panel, minimap, "show hints", text wrap, midpoint snapping, shape switch, bucket fill, frames, embeddables** | Each is either a developer/diagram affordance or already reachable, and none earns a line in a note-taker's tool popover. |

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
