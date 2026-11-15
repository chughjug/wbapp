# Integrating the GoodNotes taskbar into `excalidraw-app/App.tsx`

The taskbar is self-contained: it owns nothing outside `excalidraw-app/goodnotes/taskbar/`, adds no dependencies, and reads only the public `ExcalidrawImperativeAPI`. Wiring it up is **one import, one element, and (optionally) a few callbacks**.

It deliberately does **not** implement fuzzy select, PDF import, PDF export or image backdrops. Each is an optional prop. Pass the callback and the control appears; omit it and the control is not rendered at all. So you can mount the bar today and attach those modules as they land, without touching anything in this folder.

---

## 1. Import

Next to the other `./goodnotes/*` imports in `App.tsx`:

```tsx
import { Taskbar } from "./goodnotes/taskbar";
```

## 2. Mount it

Render it as a **sibling of `<Excalidraw>`**, inside the `.excalidraw-app` wrapper `<div>` — i.e. immediately after `</Excalidraw>` (around line 1497 today, right before the `{isPdfExportOpen && …}` block):

```tsx
      </Excalidraw>

      <Taskbar
        excalidrawAPI={excalidrawAPI}
        suppressDefaultToolbar
        onExportPdf={() => setIsPdfExportOpen(true)}
        onAddPage={() => addPage()}
        pageCount={pages.length}
        currentPage={currentPageNumber ?? undefined}
      />
```

`excalidrawAPI` is already in scope in `ExcalidrawWrapper` (`const excalidrawAPI = useExcalidrawAPI();`, line ~403). `pages` and `addPage` come from the `usePages(excalidrawAPI)` call that is already there; `currentPageNumber` is already computed for the export dialog. **`null` is an acceptable value for `excalidrawAPI`** — the bar renders and no-ops until the editor mounts, so there is no need to guard it.

### Why a sibling and not a child of `<Excalidraw>`

`<Excalidraw>` only forwards _recognised_ children (`<Footer>`, `<MainMenu>`, `<Sidebar>`, …) through its tunnels. A bare child either gets dropped or, as `PenTray` discovered the hard way, joins the editor container's flex layout and pushes the canvas sideways. The taskbar avoids all of that: its root is `position: fixed`, centred with `left: 0; right: 0`, at `z-index: 125` (above Excalidraw's library/menu layers at 120/110, below its modal layer at 1000 so dialogs still cover it). The strip either side of the bar is `pointer-events: none`, so it never eats canvas clicks.

It also carries the `excalidraw` (and `theme--dark`) class names itself, exactly like `goodnotes/export`'s dialog does, because Excalidraw's CSS custom properties are scoped to `.excalidraw`. That is why it works outside the editor tree, and why the theme is correct wherever you mount it.

---

## 3. Suppressing Excalidraw's own toolbar — yes, it is needed, and here is how

**Investigated:** there is **no `UIOptions` switch** for the shapes toolbar. `UIOptions` only exposes `canvasActions`, `tools.image`, `dockedSidebarBreakpoint` and `getFormFactor` (`packages/excalidraw/types.ts`, `UIOptions`). `LayerUI` renders the toolbar whenever `defaultUIEnabled` is true (`packages/excalidraw/components/LayerUI.tsx` ~line 370), and the only props that remove it — `viewModeEnabled` and `zenModeEnabled` — change editor behaviour as well (view mode disables editing outright; zen mode also hides the stats, the footer and the shape-style panel, and the user can toggle it back on). Passing `defaultUIEnabled={false}`/`<Excalidraw>` without default UI would take the main menu and the style panel with it.

So the correct lever is CSS, and the module ships it:

```tsx
<Taskbar … suppressDefaultToolbar />
```

While mounted, that adds `gn-taskbar-suppress-default-ui` to `<body>` (exported as `SUPPRESS_DEFAULT_TOOLBAR_CLASS` if you prefer to manage the class yourself) and `Taskbar.scss` hides:

| selector | what it is |
| --- | --- |
| `.excalidraw .App-menu_top .shapes-section` | the desktop top toolbar (select / rect / arrow / …) |
| `.excalidraw--mobile .App-toolbar-content`, `.excalidraw--mobile .App-bottom-bar .App-toolbar` | the same tools, as the mobile bottom bar |

Everything else is left alone on purpose:

- **the top-left island** (hamburger menu + shape-style panel) still works — that is where colour, stroke style, opacity, layers and the main menu live, and the taskbar does not replace them;
- **the top-right island** (sidebar trigger, collaborators) still works;
- **the bottom-left island** (zoom, undo/redo) still works.

If you want those gone too, add your own rules in `App.tsx`'s stylesheet — do not edit `Taskbar.scss`, so this module stays drop-in replaceable.

Default is `false` (opt in), so mounting the bar is reversible in one word.

---

## 4. Wiring the four injected features

Each is optional and independent. The pattern is always the same: pass a callback, optionally pass a `…Disabled` flag while the feature is loading, and optionally pass a `…Active` flag if the feature is a _mode_ rather than a one-shot (that switches the control from a plain button to an `aria-pressed` toggle).

```tsx
<Taskbar
  excalidrawAPI={excalidrawAPI}
  suppressDefaultToolbar
  // --- fuzzy select (goodnotes/fuzzy-select, another module) -------------
  onFuzzySelect={fuzzySelect.run}
  fuzzySelectActive={fuzzySelect.isActive} // omit if it is a one-shot action
  fuzzySelectDisabled={!fuzzySelect.ready}
  // --- PDF import (goodnotes/pdf-import, another module) ------------------
  onImportPdf={() => setIsPdfImportOpen(true)}
  // --- PDF export (goodnotes/export — already in App.tsx) -----------------
  onExportPdf={() => setIsPdfExportOpen(true)}
  // --- image backdrops (goodnotes/backdrops, another module) --------------
  onOpenBackdrops={() => setIsBackdropPickerOpen(true)}
  backdropsActive={isBackdropPickerOpen}
  backdropsDisabled={!hasImageSelected}
  // --- pages (goodnotes/pages — already in App.tsx) -----------------------
  onAddPage={() => addPage()}
  pageCount={pages.length}
  currentPage={currentPageNumber ?? undefined}
/>
```

Nothing in `goodnotes/taskbar/` needs to change when those modules land.

---

## 5. Ink presets (optional)

The pen and highlighter slots default to a medium black freedraw and a 40% bold yellow highlighter. To make them follow the user's saved pens, pass a `PenPreset` (the type from `goodnotes/types.ts`):

```tsx
import { loadPenPresets } from "./goodnotes/pens";

const presets = useMemo(() => loadPenPresets(), []);

<Taskbar
  …
  penPreset={presets.find((p) => p.tool === "freedraw")}
  highlighterPreset={presets.find((p) => p.tool === "highlighter")}
/>
```

The taskbar writes the same `customData` highlighter marker as `goodnotes/pens` (`{ goodnotes: { highlighter: true } }`), so a stroke started from either surface renders identically. The marker is duplicated rather than imported, so the two modules can be released independently; if you ever change it, change both.

---

## Behaviour worth knowing

- **Tool state is read from the editor, not remembered.** The bar subscribes to `excalidrawAPI.onChange` and maps `appState.activeTool` back onto its slots, so pressing `R` or `V` on the canvas, or activating a pen from `PenTray`, updates `aria-pressed` correctly. For tools the bar does not own (hand, laser, frame, lasso) nothing is shown as pressed, rather than guessing. You can override this entirely with the controlled `activeTool` prop.
- **The Image control reflects reality.** Excalidraw's image tool opens a file picker and falls back to `selection` when it is dismissed, so the Image button un-presses itself. That is the editor's behaviour, mirrored honestly.
- **Overflow, not wrapping.** Controls move into a "More" menu, lowest priority first (page indicator → import → export → backdrop → add page → fuzzy select → image → shapes → text → eraser → highlighter → pen → select). Measured in the browser: at 1440/900/620 px everything fits; at 460 px four controls collapse; at 360 px seven do. The bar never wraps and never causes horizontal scroll.
- **Keyboard.** One tab stop into the bar, then `←`/`→` (wrapping), `Home`, `End`. `Enter`/`Space` activate. Menus take focus on open, `↑`/`↓`/`Home`/ `End` inside, `Esc`/`Tab`/outside-click close and return focus to the trigger.
- **Reduced motion.** The only transition in the module is the 120 ms button hover, and it is removed under `@media (prefers-reduced-motion: reduce)`.
- **Narrow viewports.** Below ~500 px Excalidraw switches to its mobile form factor; its hamburger (top-left) and sidebar trigger (top-right) sit at the same vertical offset as the bar and can tuck under its rounded ends. The bar is above them in the stacking order and stays clickable, but if you support phones seriously you will want to nudge those two, which live in `packages/` / `excalidraw-app/components/` and are outside this module.

## Public API

See `index.ts` — every export is documented there. In short:

| export | what it is |
| --- | --- |
| `Taskbar` | the component; `TaskbarProps` documents every prop |
| `SUPPRESS_DEFAULT_TOOLBAR_CLASS` | the `<body>` class, if you want to manage it yourself |
| `activateTool`, `toolFromAppState` | drive / read the editor without the UI (for host-level shortcuts) |
| `DEFAULT_PEN`, `DEFAULT_HIGHLIGHTER`, `HIGHLIGHTER_MARKER`, `SHAPE_TOOL`, `snapStrokeWidth` | the ink defaults and the tool mapping |
| `planOverflow`, `LAYOUT`, `GROUP_ORDER` | the pure overflow solver (exported mainly so it is testable) |
| `TaskbarMenu` | the shared popover used by Shapes and More |
