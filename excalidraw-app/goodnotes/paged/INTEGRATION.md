# `goodnotes/paged` — integration

One page at a time, filling the workspace, with swipe / arrow keys / the shell's bar to move between pages. Continuous (infinite canvas) stays available as the alternative mode.

> **Changed (chrome reduction):** the permanent bottom bar (prev / "Page N of M" / next, 1194×36 = 42,984 px²) is gone. It duplicated the page count the shell's bar already shows.
>
> - `<PagedViewControls {...paged.controlsProps} />` now renders **only the visually-hidden `aria-live` region** (1×1, absolutely positioned — zero layout area). Keep rendering it: it is what announces "Page 2 of 7" for _every_ route to a page, including the flick and the arrow keys. Pass `controls` to get the old visible strip back.
> - The capability moved, not away: `paged.prev()`, `paged.next()`, `paged.goToPage(i)` on the hook drive the same controller, and the keyboard routes (←/→/↑/↓, PageUp/PageDown, Home/End) are installed by the controller and untouched.
> - The paged/continuous switch is **only** in Settings → View mode now; `controlsProps` no longer carries `mode` / `onToggleMode`. Both read and write the same `goodnotes:view-mode` store (`loadViewMode` / `saveViewMode` / `subscribeViewMode`), so the control and the controller stay in step.

**Nothing in the scene data model changes.** Pages remain frames stacked vertically with `PAGE_GAP` between them, so the paper layer, PDF export, page thumbnails and PDF import keep working exactly as they do today. This module only drives the _viewport_.

---

## 1. App.tsx changes (copy-pasteable)

### 1a. Import

Next to the other goodnotes imports (near line 94, by `usePages`):

```tsx
import { usePagedView, PagedViewControls } from "./goodnotes/paged";
```

### 1b. The hook

In `ExcalidrawWrapper`, right after the `useInputGestures` line (~line 424):

```tsx
// palm rejection, page flick and tap gestures go live from here
const input = useInputGestures(excalidrawAPI);
// one page at a time, fitted to the workspace (the swipe gesture above
// drives this automatically — see § 3)
const paged = usePagedView(excalidrawAPI);
```

That single line is the whole feature: the viewport locks to the current page as soon as the editor mounts, the arrow keys / PageUp / PageDown / Home / End work, and the two-finger flick turns pages instead of scrolling. Paged mode is the default; the user's choice is remembered in `localStorage` (`goodnotes:view-mode`).

### 1c. The visible control (page number, prev/next, mode switch)

Inside `<div className="gn-shell-canvas">`, **after** `<Excalidraw … />`:

```tsx
<div
  style={{
    position: "absolute",
    bottom: "0.75rem",
    left: "50%",
    transform: "translateX(-50%)",
    // above the editor's UI layer (4) and the paged matte (3)
    zIndex: 6,
  }}
>
  <PagedViewControls {...paged.controlsProps} />
</div>
```

`PagedViewControls` also renders the `aria-live` region that announces page changes — **mount it even if you style it away**, or provide your own live region fed from `paged.announcement` (see § 5).

### 1d. Optional: the mode switch in the nav bar's "more" menu

Add to the `moreItems` array on `<NavBar>` (~line 1140):

```tsx
          {
            id: "view-mode",
            label: paged.isPaged ? "View: One page" : "View: Continuous",
            onSelect: () => paged.togglePaged(),
          },
```

### 1e. Optional: nav-bar page counter driven by this module

`<NavBar currentPage={…}>` is currently fed by `currentPageNumber`, which derives the page from the scroll position. In paged mode the locked page is authoritative, so you can pass it straight through:

```tsx
        currentPage={paged.pageNumber || currentPageNumber || undefined}
```

### 1f. Nothing to do for the page panel

`PagePanel`/`PageSidebar` navigate with `goodnotes/pages`' `scrollToPage`. That clears the viewport lock, so the controller notices, **adopts** the page the panel scrolled to and re-fits it (~140 ms later). Clicking a thumbnail therefore does the right thing with no wiring at all. If you prefer the snappier path, hand the panel `paged.goToPage` where it takes a navigation callback.

---

## 2. Public API

```ts
import {
  usePagedView, // React: the whole feature in one hook
  PagedViewControls, // prev / page number / next / mode switch + aria-live
  attachPagedView, // framework-free equivalent of the hook
  getActivePagedView, // the attached controller, when paged mode is on
  getAttachedPagedView, // …regardless of mode
  // persistence
  loadViewMode,
  saveViewMode,
  subscribeViewMode,
  VIEW_MODE_STORAGE_KEY,
  // pure maths (also useful in tests)
  computeFit,
  clampViewport,
  resolveInsets,
  getFitZoom,
  getPageRect,
  getPageScreenRect,
  getVisibleSceneRect,
  isViewportInsidePage,
  isZoomedIn,
  PAGED_VIEW_PADDING,
  PAGED_VIEW_TRANSITION_MS,
  PAGED_VIEW_GAP_CLEARANCE,
  SETTLE_MS,
} from "./goodnotes/paged";
```

`usePagedView(excalidrawAPI, options?)` returns:

| field | meaning |
| --- | --- |
| `mode` / `isPaged` | `"paged"` \| `"continuous"` |
| `setPaged(bool)` / `togglePaged()` | switch mode (persisted) |
| `pageIndex` / `pageNumber` / `pageCount` | 0-based / 1-based / total |
| `canPrev` / `canNext` | for disabling buttons |
| `isZoomedIn` | user is past the fit zoom (free panning inside the page) |
| `goToPage(i, {animate, cause})` / `next()` / `prev()` | navigate; `false` if the page does not exist |
| `refit({animate})` | re-run the fit (after a layout change you know about) |
| `announcement` | text for an `aria-live` region |
| `controlsProps` | spread onto `<PagedViewControls />` |

Options: `padding` (CSS px around the page, default 16), `keyboard` (default `true`), `getContainer`, `onPageChange(index, count, cause)`, `formatAnnouncement(index, count)`.

`attachPagedView(api, opts)` is the same thing without React and additionally takes `matte: false` (see § 4).

---

## 3. How it works (and why the clamp holds)

- **The fit.** The page rect is fitted with `fit: "contain"` into the editor's real canvas box — `appState.width/height`, which already excludes the page panel and the top bands because they are _outside_ `.excalidraw-container`. Overlaid editor UI (styles panel, zoom pill…) is measured through `excalidrawAPI.getViewportOffsets()`, never assumed, and 16 px of padding is added — capped so the slack can never be wider than `PAGE_GAP`.
- **The clamp is the editor's own.** `setViewport({ lock: { scroll: true, zoom: true, overscroll: false } })` installs `appState.scrollConstraints`, and the editor applies them inside `AppViewport.translate()` — the funnel every wheel, trackpad pan, space-drag, pinch and zoom-pill change goes through. So the clamp is synchronous and at the source; it is _not_ an `onChange` → `updateScene` correction loop.
  - while fitted, the page box is smaller than the viewport, so it rests dead centre — you cannot drift towards a neighbour;
  - zoomed in, the same clamp becomes "pan freely, but only inside this page";
  - `lock.zoom` floors the zoom at the fit, so you cannot zoom out to the stack.
- **The watchdog.** Any _other_ `setViewport` call (page panel, zoom-to-fit, a host navigation) clears the lock. `onChange` therefore schedules a check, debounced until the viewport has been quiet for `SETTLE_MS` (140 ms) **and** no pointer is down — so it can never fight a gesture or an animation (each animation frame re-arms the timer). It only writes when the installed constraints differ from the ones the current page wants; after its own write they match, which is the loop-breaker. A circuit breaker (`MAX_CORRECTION_BURST`) backs off and warns if that ever fails to settle.
- **Page identity.** The controller follows the current page's _frame id_, not its index, so inserting, deleting or reordering pages keeps you on the page you were on.

---

## 4. The matte

Fitting alone is not enough on a portrait-ish canvas: when the fit is width-constrained there is vertical slack, and `PAGE_GAP` (48 scene px) is small enough that a sliver of the neighbouring page shows in it — the exact "PDF scroll" look being removed. The controller therefore paints a matte over everything outside the current page: one `pointer-events: none` element with a large `box-shadow` in the desk colour, inserted as a sibling of `.excalidraw-container` at `z-index: 3` — above the paper layer (0) and both canvases (2), below the editor's UI layer (4). Drawing, selection and the editor's own UI are unaffected (verified).

The desk colour is _sampled_ from the rendered paper-layer canvas, because this app's `appState.viewBackgroundColor` is `"transparent"` (the paper module paints the desk). Pass `matte: false` to `attachPagedView` to switch it off.

---

## 5. Accessibility

- **No gesture is required.** Every page is reachable from `PagedViewControls` (prev / next / type a page number), the page panel, and the keyboard.
- **Keyboard** (when the canvas or editor shell has focus, no text being edited, no dialog open): `→`/`↓`/`PageDown` next page, `←`/`↑`/`PageUp` previous, `Home`/`End` first/last. Arrow keys defer to a real selection (they nudge elements, as in the editor) — except when the only selection is a page frame, where turning the page wins over shoving a page out of the column. The handler runs in the capture phase and claims the key only when it actually turns a page.
- **Announcements.** Every page change, from any route, produces `"Page 3 of 7"` in the `role="status" aria-live="polite"` region inside `PagedViewControls`. To place it yourself, render `<span role="status" aria-live="polite" className="sr-only">{paged.announcement}</span>`.
- **Reduced motion.** `prefers-reduced-motion: reduce` makes page changes jump instead of animate (measured: 28 ms vs 307 ms).

---

## 6. Measured behaviour (Chromium, dev server, 4-page document)

| check | result |
| --- | --- |
| page fills the workspace | 1400×900 window → canvas box 1211×810.34, page on screen 601.45×778.34 at `top: 16` — exactly the box height minus the 2×16 px padding, zoom 0.737 |
| exactly one page | neighbouring pages are off-screen or covered by the matte in every state tested |
| wheel (40× down, 40× up, 20× sideways) | viewport unchanged, 0 px drift, page index unchanged |
| space-drag 800 px | viewport unchanged |
| zoom in (×6) then pan in 5 directions | zoom 0.74 → 4.4, panning free inside the page, never more than 2.04 scene px past the page edge, neighbour never intersects the viewport |
| zoom out ×30 | floors at the fit zoom (0.737) |
| arrows / PageUp / PageDown / Home / End | page changes and re-fits every time |
| two-finger flick (CDP touch) | next/previous page, animated, re-fitted |
| external `scrollToPage(3)` | adopted — controller follows and re-fits |
| window resize 1400×900 → 900×1100 | re-fits (zoom 0.74 → 0.83, page 679×878.7 in a 711×1010 box) |
| insert page above / reorder / delete / delete all / re-add | stays on the same _frame_, lock re-installed, no churn; empty document drops the lock and hides the matte |
| **feedback loop** | idle 5 s: 1 distinct viewport state, 0 watchdog corrections, 6 `onChange` events (all from the host, none produced by this module). After a 30-wheel + arrow-key burst: settles, 0 corrections in the following 3 s |
| drawing | freedraw through the matte works and binds to the page frame |

---

## 6b. The view-mode override (added for `goodnotes/surface`)

`ViewMode` is still exactly `"paged" | "continuous"`, and Settings → View mode still reads and writes `loadViewMode` / `saveViewMode` / `subscribeViewMode` unchanged. What is new is an **override** on top of that store, for documents that are not made of paper at all (whiteboard mode, `goodnotes/surface`): paged view has no page to fit, so it must stand down while such a document is open.

```ts
import {
  getEffectiveViewMode, // override ?? stored preference — what the viewport obeys
  getViewModeOverride, // the override itself, or null
  setViewModeOverride, // install / remove it; returns the effective mode
  subscribeEffectiveViewMode, // fires on stored-preference AND override changes
} from "./goodnotes/paged";
```

- The override is **never persisted**. The user's paged/continuous choice survives opening a whiteboard and is in force again the moment a paper document is opened.
- The controller now follows `getEffectiveViewMode()` / `subscribeEffectiveViewMode()`; `usePagedView`'s initial state does too. `paged.setPaged()` / `togglePaged()` still write the user's preference, but while an override is installed the viewport stays on the override (the preference takes effect when it is removed).
- `goodnotes/surface`'s `useSurface` installs and removes the override for you (and clears it on unmount). A host that wants its own non-paper surface can call `setViewModeOverride("continuous")` directly.
- Measured: entering whiteboard mode removes `appState.scrollConstraints` (the lock) and the matte within one frame; leaving it re-installs both and re-fits the page under the viewport centre.

## 7. Known gaps / fragile bits

- **The watchdog is a settle-timer, not a transaction.** For ~140 ms after another module navigates, the viewport is genuinely unlocked. That is deliberate (it is what makes adoption and animations work), but it means a very fast wheel _immediately_ after an external `setViewport` could travel past the current page before the lock is back. It will snap to a page on the next settle, so the end state is always valid.
- **Adoption is centre-of-viewport based.** If another module leaves the viewport between two pages, the controller picks the nearest one (`getPageIndexAtSceneY`). It cannot know what the other module _meant_.
- **Measured UI insets are a snapshot.** They are re-measured on every re-fit, but a panel that appears without any `onChange` and without a resize would not trigger one. Call `paged.refit()` if you add such a surface.
- **The matte's desk colour is sampled from a pixel.** If `goodnotes/paper` ever paints a gradient or a texture into the gap, the matte will be a flat approximation of it. The sample is re-taken at most every 400 ms.
- The matte element is appended as the _last_ child of `.gn-shell-canvas`, i.e. into a React-managed parent. React only ever inserts before its own children, so this is safe in practice, but it is a DOM-level assumption.
- Everything was verified in **Chromium with synthesised input**, including CDP touch for the flick — not on a real iPad.
- `PAGE_GAP`-sized slivers are handled by the matte, but if a host disables it (`matte: false`) on a portrait canvas, the neighbouring page will peek by a few dozen pixels.

---

## 8. The lock is no longer rigid: `overscroll` (added for the hand tool)

`applyLock` used to install `lock: { scroll: true, zoom: true, overscroll: false }`. That made every _navigation_ gesture a dead control while the page is fitted — at the fit zoom the page box is smaller than the viewport, so the clamp has nowhere to move the viewport to. Measured in the running app (iPad Pro 11" viewport, Letter page):

```
                       scrollX / scrollY before   after    content moved
  wheel scroll            378.07 /  21.07        378.07 /  21.07     0.00 px
  space-drag              378.07 /  21.07        378.07 /  21.07     0.00 px
  hand-tool drag          378.07 /  21.07        378.07 /  21.07     0.00 px
```

The lock now installs `overscroll: PAGED_VIEW_OVERSCROLL_PX` (28 CSS px), exported from `./pagedView` and from the module index.

**This is not slack in the clamp.** `ScrollConstraints.overscroll` is the editor's own rubberband (`constrainScrollAxis` in `packages/excalidraw/viewport.ts`), and `AppViewport.snapBack()` / `releaseOverscroll()` return the viewport to exactly the clamp when the gesture ends. The _resting_ viewport is bit-identical to before:

|  | before | after |
| --- | --- | --- |
| resting `scrollX / scrollY`, page fitted | `378.07 / 21.07` | `378.07 / 21.07` |
| peak during a hand drag | `378.07 / 21.07` (0.00 px) | `378.07 / −15.80` (**−28.00 px**) |
| page rect on screen after `refit()` | — | `left 287.14, top 16.00, 619.73 × 802.00` in a `1194 × 834` box |
| watchdog corrections after a refit | — | `0` |

### Why 28 and not the editor's default

`resolveOverscroll(true)` is `DEFAULT_OVERSCROLL = 150` px, which would drag a neighbouring page into view — pages are `PAGE_GAP` (48) scene px apart, and the vertical clearance budget is `PAGE_GAP * PAGED_VIEW_GAP_CLEARANCE * zoom` ≈ 31 CSS px at the fit zoom of a Letter page on an iPad Pro 11". 28 is the same figure `goodnotes/input`'s one-finger pan already uses (`OVERSCROLL_MAX_PX`). **Keep the two in step.**

### What did NOT change

- `lockMatches` does not compare `overscroll`, so the watchdog's loop-breaker is unaffected (verified: `getCorrectionCount() === 0` after a refit).
- The two-finger flick still turns pages and lands on the exact fit — verified with CDP touch: page 0 → 1 → 0, resting viewport back to `378.07 / 21.07`.
- Arrow keys, `goToPage`, the page panel and adoption are untouched.
- No tool change resizes the canvas: canvas `top 0`, `height 834`, `appState.width/height 1194 × 834` across Pen / Highlighter / Eraser / **Hand** / Select.

### The page turn cannot leave the document

Verified on a **single-page** document: a hand overdrag past the threshold, three times (up, down, up), is a **no-op** — `pageIndex` stays `0` of `1`, the 28 px rubberband is held and springs exactly back (`scrollY 21.07 → ±28.00 px held → 21.07`, net `0.00`), and the app stays healthy throughout (`window.h` live, 3 canvases, controller present, no page errors). The fit afterwards is still exact (`left 287.14, top 16.00, 619.73 × 802.00`, one watchdog correction, well inside `MAX_CORRECTION_BURST`).

On a two-page document the same is true at both ends: at page 0 a downward overdrag stays at 0, at the last page an upward overdrag stays there.

This needs no guard in `handPan.ts`: it calls `controller.next()` / `prev()`, which go through `goToPage`, whose first act is `if (index < 0 || index >= pages.length) return false`. `onPageTurn` only fires when that returns `true`, so the cooldown is not even consumed by a refused turn.

### One known side effect, in `packages/` (not fixed — app-level only)

With `overscroll > 0`, `AppViewport.translate` calls `this.snapBackDebounced()` from _inside_ a `setState` updater (`packages/excalidraw/components/App.viewport.ts`, `translate`, the `if (overscroll > 0)` branch). React logs _"An update … was scheduled from inside an update function"_ in development. **It is pre-existing**: the same warning is emitted with `overscroll: false` by another path, verified by temporarily reverting this change. No behavioural effect was observed. The fix is to hoist that call out of the updater, which is a `packages/` change.
