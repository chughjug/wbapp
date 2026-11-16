# Integrating the GoodNotes export module into `excalidraw-app/App.tsx`

This module owns nothing outside `excalidraw-app/goodnotes/export/`. Wiring it
up is a handful of small edits to `App.tsx`; nothing has to run before the
dialog opens.

Dependencies already present: `jspdf`, `react`, and the sibling modules
`goodnotes/paper` (the paper templates the export must redraw),
`goodnotes/pages` (one constant: the `customData` key a page's template lives
under) and `goodnotes/dark` (`toLightExportAppState`, so a dark-mode editor
still produces white-paper output). None of them is modified.

`App.tsx` already renders `<ExportDialog>` — **that existing block keeps
working unchanged**. Sections 1–2 below are the only required edits if you
just want the new dialog; 3–5 add the new entry points.

---

## 1. Imports

The existing import still works:

```tsx
import { ExportDialog, getOrderedPageFrames } from "./goodnotes/export";
```

Add what you need from the new surface:

```tsx
import {
  ExportDialog,
  QuickExportButton,
  getOrderedPageFrames,
  getLastExport,
  useQuickExport,
} from "./goodnotes/export";
```

---

## 2. The dialog (already wired — new props are optional)

The block currently at the bottom of `ExcalidrawWrapper` needs no change:

```tsx
{isPdfExportOpen && excalidrawAPI && (
  <ExportDialog
    elements={excalidrawAPI.getSceneElements()}
    files={excalidrawAPI.getFiles()}
    appState={excalidrawAPI.getAppState()}
    currentPageNumber={currentPageNumber}
    theme={editorTheme}
    onClose={() => setIsPdfExportOpen(false)}
  />
)}
```

Two props are worth adding, because they make the presets correct rather than
merely functional:

```tsx
{isPdfExportOpen && excalidrawAPI && (
  <ExportDialog
    elements={excalidrawAPI.getSceneElements()}
    files={excalidrawAPI.getFiles()}
    appState={excalidrawAPI.getAppState()}
    currentPageNumber={currentPageNumber}
    theme={editorTheme}
    // + the document's title, so the file isn't called "document.pdf"
    defaultFileName={docMeta?.title ?? "document"}
    // + the document's paper, for pages whose frame doesn't carry one
    defaultPaperTemplate={docMeta?.defaultTemplate ?? "blank"}
    // + optional: every produced file, for a toast
    onExportComplete={(result) => {
      // result.files: [{ fileName, blob }], result.delivery: shared|downloaded|cancelled
    }}
    onClose={() => setIsPdfExportOpen(false)}
  />
)}
```

The old `onExported?: (blob, fileName) => void` prop still fires, with the
first produced file.

---

## 3. One-click re-export, as a toolbar button

Drop the button anywhere in the editor chrome — it renders `null` until the
student has exported at least once, so it never shows an action that can't do
anything. Put it next to the other `goodnotes` controls inside
`ExcalidrawWrapper`'s returned tree (it is an inline `<span>`, not a portal):

```tsx
<QuickExportButton
  getScene={() =>
    excalidrawAPI && {
      elements: excalidrawAPI.getSceneElements(),
      files: excalidrawAPI.getFiles(),
      appState: excalidrawAPI.getAppState(),
    }
  }
  currentPageNumber={currentPageNumber}
  defaultPaperTemplate={docMeta?.defaultTemplate ?? "blank"}
  fileName={docMeta?.title ?? "document"}
/>
```

`getScene` is called at click time, never at render time, so a button mounted
once can't export a stale scene.

## 4. …or as a menu item in the existing NavBar

`NavBar` already takes `onExportPdf`. The headless hook gives you the same
behaviour without the button's markup, which suits a menu row:

```tsx
const quickExport = useQuickExport({
  getScene: () =>
    excalidrawAPI && {
      elements: excalidrawAPI.getSceneElements(),
      files: excalidrawAPI.getFiles(),
      appState: excalidrawAPI.getAppState(),
    },
  currentPageNumber,
  defaultPaperTemplate: docMeta?.defaultTemplate ?? "blank",
  fileName: docMeta?.title ?? "document",
});

// …then, wherever the menu is built:
<NavBar
  // …existing props…
  onExportPdf={() => setIsPdfExportOpen(true)}
  // a second entry, shown only when there is something to repeat:
  onQuickExport={quickExport.last ? () => void quickExport.run() : undefined}
/>;
```

(`NavBar` is owned by another module — if it has no `onQuickExport` prop, use
the `<QuickExportButton>` from section 3 instead, or render the hook's `run`
from an `AppMainMenu` item:)

```tsx
{quickExport.last && (
  <MainMenu.Item
    onSelect={() => void quickExport.run()}
    data-testid="goodnotes-quick-export"
  >
    {`Export again (${quickExport.label})`}
  </MainMenu.Item>
)}
```

If you drive it from a menu item, also render the hook's live region
somewhere persistent so completion is announced:

```tsx
<div className="gn-export-visually-hidden" aria-live="polite" role="status">
  {quickExport.status}
</div>
```

---

## 5. Deriving `currentPageNumber`, if you don't have it

`App.tsx` already computes this; for reference:

```tsx
import { getOrderedPageFrames } from "./goodnotes/export";

const currentPageNumber = useMemo(() => {
  if (!excalidrawAPI) {
    return null;
  }
  const { scrollY, height } = excalidrawAPI.getAppState();
  const centreY = -scrollY + height / 2; // scene y of the viewport centre
  const frames = getOrderedPageFrames(excalidrawAPI.getSceneElements());
  const index = frames.findIndex(
    (f) => centreY >= f.y && centreY <= f.y + f.height,
  );
  return index === -1 ? null : index + 1;
}, [excalidrawAPI]);
```

Without it, "This page only" is disabled and `pageMode: "current"` errors with
a readable message.

---

## Presets

| Preset | Format | Pages | Scale | Background | Delivery |
| --- | --- | --- | --- | --- | --- |
| **Submit** | PDF (1 file) | all | 2x (print) | on | download |
| **Share** | PDF (1 file) | all | 1x (small) | on | OS share sheet, falls back to download |
| **Images** | PNG, 1 per page | all | 2x | on | download (one file per page) |
| **This page only** | PDF (1 file) | current page | 2x | on | download |

Touching any control under **More options** moves the selection to "Custom" —
the preset is derived from the settings, never stored separately. The last
used settings (preset or custom) are persisted to `localStorage` under
`goodnotes:export:last` and restored next time the dialog opens; they are also
what the one-click re-export repeats.

---

## Optional: export without any UI

```tsx
import {
  exportDocumentToPdf,
  exportDocumentToImages,
  runExport,
  downloadPdfBlob,
  getPreset,
} from "./goodnotes/export";

// a PDF, as before — signature unchanged
const blob = await exportDocumentToPdf({
  elements: excalidrawAPI.getSceneElements(),
  files: excalidrawAPI.getFiles(),
  appState: excalidrawAPI.getAppState(),
  scale: 2,
});
downloadPdfBlob(blob, "my-notes.pdf");

// one PNG per page
const images = await exportDocumentToImages({
  elements: excalidrawAPI.getSceneElements(),
  files: excalidrawAPI.getFiles(),
  appState: excalidrawAPI.getAppState(),
  pageRange: [1, 2],
  scale: 2,
  fileName: "my-notes", // -> my-notes-page-1.png, my-notes-page-2.png
});

// a whole preset, delivered (download or share sheet)
await runExport({
  elements: excalidrawAPI.getSceneElements(),
  files: excalidrawAPI.getFiles(),
  appState: excalidrawAPI.getAppState(),
  settings: getPreset("share").settings,
  fileName: "my-notes",
  currentPageNumber,
});
```

---

## Notes / gotchas

- **One rasteriser.** PDF pages, PNG pages and preview thumbnails all go
  through `createPageRenderer().renderPage()`, so the preview cannot show
  something the file doesn't contain. `createPageRenderer` awaits
  `preloadPageImages` — that await is what stops image-backed pages exporting
  blank, because `renderPaperForFrame` is synchronous.
- **Page discovery is local.** `getOrderedPageFrames` finds the `page:` frames
  itself and orders them by the number in the name (`page:3`, `page:3:lined`),
  then by vertical position.
- **Paper template precedence** per page: the pages module's
  `customData.goodnotesPage.template` → a template encoded in the frame name
  (`page:3:lined`) → the `defaultPaperTemplate` prop → `blank`.
- **The output is always light theme**, whatever the editor theme or
  `appState.exportWithDarkMode` says. The appState is passed through
  `toLightExportAppState` (`goodnotes/dark`) and the ink layer is rendered
  with `theme: "light"`.
- **Paper is redrawn by the exporter.** The on-screen paper is a DOM canvas
  behind Excalidraw, not part of the scene, so each page is composited as
  paper (sheet + rulings + picture + border) → transparent ink raster on top.
  Unticking "Include page background" gives transparent pages with no paper.
- **The share sheet is feature-detected per payload** with
  `navigator.canShare({ files })`, which is the only check Safari honours.
  Desktop Chrome/Firefox have no file share, so "Share" downloads there and
  the preset's own description says so. A user dismissing the share sheet is
  reported as `delivery: "cancelled"` and nothing is downloaded — they already
  said no.
- **No zip.** The app has no zip dependency and may not add one, so a
  multi-page PNG export produces separate files: one share sheet with all of
  them, or N downloads. Browsers may prompt for "allow multiple downloads".
- **Size estimates are estimates.** They extrapolate from a 0.5x render of the
  first pages and are shown with a `~`. Measured against real exports they
  land within roughly ±40%; see `estimate.ts` for the model.
- **Cancel is cooperative**, between pages. A 4x page already in flight
  finishes rendering before the abort is noticed — up to about a second.
- The dialog's portal root carries the `excalidraw` (and `theme--dark`)
  classes, exactly like Excalidraw's own `useCreatePortalContainer`, because
  the theme custom properties are scoped to `.excalidraw`. Pass `theme` (or an
  `appState` with `theme`) or dark mode won't apply.
- The dialog portals to `document.body` with `z-index: 1000`; raise it if the
  app stacks anything above that.
- **Behaviour change:** a successful export no longer closes the dialog
  silently. It shows a completion line (announced via `aria-live`) and focuses
  a **Done** button, so a screen-reader user hears that the file exists. Call
  `onClose` from `onExportComplete` if you want the old auto-close.
