/**
 * The preview pane beside the file list.
 *
 * It renders page 1 of the selected PDF with pdf.js and states exactly what
 * the import will produce ("12 pages · imports as 12 annotatable pages").
 *
 * It fetches the file through the same path the import uses, which is the
 * point: if Canvas's pre-signed file host refuses the browser, the student
 * finds out *here*, with a working "Open in Canvas" link, instead of after
 * pressing Import.
 */

import React, { useEffect, useRef, useState } from "react";

import { CanvasDownloadError } from "./sync";
import {
  canvasFileName,
  describeImportOutcome,
  describeUnsupportedFile,
  fetchCanvasFileBlob,
  renderPdfFirstPage,
} from "./files";
import { describeCanvasError } from "./errors";

import type { PdfPreview } from "./files";
import type { CourseFileRow } from "./useCanvasData";

export interface FilePreviewPaneProps {
  row: CourseFileRow | null;
  onImport: (row: CourseFileRow) => void;
  /** True while this file is being imported. */
  isImporting?: boolean;
  /** Headless mode for tests: skip the pdf.js render. */
  disablePreview?: boolean;
}

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; preview: PdfPreview }
  | { status: "blocked"; message: string; url?: string }
  | { status: "error"; message: string };

export const FilePreviewPane: React.FC<FilePreviewPaneProps> = ({
  row,
  onImport,
  isImporting = false,
  disablePreview = false,
}) => {
  const [state, setState] = useState<State>({ status: "idle" });
  const requestRef = useRef(0);

  useEffect(() => {
    const id = ++requestRef.current;
    if (!row || !row.isPdf || disablePreview) {
      setState({ status: "idle" });
      return;
    }
    const controller = new AbortController();
    setState({ status: "loading" });

    (async () => {
      try {
        const { blob } = await fetchCanvasFileBlob(row.file, controller.signal);
        const preview = await renderPdfFirstPage(blob, 260, controller.signal);
        if (id === requestRef.current && !controller.signal.aborted) {
          setState({ status: "ready", preview });
        }
      } catch (error) {
        if (id !== requestRef.current || controller.signal.aborted) {
          return;
        }
        if (error instanceof CanvasDownloadError) {
          setState({
            status: error.canOpenInTab ? "blocked" : "error",
            message: error.message,
            url: error.url,
          });
          return;
        }
        setState({
          status: "error",
          message: describeCanvasError(error, "files"),
        });
      }
    })();

    return () => {
      controller.abort();
    };
  }, [row, disablePreview]);

  if (!row) {
    return (
      <aside className="gn-canvas-preview" aria-label="File preview">
        <p className="gn-canvas-empty">
          Select a file to preview its first page and see what importing it
          would produce.
        </p>
      </aside>
    );
  }

  const name = canvasFileName(row.file);

  return (
    <aside className="gn-canvas-preview" aria-label={`Preview of ${name}`}>
      <h3 className="gn-canvas-preview__title">{name}</h3>

      {!row.isPdf ? (
        <>
          <div className="gn-canvas-preview__placeholder" aria-hidden="true">
            —
          </div>
          <p className="gn-canvas-preview__note">
            {describeUnsupportedFile(row.file)}. Only PDFs become annotatable
            pages; this file can still be opened in Canvas.
          </p>
        </>
      ) : null}

      {row.isPdf && state.status === "loading" ? (
        <p className="gn-canvas-preview__note" aria-live="polite">
          Loading preview…
        </p>
      ) : null}

      {state.status === "ready" ? (
        <>
          <img
            className="gn-canvas-preview__page"
            src={state.preview.dataUrl}
            alt={`First page of ${name}`}
            width={state.preview.width}
            height={state.preview.height}
          />
          <p className="gn-canvas-preview__outcome">
            {describeImportOutcome(state.preview.pageCount)}
          </p>
        </>
      ) : null}

      {state.status === "blocked" ? (
        <div className="gn-canvas-notice" role="status">
          <p>{state.message}</p>
          {state.url ? (
            <a
              className="gn-canvas-button gn-canvas-button--primary"
              href={state.url}
              target="_blank"
              rel="noreferrer noopener"
            >
              Open “{name}” in a new tab
            </a>
          ) : null}
          <p className="gn-canvas-hint">
            Save it, then drop it onto the shelf — the result is identical to
            importing it here.
          </p>
        </div>
      ) : null}

      {state.status === "error" ? (
        <p className="gn-canvas-alert" role="alert">
          {state.message}
        </p>
      ) : null}

      {row.isPdf && !row.imported ? (
        <button
          type="button"
          className="gn-canvas-button gn-canvas-button--primary gn-canvas-preview__import"
          disabled={isImporting}
          onClick={() => onImport(row)}
        >
          {isImporting ? "Importing…" : "Import as notebook"}
        </button>
      ) : null}

      {row.imported ? (
        <p className="gn-canvas-preview__note">
          Already imported as “{row.imported.title}”.
        </p>
      ) : null}
    </aside>
  );
};
