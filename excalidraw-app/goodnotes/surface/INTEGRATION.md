# `goodnotes/surface` — integration

Two features, one module:

- **Whiteboard mode** — this document is not paper. No page frames, no paper background, no page count, no paged fit: Excalidraw's own endless canvas. **Per document, and completely non-destructive** — nothing in the scene is written, so a 40-page lecture comes back byte-identical.
- **Rotate sheet** — turn one page (or all of them) between portrait and landscape, re-stacking the column below it, never clipping ink, undoable with a single Ctrl+Z.

Nothing here reaches into shell DOM. The hook is headless; `SurfaceControls` is optional UI you place where you like.

---

## 1. App.tsx changes (copy-pasteable)

### 1a. Import

Next to the other goodnotes imports (by `import { PagedViewControls, usePagedView } from "./goodnotes/paged";`, ~line 103):

```tsx
import { SurfaceControls, useSurface } from "./goodnotes/surface";
```

### 1b. The hook

In `ExcalidrawWrapper`, right after the `usePagedView` line (~line 438):

```tsx
const paged = usePagedView(excalidrawAPI);
// paper vs whiteboard (per document) + rotate sheet
const surface = useSurface(excalidrawAPI, { docId });
```

`docId` is already a prop of `ExcalidrawWrapper`; pass it so the mode is remembered per document (pass nothing and the hook reads `/d/<id>` from the URL itself).

### 1c. The paper layer must know (one prop)

In the existing `<PaperBackgroundLayer …>` (~line 1190) add:

```tsx
            pages={surface.paperPages}
```

`surface.paperPages` is `undefined` in paper mode — the layer keeps deriving pages from `elements`, exactly as today — and a stable `[]` in whiteboard mode, which makes the layer paint nothing. (Measured: 185,082 opaque px → 0 in a 600×600 layer.)

### 1d. The visible control

Next to `<PagedViewControls {...paged.controlsProps} />` inside `.gn-shell-canvas`, e.g.:

```tsx
<div
  style={{
    position: "absolute",
    bottom: "0.75rem",
    right: "0.75rem",
    zIndex: 6, // above the editor UI layer (4) and the paged matte (3)
  }}
>
  <SurfaceControls {...surface.controlsProps} />
</div>
```

It renders "Rotate sheet", "All", a "Whiteboard" toggle (`aria-pressed`) and the `aria-live` region that announces both actions. If your shell drives the actions itself, still mount `<SurfaceControls {...surface.controlsProps} controls={false} />` somewhere — that renders **only** the live region (zero layout area), and it is the only thing that tells a screen-reader user what happened.

### 1e. Nav bar: the page controls, and the dead-button question

**Recommendation: hide, don't disable.** A whiteboard has no pages, so "Page 1/3" and "Add page" are not merely unavailable, they are meaningless — and leaving a disabled "+" implies the user is one subscription away from pages on a whiteboard. Also put the toggle in the "more" menu so it is reachable without the floating control:

```tsx
          onAddPage={surface.isWhiteboard ? undefined : newPage.open}
          pageCount={surface.isWhiteboard ? undefined : pages.length}
          currentPage={surface.isWhiteboard ? undefined : currentPageNumber ?? undefined}
          moreItems={[
            {
              id: "surface-mode",
              label: surface.isWhiteboard ? "Back to paper" : "Whiteboard",
              onSelect: () => surface.toggle(),
            },
            ...(surface.hasSheets
              ? [
                  {
                    id: "rotate-sheet",
                    label: "Rotate this sheet",
                    onSelect: () => surface.rotate(),
                  },
                  {
                    id: "rotate-all-sheets",
                    label: "Rotate every sheet",
                    onSelect: () => surface.rotateAll(),
                  },
                ]
              : []),
            {
              id: "settings",
              label: "Settings…",
              onSelect: () => settings.open(),
            },
          ]}
```

`FloatingBar` already treats `pageCount`/`onAddPage` as optional and renders neither the counter nor the "Add page" menu item when they are absent, so this is the whole change. The page panel is equally pointless on a whiteboard — pass `open={isPagePanelOpen && !surface.isWhiteboard}` to `<PagePanel>` (or hide its toggle).

### 1f. PDF export of a whiteboard

A whiteboard has no sheets, so "export every page" has nothing to iterate. The answer here is **one page the size of the used bounding box, plus 48 px of margin**. No change to `goodnotes/export` is needed: `getWhiteboardExportScene()` hands the existing exporter a scene containing the ink (unparented from the hidden page frames) plus one synthetic frame named `page:1` over the bounding box. The exporter finds pages by frame name and rasterises with `exportingFrame`, which selects by _overlap_, not by `frameId`.

At the `<ExportDialog …>` (~line 1453):

```tsx
          elements={
            surface.isWhiteboard
              ? getWhiteboardExportScene(excalidrawAPI.getSceneElements())
                  .elements
              : excalidrawAPI.getSceneElements()
          }
          currentPageNumber={surface.isWhiteboard ? 1 : currentPageNumber}
```

with `getWhiteboardExportScene` added to the `./goodnotes/surface` import. (Measured: a whiteboard with one stroke exported to a 5,376-byte PDF with a single 214.5 × 175 px page, through `exportDocumentToPdf` unchanged.)

### 1g. Nothing to do for paged view

`useSurface` installs a `"continuous"` **override** in `goodnotes/paged` while a whiteboard is open and removes it on unmount. The paged controller drops its scroll lock and matte immediately, and the user's own paged/continuous preference in Settings is left untouched and comes back when a paper document is opened. (Measured: `appState.scrollConstraints` present → absent → present across a round trip.)

---

## 2. Public API

```ts
import {
  useSurface, // React: the whole module in one hook
  SurfaceControls, // rotate + whiteboard buttons + aria-live
  // headless surface mode
  loadSurfaceMode,
  saveSurfaceMode,
  subscribeSurfaceMode,
  applySurfaceMode, // put a live editor into a mode
  paperPagesFor, // what to give <PaperBackgroundLayer pages={…} />
  frameRenderingFor,
  PAPER_FRAME_RENDERING,
  WHITEBOARD_FRAME_RENDERING,
  // whiteboard export
  getWhiteboardExportScene,
  getWhiteboardBounds,
  getWhiteboardContent,
  WHITEBOARD_EXPORT_PADDING,
  // rotate sheet
  rotateSheet, // live editor, one updateScene, one undo step
  rotateSheetElements, // pure: (elements, index) -> new elements
  rotateSheetsElements, // pure: (elements, indices)
  rotateAllSheetsElements, // pure: every page
  getCurrentSheetIndex,
} from "./goodnotes/surface";
```

`useSurface(excalidrawAPI, { docId?, onModeChange? })` returns:

| field | meaning |
| --- | --- |
| `mode` / `isWhiteboard` | `"paper"` \| `"whiteboard"` |
| `setMode(mode)` / `toggle()` | switch (persisted per document) |
| `pageCount` | page frames in the scene — unchanged by whiteboard mode |
| `hasSheets` | `false` on a whiteboard or an empty document: **hide** sheet UI |
| `currentSheetIndex` | 0-based page under the viewport centre, `-1` for none |
| `rotate(index?)` / `rotateAll()` | returns `RotateSheetResult` (`rotated`, `indices`, `contentScale`, `landscape`) |
| `paperPages` | `[]` on a whiteboard, `undefined` on paper |
| `announcement` | text for an `aria-live` region |
| `controlsProps` | spread onto `<SurfaceControls />` |

`SurfaceControls` props: `controls` (default `true`; `false` = live region only), `allowRotateAll` (default `true`), `className`.

---

## 3. Design decisions, and why

### Whiteboard is a per-document property, not a third `ViewMode`

Paged-vs-continuous is a way of _looking at_ a document. Whiteboard-vs-paper is what the document _is_: a mind map is not three sheets of A4 because the viewport happens to be paged, and a lecture notebook is 40 sheets whether you scroll it or fit one page. `ViewMode` is also a single global `localStorage` key — making whiteboard a third value would blank the pages of every document the user opens next. So: `goodnotes:surface-mode:<docId>`, read synchronously, per document.

Where it _should_ live is `DocMeta`. **Request for `types.ts` (which I did not edit):**

```ts
  /** "whiteboard" documents have no pages; defaults to "paper". */
  surface?: "paper" | "whiteboard";
```

on `DocMeta`, written through from `saveSurfaceMode` the way `newPageChoice` writes `defaultTemplate`. Until that field exists the mode is per-browser, not carried with the document (see gaps).

### The round trip cannot lose pages, because it writes nothing

Whiteboard mode changes exactly three things, none of them scene data:

1. `appState.frameRendering = {enabled:false, clip:false, name:false, outline:false}` (via `updateScene`, `captureUpdate: NEVER`) — frames stop being drawn _and_ stop clipping, which is what makes the canvas feel native;
2. the paper layer is given an empty page list;
3. paged view is overridden to continuous.

No element is created, deleted, moved or re-versioned. Measured on a 2-page document with ink: ids, `version`, `versionNonce`, `updated`, geometry and `frameId` all identical before → whiteboard → after, and the ink centroid identical to 4 dp.

### "New page" and the page count in whiteboard mode

Hidden, not disabled (§ 1e) — a disabled control that can never become enabled in this document is worse than no control. The capability is one click away: the "Whiteboard" toggle is `aria-pressed` and turning it off brings every page back exactly as it was.

### PDF export of a whiteboard

One page = the used bounding box + 48 px. Implemented by handing the _existing_ exporter a synthetic `page:1` frame (§ 1f), so there is one rasteriser, one preview and one PDF writer in the app, not two.

### Rotate: ink is nudged, then scaled only if it must be — never clipped

1. content that still fits the rotated sheet is left **exactly** where it is (same coordinates, same versions);
2. content that merely overhangs is translated back inside by the smallest distance that works;
3. content that genuinely cannot fit is scaled **uniformly** about the page origin by exactly `min(newW/w, newH/h)`, then clamped inside.

Growing the page instead would mean the sheet is no longer A4 — and a sheet whose whole purpose is to print as one known paper size is not something to silently resize. Stretching to fill would squash handwriting on one axis, which no later edit can undo. Scaling _always_ (rather than only when needed) would shrink notes by 0.707 on every rotation, so a rotate-and-rotate-back would cost 50% of the ink size for nothing. `strokeWidth` is not scaled, matching the editor's own resize.

Measured: a 948.03 px tall stroke on an 816 × 1056 sheet → landscape 1056 × 816 scaled by 0.8607 (= 816 / 948.03) and clamped to the sheet; rotating back rescales by 1 (it fits), so the round trip shrinks once, not twice.

### One sheet, with a way to do all

`rotate()` turns the sheet under the viewport centre; `rotateAll()` turns the document. Rotating everything by default would be a 40-page edit from a one-page intent.

### Undo

Both the geometry change and the ink transform are produced with `newElementWith` (version / versionNonce / updated bumped the way the editor does) and committed in **one** `updateScene` with `CaptureUpdateAction.IMMEDIATELY`, so one Ctrl+Z restores the original geometry exactly (measured below). The surface-mode switch uses `CaptureUpdateAction.NEVER`: "I turned the paper off" is not an edit and must not sit in the undo stack.

---

## 4. Measured behaviour (Chromium via Playwright, 1194 × 834, dev server)

| check | result |
| --- | --- |
| rotate a LETTER sheet | frame 816 × 1056 → **1056 × 816**, `customData.goodnotesPage.landscape` `null` → `true` |
| page below re-stacks | page 2 `y` 1104 → **864** = 816 + `PAGE_GAP` 48 |
| ink that fits | 3 strokes, centroid (405.367, 439.781) → **identical**, `version` 13 → **13** (untouched), bbox identical |
| Ctrl+Z | frame back to 816 × 1056, page 2 `y` back to **1104**, ink bbox identical |
| ink that does not fit | stroke h 948.03 → 816, `contentScale` **0.8607**, bbox inside the sheet, 0 px clipped; rotate back → `contentScale` **1**; two Ctrl+Z restore h **948.03** and the original bbox exactly |
| whiteboard round trip (2 pages + ink) | full element dump (id, version, versionNonce, updated, x/y/w/h, frameId, name) **byte-identical**; centroid identical to 4 dp; 4 elements → 4 |
| frames stop rendering | editor static canvas opaque pixels **6,923 → 432** (the 432 are the two ink strokes; outline + "page:1" label gone), `frameRendering` all `false` |
| paper layer | `PaperBackgroundLayer` 600 × 600: **185,082 → 0** opaque px with `paperPages` from whiteboard mode |
| paged lock released | `appState.scrollConstraints` present → **absent** → present again on return to paper |
| panning past the pages | 40 × 240 px wheel in whiteboard: viewport centre scene Y **13,168.39** vs stack bottom **2,160** — 11,008 px past the last page, no clamp, no snap-back |
| whiteboard PDF | one `page:1` frame over bounds (232.3, 8226.2) 214.5 × 175; `exportDocumentToPdf` unchanged → **5,376-byte** `application/pdf` |
| controls, keyboard | tab order "Rotate sheet" → "All" → "Whiteboard"; Enter toggles; `aria-pressed` `false` → `true`; rotate buttons disappear on a whiteboard; group label "Sheet and surface" |
| announcements | "Whiteboard on. Pages are hidden; the canvas is endless." / "Whiteboard off. Your pages are back." / "Sheet 1 is now landscape." |
| light / dark | light `#1b1b1f` on `#ffffff`, de-emphasised `#495057`; dark `#e3e3e8` on `#232329`, de-emphasised `#e9ecef` — all ≥ 8:1 |
| reduced motion | button transition `0.12s` → **`0s`** under `prefers-reduced-motion: reduce` |

---

## 5. Known gaps / fragile bits

- **The mode is stored per browser, not per document file.** It lives in `localStorage` under `goodnotes:surface-mode:<docId>`; a document opened on another device, or exported and re-imported, comes back as paper. The fix is the `DocMeta.surface` field requested in § 3 — one line in `types.ts` plus a write-through in `saveSurfaceMode`.
- **Ink drawn on a whiteboard away from the old pages stays off-page when you switch back.** Measured: a stroke drawn at scene y ≈ 8,274 has `frameId: null` and survives the switch, floating on the desk between/below the sheets. It is never deleted, but it will not appear in a per-page PDF export. Arguably correct ("your board is still your board"), but it is a real sharp edge for a user who whiteboards for ten minutes and then exports.
- **Hidden page frames are still in the scene.** Selecting-all on a whiteboard selects them, and the editor's own frame hit-testing is not gated on `frameRendering`, so a drag that starts on an invisible frame edge can still move a page. Not observed in normal drawing, not fixable at app level (it would need `App.tsx`'s `hitElement`/`getElementAtPosition` in `packages/excalidraw/components/App.tsx` to consult `state.frameRendering.enabled`).
- **Rotation scales, it does not reflow.** Text keeps its line breaks and gets a smaller `fontSize`; it is not re-wrapped to the new width. Bound-text containers are scaled with their container, but Excalidraw may re-measure the label on the next edit and shift it slightly.
- **Arrow bindings are not rescaled.** `startBinding.gap` / `endBinding.gap` keep their old value when contents are scaled, so an arrow bound to a shape can end up a pixel or two off its old gap. Points, positions and sizes are all correct.
- **`strokeWidth` is deliberately unscaled**, so heavily shrunk ink looks slightly heavier than before. This matches the editor's own resize behaviour.
- **The scaled-and-clamped case pins content to an edge.** Scaling is about the page origin and then clamped, so ink that had to shrink ends flush against the top (or left) edge rather than being re-centred. Predictable, but not pretty.
- **No `useSurface` ↔ `goodnotes/library` write-through**, for the same reason as the first bullet.
- Everything above was verified in **Chromium with synthesised input**, not on a real iPad, and not with a pen/palm-rejection device.
