# goodnotes/dashboard — integration

> **Updated for the home-screen redesign.** The required `App.tsx` change is _unchanged_ — if you already render `<Dashboard />` at `/`, there is nothing to do. §3 and the new §4 describe what moved.

The dashboard **replaces the `<Shelf />` call site** at `/`. It renders `Shelf` itself, so do not render both.

## The change to `excalidraw-app/App.tsx`

### 1. Import

`App.tsx` currently has (around line 102):

```tsx
import {
  Shelf,
  createDoc,
  getScene,
  saveSceneDebounced,
  flushSceneSaves,
} from "./goodnotes/library";
```

Replace it with — `Shelf` is no longer used directly, `Dashboard` renders it:

```tsx
import {
  createDoc,
  getScene,
  saveSceneDebounced,
  flushSceneSaves,
} from "./goodnotes/library";
import { Dashboard } from "./goodnotes/dashboard";
```

(If you prefer to keep the import block untouched, leaving `Shelf` imported is harmless apart from an unused-import lint warning.)

### 2. The route at `/`

`App.tsx` currently has (around line 1573):

```tsx
if (!docId && !isTransientScene) {
  return (
    <>
      <Shelf
        theme={editorTheme}
        onOpenDocument={openDocument}
        headerExtra={<PdfDropZone variant="inline" />}
      />
      <GlobalPdfDropOverlay mode="library" />
    </>
  );
}
```

Replace it with:

```tsx
if (!docId && !isTransientScene) {
  return (
    <>
      <Dashboard
        theme={editorTheme}
        onOpenDocument={openDocument}
        headerExtra={<PdfDropZone variant="inline" />}
      />
      <GlobalPdfDropOverlay mode="library" />
    </>
  );
}
```

That is the whole integration. `theme`, `onOpenDocument`, `headerExtra`, `className` and `defaultView` have exactly the same meaning as on `Shelf` and are forwarded to it.

### 3. Optional: wire up the Canvas connect flow

When Canvas is not connected the dashboard shows one quiet, dismissible sentence. Give it `onConnectCanvas` and that sentence gains a **Connect Canvas** button; omit it and the sentence points at Settings in words instead of offering a button that leads nowhere.

```tsx
<Dashboard
  theme={editorTheme}
  onOpenDocument={openDocument}
  headerExtra={<PdfDropZone variant="inline" />}
  onConnectCanvas={() => setSettingsOpen("canvas")} // whatever the host uses
/>
```

## What the host gets, by state

| Canvas state | What renders |
| --- | --- |
| not connected (default) | the library exactly as before, plus one dismissible sentence. **No request is made**, no strip, no course cards, no spinner, no error. |
| connected, loading | strip and course row hold their height with placeholders; the grid below does not move when deadlines land. |
| connected, failed | the library, plus a small "… Try again" notice in the strip's space. Cards already on screen are kept. |
| connected, loaded | "Due soon" (soonest first) and "Your courses" above the library. |

## Notes for the integrator

- **Headings.** `Shelf` renders the page's `<h1>` and is not editable, so this layer deliberately adds none: its two sections are `<h2>`s. The page keeps exactly one `h1`.
- **Course cards drive the library's own filter.** `Shelf` keeps its `LibraryFilter` in local state with no setter prop, so a course card activates the matching sidebar button (`shelfBridge.ts`). It fails soft: a Canvas course with no matching sidebar row simply does nothing. If `Shelf` ever gains a `filter` / `onFilterChange` prop, replace `selectCourseInShelf` with it — that is the only coupling to library markup (`.gn-sidebar__item`, `.gn-sidebar__label`).
- **"Canvas files" on a course card** are counted as the course's dated Canvas _assignments_, and labelled as such. Only four functions of `goodnotes/canvas` are pinned as stable and none lists files.
- **Scope of the Canvas calls.** The dashboard calls `listUpcomingWork()` on mount (connected only) and `refreshLinkedDueDates()` only when the user presses **Sync Canvas**. It re-checks `isCanvasConnected()` on window focus, so connecting in another tab fills the screen in without a reload.
- **Dismissal** of the invitation is permanent and local (`goodnotes:dashboard:connect-invite-dismissed`). `resetConnectInvite()` is exported for a Settings "show it again" control.

---

## 4. The home-screen redesign

### The `App.tsx` change (unchanged, copy-pasteable)

This is already in `App.tsx` at the `/` route and needs **no edit**:

```tsx
if (!docId && !isTransientScene) {
  return (
    <>
      <Dashboard
        theme={editorTheme}
        onOpenDocument={openDocument}
        headerExtra={<PdfDropZone variant="inline" />}
        onConnectCanvas={canvasConnect.open}
      />
      <GlobalPdfDropOverlay mode="library" />
      {canvasConnect.dialog}
    </>
  );
}
```

### Public API (`DashboardProps`), unchanged

| prop | type | meaning |
| --- | --- | --- |
| `onOpenDocument` | `(doc: DocMeta) => void` | required; open or create |
| `theme` | `"light" \| "dark"` | default `"light"` |
| `headerExtra` | `ReactNode` | **now rendered inside the home screen's ⋯ popover** (see below) |
| `className` | `string` | on the root |
| `defaultView` | `"grid" \| "list"` | initial view only |
| `onConnectCanvas` | `() => void` | opens the host's Canvas flow; omit and the invitation points at Settings in words |

### What moved, from the dashboard's side

**The Canvas invitation is no longer a resident strip.** It used to be two controls and a sentence across the top of the screen — on a first run, above a library with one untitled notebook, explaining a feature most students will never connect. It is now the last item of the home screen's **⋯** popover, passed down through `Shelf`'s new `menuExtra` slot:

```tsx
<Shelf
  …
  menuExtra={
    !connected && !inviteDismissed ? (
      <ConnectInvite onConnect={onConnectCanvas} onDismiss={handleDismiss} />
    ) : null
  }
/>
```

Same `ConnectInvite` component, same copy, same permanent dismissal (`goodnotes:dashboard:connect-invite-dismissed`, resettable with `resetConnectInvite()`), same `onConnectCanvas` contract — zero resident pixels. If you would rather it were resident again, render `<ConnectInvite />` yourself above `<Dashboard />`; it is still exported.

`Dashboard.scss` gained a `.excalidraw.gn-portal` block, because the popover is portalled to `document.body` and leaves the `.gn-dash` scope. That block only re-states the invitation's own rules.

**When Canvas _is_ connected, nothing changed**: `DueSoonStrip` and `CourseCards` still render above the library, with the same placeholders, the same error notice and the same `Sync Canvas` action. They are untouched by this redesign.

### Caveat the integrator should know

The connected-Canvas path (`DueSoonStrip` + `CourseCards` above a now much lighter home screen) was **not re-reviewed visually** as part of this redesign — no Canvas account was available in this environment. The code path is unchanged and still typechecks, but the two surfaces were designed to sit above a dense screen and may now want to be lighter themselves. That is the first thing to look at once a connected account exists.
