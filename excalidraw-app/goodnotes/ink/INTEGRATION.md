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

---

# The sub-pixel floor (why thin strokes looked rough, and what was done)

Added after the continuous-width slider shipped and thin pens were reported as "rough / jagged / broken". **The finding is a negative one for smoothing: nothing about the recorded path or its filtering changes with stroke width. The artefact is rasterisation, and the fix is a minimum rendered width.**

## 1. What was ruled out, and how

Every measurement below: Chromium via Playwright against the running app, 1194×834, the _same_ synthetic curved gesture (220 trusted pen samples, two humps plus a high-frequency wobble — nothing straight), freedraw drawn through real `Input.dispatchMouseEvent` with `pointerType: "pen"`.

### Input sampling — already fixed, not the cause

The coalesced-sample capture described in § 1 above is live and works: a 220-sample gesture produces an element with **220 points at every width** (0.1 through 6). Nothing is thrown away, and the count does not depend on width.

### Path geometry and filtering — identical at every width

Over the same gesture, the recorded centreline is byte-identical from 0.1 to 6:

|                     |   0.1 |   0.2 |   0.5 |     1 |     2 |     6 |
| ------------------- | ----: | ----: | ----: | ----: | ----: | ----: |
| points              |   220 |   220 |   220 |   220 |   220 |   220 |
| path length (px)    | 489.8 | 489.8 | 489.8 | 489.8 | 489.8 | 489.8 |
| total turning (deg) | 664.4 | 664.4 | 664.4 | 664.4 | 664.4 | 664.4 |
| direction reversals |     7 |     7 |     7 |     7 |     7 |     7 |
| `streamline`        |   0.2 |   0.2 |   0.2 |   0.2 |   0.2 |   0.2 |

A thin stroke is not jaggier than a thick one _as a path_. `streamline`, `smoothing`, `thinning` and `simulatePressure` therefore cannot be the cause — they are width-independent, and the thick stroke they produce looks fine. **No perfect-freehand option was changed.** Point simplification is not involved either: `rescalePoints` only runs on resize, and the constant-width outline's `simplify` is already 0.

### The decisive experiment: magnify the same stroke

Draw once at a width, then look at it at several zooms. The patchiness metric is `colMaxCV` — the coefficient of variation of the per-column peak alpha along the stroke. A line of even darkness has a low value; one that fades in and out has a high one.

| drawn at | viewed at | ink width (device px) | `colMaxCV` | mean column alpha |
| --: | --: | --: | --: | --: |
| 0.1 | 100% | 0.28 | 0.249 | 0.287 |
| 0.1 | 200% | 0.56 | 0.196 | 0.547 |
| 0.2 | 100% | 0.56 | 0.194 | 0.531 |
| 0.1 | 400% | 1.12 | 0.132 | 0.872 |
| 0.2 | 200% | 1.12 | 0.142 | 0.868 |
| 0.1 | 800% | 2.24 | 0.050 | 0.997 |
| 0.2 | 400% | 2.24 | 0.038 | 0.998 |
| 2 | 100% | 5.60 | 0.083 | 0.990 |

The metric collapses onto **rendered pixel width**, not onto `strokeWidth`. A 0.1 stroke magnified to 2.24 device pixels is as smooth as a 2.0 stroke — same element, same points. So the geometry is perfect and the roughness is created at rasterisation time.

### Why — the mechanism

A freedraw stroke is a _filled ribbon_, and the ink it lays down is `strokeWidth * 2.8` scene units wide (measured: ink mass ÷ path length is 2.80 at `strokeWidth` 1 and 5.64 at 2; `LaserPointer`'s `size` is the half-width and `CONSTANT_WIDTH_FREEDRAW.SIZE_FACTOR` is 1.4). At 100% zoom on a 1× display:

- `strokeWidth` 0.357 → exactly 1 device pixel.
- `strokeWidth` 0.1 → **0.28 device pixels.**

Below one pixel the ribbon cannot cover any pixel fully, so each pixel's alpha is whatever fraction of it the ribbon happens to cross — which depends on the sub-pixel phase of the centreline and on the local slope. The line comes out grey, uneven, and apparently broken. That is the complaint, in full.

## 2. The fix: a one-device-pixel hairline floor

`packages/element/src/renderElement.ts`, `getFreedrawHairlineCompensation()`. When a uniform-width freedraw ribbon would render narrower than one device pixel, it is widened to one device pixel and its alpha is scaled by the same factor. Total ink is conserved, so the line stays exactly as light as its width says it should be — it just stops breaking up.

- The device scale is read from `context.getTransform()`, so it is correct in the per-element cache (zoom × backing store), on the export canvas, and at any zoom, with no new plumbing.
- Widening is done by stroking the outline rather than regenerating it, and — where the two edge bands meet in the middle, which is every case below half a pixel — the fill is skipped so there is exactly **one** composite. Two overlapping composites at alpha < 1 darken where they meet, which is the artefact being removed.
- The floor is **1 device pixel and not more** on purpose. At 1 px it engages only below `strokeWidth` 0.357 at 1× / 100% — strictly inside the range that the continuous-width slider added. A 1.5 px floor would have caught the old `thin` (0.5) and changed notes people have already written.

## 3. Before / after

Same gesture, `colMaxCV` = patchiness (lower is smoother), `colMaxMean` = average darkness of the line, `inkMass` = total ink.

### `deviceScaleFactor` 1, zoom 100%

| width | ink px | CV before | CV after | mean before | mean after | mass before | mass after |
| --: | --: | --: | --: | --: | --: | --: | --: |
| 0.10 | 0.28 | 0.238 | **0.136** | 0.291 | 0.266 | 139.10 | 155.56 |
| 0.15 | 0.42 | 0.247 | **0.118** | 0.405 | 0.296 | 202.96 | 186.64 |
| 0.20 | 0.56 | 0.194 | **0.121** | 0.527 | 0.492 | 269.98 | 303.16 |
| 0.30 | 0.84 | 0.171 | 0.148 | 0.729 | 0.657 | 408.93 | 406.89 |
| 0.35 | 0.98 | 0.150 | 0.148 | 0.810 | 0.794 | 475.31 | 469.82 |
| 0.40 | 1.12 | 0.132 | 0.132 | 0.867 | 0.867 | 549.18 | 549.18 |
| 0.50 | 1.40 | 0.090 | 0.090 | 0.951 | 0.951 | 683.11 | 683.11 |
| 1.00 | 2.80 | 0.036 | 0.036 | 0.998 | 0.998 | 1372.29 | 1372.29 |
| 2.00 | 5.60 | 0.036 | 0.036 | 0.997 | 0.997 | 2762.03 | 2762.03 |
| 6.00 | 16.80 | 0.036 | 0.036 | 0.998 | 0.998 | 8425.98 | 8425.98 |

**0.4 and above are bit-identical.** Thick strokes were not touched.

### `deviceScaleFactor` 2 (iPad), zoom 100%

A 2× display halves the threshold to `strokeWidth` 0.18, so only 0.1 and 0.15 are hairlines there and everything else is already clean:

| width | CV before |  CV after | mean before | mean after |
| ----: | --------: | --------: | ----------: | ---------: |
|  0.10 |     0.186 | **0.106** |       0.544 |      0.504 |
|  0.15 |         — |     0.143 |           — |      0.664 |
|  0.20 |     0.130 |     0.130 |       0.885 |      0.885 |
|  0.50 |     0.033 |     0.033 |       0.998 |      0.998 |
|  2.00 |     0.019 |     0.019 |       0.999 |      0.999 |

### At the app's real default zoom (76%, `deviceScaleFactor` 1)

This is what a user actually sees on a page-fitted sheet, and it is where the problem was worst and the gain largest:

| width | CV before |  CV after | mass before | mass after |
| ----: | --------: | --------: | ----------: | ---------: |
|  0.10 |     0.340 | **0.168** |      105.75 |     128.44 |
|  0.20 |     0.244 | **0.123** |      204.57 |     189.44 |
|  0.50 |     0.143 |     0.143 |      519.97 |     519.97 |

### Other checks

- **Live stroke vs committed stroke** are pixel-identical (mass 155.56, CV 0.136 both before and after `pointerup`): the floor applies to the in-progress stroke too, so there is no flicker when the pen lifts.
- **Highlighter** (3.5, 45% opacity, `multiply`) is untouched: CV 0.029, mass 2193.56, identical.
- **Variable-width pen** is deliberately untouched (see gaps).

## 4. What this does _not_ fix, honestly

- **A hairline is lighter, not thinner.** Below ~0.36 (1× / 100%) or ~0.18 (2× / 100%) the slider stops changing the line's thickness and starts changing its opacity. That is physics, not a bug: a line thinner than a pixel cannot exist. `HAIRLINE_PEN_WIDTH` in `goodnotes/pens` exports the 1× / 100% threshold so UI can say so.
- **Residual unevenness.** At 0.1 the CV is 0.136, not the 0.036 of a thick stroke. A 1-pixel line at an arbitrary sub-pixel phase still splits across two pixels, and how it splits still varies along the stroke. Removing that needs a ≥ 2 device-pixel floor, which would visibly fatten the old `thin` pen — not an acceptable trade.
- **It changes already-drawn strokes below 0.4.** Those widths only became reachable when the continuous slider shipped, so the blast radius is notes taken since then, and the change is in the direction of the complaint. Nothing at 0.4 or above moves by a single pixel.
- **SVG export is unaffected** and should be: an SVG has no device pixels, so a 0.1 stroke exports as a true 0.28-unit ribbon and renders correctly at whatever resolution it is finally drawn. PNG export _does_ get the floor, via the same `getTransform()` path, which matches the screen.
- **Pressure-varying strokes are left alone.** `getFreedrawUniformInkWidth()` returns 0 for them because their width is not uniform, so there is no single number to floor. The app's pen is constant-width (`currentItemStrokeVariability === "constant"`), so this does not affect the shipped pens; a thin variable pen would still look rough (measured: CV 0.255 at 0.1).
- **No real hardware.** As with the rest of this module, everything here was measured with synthesised trusted pen events in headless Chromium, not an Apple Pencil.

## 5. `packages/` lines added for this

| file | lines | what | why it could not be done app-side |
| --- | --: | --- | --- |
| `packages/element/src/shape.ts` | +17 (6 code) | `getFreedrawUniformInkWidth()` | `CONSTANT_WIDTH_FREEDRAW.SIZE_FACTOR` is module-private; the renderer needs the ribbon's real width. |
| `packages/element/src/renderElement.ts` | +~90 (≈35 code, rest comment) | the hairline floor, in the freedraw branch of `drawElementOnCanvas` | Rasterisation happens entirely inside the renderer. An app can choose a width; it cannot choose how that width meets the pixel grid. This is the one funnel every canvas path (static scene, in-progress stroke, PNG export) goes through. |

Nothing was removed, no licence header or attribution touched, no exported API changed, and no `AppState` key added. `yarn test:typecheck` passes and the `packages/` suite is unchanged at **147 files, 2685 tests, 0 failures**.
