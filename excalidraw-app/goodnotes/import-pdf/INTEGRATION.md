# PDF import — integration

> ## Status: installed and wired up
>
> `pdfjs-dist@^4.10.38` is a dependency of `excalidraw-app`, and
> `excalidraw-app/index.tsx` hands it to this module through `configurePdfjs`.
> Nothing below needs doing again — the sections are kept as a description of
> how the pieces fit, not as a to-do list.
>
> The module still resolves pdf.js indirectly, through injection or a dynamic
> `import()`, so it keeps compiling if the dependency is ever dropped. Without
> an injected build, a bundled browser build cannot resolve the bare specifier
> and every import fails with `PdfImportError { code: "missing-dependency" }` —
> so the `configurePdfjs` call in the entry point is load-bearing, not optional.

---

## 1. `App.tsx` changes (copy-pasteable)

### a) imports — add next to the other `goodnotes` imports

```tsx
import { ImportPdfDialog } from "./goodnotes/import-pdf";
```

### b) state — inside the `ExcalidrawWrapper` component body

```tsx
const [isImportPdfOpen, setIsImportPdfOpen] = useState(false);
```

### c) the trigger

Either wire your taskbar/toolbar button to `setIsImportPdfOpen(true)`, or add a main-menu item next to the existing ones:

```tsx
<MainMenu.Item
  onSelect={() => setIsImportPdfOpen(true)}
  icon={null}
  data-testid="import-pdf"
>
  Import PDF…
</MainMenu.Item>
```

### d) the dialog — render near the other overlays, inside the

`<Excalidraw>` subtree or right after it; it portals to `document.body` either way. Mount it **only while open** so focus handling stays correct:

```tsx
{
  isImportPdfOpen && excalidrawAPI && (
    <ImportPdfDialog
      excalidrawAPI={excalidrawAPI}
      onClose={() => setIsImportPdfOpen(false)}
      onImported={(result) =>
        excalidrawAPI.setToast({
          message: `Imported ${result.pages.length} page${
            result.pages.length === 1 ? "" : "s"
          }`,
          closable: true,
        })
      }
    />
  );
}
```

That is the whole integration. The dialog talks to the editor through the imperative API only (`getSceneElements`, `addFiles`, `updateScene`), so no other state has to be threaded through.

### e) pdf.js wiring — required, and lazy

This is what the app actually does, in `excalidraw-app/index.tsx`:

```tsx
import { configurePdfjs } from "./goodnotes/import-pdf";

configurePdfjs({
  load: () => import("pdfjs-dist"),
  loadWorkerSrc: () =>
    import("pdfjs-dist/build/pdf.worker.min.mjs?url").then((m) => m.default),
});
```

Thunks, not eager imports. Rollup still resolves the dependency statically, so
the specifier works in the browser, but it emits pdf.js as its own chunk that
is fetched the first time someone imports a PDF. Importing it eagerly instead
puts ~370 kB (~109 kB gzipped) in the entry chunk of an app whose users mostly
never open a PDF; measured on this repo, the eager form cost 375 kB raw /
108 kB gzipped on every cold start.

The eager form — `configurePdfjs({ pdfjs, workerSrc })` — is still supported,
for a host that already has a pdf.js instance in hand.

### f) optional — drag a PDF onto the canvas

```tsx
const importPdf = useMemo(
  () =>
    excalidrawAPI
      ? createPdfImportHandler(excalidrawAPI, {
          onError: (message) =>
            excalidrawAPI.setToast({ message, closable: true }),
        })
      : null,
  [excalidrawAPI],
);
// …then from your own drop handler:
// if (file.type === "application/pdf") { void importPdf?.(file); }
```

Excalidraw's own drop handler rejects PDFs before this runs, so wire it on a wrapper element (or use the dialog's drop zone) rather than on the canvas.

---

## 2. Public API

Everything is exported from `./goodnotes/import-pdf`:

| Export | What it does |
| --- | --- |
| `ImportPdfDialog` | The accessible dialog (picker + drag/drop, page range, quality, page sizing, progress + cancel, error surfacing). |
| `createPdfImportHandler(api, { onError, onSuccess, defaults })` | Callback-shaped entry point for a toolbar button: `(file, opts?) => Promise<ImportPdfResult \| null>`; never rejects. |
| `importPdfIntoScene(api, source, opts)` | Renders and applies to a live editor (`addFiles` → `updateScene` → scroll to first new page). |
| `importPdfToElements(source, { elements, …opts })` | Pure variant: returns the new `elements` + `files`, touches no editor. |
| `readPdfPageCount(source)` | Page count without rendering. |
| `isPdfjsAvailable()` / `loadPdfjs()` / `configurePdfjs()` | Dependency probing and injection. |
| `parsePageRange(text, total)` | `"1-3, 7, 10-"` → `[1,2,3,7,10,11,12]`, `null` when unparseable. |
| `matchClosestPageSize(w, h)` | Nearest `PAGE_SIZES` preset + landscape flag. |
| `PdfImportError` / `describePdfImportError` | Typed errors (`code`: `missing-dependency`, `invalid-pdf`, `password-required`, `render-failed`, `cancelled`, `empty-selection`, `no-canvas`). |
| `PDFJS_PACKAGE`, `PDFJS_VERSION_RANGE`, `PDF_IMPORT_CUSTOM_DATA_KEY`, `DEFAULT_RENDER_SCALE`, `RENDER_SCALE_OPTIONS` | Constants, also used by the dialog's banner. |

`ImportPdfOptions`: `pageNumbers`, `scale` (default 2), `pageSizing` (`"preset"` default / `"exact"`), `imageFormat` (`"image/jpeg"` default / `"image/png"`), `imageQuality` (0.9), `password`, `template`, `extractText`, `onProgress(completed, total)`, `signal`, `sourceName`.

---

## 3. What it does to the scene

For each selected PDF page, appended **at the end of the document**:

1. a page frame built with the pages module's own `createPageFrame`, then `restackPages` — so names (`page:<n>`), the x = 0 column, `PAGE_GAP` spacing and child offsets stay exactly as the page model expects;
2. one `image` element parented to that frame (`frameId`), `locked: true`, `status: "saved"`, sized `contain` inside the frame and centred;
3. one `BinaryFileData` per raster — `id` is the SHA-1 digest of the encoded image (via the editor's own `generateIdFromFile`), with `mimeType`, `dataURL`, `created` and `lastRetrieved`, handed to `addFiles` **before** `updateScene` so the element never references an unknown file. Identical pages share one file id automatically.

The frame's `customData` keeps the pages module's `goodnotesPage` untouched and adds `goodnotesPdfImport` (source name, PDF page number, true source size, render scale, timestamp, and the extracted text when asked for).

**Page sizing.** Default `"preset"`: snap to the closest `PAGE_SIZES` preset (Letter / A4 / Legal, transposed for landscape pages) and letterbox the raster inside it. Rationale: the rest of the GoodNotes layer — paper templates, the page sidebar, PDF export — assumes known uniform page geometry, and a uniform document is also what GoodNotes produces. The cost is thin margins when the PDF's aspect isn't exactly one of the three. Use `"exact"` (exposed in the dialog as _Keep the PDF's exact dimensions_) for slide decks and odd formats; pages then carry true 96dpi dimensions and may be mixed-size.

**Ink stays on top.** The raster is inserted immediately after its frame, so anything drawn later is above it in z-order, and `locked: true` means a click on the scan falls through to the canvas — verified in the running app: drawing over an imported page produces a stroke parented to that page, and clicking the scan with the selection tool selects nothing.

---

## 4. Known limitations (please don't oversell this feature)

- **No text layer. Imported pages are pictures.** Nothing on them is selectable, searchable, copyable or editable text; there are no links, form fields or vector shapes. Zooming beyond the render scale shows interpolation blur, not sharper glyphs. `extractText: true` stores the page's text as a plain string in the frame's `customData` for a _future_ search feature — it is metadata, never rendered, has no per-word positions, and is empty for scanned PDFs (no OCR anywhere in this module).
- **Scene size.** A 2x A4 JPEG page is roughly 200–400 KB of base64 in the scene. A 40-page import is tens of megabytes and may exceed `localStorage`-backed persistence; prefer 1x–2x for long documents, and expect PNG to be several times larger than the JPEG default.
- Render scale is clamped so neither canvas side exceeds 8192 px; very large pages are therefore rendered below the requested scale.
- **Append only.** Pages always go to the end of the document; there is no "insert at page N" yet.
- Everything runs on the main thread apart from pdf.js's own worker, so a long import makes the UI janky even though it is cancellable between pages.
- Encrypted PDFs need the password typed into the dialog up front; pdf.js's interactive `onPassword` callback is not wired to a prompt.
- No OCR, no page rotation UI (pdf.js's own `/Rotate` is honoured because the viewport already accounts for it), no per-page re-import or "replace page".
- Annotations that are part of the PDF (highlights, comments) are flattened into the raster exactly as pdf.js draws them.

---

## 5. Verification status

Verified empirically in the running app (Playwright + Chromium, dev server on :3001):

- geometry, naming and stacking of imported pages (`page:1…page:n`, x = 0, `PAGE_GAP` spacing) including a landscape page and `"exact"` sizing;
- `BinaryFiles` wiring: one entry per raster, SHA-1 ids, `data:image/…` dataURLs, every image element's `fileId` resolvable, dedup of identical pages, `addFiles` before `updateScene`;
- import into the **real editor**: pages appear on the canvas and in the page sidebar, drawing over an imported page creates a stroke parented to that page and painted above the scan, and clicking the scan selects nothing;
- progress callbacks `0/n … n/n`, cancellation via `AbortSignal`, corrupt-file and empty-selection errors, `parsePageRange` edge cases;
- dialog accessibility (role/aria-modal, labelled controls, focus trap in both directions, Escape, `aria-live` progress, `aria-invalid` range validation, 2 px focus rings) and correct colours in light **and** dark theme.

**Verified end to end** against the production build: a 3-page PDF imported
into an open document produced three new pages carrying the rendered rasters,
with no console errors, and the pdf.js chunk was fetched only on opening the
dialog — not at boot.

**Still unverified:** CMap and standard-font handling for PDFs with embedded
CJK or unusual fonts, and `PasswordException` behaviour for real encrypted
files. Both paths are covered only by a stub that mimics `getDocument` /
`getViewport` / `render` / `getTextContent` and the pdf.js exception names.
