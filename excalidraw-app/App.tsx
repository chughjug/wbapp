/**
 * The app's router, and only the router.
 *
 * `ExcalidrawWrapper` — the editor — lives in `./Editor` and is loaded
 * lazily. It is by far the largest thing this app can pull in (Excalidraw
 * itself, the paper layer, the export pipeline, every goodnotes module),
 * and a launch that goes to the shelf and stops there has no use for any
 * of it. Keeping it in the entry chunk meant parsing all of it before the
 * list of notebooks could paint.
 *
 * Everything the shelf route needs stays here, so the common launch pulls
 * one chunk.
 */

import React, { Suspense, lazy, useCallback, useEffect, useState } from "react";

import { EVENT, isWritableElement } from "@excalidraw/common";

import { Provider, appJotaiStore } from "./app-jotai";
import { TopErrorBoundary } from "./components/TopErrorBoundary";
import { ExcalidrawPlusIframeExport } from "./ExcalidrawPlusIframeExport";
import { CourseBrowser, useCanvasConnect } from "./goodnotes/canvas";
import { Dashboard } from "./goodnotes/dashboard";
import { useDarkMode } from "./goodnotes/dark";
import { isLatexDoc } from "./goodnotes/latex";
import { flushSceneSaves, getDoc, updateDocMeta } from "./goodnotes/library";
import { useNewDocument } from "./goodnotes/pages";
import {
  GlobalPdfDropOverlay,
  PdfDropZone,
  ShareTargetReceiver,
  isShareTargetUrl,
} from "./goodnotes/share-target";
import { SyncPanel, useSync } from "./goodnotes/sync";

import type { DocMeta } from "./goodnotes/types";

/**
 * The editor chunk. Fetched the first time a document route is rendered,
 * then cached by the module map for the life of the page.
 */
const ExcalidrawWrapper = lazy(() => import("./Editor"));

/**
 * The LaTeX document editor, also lazy.
 *
 * Its own chunk rather than the editor's: a student who only writes
 * notebooks never loads it, and a student who only writes problem sets
 * never loads Excalidraw.
 */
const LatexEditor = lazy(() =>
  import("./goodnotes/latex/LatexEditor").then((m) => ({
    default: m.LatexEditor,
  })),
);

/**
 * A shared-scene URL (`#room=…` for live collaboration, `#json=…` for an
 * imported scene) addresses a scene directly, so it must open the editor
 * rather than dropping the visitor on their own shelf. Such a scene has no
 * library document behind it, so it runs transiently on upstream's
 * `LocalData` persistence.
 */
const hasTransientSceneInUrl = () =>
  /[#&](room|json)=/.test(window.location.hash);

/**
 * Routes between the document shelf and a single open document.
 *
 * A document is addressed by `/d/<docId>`, so a specific assignment can be
 * linked to and the back button behaves. `ExcalidrawWrapper` is keyed on the
 * id, which remounts the editor on document switch rather than trying to
 * swap a live scene underneath it.
 */
const GoodNotesRoot = () => {
  const [docId, setDocId] = useState<string | null>(() => {
    const match = window.location.pathname.match(/^\/d\/([^/]+)$/);
    return match ? decodeURIComponent(match[1]) : null;
  });
  // the editor, not the shelf, is what a shared link resolves to
  const [isTransientScene] = useState(hasTransientSceneInUrl);
  // a PDF arriving from the OS share sheet
  const [isShareTarget, setIsShareTarget] = useState(isShareTargetUrl);
  const [isCanvasRoute, setIsCanvasRoute] = useState(
    () => window.location.pathname === "/canvas",
  );
  const { editorTheme } = useDarkMode();
  const canvasConnect = useCanvasConnect({ theme: editorTheme });

  // Sync sits above both the shelf and the editor, so a pass is not cancelled
  // by navigating between them. `activeDocId` is load-bearing: the engine
  // will not overwrite the document the editor currently holds in memory.
  // It is inert with no Supabase env vars set, which is the default.
  const sync = useSync({ activeDocId: docId });

  const openDocument = useCallback((doc: DocMeta) => {
    window.history.pushState({}, "", `/d/${encodeURIComponent(doc.id)}`);
    setDocId(doc.id);
  }, []);

  // format picker → createDoc → stash first-page seed → navigate. One path
  // for the shelf, floating bar, tab "+", Cmd/Ctrl+N and the command palette.
  const newDocument = useNewDocument({
    theme: editorTheme,
    onCreated: openDocument,
  });

  /**
   * Is the open document a `.tex` one?
   *
   * `null` while we are finding out, which the route below waits for —
   * guessing wrong would mount Excalidraw over a LaTeX document and
   * autosave an empty scene across it.
   */
  const [isLatex, setIsLatex] = useState<boolean | null>(null);
  useEffect(() => {
    if (!docId) {
      setIsLatex(null);
      return;
    }
    let cancelled = false;
    setIsLatex(null);
    void isLatexDoc(docId).then((answer) => {
      if (!cancelled) {
        setIsLatex(answer);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [docId]);

  const [latexTitle, setLatexTitle] = useState("");
  useEffect(() => {
    if (!docId || isLatex !== true) {
      return;
    }
    void getDoc(docId).then((meta) => setLatexTitle(meta?.title ?? "Document"));
  }, [docId, isLatex]);

  const closeDocument = useCallback(() => {
    void flushSceneSaves();
    window.history.pushState({}, "", "/");
    setDocId(null);
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const match = window.location.pathname.match(/^\/d\/([^/]+)$/);
      setDocId(match ? decodeURIComponent(match[1]) : null);
      setIsShareTarget(isShareTargetUrl());
      setIsCanvasRoute(window.location.pathname === "/canvas");
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Ctrl/Cmd+N — new document from shelf or editor (never while typing).
  const openNewDocument = newDocument.open;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.altKey ||
        event.shiftKey ||
        event.key.toLowerCase() !== "n"
      ) {
        return;
      }
      if (isWritableElement(event.target)) {
        return;
      }
      event.preventDefault();
      openNewDocument();
    };
    window.addEventListener(EVENT.KEYDOWN, onKeyDown);
    return () => window.removeEventListener(EVENT.KEYDOWN, onKeyDown);
  }, [openNewDocument]);

  // the receive screen consumes the shared file, imports it and navigates
  // to /d/<newDocId> itself
  if (isShareTarget) {
    return (
      <>
        <ShareTargetReceiver theme={editorTheme} />
        {newDocument.dialog}
      </>
    );
  }

  if (isCanvasRoute) {
    return (
      <>
        <CourseBrowser
          theme={editorTheme}
          onOpenDocument={openDocument}
          onConnect={canvasConnect.open}
        />
        {canvasConnect.dialog}
        {newDocument.dialog}
      </>
    );
  }

  if (!docId && !isTransientScene) {
    return (
      <>
        <Dashboard
          theme={editorTheme}
          onOpenDocument={openDocument}
          onCreateDocument={(init) => newDocument.open(init)}
          headerExtra={
            <>
              <PdfDropZone variant="inline" />
              <SyncPanel sync={sync} theme={editorTheme} />
            </>
          }
          onConnectCanvas={canvasConnect.open}
        />
        <GlobalPdfDropOverlay mode="library" />
        {canvasConnect.dialog}
        {newDocument.dialog}
      </>
    );
  }

  return (
    <>
      {isLatex === true && docId ? (
        <Suspense fallback={null}>
          <LatexEditor
            docId={docId}
            title={latexTitle}
            theme={editorTheme}
            onClose={closeDocument}
            onRename={(title) => {
              setLatexTitle(title);
              void updateDocMeta(docId, { title });
            }}
          />
        </Suspense>
      ) : isLatex === null && docId && !isTransientScene ? null : (
        <>
          {/* No spinner: the chunk is small enough on a warm cache that a
          flash of "Loading…" is worse than a beat of the previous screen,
          and on a cold one the shelf stays interactive behind it. */}
          <Suspense fallback={null}>
            <ExcalidrawWrapper
              key={docId ?? "transient"}
              docId={docId}
              onCloseDocument={closeDocument}
              onNewDocument={() => newDocument.open()}
              onOpenDocument={openDocument}
            />
          </Suspense>
        </>
      )}
      {newDocument.dialog}
    </>
  );
};

const ExcalidrawApp = () => {
  const isCloudExportWindow =
    window.location.pathname === "/excalidraw-plus-export";
  if (isCloudExportWindow) {
    return <ExcalidrawPlusIframeExport />;
  }

  return (
    <TopErrorBoundary>
      <Provider store={appJotaiStore}>
        {/* `ExcalidrawAPIProvider` lives in `Editor.tsx`, with the only
            code that reads the context. Moving it there did NOT shrink
            the entry chunk — measured flat, because the shelf route
            reaches `@excalidraw/excalidraw` through several other
            modules anyway — but the boundary is the right one: the app
            shell should not have to import the editor package. */}
        <GoodNotesRoot />
      </Provider>
    </TopErrorBoundary>
  );
};

export default ExcalidrawApp;
