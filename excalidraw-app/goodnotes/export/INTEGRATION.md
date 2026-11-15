# Integrating the PDF export module into `excalidraw-app/App.tsx`

This module is self-contained: it owns nothing outside
`excalidraw-app/goodnotes/export/`. Wiring it up is four small edits to
`App.tsx`. Nothing here needs to run before the dialog opens.

Dependencies already present: `jspdf`, `react`, and the sibling modules
`excalidraw-app/goodnotes/paper/` (the paper templates the PDF must redraw)
and `excalidraw-app/goodnotes/pages/` (one constant: the `customData` key a
page's template is stored under). Neither is modified.

---

## 1. Imports

Add near the other `excalidraw-app` imports:

```tsx
import { ExportDialog } from "./goodnotes/export";
```

If you also want to call the exporter headlessly (e.g. "quick export"):

```tsx
import { exportDocumentToPdf, downloadPdfBlob } from "./goodnotes/export";
```

---

## 2. State

Inside the `ExcalidrawWrapper` component (the one that holds
`excalidrawAPI`), next to the other `useState` hooks:

```tsx
const [isPdfExportOpen, setIsPdfExportOpen] = useState(false);
```

---

## 3. Menu item

In the app's main menu (`excalidraw-app/components/AppMainMenu.tsx` renders
`<MainMenu>`; if you'd rather not touch that file, render the item from
`App.tsx` by passing a `<MainMenu.Item>` through, or add it to the
`renderCustomMenu`/`<MainMenu>` children in `App.tsx`).

Place it directly **after** `MainMenu.DefaultItems.SaveAsImage`, so the two
export entries sit together:

```tsx
<MainMenu.Item
  onSelect={() => setIsPdfExportOpen(true)}
  data-testid="goodnotes-export-pdf"
>
  Export to PDF…
</MainMenu.Item>
```

`MainMenu.Item` accepts an `icon` prop if you want one.

---

## 4. Render the dialog

As a sibling of `<Excalidraw …>` (it portals itself to `document.body`, so
placement in the tree doesn't matter — just don't put it somewhere that
unmounts on every render). Render it **only while open**:

```tsx
{isPdfExportOpen && excalidrawAPI && (
  <ExportDialog
    elements={excalidrawAPI.getSceneElements()}
    files={excalidrawAPI.getFiles()}
    appState={excalidrawAPI.getAppState()}
    // 1-based page number currently in view; omit to disable "Current page"
    currentPageNumber={currentPageNumber ?? null}
    defaultFileName={documentTitle ?? "document"}
    // the document's paper template, for pages whose frame name
    // doesn't encode one (e.g. plain "page:2")
    defaultPaperTemplate={defaultTemplate ?? "blank"}
    // dialog chrome follows this; the PDF is always light
    theme={appState.theme}
    onClose={() => setIsPdfExportOpen(false)}
  />
)}
```

`currentPageNumber`, `documentTitle` and `defaultTemplate` are whatever the
surrounding app already has (e.g. from `DocMeta`). All three are optional:
drop the props and the dialog falls back to "all pages", `document.pdf`, and
`blank` paper.

### Deriving `currentPageNumber`, if you don't have it

```tsx
import { getOrderedPageFrames } from "./goodnotes/export";

const currentPageNumber = useMemo(() => {
  if (!excalidrawAPI) {
    return null;
  }
  const { scrollY, height } = excalidrawAPI.getAppState();
  // scene y of the viewport centre
  const centreY = -scrollY + height / 2;
  const frames = getOrderedPageFrames(excalidrawAPI.getSceneElements());
  const index = frames.findIndex(
    (f) => centreY >= f.y && centreY <= f.y + f.height,
  );
  return index === -1 ? null : index + 1;
}, [excalidrawAPI]);
```

(Recompute it in an `onChange` handler if you want it to track scrolling.)

---

## Optional: export without the dialog

```tsx
const blob = await exportDocumentToPdf({
  elements: excalidrawAPI.getSceneElements(),
  files: excalidrawAPI.getFiles(),
  appState: excalidrawAPI.getAppState(),
  scale: 2,
});
downloadPdfBlob(blob, "my-notes.pdf");
```

---

## Notes / gotchas

- **Page discovery is local.** `getOrderedPageFrames` finds the `page:` frames
  itself and orders them by the number in the name (`page:3`, `page:3:lined`)
  and then by vertical position — it does not depend on `goodnotes/pages/`
  for that.
- **Paper template precedence** per page: the pages module's
  `customData.goodnotesPage.template` → a template encoded in the frame name
  (`page:3:lined`) → the `defaultPaperTemplate` prop → `blank`.
- **The export always uses the light theme**, whatever the editor theme or
  `appState.exportWithDarkMode` says — dark output is wrong on paper.
- **Paper templates are redrawn by the exporter.** The on-screen paper is a
  DOM canvas behind Excalidraw and is not part of the scene, so each PDF page
  is composited as: paper (sheet + rulings + border) → transparent ink raster
  on top. Turning off "Include page background" gives transparent pages with
  no paper.
- **Clipping is by page region**, matching what the canvas shows: ink that
  physically overlaps a page's rectangle is drawn on that page, even if it
  belongs to another frame or to none.
- The dialog's portal root carries the `excalidraw` (and `theme--dark`)
  classes, exactly like Excalidraw's own `useCreatePortalContainer`, because
  the theme custom properties are scoped to `.excalidraw`. Pass `theme` (or
  an `appState` with `theme`) or dark mode won't apply.
- The dialog renders into a portal on `document.body` with `z-index: 1000`;
  raise it if the app stacks anything above that.
- The dialog has no CSS reset of its own — it inherits the app's font and
  uses Excalidraw's theme custom properties, so it follows light/dark theme.
