# TRUE DARK MODE — integration

Dark mode here is a **viewing mode**. The page goes dark, the ink inverts,
and **exports / prints are bit-for-bit identical to what they would have been
in light mode** (measured — see "Evidence" below).

---

## 1. How this relates to Excalidraw's built-in `theme`

There is exactly **one** dark mode. We did not build a second one next to it.

Excalidraw's `theme="dark"` already does three of the four things we need:

| Concern | Who does it | Where |
| --- | --- | --- |
| Dark chrome | Excalidraw | `.theme--dark` CSS |
| Dark canvas background | Excalidraw | `bootstrapCanvas()` → `applyDarkModeFilter(viewBackgroundColor, isDark)` |
| Ink inversion (hue-approximate) | Excalidraw | `shape.ts` / `renderElement.ts` → `applyDarkModeFilter(strokeColor, isDark)` |
| Dark **paper** | `goodnotes/paper` | already theme-aware (`getPaperPalette("dark").paper === "#1e1f24"`) |

So this module's job is the remaining 10%:

1. own the tri-state preference (light / dark / follow-system) and persist it
   to **the same** localStorage key (`excalidraw-theme`) the app already uses,
2. **stop the view theme leaking into exports** (the `packages/` patch),
3. **stop highlighters disappearing on dark paper** (the `packages/` patch),
4. a hue-preserving colour transform for anything we render ourselves, plus
   WCAG helpers so contrast claims are numbers.

We deliberately do **not** re-invert ink ourselves: Excalidraw already does it
per element, keyed on the *render* theme (not the view theme), which is why
exports are unaffected. Doing it again would double-invert.

---

## 2. `App.tsx` changes (the integrator applies these)

### 2.1 Replace the theme hook

```diff
-import { useHandleAppTheme } from "./useHandleAppTheme";
+import { useDarkMode } from "./goodnotes/dark";
```

```diff
-  const { editorTheme, appTheme, setAppTheme } = useHandleAppTheme();
+  // `useDarkMode()` is a drop-in for `useHandleAppTheme()` — same
+  // `{ editorTheme, appTheme, setAppTheme }` shape, same storage key, plus
+  // `{ theme, preference, setPreference, isDark }`.
+  const { editorTheme, appTheme, setAppTheme } = useDarkMode();
```

Both occurrences (the editor component and the shelf component at the bottom
of the file) can be switched; they can also be migrated one at a time,
because both hooks read and write the same key.

### 2.2 Pin the export theme on `<Excalidraw>` — **this is the hard requirement**

```diff
   <Excalidraw
     theme={editorTheme}
+    // dark mode is a VIEWING mode: exports stay white paper / black ink.
+    // Without this, App.tsx mirrors the view theme into
+    // `appState.exportWithDarkMode` and every PNG/SVG goes black.
+    exportTheme="light"
     onThemeChange={setAppTheme}
```

The user's own "dark background" checkbox in the export dialog still wins
over this (precedence: user choice → `exportTheme` → view theme).

### 2.3 Mount the toggle

Anywhere in the chrome — the nav bar / taskbar module can host it:

```tsx
import { DarkModeToggle, useDarkMode } from "./goodnotes/dark";

const { preference, setPreference } = useDarkMode();

<DarkModeToggle preference={preference} onChange={setPreference} />
// or, zero-wiring (it owns its own state):
<DarkModeToggle variant="icon" />
```

`preference` / `onChange` are the callback-shaped API for the nav bar.
Variants: `"segmented"` (Light / Dark / Auto radiogroup, arrow-key navigable)
and `"icon"` (single toggle button).

### 2.4 The paper layer needs nothing

It already receives `theme={paperView.theme}`, which tracks `appState.theme`.
Dark pages come free.

### 2.5 If you export outside the editor's own export dialog

This app runs Excalidraw with `viewBackgroundColor: "transparent"` so the
paper layer shows through (App.tsx ~line 670). An export has **no paper
layer**, so a raw export is *transparent*, not white — measured below. Any
module that builds its own export (`goodnotes/export`, thumbnails, PDF) should
run its appState through the helper:

```ts
import { toLightExportAppState } from "./goodnotes/dark";

const exportState = toLightExportAppState(excalidrawAPI.getAppState());
exportScene({
  type: "png",
  data: { elements, appState: exportState, files },
  config: getExportConfigFromAppState(exportState),
});
```

It forces `theme: "light"`, `exportWithDarkMode: false`,
`exportBackground: true` and swaps a `transparent` background for `#ffffff`.
`toLightExportConfig()` does the same for config-shaped call sites.

---

## 3. `packages/` CHANGES — REVIEW THIS SECTION CAREFULLY

Three files, all additive and gated so that **nothing changes unless the host
opts in or the renderer is painting the dark theme to screen**.

### 3.1 `packages/excalidraw/types.ts` (+10 lines, type only)

Added an optional prop next to `theme`:

```ts
exportTheme?: Theme;
```

Documented as: the theme used for image exports when the user has not picked
one in the export dialog; defaults to `theme`. No behaviour change for hosts
that don't pass it.

### 3.2 `packages/excalidraw/index.tsx` (+2 lines, plumbing)

`exportTheme` destructured from props and forwarded to `<App>`. The memo
comparator (`areEqual`) picks it up through its generic rest-prop comparison,
so no change was needed there.

### 3.3 `packages/excalidraw/components/App.tsx` (2 call sites)

The only places where the view theme was copied into the export theme:

```diff
   // constructor initial state
-  exportWithDarkMode: theme === THEME.DARK,
+  exportWithDarkMode: (props.exportTheme ?? theme) === THEME.DARK,
```

```diff
   // componentDidUpdate
   const shouldExportWithDarkMode =
-    (this.sessionExportThemeOverride ?? this.state.theme) === THEME.DARK;
+    (this.sessionExportThemeOverride ??
+      this.props.exportTheme ??
+      this.state.theme) === THEME.DARK;
```

`sessionExportThemeOverride` is the pre-existing field set when the user picks
a theme in the export dialog, so the user's explicit choice still wins.
Without `exportTheme`, both expressions are identical to before.

### 3.4 `packages/element/src/renderElement.ts` (3 hunks)

**(a) New exported predicate + constant** (next to the existing
`isHighlighterElement`, same pattern):

```ts
export const isDarkViewing = (
  renderConfig: Pick<StaticCanvasRenderConfig, "theme" | "isExporting">,
): boolean => renderConfig.theme === THEME.DARK && !renderConfig.isExporting;

const DARK_MODE_HIGHLIGHTER_ALPHA_SCALE = 0.55;
```

`renderConfig.isExporting` is the guard the brief asks for. Note it is
belt-and-braces: `renderConfig.theme` on an export already comes from
`appState.exportWithDarkMode` (`scene/export.ts` →
`getExportConfigFromAppState`), never from the view theme — so an export is
already `theme: "light"` here. The `!isExporting` means a host that
*deliberately* exports with `theme: "dark"` still gets the classic
dark-theme export rather than our screen-only tweaks.

**(b) Highlighter compositing in the single `renderElement` funnel**
(the same spot the highlighter feature uses, restored by the existing
`finally { context.restore() }`):

```diff
 if (isHighlighterElement(element)) {
-  context.globalCompositeOperation = "multiply";
+  if (isDarkViewing(renderConfig)) {
+    context.globalCompositeOperation = "screen";
+    context.globalAlpha *= DARK_MODE_HIGHLIGHTER_ALPHA_SCALE;
+  } else {
+    context.globalCompositeOperation = "multiply";
+  }
 }
```

Why: `multiply` over a near-black page drives the stroke to black — the
highlighter would vanish. Real marker over dark paper reads as a glow, so we
`screen` (lighten-only, so light ink underneath stays legible) and attenuate
so it doesn't glare.

**(c) Freedraw fill colour** (`drawElementOnCanvas`, freedraw case):

```diff
-context.fillStyle = applyDarkModeFilter(
-  element.strokeColor,
-  renderConfig.theme === THEME.DARK,
-);
+context.fillStyle = applyDarkModeFilter(
+  element.strokeColor,
+  renderConfig.theme === THEME.DARK &&
+    !(isDarkViewing(renderConfig) && isHighlighterElement(element)),
+);
```

Why: `applyDarkModeFilter` maps a light marker colour (`#ffd43b`) to a dark
navy, which `screen`-composites to nothing. Highlighters keep their real hue
on screen; the dimming is done by the alpha scale above. Non-highlighter ink
is untouched, and the whole condition collapses to the original expression
while exporting.

**Not changed:** `packages/excalidraw/renderer/staticSvgScene.ts`. It already
keys everything off `renderConfig.theme` and writes
`mix-blend-mode: multiply` for highlighters — which is correct, because an
SVG export is always rendered with the export theme (verified: an SVG
exported while the screen is dark contains `fill="#1e1e1e"` and
`mix-blend-mode: multiply`).

**Caches:** both theme-sensitive caches already key on the theme
(`ShapeCache` on `renderConfig.theme`, `elementWithCanvasCache` on
`appState.theme`), so flipping the toggle repaints correctly and no cache
invalidation was added.

---

## 4. Evidence (measured, Playwright + Chromium, real renderer)

Same scene every time: a page frame, black freedraw `#1e1e1e`, blue freedraw
`#1971c2`, yellow highlighter `#ffd43b` @ 45% opacity. Screen pixels are
sampled from a real screenshot; export pixels from the actual
`exportScene()` output (PNG decoded via `createImageBitmap`, SVG rasterized
in the browser).

### On screen

| Sample | Light theme | Dark theme (`viewBackgroundColor: "transparent"`, i.e. the app's real config) |
| --- | --- | --- |
| Page | `rgb(255,255,255)` | `rgb(30,31,36)` = `#1e1f24`, the paper layer's dark sheet |
| Black ink `#1e1e1e` | `rgb(30,30,30)` | `rgb(211,211,211)` — inverted to light |
| Blue ink `#1971c2` | `rgb(25,113,194)` | `rgb(86,162,232)` — still blue, lifted |
| Highlighter `#ffd43b` | `rgb(255,236,167)` (multiply) | `rgb(145,113,80)` — still yellow, muted, not glaring |

With `viewBackgroundColor: "#ffffff"` the dark page is Excalidraw's filtered
canvas, `rgb(18,18,18)`.

### Exports of that same scene

| Export | From a LIGHT screen | From a DARK screen |
| --- | --- | --- |
| PNG corner pixel | `rgba(255,255,255,255)` | `rgba(255,255,255,255)` |
| PNG darkest pixel | `rgb(30,30,30)` | `rgb(30,30,30)` |
| PNG mean luminance | 0.9737 | 0.9737 |
| PNG histogram (dark/mid/light) | 3029 / 5017 / 221436 | 3029 / 5017 / 221436 |
| SVG mean luminance | 0.9738 | 0.9738 |
| `appState.exportWithDarkMode` | false | **false** |
| export config `theme` | light | **light** |

The dark-screen export statistics are *identical* to the light-screen ones:
the view theme has no effect on the export. The SVG markup from a dark screen
contains `<rect ... fill="#ffffff">`, `fill="#1e1e1e"`, `fill="#1971c2"`,
`fill="#ffd43b"` and `mix-blend-mode: multiply` — white paper, un-inverted
ink, light-mode highlighter compositing.

The one caveat, also measured: with the app's `viewBackgroundColor:
"transparent"`, a **raw** export has `rgba(0,0,0,0)` in the corner — white
*ink-wise* but transparent, in both themes. Running the appState through
`toLightExportAppState()` restores `rgba(255,255,255,255)` and reproduces the
white-paper numbers above exactly. See §2.5.

### Contrast ratios (WCAG 2.x, measured pixels)

| Pair | Ratio |
| --- | --- |
| Light: black ink on white paper (reference) | 16.67:1 |
| Light: blue ink on white paper | 5.02:1 |
| **Dark: ink `rgb(211,211,211)` on paper `#1e1f24`** | **10.99:1** (AAA) |
| Dark: ink on Excalidraw canvas `#121212` | 12.51:1 |
| Dark: blue ink `rgb(86,162,232)` on paper | 6.05:1 (AAA for large, AA for body) |
| Dark: highlighter wash on paper | 3.67:1 (≥3:1 non-text threshold) |
| Dark: ink over a highlighted span | 3.00:1 ⚠️ (see gaps) |
| Dark: *pure white* ink on paper (what naive inversion gives) | 16.45:1 — rejected as glare |

Deliberately **not** 21:1. The point is less eye strain at 2am: ~11:1 is well
past AAA (7:1) without the white-on-black flare that drives contrast fatigue.

---

## 5. Why this colour transform (`invertInkForDarkMode`)

Naive RGB inversion (`255 - c`) rotates hue by 180°: a red correction mark
becomes cyan and a blue pen becomes orange, destroying the colour-coding
students rely on; it also maps a light highlighter to dark navy.

Excalidraw's built-in `applyDarkModeFilter` is `invert(93%) hue-rotate(180°)`
— the hue-rotate undoes most of the flip, but the CSS hue-rotate matrix is a
linear approximation that still shifts saturated hues and still maps light
colours to dark ones.

Ours works in HSL, keeps **H exactly**, and branches on lightness:

* dark ink (L < 0.5): `L' = 1 − L`, clamped to `[0.55, 0.90]` → light grey,
  never pure white (that clamp is what buys 11:1 instead of 16.5:1);
* light ink (L ≥ 0.5): **not** inverted — `L' = 0.66·L`, `S' = 0.75·S` → a
  yellow highlighter stays yellow, just muted.

On canvas, rule 2 is implemented by compositing rather than colour maths (see
§3.4b/c) because a highlighter has to *lighten* the page, not paint over it.
Rule 1 is left to Excalidraw's existing per-element filter — the measured
`#1e1e1e → rgb(211,211,211)` above is within a few percent of what our
transform computes, so re-implementing it would add risk for no gain.

---

## 6. Accessibility / motion

* The toggle is a real `radiogroup` with roving tabindex and arrow-key
  navigation; the icon variant exposes `aria-pressed` and a descriptive
  `aria-label`.
* All transitions are disabled under
  `@media (prefers-reduced-motion: reduce)` (`DarkModeToggle.scss`),
  including the optional page cross-fade
  (`[data-goodnotes-theme-transition]`).
* `preference: "system"` follows `prefers-color-scheme` live.

---

## 7. Honest gaps

1. **Highlighted text in dark mode is 3.00:1**, below the 4.5:1 body-text
   threshold. This is inherent: a highlighter that lightens a dark page
   necessarily closes the gap to light ink. 0.55 is the measured sweet spot
   (wash visible at 3.67:1 vs paper); it is one constant,
   `DARK_MODE_HIGHLIGHTER_ALPHA_SCALE` in `renderElement.ts`, if the design
   wants a different trade-off.
2. **Rough/sketchy highlighters.** The colour-preservation hunk covers the
   freedraw path (`typeof shape === "string"`), which is what the pen presets
   produce. A highlighter stamped onto a *rough* shape (rectangle, ellipse,
   roughness > 0) still gets its stroke colour from `shape.ts`, so it would be
   inverted and then `screen`-composited to near nothing. Not reachable from
   the current pen tray; fixing it would mean touching `shape.ts`'s cached
   rough options, which did not feel worth the blast radius.
3. **Images** are untouched. Excalidraw applies `DARK_THEME_FILTER` to SVG
   images in dark theme; raster photos stay as-is and will be bright on a dark
   page. Deliberate — inverting a student's photo of a whiteboard is worse.
4. **Embeddables / iframes** render their own content and ignore the theme.
5. **PDF export** is another module's; it must use `toLightExportAppState()`
   (§2.5) or it inherits the transparent-background caveat.
6. `useDarkMode()` and the legacy `useHandleAppTheme()` share a key but not a
   React state; if both are mounted, a change in one only reaches the other on
   remount or a cross-tab `storage` event. Migrate both call sites together.
