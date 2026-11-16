# Integrating the GoodNotes shell (`goodnotes/shell`)

One bar, three zones, plus the left page panel. This file is the exact set of
`App.tsx` changes; the shell module itself needs nothing else.

Nothing here is wired into `App.tsx` yet — **except** that
`goodnotes/taskbar`'s `Taskbar` export is now a deprecated alias for `NavBar`,
so the app keeps compiling and already renders the new bar (with its left zone
empty, because the old call site passes no left-zone callbacks). Steps 1–5
below finish the job.

---

## 0. Band order (read this first)

The shell is **not** a floating overlay any more. `NavBar` and `PagePanel`
both default to `placement="flow"`, i.e. normal document flow, so they stack
cleanly with the document tab strip (owned by another module):

```
┌─────────────────────────────────────────────┐
│ document tabs            (another module)   │  band 1
├─────────────────────────────────────────────┤
│ NavBar — left │ centre tools │ right        │  band 2
├──────────┬──────────────────────────────────┤
│ PagePanel│ <Excalidraw> (zoom pill inside)  │  band 3 (a row)
│  188px   │                                  │
└──────────┴──────────────────────────────────┘
```

Three layout classes ship with the module (`NavBar.scss`), so you do not have
to invent the flexbox:

| class | what it does |
| --- | --- |
| `gn-shell-layout` | `display:flex; flex-direction:column; height:100%` — the three bands |
| `gn-shell-body` | `display:flex; flex:1; min-height:0` — panel + canvas row |
| `gn-shell-canvas` | `position:relative; flex:1; min-width:0` — the `<Excalidraw>` wrapper |

Skeleton (the tab strip is yours to wire; the shell does not render it):

```tsx
<div className="gn-shell-layout">
  <DocumentTabs … />              {/* band 1 — goodnotes/tabs */}
  <NavBar … />                    {/* band 2 */}
  <div className="gn-shell-body"> {/* band 3 */}
    <PagePanel … />
    <div className="gn-shell-canvas">
      <Excalidraw …>…</Excalidraw>
    </div>
  </div>
</div>
```

The root of that tree needs a height (`height: 100vh`, or `position: fixed;
inset: 0`), as any full-height app shell does.

### If you really want the bar to float

Pass `placement="fixed"` to **both** `NavBar` and `PagePanel`. Then:

* the bar is `position: fixed; top: 0; height: 52px` (`--gn-nav-height`,
  `3.25rem`) and the page panel is fixed from `top: var(--gn-nav-height)` to
  the bottom, overlaying the canvas;
* with a tab strip above, you must offset both: set
  `--gn-nav-height: calc(3.25rem + <tab strip height>)` on `:root` **and** add
  `top: <tab strip height>` to `.gn-nav-scope--fixed` — i.e. two offsets to
  maintain by hand, which is exactly why `flow` is the default.

`goodnotes/taskbar`'s deprecated `Taskbar` alias still defaults to
`placement="fixed"`, so the un-migrated call site in `App.tsx` keeps behaving
like the old floating taskbar until you do step 3.

---

## 0b. What replaces what

| Old surface | Replaced by |
| --- | --- |
| `<Taskbar>` (centred bar) | `<NavBar>` — three zones |
| Excalidraw shapes toolbar | NavBar CENTRE zone (CSS-suppressed) |
| Top-left hamburger island (`.App-menu_top__left`) | NavBar RIGHT zone + "…" (CSS-suppressed) |
| Top-right island (`.layer-ui__wrapper__top-right`) | NavBar RIGHT zone: Share (CSS-suppressed) |
| Right-hand page `Sidebar name="goodnotes-pages"` | `<PagePanel>` on the left |
| Floating `<PenTray>` | NavBar pen/highlighter/eraser + the floating Active Tool Menu |
| Bottom-left zoom pill | **kept as-is** — deliberately not absorbed |

---

## 1. Imports

```diff
-import { Taskbar } from "./goodnotes/taskbar";
+import { NavBar, PagePanel } from "./goodnotes/shell";
+import type { ShellMode } from "./goodnotes/shell";
```

`PageSidebar` is no longer imported by `App.tsx` (the panel wraps it):

```diff
 import {
-  PageSidebar,
   usePages,
   …
 } from "./goodnotes/pages";
```

Also drop `import { PenTray } from "./goodnotes/pens";` once you remove the
tray (step 4). Leave the rest of `goodnotes/pens` in place.

## 2. Two pieces of state

Inside the editor component, next to the other `useState`s:

```tsx
const [isPagePanelOpen, setIsPagePanelOpen] = useState(true);
const [shellMode, setShellMode] = useState<ShellMode>("write");
```

## 3. Replace the `<Taskbar …>` element

Delete the whole `<Taskbar … />` element (it currently sits just *after*
`</Excalidraw>`) and rebuild the editor's markup as the three bands from §0 —
the bar is no longer an overlay, so it must come *before* the canvas in the
tree:

```tsx
<NavBar
  excalidrawAPI={excalidrawAPI}
  // placement="flow" is the default: a band, not an overlay
  suppressDefaultChrome
  theme={editorTheme}
  // ---- LEFT ----------------------------------------------------------
  pagePanelOpen={isPagePanelOpen}
  onTogglePagePanel={() => setIsPagePanelOpen((open) => !open)}
  onToggleSearch={() =>
    excalidrawAPI?.toggleSidebar({ name: "default", tab: "search" })
  }
  mode={shellMode}
  onModeChange={setShellMode}
  // ---- CENTRE (tools) ------------------------------------------------
  onFuzzySelect={() => {
    backdrops.close();
    toggleFuzzySelect();
  }}
  fuzzySelectActive={isFuzzySelectActive}
  // ---- RIGHT ---------------------------------------------------------
  onImportPdf={() => {
    deactivateFuzzySelect();
    setIsPdfImportOpen(true);
  }}
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
  onAddPage={() => addPage()}
  pageCount={pages.length}
  currentPage={currentPageNumber ?? undefined}
  onShare={() => setShareDialogState({ isOpen: true, type: "share" })}
/>
<PagePanel
  excalidrawAPI={excalidrawAPI}
  open={isPagePanelOpen}
  theme={editorTheme}
  onClose={() => setIsPagePanelOpen(false)}
/>
```

…placed inside the band skeleton of §0: `<NavBar>` directly under the tab
strip, `<PagePanel>` as the first child of `.gn-shell-body`, and the existing
`<Excalidraw>…</Excalidraw>` inside `.gn-shell-canvas`.

Every callback is optional: **a missing callback hides its control.** The old
taskbar props (`onFuzzySelect`/`fuzzySelectActive`, `onImportPdf`,
`onExportPdf`, `onOpenBackdrops`/`backdropsActive`/`backdropsDisabled`,
`onAddPage`, `pageCount`, `currentPage`) all mean exactly what they used to.

### Optional: undo / redo in the right zone

`ExcalidrawImperativeAPI` exposes no `undo()`/`redo()` in this fork (only
`history.clear`), so the honest options are:

* **leave `onUndo`/`onRedo` off** — the controls are not rendered and the
  bottom-left pill keeps its own undo/redo (this is what I recommend today), or
* dispatch the editor's own shortcut:

```tsx
const sendKey = (key: string, shift = false) =>
  document
    .querySelector(".excalidraw-container")
    ?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key, code: `Key${key.toUpperCase()}`,
        ctrlKey: true, shiftKey: shift, bubbles: true,
      }),
    );
// onUndo={() => sendKey("z")}  onRedo={() => sendKey("z", true)}
```

### Optional: an inline search field

Pass `searchQuery` + `onSearchChange` (and optionally `onSearchSubmit`) and the
left zone renders a real field instead of the icon button; below ~900px it
folds back to the icon button and calls `onToggleSearch`.

## 4. Remove what the bar replaced

```diff
-        <PenTray excalidrawAPI={excalidrawAPI} />
```

```diff
-        <Sidebar name="goodnotes-pages" docked onDock={() => {}}>
-          <Sidebar.Header />
-          <PageSidebar excalidrawAPI={excalidrawAPI} />
-        </Sidebar>
```

and the line that force-opens that sidebar (around line 458):

```diff
-    excalidrawAPI.toggleSidebar({ name: "goodnotes-pages", force: true });
```

`Sidebar` may then be unused in the `@excalidraw/excalidraw` import list.

## 5. Nothing else

No `UIOptions` change is needed. The Excalidraw chrome the bar replaces is
hidden by a body class (`gn-shell-suppress-default-ui`) that `NavBar` adds
while `suppressDefaultChrome` is set and removes on unmount, so the
suppression is opt-in and fully reversible. It covers:

* `.App-menu_top .shapes-section` (shapes toolbar),
* `.App-menu_top__left` (hamburger island),
* `.layer-ui__wrapper__top-right` (Share / collaborators island),
* the mobile `MobileMenu` toolbars.

It deliberately leaves `.layer-ui__wrapper__footer-left` — the zoom pill —
alone. In `flow` placement the canvas starts to the right of the page panel,
so the pill is already clear of it; in `fixed` placement a second body class
(`gn-shell-page-panel-open`) nudges the pill clear instead.

There is **no** `UIOptions` switch for those islands: `LayerUI` renders them
whenever `defaultUIEnabled` is true, and the props that would remove them
(`viewModeEnabled`, `zenModeEnabled`) change editor behaviour too. CSS is the
correct lever.

---

## Behaviour worth knowing

* **Sticky vs one-shot tools.** Pen, highlighter and eraser stay active after
  use; shapes, text, image and sticky note revert to select after a single
  placement. This is Excalidraw's own tool lock (`setActiveTool({ locked })`),
  set per slot in `goodnotes/taskbar/tools.ts` (`PERSISTENT_TOOLS`), so the
  editor does the reverting and nothing is re-implemented.
* **The bar mirrors the editor.** It subscribes to `excalidrawAPI.onChange`,
  so `aria-pressed` follows keyboard shortcuts, Escape and any other surface.
* **Tool settings are not here.** Colours and widths belong to the floating
  Active Tool Menu. `NavBar` only exposes `onActiveToolMenu(tool, anchor)`,
  which fires when the user activates the tool that is already active — wire
  it to that module when it lands:

  ```tsx
  onActiveToolMenu={(tool, anchor) => toolMenu.open(tool, anchor)}
  ```
* **Read mode** is a presentation hint: the centre tools render as unavailable
  (`aria-disabled`, still focusable) and the bar stops driving the editor. If
  you want the canvas itself read-only, pass `viewModeEnabled={shellMode === "read"}`
  to `<Excalidraw>` — that part is the host's call, not the bar's.
* **Narrow windows.** Below ~1180px the Write/Read labels drop to icons; below
  ~900px the search field becomes an icon button and Import PDF / Add page
  move into the "…" menu; the centre cluster measures itself and moves tools
  into its own overflow menu as space runs out. Verified down to 480px with no
  overlap and no horizontal scrolling.
* **Accessibility.** Centre cluster is `role="toolbar"` with one tab stop,
  roving tabindex and Arrow/Home/End; Write/Read is a `role="radiogroup"`;
  every icon control has a text name; focus rings are visible in both themes;
  all transitions are removed under `prefers-reduced-motion: reduce`.
