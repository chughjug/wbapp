# Integration — Image backdrops (`goodnotes/backdrops`)

Self-contained app-level module. **No changes under `packages/` are needed.**

---

## 1. `excalidraw-app/App.tsx`

### 1a. Import

Add next to the other GoodNotes imports:

```tsx
import { BackdropPanel, useBackdropPanel } from "./goodnotes/backdrops";
```

### 1b. Create the controller inside `ExcalidrawWrapper`

`ExcalidrawWrapper` already holds the editor API (`App.tsx` ~line 403):

```tsx
const excalidrawAPI = useExcalidrawAPI();
```

Right after it, add:

```tsx
const backdrops = useBackdropPanel(excalidrawAPI);
```

`useBackdropPanel` subscribes to the scene itself; nothing else has to be wired for it to learn about the selection.

### 1c. Render the panel **inside** `<Excalidraw>`

The panel takes its colours from Excalidraw's own CSS custom properties (`--island-bg-color`, `--text-primary-color`, `--color-primary`, `--default-border-color`, …), which are declared on the `.excalidraw` container, and it opts back into pointer events with `pointer-events: var(--ui-pointerEvents)`. It must therefore be a **child of `<Excalidraw>`** (a plain absolutely-positioned child, a `<Sidebar>` or the `<Footer>` all work). Mounted outside, it silently falls back to hardcoded light-theme colours.

In the existing `<Excalidraw …>` element (`App.tsx` ~line 1128), next to the other GoodNotes children:

```tsx
<Excalidraw
/* …existing props… */
>
  {/* …existing children… */}
  <div
    style={{
      position: "absolute",
      top: "5rem",
      right: "1rem",
      zIndex: "var(--zIndex-layerUI)",
    }}
  >
    <BackdropPanel {...backdrops.panelProps} />
  </div>
</Excalidraw>
```

`BackdropPanel` renders `null` while `open` is false, so the wrapper costs nothing when the panel is closed.

### 1d. Opening it

`backdrops.open` is the **callback-shaped entry point** for the centralized taskbar:

```tsx
<Taskbar
  items={[
    {
      id: "backdrop",
      label: "Backdrop",
      onSelect: backdrops.open, // () => void
      disabled: !backdrops.hasImageSelection,
      active: backdrops.isOpen,
    },
  ]}
/>
```

The full controller is:

| field | type | meaning |
| --- | --- | --- |
| `open` / `close` / `toggle` | `() => void` | visibility, for the taskbar |
| `isOpen` | `boolean` | current visibility |
| `hasImageSelection` | `boolean` | exactly one image element is selected |
| `hasBackdrop` | `boolean` | that image already carries a baked backdrop |
| `panelProps` | object | spread onto `<BackdropPanel />` |

If the taskbar wants its own state instead, skip the hook and drive the panel directly — it is fully controlled:

```tsx
<BackdropPanel
  excalidrawAPI={excalidrawAPI}
  open={myOpenState}
  onClose={() => setMyOpenState(false)}
  theme="dark" // optional; defaults to the editor's theme
  onApplied={(elementId, presetId) => {
    /* optional telemetry */
  }}
/>
```

---

## 2. How the panel learns about the selection

It does **not** need a prop. `useSelectedImageElement(excalidrawAPI)` subscribes with `excalidrawAPI.onChange(...)` and reports the single selected, non-deleted `type === "image"` element (and `null` for zero, multiple, or non-image selections). When nothing suitable is selected the panel shows "Select a single image on the canvas to give it a backdrop."

If a host already tracks the selection, it can bypass the panel entirely:

```ts
import { applyBackdrop, removeBackdrop } from "./goodnotes/backdrops";

await applyBackdrop({
  excalidrawAPI,
  elementId,
  presetId: "gradient",
  params: { padding: 9, gradientAngle: 200 }, // optional overrides
  theme: "dark",
});

await removeBackdrop({ excalidrawAPI, elementId }); // reset to original
```

---

## 3. What it writes to the scene

- the image element's `fileId` is re-pointed at a newly baked PNG, registered through `excalidrawAPI.addFiles([...])` with a content-addressed (SHA-1 hex) id, `mimeType: "image/png"` and a `data:` URL — the same `BinaryFileData` shape the editor's own image insertion produces, so persistence (`FileManager` / `LocalData`) and export pick it up unchanged;
- `element.x/y/width/height` grow outwards so the picture does not move;
- `element.customData.goodnotes.backdrop` records the preset, its parameters, the original file id and the rectangle the original pixels occupy inside the baked raster.

Other `customData.goodnotes.*` keys (the pages module's `page`, the pens module's marker) are merged, never overwritten, and survive a reset.

Updates are committed with `CaptureUpdateAction.IMMEDIATELY`, so **Ctrl+Z undoes an apply or a reset** like any other edit.

---

## 4. Nothing else

No provider, no CSS import (the component imports its own `.scss`), no change to `index.scss`, `vite.config.mts` or `package.json`.
