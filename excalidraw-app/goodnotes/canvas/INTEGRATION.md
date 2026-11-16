# Canvas LMS — integration

Connect a student's Canvas instance, browse one course at a time, turn an
assignment into a notebook and a course PDF into annotatable pages.

**Nothing to install.** `pdfjs-dist` is already installed and configured at
app startup (`excalidraw-app/index.tsx` calls `configurePdfjs`), and the
read-only relay (`api/canvas/proxy.ts`) is already in the repo.

> **The relay only runs on Vercel.** `/api/canvas/proxy` is a serverless
> function; the Vite dev server does not serve it. On `yarn start` every
> Canvas call fails with `CanvasError { kind: "network" }`, and the UI says
> so in those words ("the relay only runs on the deployed app"). That is
> expected locally, not a bug to chase.

---

## 1. `App.tsx` changes (copy-pasteable)

### a) import — next to the other `goodnotes` imports

```tsx
import { CourseBrowser, useCanvasConnect } from "./goodnotes/canvas";
```

### b) the home route — inside `ExcalidrawApp`, where the shelf is returned

Replace the existing `if (!docId && !isTransientScene) { … }` block with:

```tsx
  if (!docId && !isTransientScene) {
    if (isCanvasBrowserOpen) {
      return (
        <CourseBrowser
          theme={editorTheme}
          onOpenDocument={openDocument}
          onConnect={canvas.open}
        />
      );
    }
    return (
      <>
        <Shelf
          theme={editorTheme}
          onOpenDocument={openDocument}
          headerExtra={
            <>
              <PdfDropZone variant="inline" />
              <button
                type="button"
                onClick={() =>
                  canvas.isConnected
                    ? setCanvasBrowserOpen(true)
                    : canvas.open()
                }
              >
                {canvas.isConnected ? "Canvas courses" : "Connect Canvas…"}
              </button>
            </>
          }
        />
        <GlobalPdfDropOverlay mode="library" />
        {canvas.dialog}
      </>
    );
  }
```

### c) the state + controller — in the same component, above that block

```tsx
  const [isCanvasBrowserOpen, setCanvasBrowserOpen] = useState(false);
  const canvas = useCanvasConnect({
    theme: editorTheme,
    // go straight to the courses once a token is accepted
    onConnected: () => setCanvasBrowserOpen(true),
    onDisconnected: () => setCanvasBrowserOpen(false),
  });
```

`canvas.dialog` is `null` while the connect screen is closed, so mounting it
costs nothing. It portals to `document.body`.

That is the whole integration. `CourseBrowser` renders its own connect
prompt when there is no token, so passing `onConnect` is optional — omit it
and the browser opens the built-in dialog itself.

---

## 2. Just the connect screen

Any button, anywhere:

```tsx
const canvas = useCanvasConnect({ theme });

<button onClick={canvas.open}>Canvas connection…</button>
{canvas.dialog}
```

`canvas.openIfNeeded()` opens it only when no token is stored, and returns
whether it opened — handy before kicking off a sync.

---

## 3. What the UI promises the user

The connect screen states, above the fields and not collapsible:

- a Canvas personal access token **cannot be limited to read-only** and
  carries the full access of the account;
- it is **stored in this browser** and sent only to this app's own relay;
- this app **only reads** courses, assignments and files;
- it can be **revoked at Canvas → Account → Settings → Approved
  Integrations** — the same page where it is created.

Keep that copy if you restyle the dialog. It is the honest part of asking a
student for an all-powerful credential.

---

## 4. The download limitation, and why the Import button can fail

Canvas returns a short-lived **pre-signed URL on its file host**, not on the
instance. The relay deliberately refuses to forward arbitrary hosts (an open
proxy carrying a bearer token is the thing to avoid), so the browser fetches
that URL directly and CORS may refuse it.

When that happens the UI does not show a dead error: it shows the reason and
an `Open the file in a new tab` link to the pre-signed URL, with the
suggestion to drop the saved file onto the shelf. The preview pane uses the
same download path on purpose, so the student learns this *before* pressing
Import. Programmatically this is `CanvasDownloadError { canOpenInTab, url }`.

---

## 5. Public API

| Export | What it is |
| --- | --- |
| `useCanvasConnect(options)` | callback-shaped entry point: `{ open, close, openIfNeeded, isOpen, isConnected, connection, dialog }` |
| `CanvasConnectDialog` | the connect screen itself (modal, portalled) |
| `CourseBrowser` | the per-course browser: Assignments / Files / My notebooks |
| `useCanvasConnection()` | `{ connection, isConnected, userName, isChecking, error, connect, disconnect, clearError }` |
| `useCanvasCourses()` | `{ data, isLoading, error, cause, reload }` |
| `useCourseAssignments(courseId, course)` | the same shape, of `AssignmentRow[]` (includes assignments with no due date) |
| `useCourseFiles(courseId)` | the same shape, of `CourseFileRow[]` (`{ file, isPdf, imported }`) |
| `useCourseNotebooks(course)` | local documents filed under the course (IndexedDB only) |
| `importCanvasFile(file, options)` | `importCanvasFileAsDocument` + an "imported from this Canvas file" tag |
| `describeCanvasError(error, context)` | any thrown value → a sentence naming the real cause |
| `AssignmentList` / `FileList` / `FilePreviewPane` / `NotebookList` / `CanvasTabs` / `CanvasProgress` | the leaf components, for a custom layout |

Unchanged and still exported: `listUpcomingWork`, `createDocumentForAssignment`,
`refreshLinkedDueDates`, `isCanvasConnected`, `importCanvasFileAsDocument`,
`CanvasError`, `CanvasDownloadError`, and the `client.ts` list functions.

---

## 6. Accessibility contract

- every input is labelled; the token field is `type="password"`;
- errors are `role="alert"` and referenced by the field's `aria-describedby`;
- the tabs are a real `role="tablist"` with roving tabindex and
  Left/Right/Home/End, each panel a `role="tabpanel"` labelled by its tab;
- import progress is a `role="progressbar"` next to an `aria-live="polite"`
  region that is mounted *before* the import starts;
- the connect dialog traps Tab, closes on Escape, and restores focus to
  whatever opened it;
- `:focus-visible` rings are explicit, and `@media (prefers-reduced-motion:
  reduce)` turns off the backdrop fade and the progress animation.

Colours come from Excalidraw's own custom properties in both themes.
`--color-muted*` is never used for text (it is a background grey), and the
danger pair is picked per theme because dark theme's `--color-danger-text`
and `--color-danger-background` are the same colour.

---

## 7. What has **not** been verified

Everything above was exercised against a **stubbed** Canvas: Playwright
`page.route()` serving realistic Canvas JSON plus 401 / 403 / network-failure
/ blocked-download cases. There was no real Canvas account and no deployed
relay in this environment, so **no live round-trip has ever run**. Expect to
shake out pagination, scope and field-name details the first time this is
pointed at a real instance.
