# Integrating `goodnotes/pages` into `excalidraw-app/App.tsx`

Everything below goes into `excalidraw-app/App.tsx`. This module does **not** edit it itself.

---

## 0. Which host should render the sidebar?

Investigated options:

| Host | Verdict |
| --- | --- |
| `<Sidebar name="…">` (exported from `@excalidraw/excalidraw`, rendered as a **child** of `<Excalidraw>`) | **Use this.** It is the supported host-app sidebar API. It renders into the editor's own sidebar slot, is dockable (`docked` + `onDock`), closes on outside click / Escape, is excluded from the canvas pointer handling, participates in `appState.openSidebar`, can be toggled from `excalidrawAPI.toggleSidebar({ name: "goodnotes-pages" })`, and — importantly for us — is measured by `getViewportOffsets()`, so `setViewport`/`scrollToPage` will not centre a page underneath it. |
| `renderSidebar` prop | **Does not exist** in this codebase. (`props.children` is the sidebar mechanism; there is no `renderSidebar`.) |
| A plain absolutely-positioned child of `<Excalidraw>` | Works, but you lose docking, the open/close state machine, Escape handling, and the viewport-offset measurement. Only worth it if you want the strip permanently visible with no toggle. |
| `<DefaultSidebar>` | Wrong host — it is the editor's own library/canvas sidebar; adding a tab to it mixes our pages with editor UI. |

Note the editor sidebar is anchored to the **right** edge (left in RTL). If you want GoodNotes' left-hand strip, use the plain-child variant in §4.

---

## 1. Imports

```tsx
// add to the existing `@excalidraw/excalidraw` import
import { Sidebar } from "@excalidraw/excalidraw";

// new import
import { PageSidebar, usePages } from "./goodnotes/pages";
```

## 2. Seed a brand-new document with its first page

`excalidraw-app` resolves `initialData` through `initialStatePromiseRef.current.promise`. The simplest, collaboration-safe place to seed is right after the API exists, using the hook's idempotent `seedFirstPage()` (it is a no-op when the scene already has a page, so it is safe to run on every load and after a remote scene arrives).

Inside `ExcalidrawWrapper`, next to the other hooks:

```tsx
const { seedFirstPage } = usePages(excalidrawAPI);

useEffect(() => {
  if (!excalidrawAPI) {
    return;
  }
  // wait for the initial scene to be applied, then ensure page 1 exists
  initialStatePromiseRef.current.promise.then(() => {
    seedFirstPage({ size: "A4", template: "blank" });
  });
}, [excalidrawAPI, seedFirstPage]);
```

`seedFirstPage` applies the change with `CaptureUpdateAction.NEVER`, so it is not an undoable user edit.

> If you prefer to seed _before_ first paint instead, build the elements in `initializeScene`:
>
> ```tsx
> import { ensureFirstPage } from "./goodnotes/pages";
> // …where the initial scene data is assembled:
> scene.elements = ensureFirstPage(scene.elements ?? []);
> ```

## 3. Render the sidebar (recommended: editor `Sidebar` host)

Add as a child of `<Excalidraw>` — e.g. just after `<AppMainMenu …/>`:

```tsx
{
  excalidrawAPI && (
    <Sidebar name="goodnotes-pages" docked onDock={() => {}}>
      <Sidebar.Header />
      <PageSidebar excalidrawAPI={excalidrawAPI} />
    </Sidebar>
  );
}
```

and a trigger — e.g. inside `renderTopRightUI`:

```tsx
<Sidebar.Trigger
  name="goodnotes-pages"
  title="Pages"
  icon={<span aria-hidden="true">▤</span>}
>
  Pages
</Sidebar.Trigger>
```

(or open it programmatically: `excalidrawAPI.toggleSidebar({ name: "goodnotes-pages", force: true })`.)

`PageSidebar` fills its container (`height: 100%`), so nothing else is needed.

## 4. Alternative: always-visible left strip

```tsx
<Excalidraw …>
  {excalidrawAPI && (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        bottom: 0,
        width: 180,
        zIndex: 4,
        borderRight: "1px solid var(--sidebar-border-color)",
      }}
    >
      <PageSidebar excalidrawAPI={excalidrawAPI} />
    </div>
  )}
</Excalidraw>
```

With this variant pass an explicit left offset when navigating, since the editor cannot measure your strip:

```tsx
scrollToPage(excalidrawAPI, index /* … */);
// or call excalidrawAPI.setViewport({ target, offsets: { left: 180, ui: true } })
```

## 5. Optional extras

```tsx
const { pages, activePageIndex, addPage, goToPage } = usePages(excalidrawAPI);
```

- page counter in the footer: `` `${activePageIndex + 1} / ${pages.length}` ``
- "new page" command in the command palette: `() => addPage()`
- jump to the page of a clicked element: `scrollToPageOfElement(excalidrawAPI, elementId)`

## 6. Contract with the paper-templates module

**Decision: option 2 — the template is stored in the frame's `customData`, not in the frame name.** Page frame names stay exactly `page:1`, `page:2`, … .

Why: Excalidraw renders `frame.name` as a visible label above the frame and lets the user rename it inline (`getFrameLikeTitle`, and the frame-name editor in the interactive scene). A name like `page:3:cornell` would be shown on the canvas, and any user rename would silently change the paper. `customData` is the sanctioned per-element host-data slot, survives save/load, export and collaboration, and cannot be edited away by accident.

Wire the paper module's `templateForPage` callback to this accessor:

```tsx
import { getTemplateForPage } from "./goodnotes/pages";

<PaperLayer
  // …
  templateForPage={(pageIndex: number) =>
    getTemplateForPage(excalidrawAPI.getSceneElements(), pageIndex)
  }
/>;
```

Other accessors available for the same data:

| Accessor | Signature |
| --- | --- |
| `getTemplateForPage` | `(elements: readonly ExcalidrawElement[], index: number) => PaperTemplateId` |
| `getPageTemplate` | `(frame: ExcalidrawFrameElement) => PaperTemplateId` |
| `getPages(elements)[i].template` | already a `PaperTemplateId` on every `Page` |
| `setPageTemplate` | `(elements, index, template) => ExcalidrawElement[]` (writer) |
| `usePages(api).setPageTemplate` | `(index, template) => void` (writer, applies via `updateScene`) |

The storage key is exported as `PAGE_CUSTOM_DATA_KEY` (`"goodnotesPage"`), with the shape `{ template: PaperTemplateId; size: PageSizeName }`, if you ever need to read it directly.

Note the paper module's existing `page:<index>:<templateId>` parser stays backward-compatible with what we emit — it just always sees the two-segment form `page:<index>` and should fall back to its default (which should then be overridden by `templateForPage`).

### Page backgrounds are transparent

Checked: Excalidraw draws a frame as an **outline only** — `renderElement.ts` (`case "frame"`) strokes with `FRAME_STYLE` and never fills from `element.backgroundColor`; `FRAME_STYLE.backgroundColor` is `"transparent"` too. On top of that, `createPageFrame` sets `backgroundColor: "transparent"` explicitly. A page frame therefore cannot occlude the paper layer painted behind the canvas.

### Thumbnails show the paper

The page-thumbnail strip composites the two layers: `renderPaper(ctx, templateId, w, h, { theme, sheet: true })` from `../paper` is painted first, then the page's ink is exported on a **transparent** raster (`canvasBackgroundColor: false`) and drawn on top. So a lined page looks lined in the strip, a grid page looks gridded, and the thumbnail matches what the canvas shows.

Verified headlessly against the running dev server (Playwright + Chromium, importing the real modules):

| thumbnail                                   | non-white paper px | ink px |
| ------------------------------------------- | ------------------ | ------ |
| `lined` page with a red rectangle on it     | 14 522             | 597    |
| `grid` page, empty                          | 37 180             | 0      |
| `blank` page, empty (control — border only) | 1 270              | 0      |

Negative control, same export at the same size: **without** `canvasBackgroundColor: false` the ink raster is 35 775/35 775 opaque pixels (it would have covered the paper completely); **with** it, 0 opaque pixels on an empty page. Keep that flag if you ever touch this code.

`PageSidebar` imports `../paper` directly — no extra wiring in App.tsx.

## 7. Things worth knowing

- **This fork has no `excalidrawAPI.scrollToContent`.** The replacement is `excalidrawAPI.setViewport(opts)`; `scrollToPage` wraps it.
- `PageSidebar.scss` is imported by the component — no extra CSS wiring.
- Pages are ordinary frames, so Excalidraw's own frame behaviour (clipping, reparenting of newly drawn elements, per-frame export) applies for free.
- Nothing in this module registers keyboard shortcuts or touches `appState` beyond `updateScene`/`setViewport`.

---

# ADDENDUM — the "New page" format flow (template / size / orientation / image)

Added by the page-format work. Everything here is **new**; nothing above changed its meaning.

`addPage()` used to pick a format silently. There is now a real picker, reachable from both entry points, and the choice is remembered per document.

## A1. One shared flow for the page panel AND the nav bar

`useNewPage` owns the dialog state, the remembered choice and the insertion (including hashing an image into `BinaryFiles`). Render `dialog` once; hand `open` to as many buttons as you like.

```tsx
// with the other goodnotes imports
import { usePages, useNewPage } from "./goodnotes/pages";
```

Inside `ExcalidrawWrapper`, **replace**

```tsx
const { seedFirstPage, pages, addPage } = usePages(excalidrawAPI);
```

with

```tsx
const { seedFirstPage, pages } = usePages(excalidrawAPI);
// docId is already in scope in ExcalidrawWrapper; passing it keeps the
// remembered choice per notebook (it also writes DocMeta.defaultTemplate /
// defaultPageSize through `goodnotes/library`).
const newPage = useNewPage(excalidrawAPI, { docId, theme: editorTheme });
```

Then the nav bar's add-page action becomes:

```tsx
onAddPage={newPage.open}        // was: onAddPage={() => addPage()}
```

and the dialog is mounted once, anywhere inside the shell (it portals to `document.body`, so placement does not matter):

```tsx
{
  newPage.dialog;
}
```

### The page panel's own `+ Add page`

**Nothing to do — it already works.** `PageSidebar` (mine) owns a `useNewPage` instance of its own, so the panel's `+ Add page` opens the same dialog, writes the same per-document memory and produces identical pages. Two hook instances, one shared choice.

If you would rather have exactly one instance, `PageSidebar` takes `onAddPage` — but `goodnotes/shell`'s `PagePanel` (not my file) renders `<PageSidebar excalidrawAPI thumbnails />` and does **not** forward extra props, so `<PagePanel onAddPage={…}>` will not type-check as things stand. Adding

```tsx
// goodnotes/shell/PagePanel.tsx — YOUR file, optional
onAddPage?: () => void;
…
<PageSidebar excalidrawAPI={excalidrawAPI} thumbnails={thumbnails} onAddPage={onAddPage} />
```

is all it takes if you want that.

## A2. Headless / keyboard entry points

```tsx
// add another page exactly like the last one — no dialog at all
await newPage.repeatLastChoice();

// fully explicit
await newPage.addPageWithChoice({
  template: "cornell",
  size: "LETTER",
  landscape: true,
  at: 0, // insert first; default is "append"
  remember: false, // don't overwrite the document's remembered choice
});

// an image page from a File you already have (drag & drop, paste, …)
await newPage.addPageWithChoice({ imageFile: file, imageFit: "contain" });
```

`PageSidebar` also takes `addPageMode="repeat"` if you want its `+ Add page` button to silently reuse the last format and never open the dialog.

## A3. Where the remembered choice lives

Two tiers, read merged, `localStorage` winning:

| Tier | Key | Holds |
| --- | --- | --- |
| `localStorage` | `goodnotes:new-page-choice:<docId>` | template, size, orientation, image mode, image fit |
| `DocMeta` (IndexedDB, via `goodnotes/library`) | the document row | `defaultTemplate`, `defaultPageSize` |

`goodnotes/library` and `goodnotes/types` were **not** edited: the `DocMeta` tier is written with the module's own public `updateDocMeta()`. The extra fields (orientation, image fit) have nowhere to live in `DocMeta`, which is why the local tier exists at all — see "What I would like added to `types.ts`" below.

## A4. Image-backed pages

An image page is a normal page frame whose `customData` carries an extra key:

```jsonc
{
  "goodnotesPage": { "template": "blank", "size": "LEGAL", "landscape": true },
  "goodnotesPageImage": {
    "fileId": "<sha1>", // into the editor's own BinaryFiles
    "mimeType": "image/png",
    "fit": "cover", // "cover" | "contain" | "stretch"
    "name": "worksheet.png",
    "naturalWidth": 600,
    "naturalHeight": 800
  }
}
```

- **Bytes** go through `excalidrawAPI.addFiles()` with a SHA-1 `generateIdFromFile` id, exactly like `goodnotes/import-pdf`, so they are saved with the scene and survive reload. `addFiles` happens **before** the element is inserted.
- **Rendering** happens on the paper layer, behind every stroke and outside the selection model — there is no image _element_, so the picture can never be clicked, dragged or deleted by accident.
- **Decoding** is asynchronous, `renderPaper` is not. `goodnotes/paper/pageImages.ts` owns a process-wide cache keyed by `fileId`; `usePages` primes it on every scene change (so **no App.tsx wiring is needed** for the live canvas), the layer repaints via `onPageImageReady`, and the first paint shows a neutral placeholder rather than a hole.
- **Thumbnails** `await preloadPageImages(...)` before rendering, so the strip shows the real picture.

### Reusing one image across pages

```tsx
import { getPageImage } from "./goodnotes/pages";
const bg = getPageImage(pages[0].frame);
await newPage.addPageWithChoice({ image: bg }); // same fileId, no re-upload
```

## A5. KNOWN GAP — image pages are blank in PDF export

**Measured, not guessed:** exporting a two-page document (page 1 lined, page 2 an image page) produces a PDF whose page 2 is white — 0.0 % of the image's colour, against 86.3 % in the same page's thumbnail.

The cause is a signature, not a bug in this module. `goodnotes/export/exportPdf.ts` calls

```ts
renderPaper(
  ctx,
  templateByFrameId.get(frame.id) ?? defaultPaperTemplate,
  frame.width,
  frame.height,
  { theme: "light", sheet: true },
);
```

It passes a **template id**, not the frame, so there is no way for `renderPaper` to find the image. `goodnotes/export/` is not mine to edit. The fix is three lines there, and the API it needs is already exported:

```ts
// 1. new imports
import { preloadPageImages, renderPaperForFrame } from "../paper";

// 2. once, before the page loop in exportDocumentToPdf (it is already async)
await preloadPageImages(sceneElements, files);

// 3. replace the renderPaper(…) call above with
renderPaperForFrame(ctx, frame, {
  theme: "light",
  sheet: true,
  defaultTemplate: templateByFrameId.get(frame.id) ?? defaultPaperTemplate,
});
```

`renderPaperForFrame` reads both the ruling and the image off the frame's `customData` and is synchronous; `preloadPageImages` is what makes that safe. Until that lands, image pages print as plain paper.

## A6. What I would like added to `goodnotes/types.ts`

I did not touch the file. Two changes would let me drop the workarounds:

1. **A `PageImageBackground` shape and an `image` field on the page record.** Right now I keep `template: "blank"` and store the picture under a sibling `customData` key (`goodnotesPageImage`), because `PaperTemplateId` is a closed union. I am **not** asking for `"image"` as a seventh `PaperTemplateId` — rulings and pictures are orthogonal (a lined overlay on a scan is genuinely useful, and already works). What I want is:

   ```ts
   export type PageImageFit = "cover" | "contain" | "stretch";

   export interface PageImageBackground {
     /** SHA-1 fileId into the scene's BinaryFiles. */
     fileId: string;
     mimeType?: string;
     fit?: PageImageFit;
     opacity?: number;
     name?: string;
     naturalWidth?: number;
     naturalHeight?: number;
   }

   export interface Page {
     frame: ExcalidrawFrameElement;
     index: number;
     template: PaperTemplateId;
     image?: PageImageBackground;      // <- new
   }

   export interface PaperTemplate {
     …
     render: (ctx, width, height, opts: { theme: "light" | "dark" }) => void;
   }
   ```

   If you add it, I will re-export mine as an alias of yours and delete the local copy in `goodnotes/paper/pageImages.ts`.

2. **Orientation and image-fit on `DocMeta`**, so the remembered choice does not need a `localStorage` tier:

   ```ts
   export interface DocMeta {
     …
     defaultTemplate: PaperTemplateId;
     defaultPageSize: PageSizeName;
     defaultLandscape?: boolean;       // <- new
     defaultImageFit?: PageImageFit;   // <- new
   }
   ```

Neither is required for the feature to work today.

## A7. New public API (`./goodnotes/pages`)

| Export | What it is |
| --- | --- |
| `useNewPage(api, { docId?, theme?, at?, onAdded? })` | the whole flow: `{ open, close, isOpen, dialog, choice, addPageWithChoice, repeatLastChoice }` |
| `NewPageDialog` | the dialog itself, if you drive `isOpen` yourself |
| `IMAGE_FORMAT_ID`, `NewPageFormatId`, `NewPageSubmission` | the dialog's format-id space (ours, not `PaperTemplateId`) |
| `loadNewPageChoice` / `readNewPageChoice` / `writeNewPageChoice` / `DEFAULT_NEW_PAGE_CHOICE` / `getCurrentDocId` | the remembered choice |
| `attachPageImageFile` / `preparePageImage` / `isSupportedPageImage` / `PageImageError` / `PAGE_IMAGE_ACCEPT` / `PAGE_IMAGE_MIME_TYPES` / `PAGE_IMAGE_MAX_BYTES` | File → `BinaryFiles` |
| `setPageImage` / `getPageImage` | read/write a page's image background |
| `isLandscapePage` / `getPageDimensions` | orientation |
| `PageSidebar` props `addPageMode` / `onAddPage` / `docId` | wire the panel's `+ Add page` |

`createPageFrame(index, size, opts)` and `addPage(elements, opts)` gained two **optional** fields each — `landscape` and `image`. Existing calls (including `goodnotes/import-pdf`'s) are unchanged.
