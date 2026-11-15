# Integration — Highlighter + Pen presets (`goodnotes/pens`)

Two parts:

1. An app-level module, `excalidraw-app/goodnotes/pens/` (self-contained).
2. A small patch under `packages/` that teaches the renderer about highlighter
   strokes. **Review section 3 carefully** — it is the only part that touches
   the editor core.

---

## 1. App wiring (`excalidraw-app/App.tsx`)

### 1a. Import

```tsx
import { PenTray } from "./goodnotes/pens";
```

### 1b. Render the tray **inside** `<Excalidraw>`

The tray styles itself from Excalidraw's CSS custom properties
(`--island-bg-color`, `--color-primary`, `--focus-highlight-color`, …), which
are declared on the `.excalidraw` container. It must therefore be a child of
`<Excalidraw>` (a `<Footer>`, `<Sidebar>` or a plain absolutely-positioned
child all work). Mounted outside it, the tray falls back to hardcoded
light-theme colours.

Add as a child of the existing `<Excalidraw …>` element, e.g. next to the
other GoodNotes children:

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

`excalidrawAPI` may be `null` on the first render — the tray handles that
(buttons still work for selection, they just don't drive the editor until the
API arrives).

### 1c. Number-key shortcuts (read this)

`PenTray` installs a **capture-phase** `keydown` listener on `window` for the
digits `1`–`9` and calls `preventDefault()`/`stopPropagation()`, so it wins
over Excalidraw's built-in numeric tool shortcuts (`1` = selection, `2` =
rectangle, …). That is deliberate for a GoodNotes-style app. Modifier
combos, and keys pressed while an `input`/`textarea`/`select`/contenteditable
has focus, are ignored.

To keep Excalidraw's own digit shortcuts instead:

```tsx
<PenTray excalidrawAPI={excalidrawAPI} disableShortcuts />
```

### 1d. Nothing else

No provider, no context, no state lifting. Presets persist themselves to
`localStorage` under `goodnotes-pens`.

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
export const PEN_WIDTHS: { thin: 0.5; medium: 1; bold: 2 };
export const MIN_PEN_WIDTH: number;
export const MAX_PEN_WIDTH: number;

export const loadPenPresets: () => PenPreset[];       // never throws
export const savePenPresets: (p: readonly PenPreset[]) => boolean;
export const resetPenPresets: () => PenPreset[];
export const snapPenWidth: (width: number) => "thin" | "medium" | "bold";

export type { PenWidthKey, PenPreset };
```

---

## 3. `packages/` patch — every file, and why

The highlighter is flagged per element with
`element.customData.goodnotes.highlighter === true`. `customData` is an
existing, serialized, free-form field on `_ExcalidrawElementBase`, so **no
element schema or type-union change was needed** and existing scenes load
untouched (elements without the marker render exactly as before).

| # | File | Change | Why |
|---|------|--------|-----|
| 1 | `packages/element/src/renderElement.ts` | Added exported `isHighlighterElement(element)`; in `renderElement()`, right after the existing `context.save()` / `globalAlpha` assignment, set `context.globalCompositeOperation = "multiply"` when the element is a highlighter. | `renderElement()` is the single funnel every canvas render path goes through (static scene, in-progress stroke, export). The composite op is restored by the `context.restore()` already present in that function's `finally` block, so nothing leaks to later elements. **~12 lines.** |
| 2 | `packages/excalidraw/types.ts` | Added `currentItemCustomData: ExcalidrawElement["customData"] \| null;` to `AppState`. | There was no supported way to make the freedraw tool stamp `customData` onto new strokes. This mirrors the existing `currentItem*` pattern, so the tray can switch highlighter mode on/off through the public `updateScene({ appState })`. **1 line + doc comment.** |
| 3 | `packages/excalidraw/appState.ts` | `currentItemCustomData: null` in `getDefaultAppState()`, and `{ browser: true, export: false, server: false }` in `APP_STATE_STORAGE_CONF`. | Required for any new `AppState` key. Additive; `restoreAppState` fills the default for older persisted states. **2 lines.** |
| 4 | `packages/excalidraw/components/App.tsx` | In the freedraw branch of `handleCanvasPointerDown` (`newFreeDrawElement({ … })`, ~line 8340): `customData: this.state.currentItemCustomData ?? undefined,`. | Stamps the marker onto strokes drawn while a highlighter preset is active. `newFreeDrawElement` already accepts `customData` via `ElementConstructorOpts`. **1 line.** |
| 5 | `packages/excalidraw/renderer/staticSvgScene.ts` | On the freedraw `<g>` wrapper, set `style="mix-blend-mode: multiply"` for highlighter elements (+ one import). | Optional parity so **SVG export** matches the canvas. Omit this hunk if you want the canvas-only change; PNG export already works via file #1. **7 lines.** |

Nothing else under `packages/` was touched. No existing behaviour changes for
any element that does not carry the marker.

### Risk notes for the reviewer

- `AppState` gained a key, so `getDefaultAppState()` snapshot tests may need
  `yarn test:update`.
- `globalCompositeOperation` is set on the *element* render, which for
  freedraw means the cached per-element bitmap is blitted with `multiply`.
  That is what makes a single self-crossing stroke stay flat.

---

## 4. What multiply actually does (measured, not assumed)

Driven in the real app at `http://localhost:3001` with Playwright, sampling
pixels straight out of `canvas.excalidraw__canvas.static` (yellow `#ffd43b`
highlighter at 45% opacity, over a black freedraw stroke, white canvas):

| sample | with marker (multiply) | without marker (normal) |
|---|---|---|
| blank paper | `255,255,255` | `255,255,255` |
| single highlighter stroke | `255,236,167` | `255,235,166` |
| two separate strokes crossing | `255,218,109` | `255,224,117` |
| black ink under a highlighter | **`0,0,0`** | `115,96,26` |

- **Ink underneath is preserved exactly.** This is the real GoodNotes win and
  the thing Excalidraw gets wrong today: without multiply, a translucent
  stroke washes black ink out to a muddy olive (`115,96,26`).
- **A single stroke crossing itself does not darken** — verified visually with
  a self-intersecting loop; the overlap is a uniform flat yellow.
- **Honest caveat:** two *separate* highlighter strokes crossing each other
  still darken slightly (`236→218` in G). That is inherent to compositing each
  element separately at `globalAlpha < 1`; `multiply` changes the colour of
  the overlap but cannot make it idempotent. Perfectly flat stroke-to-stroke
  overlaps would require rendering all highlighter elements into one shared
  offscreen layer at full alpha and compositing that layer once — a much
  larger renderer change that was out of scope here.

## 5. Known limitation: stroke width granularity

Excalidraw only exposes three freedraw widths through
`appState.currentItemStrokeWidthKey` (`thin`/`medium`/`bold` →
`strokeWidth` `0.5`/`1`/`2`, rendered at `strokeWidth × 4.25` px).
`PenPreset.width` is expressed in those units and snapped to the nearest with
`snapPenWidth()`. A genuinely fat GoodNotes highlighter (~25 px) is therefore
not reachable without a further `packages/` change (an arbitrary
`currentItemStrokeWidth` override in `App.getCurrentItemStrokeWidth`), which
was deliberately left out to keep the core patch minimal.

## 6. Accessibility

Real `<button type="button">` elements; `aria-pressed` on the active preset;
accessible names that include tool, width, opacity and shortcut number
(visually hidden span); `aria-expanded`/`aria-controls` on the editor toggle;
`:focus-visible` outlines using `--focus-highlight-color` (verified: a `Tab`
press yields `2px solid rgb(165,216,255)`); fully keyboard reachable; the
preset list is a `<ul>` labelled "Pen presets"; and
`@media (prefers-reduced-motion: reduce)` drops the transitions (verified:
`transition-property: none` under reduced motion). Verified in both light and
dark theme using only Excalidraw's CSS custom properties.
