# INK — integration notes

Lower-latency, higher-fidelity handwriting with a stylus. **No new dependencies**: `perfect-freehand@1.2.0` was already in the tree and already draws every freedraw outline. The wins come from (a) not throwing away the pen's samples, and (b) letting the user pick how hard those samples are filtered.

---

## 1. Coalesced sample capture (the big one)

### What was wrong

A stylus reports 120–240 samples/second. The editor kept **one point per animation frame** and discarded everything else, twice over:

1. the browser coalesces several digitizer samples into each dispatched `pointermove`, and the editor never called `getCoalescedEvents()`;
2. `onPointerMoveFromPointerDownHandler` is wrapped in `withBatchedUpdatesThrottled` → `throttleRAF`, which keeps only the _last_ event per frame and drops the rest outright.

### What changed

`packages/excalidraw/components/App.tsx` now runs an **unthrottled** wrapper around the throttled move handler. The wrapper banks every coalesced sample (coordinates _and_ its own pressure); the throttled handler drains the bank once per frame and appends all of them in a single `mutateElement` call.

So stroke fidelity is decoupled from frame rate, while rendering still happens once per frame — no extra re-renders, no extra React work.

Where `getCoalescedEvents()` is unavailable (or throws), the wrapper falls back to the single dispatched event, i.e. exactly the old behaviour.

### Measured (Chromium, synthetic 240 Hz-equivalent stroke)

Identical fast stroke: 120 digitizer samples delivered as 30 dispatched `pointermove` events × 4 coalesced samples each.

|        | points in the resulting freedraw element         |
| ------ | ------------------------------------------------ |
| before | **32** (1 per frame + pointerdown + pointerup)   |
| after  | **122** (every sample + pointerdown + pointerup) |

**3.8× more points, 73% of the stroke recovered.** A control stroke with no coalesced samples in the events still yields 32 points — the fallback is exact, and ordinary mouse drawing is unchanged.

---

## 2. "Ink feel" preference

### What the old constants do

`packages/element/src/shape.ts`:

```
VARIABLE_WIDTH_FREEDRAW = { SIZE_FACTOR: 4.25, THINNING: 0.6, SMOOTHING: 0.5 }
streamline = element.strokeOptions.streamline   // 0.2 for pen/touch, 0.5 for mouse
```

`streamline` is the one that matters for handwriting: perfect-freehand pulls each input point towards the previous one by that fraction before building the outline. At 0.5 (mouse) it hides desk jitter — great for diagramming — but it also rounds the corners off anything the size of a lowercase letter and leaves the ink visibly trailing the nib.

### What changed

Three presets, mapped onto `streamline` / `smoothing` / `thinning` (`packages/element/src/inkFeel.ts`):

| preset | streamline (pen) | streamline (mouse) | smoothing | thinning |
| --- | --- | --- | --- | --- |
| Smooth | 0.45 | 0.6 | 0.65 | 0.5 |
| **Balanced (default)** | **0.2** | **0.5** | **0.5** | **0.6** |
| Precise | 0.08 | 0.3 | 0.35 | 0.7 |

**Balanced is byte-for-byte the previous behaviour**, so the default cannot regress diagramming. The resolved values are baked into `element.strokeOptions` **at stroke creation time**, so changing the preference never re-shapes strokes already on the page. `smoothing`/`thinning` are only serialised when they differ from the renderer's own defaults, so Balanced strokes serialise exactly as they did before (verified: zero snapshot churn in the editor's test suite).

---

## 3. `simulatePressure` and real pen pressure — what we found

perfect-freehand's `simulatePressure` defaults to `true`, and when it is on, the `pressures` array is **ignored entirely** — width comes from stroke velocity instead of the pen.

Excalidraw decides from the first sample only:

```ts
const simulatePressure = event.pressure === 0.5; // was, in App.tsx
```

A mouse reports exactly `0.5` while a button is held, so this is a reasonable "no sensor" test — but **a stylus that happens to touch down at mid-force reports 0.5 too**, and the whole stroke then renders with simulated pressure and the pen's real force is thrown away. Confirmed empirically in Chromium: a synthetic pen stroke with `pressure: 0.5` at pointerdown and genuine varying pressure afterwards produced `simulatePressure: true` and **`pressures: []`** — every real pressure reading discarded.

The fix is a user opt-in rather than a silent behaviour change, because the heuristic is _also_ right for digitizers (and virtualised/remote-desktop pen pipelines) that report a constant 0.5 for every sample; trusting those gives a dead, uniform-width line. With **"Always use real pen pressure"** on, the same stroke records 42/42 pressures ranging 0.00–0.80.

### Caveat worth knowing

The app's default pen is **constant-width** (`appState.currentItemStrokeVariability === "constant"`), which renders via `LaserPointer` with pressure pinned to `1`. On that pen, pressure — real or simulated — does nothing at all, and `thinning`/`smoothing` are not consulted either; only `streamline` applies. Pressure work only shows up on the variable-width pen.

---

## 4. Predicted events — NOT shipped

`getPredictedEvents()` is available in this browser and would hide perceived lag by drawing ahead of the nib. It is **deliberately not implemented**.

Predicted points would have to be appended to `element.points` and then removed again when the real samples land. But `element.points` is not a private render buffer — it is read mid-stroke by autosave/localStorage, the collaboration broadcast, history/versioning and hit-testing. A frame in which a phantom tail is visible to any of those produces a permanently wrong stroke, and a wrong stroke is far worse than a slightly laggy one.

Doing it safely needs a separate "wet ink" overlay that renders the predicted tail without committing it to the element — a renderer change well outside this patch. Skipped, as briefed.

---

## Files touched under `packages/`

| file | why |
| --- | --- |
| `packages/element/src/inkFeel.ts` | **new.** Ink-feel presets, the module-level preference slot, `resolveFreedrawStrokeOptions()` and `shouldSimulatePressure()`. Lives in the element package because `App.tsx` reads it synchronously on pointerdown — there is no render-time prop to thread it through. |
| `packages/element/src/index.ts` | one line: `export * from "./inkFeel"`. |
| `packages/element/src/types.ts` | `StrokeOptions` gains optional `smoothing` / `thinning`. Optional, so old scenes and programmatically created elements are unaffected. |
| `packages/element/src/shape.ts` | `getFreedrawSmoothing()` / `getFreedrawThinning()` read the per-element values, falling back to the existing `VARIABLE_WIDTH_FREEDRAW` constants. |
| `packages/excalidraw/data/restore.ts` | `restoreFreedrawStrokeOptions()` preserves `smoothing`/`thinning` when present (and only when present). |
| `packages/excalidraw/components/App.tsx` | the coalesced-sample bank + the freedraw move branch that drains it; `strokeOptions` and `simulatePressure` at pointerdown now come from `inkFeel.ts`. |

Nothing else in `packages/` was modified.

## Wiring this app-side

```tsx
import { initInkFeel, InkFeelSettings, useInkFeel } from "./goodnotes/ink";

initInkFeel(); // once at app start, before the first stroke

// self-managing:
<InkFeelSettings />;

// or controlled, for the consolidated Settings screen:
const ink = useInkFeel();
<InkFeelSettings
  settings={ink.settings}
  onChange={(next) => {
    /* ... */
  }}
/>;
```

`initInkFeel()` is idempotent and is also called by `useInkFeel()`, so mounting the settings control is enough to apply the stored preference. Coalesced capture needs no wiring at all — it is unconditional.

## Not verified

None of this has been tested on real Apple Pencil hardware (or any real digitizer). The sample-count numbers come from synthetic `PointerEvent`s carrying `coalescedEvents` in headless Chromium. The _mechanism_ is the one real hardware exercises, but the actual per-frame sample counts, pressure curves and the subjective feel of each preset need a device.
