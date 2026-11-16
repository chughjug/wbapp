# Integrating the GoodNotes shell (`goodnotes/shell`)

**One floating bar, plus a page overlay.** This file is the exact, copy-pasteable set of `App.tsx` changes. The shell module itself needs nothing else.

---

## 0. What changed

Measured on an iPad Pro 11" viewport (1194x834) with a document open, the editor's *permanent* chrome was **28.5%** of the screen across six surfaces. `goodnotes/shell` owned two of the worst — the 189x656 page rail (123,954 px²) and the 1194x52 nav bar — plus, with `goodnotes/tabs`, the 1152x29 tab strip.

| before (shell + tabs) | after |
| --- | --- |
| nav bar: a 1194x52 full-width band, ~20 controls in three zones | one **380x46 floating pill**, 9 visible controls, `position: absolute`, centred near the top, rounded, translucent with a backdrop blur |
| page panel: a 189px column that held its place whether open or not | a **slide-over dialog**: closed, nothing is rendered at all |
| tab strip: always on | renders **only with more than one document open** |

Measured again after the change, same method, same viewport, one document open:

```
  the one bar                    380x 46 =   17481 px²   floats over the canvas
  zoom pill (Excalidraw's own)   178x 36 =    6393 px²
  TOTAL                                      23874 px² of 995796
  CHROME 2.40%   CANVAS 97.60%
```

The bar does not displace the canvas: with the overlay closed the editor box is the full 1194x834 and the page gets the whole height.

---

## 1. Band order → ONE stage

There are no bands left. The host needs **one positioned stage**; the bar and the page overlay are absolutely positioned children of it, over the canvas:

```
┌─────────────────────────────────────────────┐
│ document tabs      (only with >1 document)  │  a band, still
├─────────────────────────────────────────────┤
│ .gn-shell-stage  (position: relative)       │
│   ┌───────────────────────────────────────┐ │
│   │ .gn-shell-canvas → <Excalidraw>       │ │
│   │        ╭────── FloatingBar ──────╮    │ │   absolute, top: 10px
│   │        ╰──────────────────────────╯    │ │
│   │  [PagePanel: scrim + slide-over]      │ │   absolute, only when open
│   └───────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

Three classes ship with the module (`FloatingBar.scss`):

| class | what it does |
| --- | --- |
| `gn-shell-layout` | `display:flex; flex-direction:column; height:100%` — tab strip, then stage |
| `gn-shell-stage` | `position:relative; display:flex; flex:1; min-height:0` — **the positioning context the bar and the overlay anchor to** |
| `gn-shell-canvas` | `position:relative; flex:1; min-width:0` — the `<Excalidraw>` wrapper |

**`gn-shell-body` is kept as an exact alias of `gn-shell-stage`.** It is now `position: relative`, so if you only move `<FloatingBar>` *inside* your existing `.gn-shell-body` you are already correct and need not rename anything.

### The one thing you must change

`<FloatingBar>` is `position: absolute`. It anchors to the nearest positioned ancestor. Today that is `.excalidraw-app` (which has an inline `position: relative`), **not** the stage — so with two documents open the pill lands on top of the tab strip. Move it inside the stage and the problem goes away.

---

## 2. The `App.tsx` diff

### 2a. Import

```diff
-import { NavBar, PagePanel } from "./goodnotes/shell";
+import { FloatingBar, PagePanel } from "./goodnotes/shell";
```

(`NavBar` is still exported as a deprecated alias for `FloatingBar`, so this rename is optional — but every name below assumes you did it.)

### 2b. The page overlay starts closed

```diff
-  const [isPagePanelOpen, setIsPagePanelOpen] = useState(true);
+  // the page rail is a dialog now; a dialog's resting state is closed
+  const [isPagePanelOpen, setIsPagePanelOpen] = useState(false);
```

### 2c. Replace the whole `<NavBar> … </div>` block

Delete the `<TabBar>` / `<NavBar>` / `<ToolMenu>` / `.gn-shell-body` markup you have today and use this. The three things that moved are marked:

```tsx
      {/* the tab strip renders only when more than one document is open */}
      <TabBar
        tabs={openDocs.tabs}
        activeId={openDocs.activeId}
        theme={editorTheme}
        onActivate={onActivateTab}
        onClose={onCloseTab}
        onReorder={openDocs.actions.reorder}
        onCloseOthers={openDocs.actions.closeOthers}
        onNewTab={onNewDocument}
      />
      {/* ONE stage: canvas, then the bar and the overlay floating over it */}
      <div className="gn-shell-stage">
        <div className="gn-shell-canvas">
          <PaperBackgroundLayer
            /* …unchanged… */
          />
          <Excalidraw /* …unchanged… */>
            {/* …unchanged children… */}
          </Excalidraw>
        </div>

        {/* MOVED: the bar is now a child of the stage, not a band */}
        <FloatingBar
          excalidrawAPI={excalidrawAPI}
          suppressDefaultChrome
          theme={editorTheme}
          // ---- identity ----------------------------------------------
          onHome={onCloseDocument}
          // NEW: with one document there is no tab strip to carry the title,
          // so it heads the "…" menu and describes the Home control
          documentTitle={openDocs.tabs.find((t) => t.id === docId)?.meta?.title}
          pagePanelOpen={isPagePanelOpen}
          onTogglePagePanel={() => setIsPagePanelOpen((v) => !v)}
          pageCount={pages.length}
          currentPage={currentPageNumber ?? undefined}
          // ---- tools ---------------------------------------------------
          onActiveToolMenu={(tool, anchor) => {
            if (
              tool === "pen" ||
              tool === "highlighter" ||
              tool === "eraser" ||
              tool === "shape" ||
              tool === "text"
            ) {
              toolMenu.onToolSelect(tool, anchor);
            }
          }}
          onFuzzySelect={() => {
            backdrops.close();
            toggleFuzzySelect();
          }}
          fuzzySelectActive={isFuzzySelectActive}
          // ---- "+" (secondary inserts) ---------------------------------
          onImportPdf={() => {
            deactivateFuzzySelect();
            setIsPdfImportOpen(true);
          }}
          // MOVED: graph belongs under "+", not in the "…" overflow
          onInsertGraph={() => graph.open()}
          // ---- "…" (document actions) ----------------------------------
          onNewDocument={onNewDocument}
          onUndo={input.undo}
          onRedo={input.redo}
          onAddPage={newPage.open}
          onExportPdf={() => {
            deactivateFuzzySelect();
            setIsPdfExportOpen(true);
          }}
          onOpenBackdrops={() => {
            // the lasso overlay is modal and covers the window
            deactivateFuzzySelect();
            backdrops.open();
          }}
          backdropsActive={backdrops.isOpen}
          backdropsDisabled={!backdrops.hasImageSelection}
          // NEW: this app controls the editor theme itself (goodnotes/dark
          // feeds <Excalidraw theme={editorTheme}>), so the bar's own
          // fallback cannot win — wire it explicitly. See §5.
          onToggleTheme={() =>
            setAppTheme(editorTheme === "dark" ? "light" : "dark")
          }
          moreItems={[
            {
              id: "settings",
              label: "Settings…",
              onSelect: () => settings.open(),
            },
          ]}
        />

        {/* MOVED: the overlay is a child of the stage and renders nothing
            at all while closed */}
        <PagePanel
          excalidrawAPI={excalidrawAPI}
          open={isPagePanelOpen}
          onClose={() => setIsPagePanelOpen(false)}
          theme={editorTheme}
          onAddPage={newPage.open}
          docId={docId ?? undefined}
        />

        {/* the active tool's settings — owned by goodnotes/tool-menu */}
        <ToolMenu {...toolMenu.menuProps} />
      </div>
```

`setAppTheme` already comes out of the `useDarkMode()` call at the top of the component — no new import.

Everything else in the file (the `PaperBackgroundLayer` props, the `<Excalidraw>` element and its children, the dialogs after it) is unchanged. `PaperBackgroundLayer` stays a sibling of `<Excalidraw>` inside `.gn-shell-canvas`, so its `offsetLeft={0} offsetTop={0}` reasoning still holds: with the page rail out of the layout, that box is now the whole stage.

### 2d. Props that no longer exist

The three-zone band had an inline search field, an inline Write/Read segmented control and an inline `Share` button. Those *capabilities* survive as `onToggleSearch`, `mode`/`onModeChange` and `onShare`/`shareLabel`, now rendered as items in the "…" menu. The band-only props `searchQuery`, `onSearchChange`, `onSearchSubmit` and `searchPlaceholder` are gone. `App.tsx` passes none of them, so nothing to do.

---

## 3. Capability audit

Everything the old nav bar exposed, and where it is now. **Nothing became impossible; nothing is more than one tap further away.** Each row was clicked through in a browser at 1194x834.

| capability | old home | new home | taps |
| --- | --- | --- | --- |
| home | left zone button | **Home** control on the bar | 1 → 1 |
| pages panel | left zone toggle | **Pages** control (opens the overlay) | 1 → 1 |
| page counter "n/N" | folded into the Pages toggle | same, on the Pages control | — |
| select | centre zone | bar | 1 → 1 |
| lasso / **fuzzy select** | centre zone | bar (`onFuzzySelect` still backs the slot) | 1 → 1 |
| pen | centre zone | bar | 1 → 1 |
| highlighter | centre zone | bar | 1 → 1 |
| eraser | centre zone | bar | 1 → 1 |
| text | centre zone | "+" → Text | 1 → 2 |
| shapes (rectangle, ellipse, diamond, arrow, line) | centre zone menu | "+" → Shapes | 2 → 2 |
| image | centre zone | "+" → Image | 1 → 2 |
| sticky note | centre zone | "+" → Sticky note | 1 → 2 |
| **import PDF** | right zone | "+" → Import PDF… | 1 → 2 |
| **insert graph** | "…" (host `moreItems`) | "+" → Insert graph… (`onInsertGraph`) | 2 → 2 |
| **new document** | left zone | "…" → New document | 1 → 2 |
| **add page** | right zone | "…" → Add page (also the overlay's own `+ Add page` footer) | 1 → 2 |
| **undo** | right zone | "…" → Undo (also Excalidraw's zoom pill, also Ctrl/Cmd+Z) | 1 → 2 |
| **redo** | right zone | "…" → Redo (also the zoom pill, also Ctrl/Cmd+Shift+Z) | 1 → 2 |
| **export PDF** | "…" | "…" → Export to PDF… | 2 → 2 |
| **backdrops** | "…" | "…" → Image backdrop… (ticked while open) | 2 → 2 |
| **settings** | "…" (host `moreItems`) | "…" → Settings… (host `moreItems`, unchanged) | 2 → 2 |
| **theme** | *nowhere* — Excalidraw's hamburger island, which `suppressDefaultChrome` hides | "…" → Dark/Light theme | ∞ → 2 |
| share | right zone primary button | "…" → Share (`onShare`; this app passes none, so no item) | 1 → 2 |
| search | left zone field/button | "…" → Search… (`onToggleSearch`; this app passes none) | 1 → 2 |
| Write / Read | left zone segmented control | "…" → Read mode (`onModeChange`; this app passes none) | 1 → 2 |
| tool settings (colour, width) | never here | unchanged: the floating Active Tool Menu, via `onActiveToolMenu` | — |
| zoom / fit | never here | unchanged: Excalidraw's bottom-left pill, deliberately not absorbed | — |

### Deliberately dropped

1. **The inline search *field*.** Search itself is still reachable (`onToggleSearch` → "…" → Search…), but a 16rem text input cannot live in a 46px pill without the pill becoming a band again. The host's own search UI is the right place for a field.
2. **The centre cluster's measured overflow solver** (`planOverflow`). With a fixed set of 9 controls there is nothing to solve; the bar is ~380px wide and fits every viewport down to ~400px. `planOverflow` is still exported from `goodnotes/taskbar` for anyone who wants it.
3. **The `Share` button's "primary" styling.** Share is a menu item now, not a filled button. The capability is intact; the emphasis is not. If Share matters more than this to you, say so and it gets a slot.
4. **The separate "more tools" overflow menu.** There is one "+" and one "…" instead of three menus.

Nothing else was dropped.

---

## 4. Accessibility

Implemented and checked in a browser:

- **The bar is one `role="toolbar"`** with `aria-orientation="horizontal"`: a single tab stop, roving tabindex, Arrow Left/Right to move, Home/End to the ends.
  - Those keys are bound on the *document* in the capture phase, not as a React handler on the bar. `goodnotes/paged` claims Arrow/Home/End at document capture to turn the page, and its guard is "the target is inside `.excalidraw`" — which the bar's root is, because that is the scope Excalidraw's colour tokens live in. Capturing and calling `preventDefault()` gets the keys back (that controller bails on `defaultPrevented`) without either module reaching into the other.
- **`aria-pressed` on all five tool toggles**, mirrored from `excalidrawAPI.onChange`, so it stays true when a keyboard shortcut or the Active Tool Menu changes the tool. Read mode uses `aria-disabled`, never `disabled`, so the toolbar never loses its tab stop.
- **Every icon control has a visually-hidden text name** (`.gn-bar__sr`), plus a `title`.
- **"+" and "…" are real menus**: `aria-haspopup="menu"`, `aria-expanded`, `aria-controls`; `role="menu"` / `role="menuitem"`; focus moves to the first item on open; Escape, Tab, an outside pointerdown and selecting an item all close and return focus to the trigger.
- **The page overlay is a labelled dialog**: `role="dialog"`, `aria-modal="true"`, `aria-label="Pages panel"`; focus moves in on open; Tab and Shift+Tab wrap inside it (14 Tabs never escape); Escape (document capture, so it works wherever focus drifted) and a scrim click both dismiss; focus returns to the Pages control either way. The Pages control carries `aria-haspopup="dialog"` + `aria-expanded`.
- **`:focus-visible` rings** (`--focus-highlight-color`, 2px, 1px offset) are visible against both themes and against the translucent bar.
- **`@media (prefers-reduced-motion: reduce)`** removes every transition and both overlay animations.
- **`@media (forced-colors: active)`** gives the bar a `CanvasText` border, an opaque `Canvas` background and drops the blur.
- **Colour comes only from Excalidraw's custom properties**, funnelled through local `--gn-bar-*` properties that are redeclared under `.theme--dark`, so even the `var()` fallbacks are theme-correct. `--color-muted` (a *background* grey) and `--keybinding-color` (~1.9:1 on white) are not used. De-emphasised text — the "2/12" counter — uses `--input-label-color` (#495057 light / #e9ecef dark).

### Pointer

A bar floating over the canvas must not swallow drawing. The bar's full-width positioning wrapper (`.gn-bar-scope`) is `pointer-events: none` throughout; only the pill takes pointer events. Verified in a browser: 6px below, 6px above and 10px to the right of the pill all hit-test to `canvas.excalidraw__canvas`, the pill's own centre hit-tests to its button, and a stroke started 10px under the pill draws ink on the page beneath.

While the overlay is open its scrim (z-index 130) is above the bar (125), as a modal's scrim should be. That means the Pages control cannot be *clicked* to close the overlay — Escape, the overlay's close button, and a scrim click (including a click where the Pages control is) all do it.

---

## 5. Theme

`theme` is the one capability that was not reachable before: it lived in Excalidraw's hamburger island, which `suppressDefaultChrome` hides. It is now a "…" item.

When `onToggleTheme` is omitted the bar flips `appState.theme` through `excalidrawAPI` — correct for a host that lets the editor own its theme. **This app does not**: `goodnotes/dark`'s `useDarkMode()` feeds `<Excalidraw theme={editorTheme}>`, which is a controlled prop, so the fallback is overwritten on the next render. Pass `onToggleTheme` as in §2c.

---

## 6. Nothing else

No `UIOptions` change. The Excalidraw chrome the bar replaces is hidden by a body class (`gn-shell-suppress-default-ui`) that `FloatingBar` adds while `suppressDefaultChrome` is set and removes on unmount, so the suppression is opt-in and fully reversible. It covers `.App-menu_top .shapes-section`, `.App-menu_top__left`, `.layer-ui__wrapper__top-right` and the mobile `MobileMenu` toolbars, and deliberately leaves `.layer-ui__wrapper__footer-left` — the zoom pill — alone, because it is a second route to undo/redo and to zoom.

---

## Behaviour worth knowing

- **Sticky vs one-shot tools.** Pen, highlighter and eraser stay active after use; shapes, text, image and sticky note revert to select after one placement. This is Excalidraw's own tool lock, set per slot in `goodnotes/taskbar/tools.ts` (`PERSISTENT_TOOLS`).
- **Tap the active tool again** for its settings — the GoodNotes gesture. The bar only fires `onActiveToolMenu(tool, anchor)`; it renders no colours or widths itself.
- **The overlay's width** is 248px (`PAGE_PANEL_WIDTH`), up from the old rail's 188px: it no longer has to pay for itself in permanent layout, so the thumbnails can be bigger. `side="right"` slides it in from the right instead.
- **`returnFocusTo`** on `PagePanel` lets you name the element focus returns to. Without it, focus goes back to whatever was focused when the overlay opened, which is the Pages control in every normal flow.

---

## 9. The Hand (pan) control — added

### What you have to change in `App.tsx`

**Nothing.** The control is internal to `FloatingBar`: it adds no prop, changes no prop, and drives the editor itself through `goodnotes/tool-menu`'s `activateExtraTool(api, "hand")`. If your `<FloatingBar …>` block compiles today it already has the button.

Two optional lines, if you want them:

```diff
   onToolChange={(tool) => {
     // NEW (optional): the Hand control reports leaving pan as a switch to
     // "select", so a host mirroring the active slot stays honest. It emits
     // nothing when pan is *entered* — `hand` is not a `TaskbarToolId` and
     // `goodnotes/types.ts` is the integrator's to change, not ours.
     setMirroredTool(tool);
   }}
```

```diff
   // NEW (optional): the editor's own shortcut already works and is a
   // toggle, so this is only needed if you suppress editor shortcuts.
-  // (nothing)
+  // "H" → hand, handled by packages/excalidraw/components/Tools.tsx
+  //       (TOOLS.hand: { letterKey: KEYS.H, toggle: true })
```

### Where it sits, and why an eleventh control is justified

```
 ⌂ │ ▤ 1/1 │ ✒ ▰ ⌫ ◌ ▶ ✋ │ + │ …
                           ^^ new, last in the tool run
```

The bar was cut to ten controls on purpose, so an extra one needs an argument. The test applied to the other five tools was applied here: **can the user afford to reach it through a menu?** No — panning is a *mode* you enter and leave continuously while writing (zoom into a corner, write, shove the paper, write), and a two-tap mode switch through "…" turns that rhythm into a chore. It is also the only control that makes a zoomed-in page navigable with a mouse, a trackpad or a single finger without a modifier key.

It sits **last in the tool run, next to Select**, because Select and Hand are the two non-marking tools: everything to their left leaves ink.

### What was considered and rejected

- **Putting it in "…"** — rejected above: wrong for a mode.
- **Moving `lasso` into "…" to keep the count at ten** — rejected. The lasso slot is a *host hook* (`onFuzzySelect` backs it with `goodnotes/fuzzy-select`); demoting it would quietly change a capability this module does not own, to buy 36 px.
- **A long-press on Select** — rejected: an undiscoverable gesture is not a control.

### Measured cost (Chromium, 1194 × 834, one document open, first-run hint dismissed)

Union of the surfaces that actually paint — `.gn-bar` and Excalidraw's own `zoom-actions` pill — rasterised to a 1 px grid so nothing is double-counted:

| | bar | zoom pill | union | % of 995,796 px² |
| --- | --- | --- | --- | --- |
| without the Hand control | 380 × 46 | 96 × 36 | 20,936 px² | **2.10%** |
| with the Hand control | 416 × 46 | 96 × 36 | 22,592 px² | **2.27%** |

**+1,656 px², +0.17 percentage points.** The pill grows 380 → 416 px (the 34 px button plus the 2 px flex gap); it stays centred and still clears a quarter of the viewport width on each side.

> The brief quoted 2.50% as the resting figure and `INTEGRATION.md` § 0 quotes 2.40%; neither method is recorded, so the two numbers above are both taken with the *same* method on the *same* page, which is what makes the delta trustworthy. The absolute figure moves with which surfaces you count (an undo/redo island, a minimap dot, the first-run hint) — the +0.17 pp does not.

### Keyboard shortcuts — two pre-existing lies in the bar, fixed

Adding a Hand control put a **second `H`** in the bar and exposed something that was already wrong. Every letter `a`–`z` and `Shift`+`a`–`z` was pressed in the running app with the canvas focused and `appState.activeTool` read back:

| the bar used to say | what the key actually did | now |
| --- | --- | --- |
| Pen **(P)** | `p` → `freedraw` ✓ — but it does **not** clear the highlighter marker, so after using the highlighter, `p` left you highlighting | **(P)**, now bound by the bar so it means the Pen *slot*, ink and all |
| Highlighter **(H)** | `h` → **`hand`**. The editor owns `H` (`TOOLS.hand: { letterKey: KEYS.H, toggle: true }`); nothing in this app ever bound it to the highlighter. **This was wrong before the Hand control existed** — the Hand control did not take the key, it made the collision visible | **(⇧P)** — "the other pen", bound by the bar |
| Eraser **(E)** | `e` → `eraser` ✓ | unchanged |
| Lasso select **(Q)** | `q` → toggles the **tool lock** (`activeTool.locked`, measured `false → true → false`). `TOOLS.lasso` has no `letterKey`, and a scan of all 26 letters reached the lasso with none of them | **no shortcut advertised** |
| Select **(V)** | `v` → `selection` ✓ | unchanged |
| — | — | Hand **(H)**, the editor's own binding, a toggle |

**`Shift+H` was the obvious choice for the highlighter and was rejected on measurement**: it is `actionFlipHorizontal` (`keyTest: event.shiftKey && event.code === CODES.H` in `packages/excalidraw/actions/actionFlip.ts`). It arrives already `defaultPrevented` and flips the selection. Of every `Shift`+letter, only `Shift+H` and `Shift+V` (flip vertical) are `defaultPrevented`. `Shift+P` was checked the same way — not `defaultPrevented`, and inert both with and without a selection.

#### Why the bar binds any key at all

The highlighter is not an editor tool — it is `freedraw` plus a `customData` marker — so the engine has no binding to give it and never will. `FloatingBar` installs one `keydown` listener for `P` and `Shift+P` (`INK_SHORTCUT_KEYS`). It does not fight the engine:

- it listens in the **bubble phase on `document`**, i.e. after the editor's own handler has already run;
- for `P` it does **not** call `preventDefault` — it completes the engine's action (which already set `freedraw`) by applying the pen's ink, rather than replacing it;
- `Shift+P` reaches no engine tool at all, so claiming it takes nothing away;
- it bails on `defaultPrevented`, any modifier, `event.repeat`, an editable target, an open `.gn-menu`, a target outside the editor container and the bar, `appState.editingTextElement` and `appState.openDialog`.

#### Measured end state

Bar titles:

```
  pen           "Pen (P)"
  highlighter   "Highlighter (⇧P)"
  eraser        "Eraser (E)"
  lasso         "Lasso select (smart selection)"      <- no key claimed
  select        "Select (V)"
  hand          "Hand (pan) (H)"
```

Pressing each advertised key with the canvas focused, reading back `activeTool.type`, the highlighter marker in `currentItemCustomData`, and which bar button reports `aria-pressed="true"`:

```
  V        -> activeTool=selection  highlighterMarker=false  barPressed=["select"]
  P        -> activeTool=freedraw   highlighterMarker=false  barPressed=["pen"]
  Shift+P  -> activeTool=freedraw   highlighterMarker=true   barPressed=["highlighter"]
  P        -> activeTool=freedraw   highlighterMarker=false  barPressed=["pen"]     <- straight after the highlighter
  E        -> activeTool=eraser     highlighterMarker=false  barPressed=["eraser"]
  H        -> activeTool=hand       highlighterMarker=false  barPressed=["hand"]
  Shift+P  -> activeTool=freedraw   highlighterMarker=true   barPressed=["highlighter"]
  V        -> activeTool=selection                           barPressed=["select"]
```

Every title matches what its key does, and no two controls claim the same key.

**Nothing fires while typing.** Double-click to create a text element, then type `Pp`, press `Shift+P`, press `e`: the wysiwyg textarea reads `"PpPe"`, `editingTextElement` is still set, `activeTool` is unchanged and `highlighterMarker` is still `false` — all four keystrokes were text, none was a shortcut.

### Accessibility

- A real `<button>` in the toolbar's roving tabindex: focus the bar and press `ArrowRight`; verified that Home + 7 × `ArrowRight` lands on it (`data-control="hand"`, accessible name "Hand (pan)").
- `aria-pressed` is mirrored from `appState.activeTool.type === "hand"` through `excalidrawAPI.onChange`, so a keyboard shortcut or another surface cannot make it lie. Verified `false → true → false` across two `Enter` presses.
- It is a **toggle**: pressing it while pan is active returns to Select, so it is not a mode you can only leave through another control.
- Visually hidden text name, `title` with the shortcut, `aria-disabled` (never `disabled`) in read mode — the same contract as the other five tools, from the same `.gn-bar__button--tool` class, so light/dark, focus ring and `prefers-reduced-motion` are inherited rather than re-stated.
- Touch target 34 × 34 px inside a 46 px pill, identical to the other tools.

### No tool change resizes the canvas

Verified across Pen / Highlighter / Eraser / **Hand** / Select: interactive canvas `top = 0`, `height = 834`, `appState.width × height = 1194 × 834`, unchanged for every one.

### What the control actually does

See `goodnotes/paged/INTEGRATION.md` § 8 and `goodnotes/input/INTEGRATION.md` § 8. In short: the paged viewport lock now carries a 28 px rubberband so a hand drag is never a dead gesture, free panning inside a zoomed page was already correct, and an overdrag the page could not consume turns the page.
