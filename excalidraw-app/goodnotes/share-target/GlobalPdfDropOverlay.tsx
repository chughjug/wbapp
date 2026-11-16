/**
 * Drop a PDF anywhere in the window.
 *
 * Two modes, because the right outcome depends on where you are:
 *
 * - `mode="library"` — on the shelf. Each dropped PDF becomes its **own new
 *   document**; the first one is opened.
 * - `mode="document"` — with a document open. The PDF's pages are appended
 *   to the document you are looking at, through `importPdfIntoScene` from
 *   `../import-pdf` (which also scrolls to the first new page). Requires
 *   `excalidrawAPI`; without it the component falls back to library mode so
 *   a drop is never silently lost.
 *
 * The overlay is `pointer-events: none` while it is only a drag hint, so it
 * cannot steal the drop from the element underneath; the busy/error card
 * that replaces it afterwards is interactive.
 */

import React, { useCallback, useState } from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { describePdfImportError, importPdfIntoScene } from "../import-pdf";

import { ImportProgress } from "./ImportProgress";
import { looksLikePdf, type ImportSharedPdfsOptions } from "./importSharedPdfs";
import { openDocument as defaultOpenDocument } from "./navigation";
import { useGlobalPdfDrop } from "./useGlobalPdfDrop";
import { usePdfImport } from "./usePdfImport";

import "./shareTarget.scss";

export interface GlobalPdfDropOverlayProps {
  mode: "library" | "document";
  /** Required for `mode="document"`. */
  excalidrawAPI?: ExcalidrawImperativeAPI | null;
  /** Library mode only. Defaults to navigating to `/d/<docId>`. */
  onOpenDocument?: ((docId: string) => void) | null;
  /** Document mode: called with the number of pages appended. */
  onPagesAppended?: (pageCount: number) => void;
  theme?: "light" | "dark";
  pdfOptions?: ImportSharedPdfsOptions["pdfOptions"];
  /** Turn the whole thing off (e.g. while a modal owns the window). */
  disabled?: boolean;
}

export const GlobalPdfDropOverlay: React.FC<GlobalPdfDropOverlayProps> = ({
  mode,
  excalidrawAPI,
  onOpenDocument,
  onPagesAppended,
  theme = "light",
  pdfOptions,
  disabled = false,
}) => {
  const [sceneState, setSceneState] = useState<{
    busy: boolean;
    message: string;
    fraction: number | null;
    error: string | null;
  }>({ busy: false, message: "", fraction: null, error: null });

  const libraryImporter = usePdfImport({
    pdfOptions,
    onSettled: (created) => {
      if (created.length && onOpenDocument !== null) {
        (onOpenDocument ?? ((docId: string) => defaultOpenDocument(docId)))(
          created[0].docId,
        );
      }
    },
  });

  const intoDocument = useCallback(
    async (files: File[]) => {
      if (!excalidrawAPI) {
        return;
      }
      for (const file of files) {
        setSceneState({
          busy: true,
          message: `Opening ${file.name}…`,
          fraction: null,
          error: null,
        });
        if (!(await looksLikePdf(file))) {
          setSceneState({
            busy: false,
            message: "",
            fraction: null,
            error: `“${file.name}” is not a PDF, so it was not added to this document.`,
          });
          continue;
        }
        try {
          const result = await importPdfIntoScene(excalidrawAPI, file, {
            ...pdfOptions,
            onProgress: (completed, total) =>
              setSceneState({
                busy: true,
                message: `Adding page ${completed} of ${total} from ${file.name}…`,
                fraction: total ? completed / total : null,
                error: null,
              }),
          });
          onPagesAppended?.(result.pages.length);
          setSceneState({
            busy: false,
            message: "",
            fraction: null,
            error: null,
          });
        } catch (error) {
          setSceneState({
            busy: false,
            message: "",
            fraction: null,
            error: describePdfImportError(error),
          });
        }
      }
    },
    [excalidrawAPI, onPagesAppended, pdfOptions],
  );

  const handleFiles = useCallback(
    (files: File[]) => {
      if (mode === "document" && excalidrawAPI) {
        void intoDocument(files);
      } else {
        void libraryImporter.run(files);
      }
    },
    [excalidrawAPI, intoDocument, libraryImporter, mode],
  );

  const busy = libraryImporter.isImporting || sceneState.busy;
  const { isDragging } = useGlobalPdfDrop({
    onFiles: handleFiles,
    disabled: disabled || busy,
  });

  const errorText = sceneState.error ?? libraryImporter.errorText;
  const showCard = isDragging || busy || Boolean(errorText);

  if (disabled || !showCard) {
    return null;
  }

  const variant = isDragging && !busy ? "hint" : busy ? "busy" : "error";

  return (
    <div
      className={`excalidraw gn-share-overlay gn-share-overlay--${variant}${
        theme === "dark" ? " theme--dark" : ""
      }`}
      data-testid="gn-share-overlay"
      data-variant={variant}
    >
      <div className="gn-share-overlay__card">
        {variant === "hint" && (
          <>
            <span className="gn-share-overlay__title">Drop to import</span>
            <span className="gn-share-overlay__text">
              {mode === "document" && excalidrawAPI
                ? "The PDF's pages will be added to this document."
                : "Each PDF becomes a new document."}
            </span>
          </>
        )}
        {variant !== "hint" && (
          <>
            <span className="gn-share-overlay__title">
              {busy ? "Importing PDF…" : "Import failed"}
            </span>
            <ImportProgress
              message={
                busy ? sceneState.message || libraryImporter.message : ""
              }
              fraction={
                busy ? sceneState.fraction ?? libraryImporter.fraction : null
              }
              errorText={busy ? null : errorText}
              showBar={busy}
            />
            {!busy && (
              <button
                type="button"
                className="gn-share-button"
                onClick={() => {
                  setSceneState({
                    busy: false,
                    message: "",
                    fraction: null,
                    error: null,
                  });
                  libraryImporter.reset();
                }}
              >
                Dismiss
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
};
