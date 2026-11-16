/**
 * "Drop a PDF here, or choose one" — the import path that works on **every**
 * platform, and the only one that works on iPad.
 *
 * iOS cannot deliver an OS share to a web app (see `capabilities.ts`), but a
 * plain `<input type="file" accept="application/pdf">` opens the iOS document
 * picker, which reaches the Files app, iCloud Drive, Google Drive, and
 * anything else with a Files provider — and "Open in…" / Split View drags
 * land as ordinary `drop` events. So this component is first-class, not a
 * consolation prize.
 *
 * Accessibility
 * - The drop zone *is* a `<button>`: it is in the tab order, has an
 *   accessible name, and Enter/Space open the picker. The drag handlers sit
 *   on the same element; drag-and-drop is pure enhancement.
 * - Progress is announced through `aria-live="polite"`, errors through
 *   `role="alert"` (see `ImportProgress`).
 * - Focus rings come from `:focus-visible` in the stylesheet; the hover and
 *   drag animations are disabled under `prefers-reduced-motion: reduce`.
 */

import React, { useCallback, useId, useRef, useState } from "react";

import { ImportProgress } from "./ImportProgress";
import {
  dragHasPdf,
  filesFromDataTransfer,
  type ImportSharedPdfsOptions,
  type ImportedSharedPdf,
  type SharedPdfFailure,
} from "./importSharedPdfs";
import { openDocument as defaultOpenDocument } from "./navigation";
import { usePdfImport } from "./usePdfImport";

import "./shareTarget.scss";

export interface PdfDropZoneProps {
  /**
   * Called with the first document created. Defaults to a history push to
   * `/d/<docId>` (plus the `popstate` dispatch `App.tsx` listens for).
   * Pass `null` to import without navigating.
   */
  onOpenDocument?: ((docId: string) => void) | null;
  /** Called once the batch settles, whatever the outcome. */
  onImported?: (
    created: ImportedSharedPdf[],
    failed: SharedPdfFailure[],
  ) => void;
  /** Open the first created document when the batch finishes. Default true. */
  openAfterImport?: boolean;
  /** Allow picking several PDFs at once (one document each). Default true. */
  multiple?: boolean;
  /** `"panel"` (default) is the big dashed box; `"inline"` is a toolbar pill. */
  variant?: "panel" | "inline";
  /** Drives the Excalidraw theme custom properties. Default `"light"`. */
  theme?: "light" | "dark";
  /** Button label. */
  label?: string;
  /** Secondary line under the label (panel variant only). */
  hint?: string;
  /** Render options forwarded to the PDF importer (scale, template, …). */
  pdfOptions?: ImportSharedPdfsOptions["pdfOptions"];
  className?: string;
  /** Extra id to put on the button, e.g. for a `aria-describedby` elsewhere. */
  id?: string;
}

const DocumentIcon = () => (
  <svg
    className="gn-share-dropzone__icon"
    width="28"
    height="28"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
    <path d="M12 18v-6" />
    <path d="M9.5 14.5 12 12l2.5 2.5" />
  </svg>
);

export const PdfDropZone: React.FC<PdfDropZoneProps> = ({
  onOpenDocument,
  onImported,
  openAfterImport = true,
  multiple = true,
  variant = "panel",
  theme = "light",
  label = multiple ? "Import PDFs" : "Import PDF",
  hint = "Drop a PDF here, or choose one from Files. Each PDF opens as its own annotatable document.",
  pdfOptions,
  className = "",
  id,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragDepth = useRef(0);
  const hintId = useId();

  const handleSettled = useCallback(
    (created: ImportedSharedPdf[], failed: SharedPdfFailure[]) => {
      onImported?.(created, failed);
      if (openAfterImport && created.length && onOpenDocument !== null) {
        (onOpenDocument ?? ((docId: string) => defaultOpenDocument(docId)))(
          created[0].docId,
        );
      }
    },
    [onImported, onOpenDocument, openAfterImport],
  );

  const importer = usePdfImport({ pdfOptions, onSettled: handleSettled });

  const pick = useCallback(() => {
    if (importer.isImporting) {
      return;
    }
    inputRef.current?.click();
  }, [importer.isImporting]);

  const onInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      // reset so picking the same file twice in a row still fires `change`
      event.target.value = "";
      if (files.length) {
        void importer.run(files);
      }
    },
    [importer],
  );

  const onDragEnter = useCallback((event: React.DragEvent) => {
    if (!dragHasPdf(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    dragDepth.current += 1;
    setIsDragging(true);
  }, []);

  const onDragOver = useCallback((event: React.DragEvent) => {
    if (!dragHasPdf(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback(() => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      dragDepth.current = 0;
      setIsDragging(false);
      const files = filesFromDataTransfer(event.dataTransfer);
      if (files.length) {
        void importer.run(multiple ? files : files.slice(0, 1));
      }
    },
    [importer, multiple],
  );

  const busy = importer.isImporting;

  return (
    <div
      className={`excalidraw gn-share-dropzone${
        theme === "dark" ? " theme--dark" : ""
      }${isDragging ? " gn-share-dropzone--dragging" : ""}${
        variant === "inline" ? " gn-share-dropzone--inline" : ""
      }${className ? ` ${className}` : ""}`}
      data-testid="gn-share-dropzone"
    >
      <input
        ref={inputRef}
        className="gn-share-dropzone__input"
        type="file"
        accept="application/pdf,.pdf"
        multiple={multiple}
        onChange={onInputChange}
        tabIndex={-1}
        aria-hidden="true"
        data-testid="gn-share-file-input"
      />
      <button
        type="button"
        id={id}
        className="gn-share-dropzone__button"
        onClick={pick}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        disabled={busy}
        aria-describedby={variant === "panel" ? hintId : undefined}
        aria-busy={busy}
        data-testid="gn-share-dropzone-button"
      >
        {variant === "panel" && <DocumentIcon />}
        <span className="gn-share-dropzone__title">
          {busy ? "Importing…" : label}
        </span>
        {variant === "panel" && (
          <span className="gn-share-dropzone__hint" id={hintId}>
            {hint}
          </span>
        )}
      </button>

      <div className="gn-share-dropzone__status">
        <ImportProgress
          message={importer.message}
          fraction={importer.fraction}
          errorText={importer.errorText}
          showBar={busy}
          label="PDF import progress"
        />
        {busy && (
          <button
            type="button"
            className="gn-share-button"
            onClick={importer.cancel}
          >
            Cancel import
          </button>
        )}
      </div>
    </div>
  );
};
