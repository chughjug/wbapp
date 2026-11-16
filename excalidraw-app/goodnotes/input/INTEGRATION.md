# Integration — Pen & touch input (`goodnotes/input`)

Palm rejection, pencil-only drawing, two-finger page flicks, two/three-finger tap for undo/redo, and a stylus hover preview.

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
| `SWIPE_*`, `TAP_*`, `PEN_ACTIVE_WINDOW_MS`, `HOVER_PREVIEW_*` | Every threshold, named and documented, in `constants.ts`. |

`capabilities` is `{ penSeen, penHoverSupported, touchSeen, rejectingTouch }` — useful for hiding tablet-only UI on a desktop.

---

## 3. What the editor already does (do not re-add)

Measured on this fork, not assumed:

- **Pinch-zoom and two-finger pan** — `App.tsx#updateMultiTouchGesture`. Works; a pinch from 160 px to 440 px of finger separation took zoom 1 → 5.4.
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
| `SWIPE_POINTER_COUNT` | 2 | One finger is ink or a hand-tool pan. |
| `SWIPE_MIN_DISTANCE_PX` | 90 | Below this it is a nudge. |
| `SWIPE_HORIZONTAL_DOMINANCE` | 2 | `\|dx\| > 2·\|dy\|` — the main guard against stealing a diagonal pan. |
| `SWIPE_MIN_VELOCITY_PX_PER_MS` | 0.45 | A _flick_, not a slow reposition. |
| `SWIPE_MAX_DURATION_MS` | 600 | Longer is a pan. |
| `SWIPE_MAX_PINCH_RATIO` | 0.25 | A pinch is never a swipe. |
| `PEN_ACTIVE_WINDOW_MS` | 5000 | How long after the last pen event fingers stay locked out of ink. |
| `TAP_MAX_DURATION_MS` / `TAP_MAX_MOVEMENT_PX` | 260 / 18 | Tap, not drag. |

The gesture is resolved **when the last finger lifts**, never mid-drag, so an ambiguous movement always stays with the editor. The stray pan the editor did in the meantime is corrected by the `scrollToPage` that follows.

`scrollToPage` is called with `fit: "none"` so a flick keeps your zoom, and with `animate: !prefersReducedMotion()`.

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
- Palm rejection is coarse-grained by design: it is "fingers don't ink while the pen is in use", not contact-geometry analysis (the web exposes no touch radius on `PointerEvent` reliably enough to do better).
