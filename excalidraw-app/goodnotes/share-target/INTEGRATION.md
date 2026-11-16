# Open a PDF from outside the app — integration

Three ways a PDF gets in. Only one of them is platform-limited, and it is the
flashy one.

| Path | Component | Works on |
| --- | --- | --- |
| **File picker** | `PdfDropZone` | Everywhere. On iPad/iPhone this reaches the Files app, iCloud Drive, Dropbox, "Open in…" — it is *the* path there. |
| **Drag & drop** | `PdfDropZone`, `GlobalPdfDropOverlay` | Every desktop browser; iPadOS Split View / Stage Manager drags. |
| **OS share sheet** | manifest `share_target` + `ShareTargetReceiver` | **Installed Chromium PWAs on Android and ChromeOS only.** |

> ### iOS and iPadOS cannot receive shares. This is not a bug to fix.
>
> WebKit does not implement the Web Share Target API, and every browser on
> iOS is WebKit underneath. A PWA cannot appear in the iOS share sheet,
> installed or not, however the manifest is written. Sharing *out* with
> `navigator.share()` works there; receiving does not.
>
> So: gate any "share a PDF to Notebook" copy on `canReceiveShares()` (false
> on all of iOS), and treat the picker + drag-and-drop as the product, not a
> fallback.

---

## 0. Prerequisite: pdf.js must be wired up

This module renders through `goodnotes/import-pdf`, which resolves `pdfjs-dist`
with a `@vite-ignore`'d dynamic import. A browser cannot resolve that bare
specifier at runtime, so **without the static wiring below every import fails
with `missing-dependency`** (that is exactly what happens today if nothing
calls `configurePdfjs`). `pdfjs-dist` is already installed; add this once near
the top of `excalidraw-app/index.tsx` (it is step (e) of
`goodnotes/import-pdf/INTEGRATION.md`, and it is shared with the import
dialog):

```tsx
import * as pdfjs from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import { configurePdfjs } from "./goodnotes/import-pdf";

configurePdfjs({ pdfjs, workerSrc: pdfWorkerUrl });
```

---

## 1. `App.tsx` changes (copy-pasteable)

### a) imports — next to the other `goodnotes` imports

```tsx
import {
  GlobalPdfDropOverlay,
  PdfDropZone,
  ShareTargetReceiver,
  isShareTargetUrl,
} from "./goodnotes/share-target";
```

### b) the new route — first thing inside `GoodNotesRoot`

`GoodNotesRoot` currently derives `docId` from the path and otherwise renders
the `Shelf`. `/share-target` must win over both, before any document state is
read. Add the `isShareTarget` state next to `isTransientScene`, and the early
return just above the existing `if (!docId && !isTransientScene)`:

```tsx
const GoodNotesRoot = () => {
  const [docId, setDocId] = useState<string | null>(() => {
    const match = window.location.pathname.match(/^\/d\/([^/]+)$/);
    return match ? decodeURIComponent(match[1]) : null;
  });
  // the editor, not the shelf, is what a shared link resolves to
  const [isTransientScene] = useState(hasTransientSceneInUrl);
  // NEW — a PDF arriving from the OS share sheet
  const [isShareTarget, setIsShareTarget] = useState(isShareTargetUrl);
  const { editorTheme } = useDarkMode();

  const openDocument = useCallback((doc: DocMeta) => {
    window.history.pushState({}, "", `/d/${encodeURIComponent(doc.id)}`);
    setDocId(doc.id);
  }, []);

  // …closeDocument unchanged…

  useEffect(() => {
    const onPopState = () => {
      const match = window.location.pathname.match(/^\/d\/([^/]+)$/);
      setDocId(match ? decodeURIComponent(match[1]) : null);
      // NEW
      setIsShareTarget(isShareTargetUrl());
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // NEW — the receive screen. It consumes the shared file, imports it and
  // navigates to /d/<newDocId> itself (via pushState + a popstate dispatch,
  // which the effect above already listens for).
  if (isShareTarget) {
    return <ShareTargetReceiver theme={editorTheme} />;
  }

  if (!docId && !isTransientScene) {
    return (
      <>
        <Shelf
          theme={editorTheme}
          onOpenDocument={openDocument}
          // NEW — the always-works path, in the shelf header
          headerExtra={
            <PdfDropZone
              variant="inline"
              theme={editorTheme}
              label="Import PDF"
              onOpenDocument={(id) => {
                window.history.pushState({}, "", `/d/${encodeURIComponent(id)}`);
                setDocId(id);
              }}
            />
          }
        />
        {/* NEW — drop a PDF anywhere on the shelf */}
        <GlobalPdfDropOverlay
          mode="library"
          theme={editorTheme}
          onOpenDocument={(id) => {
            window.history.pushState({}, "", `/d/${encodeURIComponent(id)}`);
            setDocId(id);
          }}
        />
      </>
    );
  }

  return (
    <ExcalidrawWrapper
      key={docId ?? "transient"}
      docId={docId}
      onCloseDocument={closeDocument}
    />
  );
};
```

> If you already pass `headerExtra` to `Shelf` for something else, render
> `<PdfDropZone variant="inline" …/>` inside your existing node — it is just a
> button.

### c) drop a PDF onto an **open** document

Inside `ExcalidrawWrapper`, next to the other overlays (anywhere in the JSX;
it portals nothing and renders `null` unless a drag or an import is in
flight):

```tsx
<GlobalPdfDropOverlay
  mode="document"
  excalidrawAPI={excalidrawAPI}
  theme={editorTheme}
  onPagesAppended={(pages) =>
    excalidrawAPI?.setToast({
      message: `Added ${pages} page${pages === 1 ? "" : "s"}`,
      closable: true,
    })
  }
/>
```

It listens in the **capture** phase and only swallows the event when the drag
really carries a PDF, so images, `.excalidraw` scenes and text still reach
Excalidraw's own drop handler untouched. Without `excalidrawAPI` it falls back
to library mode, so a drop is never silently lost.

### d) optional — only advertise sharing where it exists

```tsx
import { canReceiveShares, describeShareSupport } from "./goodnotes/share-target";

{canReceiveShares() && <p>Tip: share a PDF to Notebook from any app.</p>}
{/* or, to explain the situation honestly: */}
<p>{describeShareSupport()}</p>
```

---

## 2. What changed in `vite.config.mts` (already applied)

1. **`share_target` in the manifest** → `SHARE_TARGET_MANIFEST` from
   `constants.ts`: `POST /share-target`, `multipart/form-data`, file param
   `file`, accepting `application/pdf` / `.pdf`.
   This **replaced** the previous `/web-share-target` + `.excalidraw` entry,
   which was dead: no service worker answered that POST, and `/` renders the
   document shelf rather than the upstream editor that reads the
   `web-share-target` cache. Restore it only together with a handler.
2. **`workbox.importScripts: ["/share-target-sw.js"]`** — `generateSW` has no
   hook for a custom route, but it emits `importScripts(…)` at the very top of
   `sw.js`, so our `fetch` listener registers *before* workbox's router and
   gets first refusal on the POST. (Verified in the built `sw.js`.)
3. **`shareTargetSwPlugin()`** in `plugins` — emits that file at build time
   (generated from `swSource.ts`, so the cache name and redirect URL can never
   drift from the page's) and serves it from the dev server.
4. **`globIgnores: [… "share-target-sw.js"]`** — the browser already stores
   `importScripts` dependencies with the SW script; a second precached copy
   would only risk going stale.
5. **No `navigateFallbackDenylist` entry** — and this is deliberate. The POST
   never reaches workbox's `NavigationRoute` (that route matches GET only),
   while the GET that follows the SW's 303 **must** be served `index.html` so
   the SPA can render the receive screen. Denylisting `/share-target` would
   send that GET to the static host instead. (`vercel.json` already rewrites
   extension-less paths to `index.html`, which covers a cold visit before the
   SW is installed.)

Nothing else in the workbox block was touched — `maximumFileSizeToCacheInBytes`
(6 MB), the mermaid `manifestTransforms` and every `runtimeCaching` rule are
unchanged.

### How the hand-off actually works

```
Android share sheet
  └─ POST /share-target (multipart/form-data)
       └─ sw.js → share-target-sw.js fetch listener
            ├─ request.formData() → the File
            ├─ cache.put("/__goodnotes-share/<id>", Response(file, {headers}))
            └─ 303 → /share-target?shared=<id>
                 └─ navigation → workbox NavigationRoute → index.html
                      └─ <ShareTargetReceiver>
                           ├─ takeSharedFiles([id])   (destructive read)
                           ├─ importPdfToElements → createDoc → saveScene
                           └─ replaceState → /d/<newDocId>
```

The read is destructive and the navigation uses `replaceState`, so a reload or
a Back cannot import the same PDF twice — the second visit shows
"Nothing to import" instead.

---

## 3. Public API

| Export | What it does |
| --- | --- |
| `ShareTargetReceiver` | The `/share-target` screen: consumes the stashed file, shows progress, imports, navigates. Doubles as a standalone "import a PDF" page. |
| `PdfDropZone` | Keyboard-accessible drop zone + file picker (`variant="panel" \| "inline"`). The path that works everywhere. |
| `GlobalPdfDropOverlay` | Window-wide drag & drop. `mode="library"` → a document per PDF; `mode="document"` → pages appended to the open scene. |
| `ImportProgress` | The progress bar + `aria-live` + `role="alert"` pair, if you build your own UI. |
| `canReceiveShares()` | Can the OS hand us a file *right now*? False on all of iOS; false until a Chromium PWA is installed. |
| `getShareTargetCapabilities()` | `{ canReceiveShares, canReceiveSharesWhenInstalled, isInstalled, isIos, hasServiceWorker, canShareOut, canShareFilesOut, reason }`. |
| `describeShareSupport()` | One sentence for a tooltip, e.g. "iPhone and iPad cannot share files into a web app…". |
| `importPdfAsNewDocument(file, opts)` | Headless: render → `createDoc` → `saveScene`. Throws `SharedPdfImportError` with user-ready text. |
| `importPdfsAsNewDocuments(files, opts)` | Batch; one bad file never stops the rest (`{ created, failed }`). |
| `usePdfImport(opts)` | That pipeline as React state: `run`, `cancel`, `reset`, `progress`, `fraction`, `message`, `errorText`. |
| `useGlobalPdfDrop({ onFiles })` | Window-level PDF drag handling without the overlay UI. |
| `looksLikePdf(blob)` | `%PDF-` sniffing. Needed because iOS often reports an empty MIME type. |
| `takeSharedFiles` / `peekSharedFiles` / `clearSharedFiles` / `hasPendingSharedFiles` / `stashSharedFiles` | The Cache Storage hand-off. `stashSharedFiles` lets you (or a test) feed the receive screen without an OS share. |
| `isShareTargetUrl` / `readSharedIdsFromUrl` / `readShareErrorFromUrl` | Route and query parsing. |
| `documentUrl` / `openDocument` / `openLibrary` / `clearShareQuery` | Navigation that matches `App.tsx` (`pushState` + a dispatched `popstate`). |
| `SHARE_TARGET_ACTION`, `SHARE_TARGET_MANIFEST`, `SHARE_CACHE_NAME`, … | The wire format, shared with `vite.config.mts` and the generated SW. |

Options passed through to the renderer (`pdfOptions`) are
`goodnotes/import-pdf`'s `ImportPdfOptions` minus `onProgress`/`signal`:
`scale` (default 2), `pageSizing`, `imageFormat`, `imageQuality`, `password`,
`template`, `extractText`, `pageNumbers`.

---

## 4. What the user sees

- **Android/ChromeOS, installed:** share a PDF → "Opening your PDF…" with a
  live page counter → the document opens. A 3-page PDF took ~2.7 s end to end
  on a desktop-class machine.
- **Everywhere, including iPad:** "Import PDF" in the shelf header, a dashed
  drop zone, or dragging a PDF anywhere onto the window. Each PDF becomes its
  own document named after the file; pages are locked raster images you draw
  on top of.
- **Errors are never blank:** a non-PDF gives
  "“notes.zip” is not a PDF. Only PDF files can be opened as documents.", a
  renamed file gives "…is named like a PDF but its contents are not a PDF",
  and an empty share gives "The share did not include a file." — each in a
  `role="alert"`, with the picker right below it so the user can retry.

## 5. Accessibility

- The drop zone **is** a `<button>`: tab-reachable, has an accessible name,
  Enter/Space open the picker. Drag-and-drop is pure enhancement.
- Progress goes through an `aria-live="polite"` region that is mounted before
  the import starts (so the first update is announced); the bar is a real
  `role="progressbar"` with `aria-valuenow` once the page count is known.
- Errors are in `role="alert"`.
- `:focus-visible` rings on every interactive descendant, from one rule in
  `shareTarget.scss`.
- All motion is disabled under `@media (prefers-reduced-motion: reduce)`.
- Light and dark theme come from Excalidraw's own custom properties; pass
  `theme={editorTheme}`. (`--color-muted` is a *background* grey and is never
  used for text — secondary text uses the local `--gn-share-text-muted`
  alias.)

## 6. Known gaps

- **No iOS share-sheet support, ever** (WebKit). Not worked around; the
  picker is the answer.
- Desktop Chrome/Edge are reported as *unable* to receive shares. They can
  register file handlers on some platforms, but not a file share target, and
  over-promising here is worse than under-promising.
- Documents created from a share get **no thumbnail** until the shelf next
  renders one; `createDoc` is called without a `thumbnail`.
- The receive screen imports **all** pages at the default scale. There is no
  page-range or quality UI on this path — use `ImportPdfDialog` from
  `goodnotes/import-pdf` for that.
- Multi-file shares are supported by the code (one document per file) but
  Android only sends multiple files when the manifest `files` entry is used
  with a multi-select share; single-file is the common case.
