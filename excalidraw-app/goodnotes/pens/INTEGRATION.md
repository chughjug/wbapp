# Integration — Highlighter + Pen presets (`goodnotes/pens`)

Three parts:

1. An app-level module, `excalidraw-app/goodnotes/pens/` (self-contained).
2. A small patch under `packages/` that teaches the renderer about highlighter strokes. **Review section 3 carefully.**
3. A second, smaller patch under `packages/` (3 files, +23 lines, nothing removed) that lets a freedraw stroke take an **exact** width instead of one of three steps — **section 5**, which also carries the measured proof that 0.2 really draws thinner than the old `thin`.

---

## 1. App wiring (`excalidraw-app/App.tsx`)

### 1a. Import

```tsx
import { PenTray } from "./goodnotes/pens";
```

### 1b. Render the tray **inside** `<Excalidraw>`

The tray styles itself from Excalidraw's CSS custom properties (`--island-bg-color`, `--color-primary`, `--focus-highlight-color`, …), which are declared on the `.excalidraw` container. It must therefore be a child of `<Excalidraw>` (a `<Footer>`, `<Sidebar>` or a plain absolutely-positioned child all work). Mounted outside it, the tray falls back to hardcoded light-theme colours.

Add as a child of the existing `<Excalidraw …>` element, e.g. next to the other GoodNotes children:

```tsx
<Excalidraw
  excalidrawAPI={(api) => setExcalidrawAPI(api)}
  /* …existing props… */
>
  {/* …existing children… */}
  <PenTray excalidrawAPI={excalidrawAPI} />
</Excalidraw>
```

If you want it docked in the footer instead:

```tsx
import { Footer } from "@excalidraw/excalidraw";

<Footer>
  <PenTray excalidrawAPI={excalidrawAPI} />
</Footer>;
```

`excalidrawAPI` may be `null` on the first render — the tray handles that (buttons still work for selection, they just don't drive the editor until the API arrives).

### 1c. Number-key shortcuts (read this)

`PenTray` installs a **capture-phase** `keydown` listener on `window` for the digits `1`–`9` and calls `preventDefault()`/`stopPropagation()`, so it wins over Excalidraw's built-in numeric tool shortcuts (`1` = selection, `2` = rectangle, …). That is deliberate for a GoodNotes-style app. Modifier combos, and keys pressed while an `input`/`textarea`/`select`/contenteditable has focus, are ignored.

To keep Excalidraw's own digit shortcuts instead:

```tsx
<PenTray excalidrawAPI={excalidrawAPI} disableShortcuts />
```

### 1d. Nothing else

No provider, no context, no state lifting. Presets persist themselves to `localStorage` under `goodnotes-pens`.

---

## 2. Public API

```ts
// excalidraw-app/goodnotes/pens/index.ts

export interface PenTrayProps {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  disableShortcuts?: boolean; // default false
  className?: string;
}
export const PenTray: (props: PenTrayProps) => JSX.Element;

/** Drive the editor from a preset (tool + colour + width + opacity). */
export const applyPenPreset: (
  excalidrawAPI: ExcalidrawImperativeAPI,
  preset: PenPreset,
) => void;

/** The `customData` written onto highlighter strokes. */
export const HIGHLIGHTER_CUSTOM_DATA: { goodnotes: { highlighter: true } };

export const PENS_STORAGE_KEY: "goodnotes-pens";
export const DEFAULT_PEN_PRESETS: readonly PenPreset[];

export const loadPenPresets: () => PenPreset[]; // never throws
export const savePenPresets: (p: readonly PenPreset[]) => boolean;
export const resetPenPresets: () => PenPreset[];

// ── the continuous width model (see § 5) ───────────────────────────────────
export const MIN_PEN_WIDTH: 0.1;
export const MAX_PEN_WIDTH: 6;
export const PEN_WIDTH_STEP: 0.1;
export const PEN_WIDTH_STOPS: readonly { width: number; label: string }[];
//   0.2 Extra fine · 0.5 Fine · 1 Medium · 2 Bold · 3.5 Extra bold
export const DEFAULT_PEN_WIDTH: 0.5;
export const DEFAULT_HIGHLIGHTER_WIDTH: 3.5;
export const clampPenWidth: (width: number) => number; // clamp + 2dp round
export const formatPenWidth: (width: number) => string; // "0.2", "1", "3.5"

// per-ink-tool "last nib used", localStorage key `goodnotes-pen-width`
export const PEN_WIDTH_STORAGE_KEY: "goodnotes-pen-width";
export const DEFAULT_PEN_WIDTH_MEMORY: { pen: 0.5; highlighter: 3.5 };
export const loadPenWidths: () => { pen: number; highlighter: number };
export const savePenWidth: (tool: "pen" | "highlighter", w: number) => boolean;

// still exported: shapes and text have no exact-width override and go
// through Excalidraw's three-step key
export const PEN_WIDTHS: { thin: 0.5; medium: 1; bold: 2 };
export const snapPenWidth: (width: number) => "thin" | "medium" | "bold";

export type { PenWidthKey, InkToolId, PenWidthMemory, PenPreset };
```

---

## 3. `packages/` patch — every file, and why

The highlighter is flagged per element with `element.customData.goodnotes.highlighter === true`. `customData` is an existing, serialized, free-form field on `_ExcalidrawElementBase`, so **no element schema or type-union change was needed** and existing scenes load untouched (elements without the marker render exactly as before).

| # | File | Change | Why |
| --- | --- | --- | --- |
| 1 | `packages/element/src/renderElement.ts` | Added exported `isHighlighterElement(element)`; in `renderElement()`, right after the existing `context.save()` / `globalAlpha` assignment, set `context.globalCompositeOperation = "multiply"` when the element is a highlighter. | `renderElement()` is the single funnel every canvas render path goes through (static scene, in-progress stroke, export). The composite op is restored by the `context.restore()` already present in that function's `finally` block, so nothing leaks to later elements. **~12 lines.** |
| 2 | `packages/excalidraw/types.ts` | Added `currentItemCustomData: ExcalidrawElement["customData"] \| null;` to `AppState`. | There was no supported way to make the freedraw tool stamp `customData` onto new strokes. This mirrors the existing `currentItem*` pattern, so the tray can switch highlighter mode on/off through the public `updateScene({ appState })`. **1 line + doc comment.** |
| 3 | `packages/excalidraw/appState.ts` | `currentItemCustomData: null` in `getDefaultAppState()`, and `{ browser: true, export: false, server: false }` in `APP_STATE_STORAGE_CONF`. | Required for any new `AppState` key. Additive; `restoreAppState` fills the default for older persisted states. **2 lines.** |
| 4 | `packages/excalidraw/components/App.tsx` | In the freedraw branch of `handleCanvasPointerDown` (`newFreeDrawElement({ … })`, ~line 8340): `customData: this.state.currentItemCustomData ?? undefined,`. | Stamps the marker onto strokes drawn while a highlighter preset is active. `newFreeDrawElement` already accepts `customData` via `ElementConstructorOpts`. **1 line.** |
| 5 | `packages/excalidraw/renderer/staticSvgScene.ts` | On the freedraw `<g>` wrapper, set `style="mix-blend-mode: multiply"` for highlighter elements (+ one import). | Optional parity so **SVG export** matches the canvas. Omit this hunk if you want the canvas-only change; PNG export already works via file #1. **7 lines.** |

Nothing else under `packages/` was touched. No existing behaviour changes for any element that does not carry the marker.

### Risk notes for the reviewer

- `AppState` gained a key, so `getDefaultAppState()` snapshot tests may need `yarn test:update`.
- `globalCompositeOperation` is set on the _element_ render, which for freedraw means the cached per-element bitmap is blitted with `multiply`. That is what makes a single self-crossing stroke stay flat.

---

## 4. What multiply actually does (measured, not assumed)

Driven in the real app at `http://localhost:3001` with Playwright, sampling pixels straight out of `canvas.excalidraw__canvas.static` (yellow `#ffd43b` highlighter at 45% opacity, over a black freedraw stroke, white canvas):

| sample | with marker (multiply) | without marker (normal) |
| --- | --- | --- |
| blank paper | `255,255,255` | `255,255,255` |
| single highlighter stroke | `255,236,167` | `255,235,166` |
| two separate strokes crossing | `255,218,109` | `255,224,117` |
| black ink under a highlighter | **`0,0,0`** | `115,96,26` |

- **Ink underneath is preserved exactly.** This is the real GoodNotes win and the thing Excalidraw gets wrong today: without multiply, a translucent stroke washes black ink out to a muddy olive (`115,96,26`).
- **A single stroke crossing itself does not darken** — verified visually with a self-intersecting loop; the overlap is a uniform flat yellow.
- **Honest caveat:** two _separate_ highlighter strokes crossing each other still darken slightly (`236→218` in G). That is inherent to compositing each element separately at `globalAlpha < 1`; `multiply` changes the colour of the overlap but cannot make it idempotent. Perfectly flat stroke-to-stroke overlaps would require rendering all highlighter elements into one shared offscreen layer at full alpha and compositing that layer once — a much larger renderer change that was out of scope here.

## 5. Continuous stroke widths (replaces the old three-step limitation)

**The finding first:** `ExcalidrawElement["strokeWidth"]` is, and always was, a plain `number` (`packages/element/src/types.ts:47`). Nothing about freedraw is quantised. The three steps came from exactly one place — `App.getCurrentItemStrokeWidth()` resolving `appState.currentItemStrokeWidthKey` through `FREEDRAW_STROKE_WIDTH` (`packages/common/src/constants.ts:500`) — and that resolution is the _only_ chokepoint for a stroke's width at creation time.

So this is 90% an app-level fix, but not 100%: an app can put any number on an element it owns, and it cannot put any number on an element the editor is _about to create_. Making the live stroke draw at 0.2 therefore needed one override in that single chokepoint. **4 lines of behaviour in `packages/`, all additive** — see § 5a.

### The model

|  |  |
| --- | --- |
| range | `0.1` – `6.0`, step `0.1` (`<input type="range">`, Home / End / arrows) |
| one-tap stops | `0.2` Extra fine · `0.5` Fine · `1` Medium · `2` Bold · `3.5` Extra bold |
| old `thin` / `medium` / `bold` | `0.5` / `1` / `2` — still exactly reachable, now as three points on the slider |
| memory | per ink tool, `localStorage` `goodnotes-pen-width`, e.g. `{"pen":0.3,"highlighter":3.5}` |
| presets | `PenPreset.width` is now honoured exactly; no `snapPenWidth()` on the way to the canvas |

`PenPreset` itself is **unchanged** (`{ id; label; tool; color; width; opacity }`) — `width` was already a `number`, it was simply snapped on the way out. Pens saved by the three-step build load untouched; `loadPenPresets()` only clamps `width` into `[0.1, 6]`, a no-op for `0.5` / `1` / `2`. **No migration is required and no saved pen is orphaned.**

### 5a. The `packages/` change for this feature

Three files, **23 added lines, 0 removed, 0 modified**. Nothing is deleted or rewritten, no licence header or attribution is touched, and the published `@excalidraw/excalidraw` API is unchanged for other consumers: the new `AppState` key defaults to `null`, and `null` reproduces today's behaviour byte for byte.

| # | File | Lines | Change | Why it was unavoidable |
| --- | --- | --- | --- | --- |
| 1 | `packages/excalidraw/types.ts` | +8 (1 code, 7 doc) | `currentItemFreedrawStrokeWidth: number \| null;` on `AppState` | The app can only talk to the editor through `updateScene({ appState })`. With no key there is no channel. |
| 2 | `packages/excalidraw/appState.ts` | +6 | `currentItemFreedrawStrokeWidth: null` in `getDefaultAppState()`; `{ browser: true, export: false, server: false }` in `APP_STATE_STORAGE_CONF` | Mandatory for any new `AppState` key. `browser: true` is what makes a chosen width survive a reload; `export`/`server` stay `false` so no document or server payload changes shape. |
| 3 | `packages/excalidraw/components/App.tsx` | +9 | In `getCurrentItemStrokeWidth()`: return the override when `elementType === "freedraw"` and the value is a finite number `> 0`; otherwise fall through to the existing `getStrokeWidthByKey(…)` | The one and only chokepoint (`App.tsx:8387` → `newFreeDrawElement({ strokeWidth })`). Rewriting the element afterwards from the app was the alternative and it is worse: the live stroke would draw at `0.5` and jump to `0.2` on pointer-up, a visible 2.5× snap on every stroke. |

Snapshot fallout: 133 `appState` snapshots across `contextmenu`, `history` and `regressionTests` gained the single line `"currentItemFreedrawStrokeWidth": null,` (`yarn vitest run -u`). The whole `packages/` suite then passes — **147 files, 2685 tests, 0 failures**.

**Known gap:** Excalidraw's own stroke-width picker (`actionProperties.tsx`) writes `currentItemStrokeWidthKey` and does not clear the override, so if a host re-exposes the native property panel the key will be ignored for freedraw until something writes an exact width. Clearing it there would have meant touching an upstream action and its tests; the GoodNotes shell hides that panel, so it was left alone. `applyInk({ widthKey })` in `goodnotes/tool-menu/editor.ts` _does_ clear the override, so every in-app path stays coherent.

### 5b. Measured, in the browser

Playwright, Chromium, 1194×834 (iPad Pro 11"), `deviceScaleFactor: 1`, canvas zoom pinned to 1.0. Each row: set the width **through the real slider**, draw one horizontal stroke, read `element.strokeWidth` back out of the scene, then sample a 400×30 px crop of `canvas.excalidraw__canvas.static` around it. `inkMass` = sum of `(255 − luma)/255` over the crop.

| slider | `appState` exact | width key | readout | `element.strokeWidth` | dark px (luma < 128) | any-ink px | inkMass |
| --: | --: | --- | --- | --: | --: | --: | --: |
| 0.1 | 0.1 | thin | `0.1` | **0.1** | 0 | 349 | 77.84 |
| 0.2 | 0.2 | thin | `0.2` | **0.2** | 0 | 349 | 154.39 |
| 0.35 → 0.4 | 0.4 | thin | `0.4` | **0.4** | 348 | 700 | 310.62 |
| 0.5 (old `thin`) | 0.5 | thin | `0.5` | **0.5** | 696 | 700 | 465.33 |
| 1 (old `medium`) | 1 | medium | `1` | **1** | 700 | 1404 | 927.49 |
| 2 (old `bold`) | 2 | bold | `2` | **2** | 2112 | 2120 | 1713.81 |
| 3.5 | 3.5 | bold | `3.5` | **3.5** | 3556 | 3568 | 3132.98 |
| 6 | 6 | bold | `6` | **6** | 5780 | 6513 | 5410.71 |

Read this way:

- **`element.strokeWidth` equals the requested width in all eight rows.** Nothing snaps back to 0.5.
- **0.2 against the old `thin` (0.5):** `inkMass` 154.39 vs 465.33 — **33.2 %** of the ink, against a 40 % ideal; the shortfall is sub-pixel antialiasing, not quantisation. Dark pixels: **0 vs 696**. At 0.2 the stroke never reaches luma < 128 anywhere, i.e. it is genuinely a hairline.
- `0.35` becomes `0.4` because the native range input snaps to its `step` of 0.1. That is the slider's documented grid, not a width model limit.
- Across the whole range `inkMass` tracks the requested width almost linearly (77.84 → 5410.71 for 0.1 → 6, a 69.5× span for a 60× width span).

Round trip: slider → `0.3`; `localStorage["goodnotes-pen-width"]` = `{"pen":0.3,"highlighter":3.5}`; full page reload; tap Pen; `appState.currentItemFreedrawStrokeWidth` = `0.3`; the next stroke's `element.strokeWidth` = **0.3**. Switching to the Highlighter gives **3.5** and back to the Pen gives **0.3** again — each ink tool keeps its own nib.

## 6. Accessibility

Real `<button type="button">` elements; `aria-pressed` on the active preset; accessible names that include tool, width, opacity and shortcut number (visually hidden span); `aria-expanded`/`aria-controls` on the editor toggle; `:focus-visible` outlines using `--focus-highlight-color` (verified: a `Tab` press yields `2px solid rgb(165,216,255)`); fully keyboard reachable; the preset list is a `<ul>` labelled "Pen presets"; and `@media (prefers-reduced-motion: reduce)` drops the transitions (verified: `transition-property: none` under reduced motion). Verified in both light and dark theme using only Excalidraw's CSS custom properties.

## 7. What a width below ~0.36 actually does (read before touching `MIN_PEN_WIDTH`)

A pen stroke lays down `strokeWidth * 2.8` scene units of ink (measured; see `goodnotes/ink/INTEGRATION.md` § "The sub-pixel floor"). At 100% zoom on a 1× display that makes `strokeWidth` **0.357 exactly one device pixel**, and on a 2× display (iPad) **0.18**.

Below that the line is thinner than a pixel, and the slider stops making it thinner — it makes it **lighter** instead. Before this was handled, a sub-pixel stroke also came out visibly patchy and broken, because each pixel's alpha depended on where the centreline happened to fall inside it; that is what the "small pens look rough" report was. The renderer now floors such a stroke at one device pixel and dims it by the same factor, so it is even instead of ragged. Measured at the app's default 76% zoom, 1×: the per-column alpha variation at `strokeWidth` 0.1 fell from 0.340 to 0.168, and at 0.2 from 0.244 to 0.123. **Nothing at 0.4 or above changed by a single pixel** — all the measurements in § 5b still hold exactly.

New export, for UI that wants to be honest about this:

```ts
export const HAIRLINE_PEN_WIDTH: 0.36; // the 1× / 100% threshold
```

Widths below it are still perfectly usable — a pale hairline is a real annotation weight — but a control should not imply that 0.1 and 0.3 differ in _thickness_. They differ in _weight_. Suggested copy for the width slider's description, using `--input-label-color` (not `--color-muted`, which is a background grey): _"Below 0.4 a stroke is thinner than a screen pixel, so it gets lighter rather than thinner."_

### `App.tsx` changes required

**None.** The floor lives entirely inside `packages/element/src/renderElement.ts` and needs no state, no prop and no wiring; `HAIRLINE_PEN_WIDTH` is an optional export for copy. The existing `currentItemFreedrawStrokeWidth` branch in `App.getCurrentItemStrokeWidth()` is untouched and still required.
