# Integration — Pen & touch input (`goodnotes/input`)

Palm rejection, pencil-only drawing, two-finger page flicks, two/three-finger tap for undo/redo, a stylus hover preview — and **auto-hiding chrome**.

## Auto-hiding chrome (`chromeVisibility`)

The chrome fades out the moment a stroke begins and comes straight back when you stop. It lives here because this module already knows whether a stylus is down, whether palm rejection is suppressing a finger, and whether a gesture is in flight.

**It never touches the shell's DOM.** Two contracts:

```ts
import { subscribeChromeVisibility } from "./goodnotes/input";

const stop = subscribeChromeVisibility(({ visible, reducedMotion }) => {
  // render your bar from this
});
```

…and one attribute on `<html>`: `data-gn-chrome="visible" | "hidden"` (plus `data-gn-chrome-instant` when the user asked for reduced motion). Mark any surface with `data-gn-chrome-surface` and the stylesheet shipped here fades it; the current shell classes (`.gn-bar-scope`, `.gn-nav-scope`, `.gn-tabbar`, the docked tool band) and Excalidraw's own bottom-left zoom/undo island are matched as a bridge until the shell opts in. `useInputGestures()` also returns `chromeVisibility` for React hosts.

### How it decides

| Event | Result |
| --- | --- |
| Pointer-down on the canvas with a mark-making tool, and that pointer is allowed to draw (a finger is not, while palm rejection holds `appState.penMode`) | **hide** |
| That pointer lifts having moved ≤ 8 px — a tap, including a tap on empty canvas | **reveal** |
| Any pointer that is not drawing: a finger pan, a second finger (gesture), a pointer off-canvas, a non-drawing tool | reveal |
| Any `keydown` | reveal, and block hiding for 2.5 s (`KEYBOARD_GRACE_MS`) |
| `focusin` anywhere outside the canvas (Tab, screen reader, a click on a button) | reveal |
| A menu, popover or dialog is open (`BLOCKING_SELECTORS`) | refuses to hide |
| A text field has focus, including Excalidraw's canvas text editor | refuses to hide |
| Window blur, or the switch turned off | reveal |

Default **on**, with a labelled checkbox ("Hide the toolbars while writing") in `InputSettingsPanel`, which already renders inside the Settings screen.

### The accessibility decision, and why

Hidden chrome is **faded (`opacity: 0`), not unmounted and not `display: none`**. It therefore stays in the accessibility tree, keeps its place in the tab order, and is still reachable by screen-reader review. Verified with CDP `Accessibility.getFullAXTree`: with `data-gn-chrome="hidden"`, the Pen button is still present as `role=button`, `ignored: false`.

The alternative — genuinely removing it and restoring it on focus — was rejected because it makes the tab order depend on whether a pen happens to be touching the glass: a keyboard user who presses Tab mid-document would land somewhere different every time, and a screen-reader user's model of the page would silently change under them. Fading keeps one stable structure and only changes its paint.

Two rails come with that choice:

- while hidden the surfaces take `pointer-events: none`, so an invisible button cannot be tapped by accident;
- focus reveals the chrome immediately — in JS (`focusin`) and again as a `:focus-within` CSS rule, so it works even if the JS listener is late or the rule is overridden.

`prefers-reduced-motion: reduce` removes the transition entirely (instant swap), both from the media query and from the `data-gn-chrome-instant` attribute the store sets.

This module **does** depend on a small editor patch (3 hunks in one file) — see § 4. The app-level part below is all you need in `App.tsx`.

---

## 1. `App.tsx` changes — exact diff

### 1a. Imports

Next to the other `goodnotes/*` imports (~line 87):

```tsx
import { InputSettingsPanel, useInputGestures } from "./goodnotes/input";
```

### 1b. Install the layer

`excalidrawAPI` already exists in `ExcalidrawWrapper` (`const excalidrawAPI = useExcalidrawAPI();`, ~line 397). Add below the `usePages(...)` line (~line 413):

```tsx
const input = useInputGestures(excalidrawAPI);
```

`excalidrawAPI` may be `null` on the first render — the hook attaches as soon as it arrives, and detaches on unmount. Nothing else is required: palm rejection, the page flick and the tap gestures are live from here.

### 1c. Make the nav bar's undo/redo buttons work

`excalidrawAPI.history` only exposes `clear` in this fork (`packages/excalidraw/components/App.tsx`: `history: { clear: this.resetHistory }`), so `excalidrawAPI.history.undo()` — as `goodnotes/shell`'s README suggests — is `undefined` at runtime. Use these instead, on the `<NavBar>` (~line 1120):

```tsx
  onUndo={input.undo}
  onRedo={input.redo}
```

They dispatch the editor's own Cmd/Ctrl+Z (see `history.ts` for why that is the supported route) and return `false` if a text field has focus.

### 1d. Show the settings

Anywhere outside `<Excalidraw>` — e.g. in the "…" overflow menu's popover, or beside `<ToolMenu>` after the closing `</Excalidraw>`:

```tsx
      </Excalidraw>
      <InputSettingsPanel {...input.settingsPanelProps} theme={editorTheme} />
```

The panel's root carries the `excalidraw` class so the editor's CSS custom properties are in scope wherever it is mounted. It is a plain block element — size and place it with the wrapping popover, or pass `className`.

### 1e. (optional) React to claimed gestures

```tsx
const input = useInputGestures(excalidrawAPI, {
  onGesture: (event) => {
    if (event.type === "swipe") {
      setStatus(`Page ${event.to + 1}`);
    }
  },
});
```

---

## 2. Public API

| Export | What it is |
| --- | --- |
| `useInputGestures(excalidrawAPI, options?)` | React entry point. Returns `{ settings, setSetting, setSettings, capabilities, undo, redo, settingsPanelProps }`. |
| `attachInputGestures(api, options?)` | The same behaviour without React. Returns `{ detach, notifySettingsChanged }`. |
| `InputSettingsPanel` | Labelled-checkbox settings UI. |
| `requestUndo()` / `requestRedo()` | Working undo/redo for app buttons. |
| `loadInputSettings` / `saveInputSettings` / `subscribeInputSettings` | Settings model (localStorage key `goodnotes:input-settings`). |
| `canOneFingerPan(appState)` / `createOneFingerPan(api)` | The one-finger pan rule and engine, standalone (`pan.ts`). |
| `SWIPE_*`, `TAP_*`, `PEN_ACTIVE_WINDOW_MS`, `HOVER_PREVIEW_*`, `ONE_FINGER_PAN_SLOP_PX`, `OVERSCROLL_*` | Every threshold, named and documented, in `constants.ts`. |

`capabilities` is `{ penSeen, penHoverSupported, touchSeen, rejectingTouch }` — useful for hiding tablet-only UI on a desktop.

---

## 3. What the editor already does (do not re-add)

Measured on this fork, not assumed:

- **Pinch-zoom and two-finger pan** — `App.tsx#updateMultiTouchGesture`. Works; a pinch from 160 px to 440 px of finger separation took zoom 1 → 5.4. Note it only acts with **two** pointers: one finger is never a pan unless the hand tool (or space-drag) is engaged, which is the gap § 5a fills.
- **Pressure / tilt** — freedraw already records `pressures` and falls back to `simulatePressure`; the first pen event also switches `currentItemStrokeVariability` to `"variable"`.
- **`appState.penMode`** — the editor already auto-enables it the first time it sees a `pointerType: "pen"` event, and `allowOnPointerDown` then stops `touch` pointers from starting a drawing tool while still allowing selection, pan and pinch. **This module drives that flag** rather than re-implementing rejection; it adds the recency window, the explicit pencil-only pin, and arming from _hover_ (before the nib ever touches).
- **Touch double-tap to add text**, long-press context menu, and discarding a short freedraw spike when a second finger lands.

---

## 4. The editor patch (`packages/excalidraw/components/App.tsx`)

Three hunks, one file, all in the pointer path. Each fixes a measured tablet-only defect; none of them is reachable from app code.

1. **`updateGestureOnPointerDown` ignores `pointerType === "pen"`.** A stylus was being added to `gesture.pointers`, so _palm + nib_ read as two pointers: the pen stroke became a pan (`gesture.pointers.size > 1` returns early in `handleCanvasPointerDown`). Measured before: the pen stroke was lost and the canvas jumped by 30 px. After: the pen draws.
2. **A pen landing during a touch freedraw discards that stroke.** The existing "second finger" branch only fired for `pointerType === "touch"` and only for strokes under 10 points. A palm that rests _before_ the nib lands therefore left a scribble on the page. Now, when the pointer is a pen and `lastPointerDownWith === "touch"`, the in-progress stroke is dropped whatever its length — and, unlike the second-finger case, the handler continues so the pen starts its own stroke.
3. **Pinch-zoom is no longer disabled by pen mode alone.** `scaleFactor` was pinned to `1` whenever `activeTool === "freedraw" && penMode`. On a tablet the user lives in the freedraw tool, so pinch-zoom was unreachable while writing (measured: zoom stayed at 1.0 through a 1 → 2.5 pinch; with the selection tool the same pinch zoomed). It is now pinned only while a freedraw stroke is actually in progress (`state.newElement?.type === "freedraw"`), which is the case the guard was written for (a palm brushing the glass mid-stroke).

All 1178 editor unit tests (`npx vitest run packages/excalidraw/tests`), including `regression tests > pinch-to-zoom works`, pass with the patch.

---

## 5. Thresholds

A page flick is claimed only when **all** of these hold (`constants.ts`):

| Constant | Value | Why |
| --- | --- | --- |
| `SWIPE_POINTER_COUNT` | 2 | One finger is ink, a hand-tool pan, or (see § 5a) a one-finger page pan. |
| `SWIPE_MIN_DISTANCE_PX` | 90 | Below this it is a nudge. |
| `SWIPE_HORIZONTAL_DOMINANCE` | 2 | `\|dx\| > 2·\|dy\|` — the main guard against stealing a diagonal pan. |
| `SWIPE_MIN_VELOCITY_PX_PER_MS` | 0.45 | A _flick_, not a slow reposition. |
| `SWIPE_MAX_DURATION_MS` | 600 | Longer is a pan. |
| `SWIPE_MAX_PINCH_RATIO` | 0.25 | A pinch is never a swipe. |
| `PEN_ACTIVE_WINDOW_MS` | 5000 | How long after the last pen event fingers stay locked out of ink. |
| `TAP_MAX_DURATION_MS` / `TAP_MAX_MOVEMENT_PX` | 260 / 18 | Tap, not drag. |
| `ONE_FINGER_PAN_SLOP_PX` | 6 | Jitter of a resting fingertip is not a pan. |
| `OVERSCROLL_MAX_PX` / `OVERSCROLL_SPRING_MS` | 28 / 220 | Rubberband hint when the page already fits. |

The gesture is resolved **when the last finger lifts**, never mid-drag, so an ambiguous movement always stays with the editor. The stray pan the editor did in the meantime is corrected by the `scrollToPage` that follows.

`scrollToPage` is called with `fit: "none"` so a flick keeps your zoom, and with `animate: !prefersReducedMotion()`.

### 5a. One-finger panning

**The bug it fixes.** With palm rejection up (`appState.penMode`), the editor refuses a `touch` pointer on a drawing tool (`allowOnPointerDown`) — and it only pans with _two_ pointers. So a one-finger drag did **nothing at all**: measured in paged mode, zoomed to 2.23×, a 300 px one-finger drag moved `scrollY` by 0.00 and drew nothing. That is the "I can't scroll the page with my finger" report.

**The rule** (`canOneFingerPan`, `pan.ts`): one finger pans **only when the finger cannot be the drawing instrument** — `penMode` is up _and_ the active tool is not one the editor still honours for touch (`selection`, `lasso`, `text`, `image`). In exactly those states the editor drops the touch on the floor, so nothing is stolen and nothing has to be `preventDefault`-ed (which would break pinch, see the header of `gestures.ts`). Consequences, all measured:

| State | One finger does |
| --- | --- |
| No stylus seen, palm rejection idle | **draws** — the finger _is_ the pencil |
| Stylus used in the last `PEN_ACTIVE_WINDOW_MS`, drawing tool | **pans** |
| "Pencil-only drawing" on, drawing tool | **pans** |
| Selection / lasso / text / image tool | selects / marquees, as the editor intends |
| Hand tool | the editor's own one-finger pan, untouched |

A user with no stylus who still wants finger panning turns on **Pencil-only drawing** — which is exactly the statement "my finger is not a pen". That is why this is not a separate three-way setting; the on/off switch (`oneFingerPan`, default **on**) only exists to opt out entirely.

**Clamping.** The pan does not go through the editor's internal `viewport.translate()` (not on the imperative API), so it applies the same clamp itself via `goodnotes/paged`'s `clampViewport`, fed from `appState.scrollConstraints`. Measured: one-finger panning stops at scene `y = 2201.2 … 3270.8` for a page occupying `2208 … 3264` with 6.8 scene px of inset slack — i.e. bit-for-bit the limit the editor's own two-finger pan reaches. A neighbouring page is never reachable. With no constraints installed (continuous mode) the pan is free.

**Rubberband.** When the page already fits there is genuinely nowhere to go. Rather than feel dead, the pan applies its own asymptotic give — at most `OVERSCROLL_MAX_PX` (28 px, measured peak 25.5 px for a 300 px drag) — and springs back to the clamp over `OVERSCROLL_SPRING_MS`. It is a _hint_, never navigation: it is far smaller than the page-gap clearance paged mode keeps, so no neighbouring page edge is ever exposed, and the gesture always ends exactly on the clamp (net `Δ 0.00`).

### Paged view

When `goodnotes/paged` is active (`getActivePagedView()` returns a controller — i.e. the user is in paged mode and the editor has mounted), the flick does **not** scroll: it calls that controller's `next()` / `prev()`, so the flick lands exactly where the arrow keys and the page controls land — the destination page animated into a fit, and the change announced through the module's `aria-live` region. `SWIPE_PAGE_FIT` then applies to continuous mode only.

The recogniser itself is unchanged, so the thresholds below still describe what counts as a flick in either mode.

---

## 6. Accessibility

- Every switch is an `<input type="checkbox">` + `<label>` inside a `<fieldset>`/`<legend>`, each with an `aria-describedby` hint, and a `role="status"` line reporting what the device turned out to support.
- `:focus-visible` rings on every control; the panel and the hover dot both honour `@media (prefers-reduced-motion: reduce)`.
- **No gesture is the only route to anything.** Pages: the page panel. Undo/redo: Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z, plus the nav-bar buttons once wired as in § 1c.

---

## 7. Known gaps

- Everything was verified in **Chromium with CDP-synthesised pen and touch input**, not on an iPad. Chromium's synthetic `pointerType: "pen"` is a faithful stand-in for event _routing_, but not for Apple Pencil latency, coalesced events (`getCoalescedEvents`) or real pressure curves.
- **Stylus hover is feature-detected, never assumed.** The dot appears only after a real `pen` event with `buttons === 0` has been seen; on iPadOS that happens only with hover-capable Pencil/iPad pairings. On everything else the code is inert and `capabilities.penHoverSupported` stays `false`.
- **One-finger panning is measured with CDP-synthesised touch**, which has no inertia, no palm contact geometry and no Safari rubberband of its own. On iPadOS, Safari's own overscroll on the page body is a separate thing from the canvas rubberband here; the canvas has `touch-action: none`, so it should not fire, but that is unverified on hardware.
- **Pencil-only used to be lost on document open.** The app pushes a restored `appState` when a document loads, which resets `penMode` to `false`; the stale `penModeRequested` guard then read "already asked for" forever, so "pencil only" silently did nothing for the rest of the session. The layer now watches `api.onChange` for a `penMode` it did not write and re-asserts the setting.
- Palm rejection is coarse-grained by design: it is "fingers don't ink while the pen is in use", not contact-geometry analysis (the web exposes no touch radius on `PointerEvent` reliably enough to do better).

---

## 8. The hand tool, and how it coexists with paged mode (`handPan.ts`)

The hand tool used to be a **dead control** in this app, and was correctly left out of the bar for it. Measured in the running app at an iPad Pro 11" viewport, with a Letter page fitted:

```
                       scrollX / scrollY before   after    content moved
  wheel scroll            378.07 /  21.07        378.07 /  21.07     0.00 px
  space-drag              378.07 /  21.07        378.07 /  21.07     0.00 px
  hand-tool drag          378.07 /  21.07        378.07 /  21.07     0.00 px
```

Nothing was broken: at the fit zoom the page box is *smaller* than the viewport, so the page lock has nowhere to move the viewport to, and that is the clamp doing its job. The tool simply had nothing to pan.

Two changes make it real, and they are deliberately in different modules:

1. **Inside the page** — `goodnotes/paged` now installs the lock with `overscroll: PAGED_VIEW_OVERSCROLL_PX` (28 CSS px) instead of `false`. Nothing in this module is involved: the editor's own rubberband and `AppViewport.releaseOverscroll()` do all of it.
2. **Between pages** — `handPan.ts`, wired into `attachInputGestures`. A hand drag whose travel the viewport demonstrably could *not* consume is an attempt to go somewhere the current page does not reach; past `HAND_PAGE_TURN_PX` (72 CSS px) of such travel, releasing turns the page through `getActivePagedView()`.

### It cannot fight the editor

`handPan.ts` **writes nothing to the viewport while the pointer is down.** Its listeners are the same passive, capture-phase `document` listeners the rest of this module uses, and the gesture is resolved on *release* — the same contract as the flick and the taps. The editor's own hand pan stays the only thing moving the viewport during the drag.

"Unconsumed" is measured, not assumed:

```ts
unconsumedTravel(pointerDelta, scrollDelta, zoom) === pointerDelta - scrollDelta * zoom;
```

So while there is anywhere left to pan — zoomed in, mid-page — the figure stays at zero and no page turn can fire however far the user drags.

### Measured (Chromium, 1194×834, Letter page, 3 pages)

| gesture | before | after | content moved on screen |
| --- | --- | --- | --- |
| hand drag −80 px, page fitted | `scrollY 21.07` | peak `−15.80`, rest `21.07` | **−28.00 px** held, 0.00 px resting |
| hand drag −300 px, page fitted | page 0 | page 1 | **−838.45 px** |
| hand drag +300 px | page 1 | page 0 | **+838.45 px** |
| hand drag (−120, −140) at zoom 2.2698 | — | — | **−120.00 / −140.00 px**, page unchanged |
| one-finger *touch* hand drag, pencil-only on | — | — | −28.00 px held, then page 0 → 1 |
| hand drag (−250, −180), continuous (no constraints) | — | — | **−250.00 / −180.00 px**, no spring-back |

### Settings

The gesture is governed by the existing `swipePages` switch — "a drag can turn the page" is one idea with two input shapes, and a second checkbox for the same promise would be chrome without a purpose. Its label and hint in `InputSettingsPanel` already read as "gesture page turns".

### One-finger pan and the hand tool

`canOneFingerPan` now returns `false` for the `hand` tool (`"hand"` added to `TOUCH_TOOLS_IN_PEN_MODE` in `pan.ts`). With pencil-only on and the hand tool active, both this module's one-finger pan and the editor's own hand pan used to arm on the same drag. **Measured, this made no visible difference** — the editor's `translate()` runs last in each frame and simply overwrote this module's `updateScene` write, so the net motion was already 1:1 (−120.00 px asked, −120.00 px delivered, before and after the change). The change is therefore hygiene, not a fix: it removes a redundant writer, a competing second rubberband at the page edge, and a spurious `one-finger-pan` gesture event.
