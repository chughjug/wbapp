/**
 * The `/share-target` screen: what the user sees for the second or two
 * between tapping "Notebook" in the Android share sheet and their PDF
 * opening as a document.
 *
 * Lifecycle
 * 1. The service worker has already answered the POST, parked the file in
 *    Cache Storage and redirected here with `?shared=<ids>`.
 * 2. On mount we **take** those files (destructive read — a reload must not
 *    import the same PDF twice), import each one into a new library
 *    document, then navigate to the first one with `replaceState`, so Back
 *    goes to the library rather than to a consumed share URL.
 * 3. Anything that goes wrong — no file in the cache, a non-PDF, a corrupt
 *    or password-protected PDF — lands on an explicit error state with the
 *    reason, a retry via the file picker, and a way back to the library.
 *    Never a blank screen.
 *
 * It is also a perfectly good manual "import a PDF" page: visiting
 * `/share-target` with no query shows the drop zone.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";

import { ImportProgress } from "./ImportProgress";
import { PdfDropZone } from "./PdfDropZone";
import {
  openDocument as defaultOpenDocument,
  openLibrary as defaultOpenLibrary,
} from "./navigation";
import {
  readShareErrorFromUrl,
  readSharedIdsFromUrl,
  takeSharedFiles,
} from "./sharedFiles";
import { usePdfImport } from "./usePdfImport";

import "./shareTarget.scss";

import type {
  ImportSharedPdfsOptions,
  ImportedSharedPdf,
} from "./importSharedPdfs";

export interface ShareTargetReceiverProps {
  /** Defaults to `replaceState` to `/d/<docId>` + a `popstate` dispatch. */
  onOpenDocument?: (docId: string) => void;
  /** "Back to library". Defaults to a history push to `/`. */
  onOpenLibrary?: () => void;
  /** Drives the Excalidraw theme custom properties. Default `"light"`. */
  theme?: "light" | "dark";
  /** Render options forwarded to the PDF importer. */
  pdfOptions?: ImportSharedPdfsOptions["pdfOptions"];
  /** Open the first imported document automatically. Default true. */
  autoOpen?: boolean;
}

type Phase = "loading" | "importing" | "empty" | "done" | "error";

const SHARE_ERROR_TEXT: Record<string, string> = {
  empty:
    "The share did not include a file. Try sharing again, or choose a PDF below.",
  failed:
    "The shared file could not be read. Try sharing again, or choose a PDF below.",
};

export const ShareTargetReceiver: React.FC<ShareTargetReceiverProps> = ({
  onOpenDocument,
  onOpenLibrary,
  theme = "light",
  pdfOptions,
  autoOpen = true,
}) => {
  const [phase, setPhase] = useState<Phase>("loading");
  const [swError, setSwError] = useState<string | null>(null);
  const startedRef = useRef(false);

  const openDocument = useCallback(
    (docId: string) => {
      if (onOpenDocument) {
        onOpenDocument(docId);
      } else {
        // replace, not push: the consumed /share-target URL must not sit in
        // the back stack
        defaultOpenDocument(docId, true);
      }
    },
    [onOpenDocument],
  );

  const openLibrary = useCallback(() => {
    if (onOpenLibrary) {
      onOpenLibrary();
    } else {
      defaultOpenLibrary(true);
    }
  }, [onOpenLibrary]);

  const handleSettled = useCallback(
    (created: ImportedSharedPdf[]) => {
      setPhase(created.length ? "done" : "error");
      if (autoOpen && created.length) {
        openDocument(created[0].docId);
      }
    },
    [autoOpen, openDocument],
  );

  const importer = usePdfImport({ pdfOptions, onSettled: handleSettled });
  const { run } = importer;

  useEffect(() => {
    // StrictMode double-invokes effects in development; a destructive cache
    // read must happen exactly once.
    if (startedRef.current) {
      return;
    }
    startedRef.current = true;

    const code = readShareErrorFromUrl();
    if (code) {
      setSwError(SHARE_ERROR_TEXT[code] ?? SHARE_ERROR_TEXT.failed);
      setPhase("empty");
      return;
    }

    void (async () => {
      let shared;
      try {
        shared = await takeSharedFiles(readSharedIdsFromUrl());
      } catch (error) {
        setSwError(
          "The shared file could not be read from this device's storage.",
        );
        setPhase("empty");
        return;
      }
      if (!shared.length) {
        setPhase("empty");
        return;
      }
      setPhase("importing");
      await run(shared.map((entry) => entry.file));
    })();
  }, [run]);

  const created = importer.created;
  const failed = importer.failed;

  return (
    <div
      className={`excalidraw gn-share-receiver${
        theme === "dark" ? " theme--dark" : ""
      }`}
      data-testid="gn-share-receiver"
      data-phase={phase}
    >
      <div className="gn-share-receiver__panel">
        {(phase === "loading" || phase === "importing") && (
          <>
            <h1 className="gn-share-receiver__title">Opening your PDF…</h1>
            <p className="gn-share-receiver__text">
              Each page becomes a page you can write on. Large documents take a
              few seconds.
            </p>
            <ImportProgress
              message={
                phase === "loading"
                  ? "Reading the shared file…"
                  : importer.message
              }
              fraction={phase === "loading" ? null : importer.fraction}
              errorText={importer.errorText}
              label="PDF import progress"
            />
            <div className="gn-share-receiver__actions">
              <button
                type="button"
                className="gn-share-button"
                onClick={() => {
                  importer.cancel();
                  openLibrary();
                }}
              >
                Cancel
              </button>
            </div>
          </>
        )}

        {phase === "done" && (
          <>
            <h1 className="gn-share-receiver__title">
              {created.length === 1
                ? "Document ready"
                : `${created.length} documents ready`}
            </h1>
            <ImportProgress
              message={importer.message}
              fraction={1}
              errorText={
                failed.length
                  ? failed.map((failure) => failure.message).join(" ")
                  : null
              }
              showBar={false}
            />
            <ul className="gn-share-receiver__list">
              {created.map((doc) => (
                <li key={doc.docId}>
                  {doc.title} — {doc.pageCount}{" "}
                  {doc.pageCount === 1 ? "page" : "pages"}
                </li>
              ))}
            </ul>
            <div className="gn-share-receiver__actions">
              {created.length > 0 && (
                <button
                  type="button"
                  className="gn-share-button gn-share-button--primary"
                  onClick={() => openDocument(created[0].docId)}
                >
                  Open {created[0].title}
                </button>
              )}
              <button
                type="button"
                className="gn-share-button"
                onClick={openLibrary}
              >
                Back to library
              </button>
            </div>
          </>
        )}

        {(phase === "empty" || phase === "error") && (
          <>
            <h1 className="gn-share-receiver__title">
              {phase === "error"
                ? "That PDF could not be imported"
                : "Nothing to import"}
            </h1>
            <p className="gn-share-error" role="alert">
              {swError ??
                (failed.length
                  ? failed.map((failure) => failure.message).join(" ")
                  : importer.errorText ??
                    "No shared file was waiting for this app. It may already have been imported.")}
            </p>
            <PdfDropZone
              theme={theme}
              pdfOptions={pdfOptions}
              onOpenDocument={(docId) => openDocument(docId)}
              label="Choose a PDF"
              hint="Pick a PDF from Files, or drop one here."
            />
            <div className="gn-share-receiver__actions">
              <button
                type="button"
                className="gn-share-button"
                onClick={openLibrary}
              >
                Back to library
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
