/**
 * Accessible options dialog for {@link exportDocumentToPdf}.
 *
 * Rendered into a portal on `document.body`. Mount it only while open
 * (`{isExportOpen && <ExportDialog … />}`) so focus handling stays simple.
 */

import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";

import {
  downloadPdfBlob,
  exportDocumentToPdf,
  getOrderedPageFrames,
  matchPageSizeName,
  parsePageRange,
  PdfExportError,
  toPdfFileName,
} from "./exportPdf";

import "./ExportDialog.scss";

import type { PaperTemplateId } from "../types";

export type PageRangeMode = "all" | "current" | "custom";

export interface ExportDialogProps {
  /** The full scene. */
  elements: readonly ExcalidrawElement[];
  files: BinaryFiles | null;
  appState?: Partial<AppState>;
  /**
   * 1-based page number currently in view, used by the "Current page" option.
   * When omitted, that option is disabled.
   */
  currentPageNumber?: number | null;
  /** Pre-filled filename (with or without the `.pdf` suffix). */
  defaultFileName?: string;
  /**
   * Paper template used for pages whose frame name doesn't encode one.
   * Pass the document's default (e.g. `DocMeta.defaultTemplate`).
   */
  defaultPaperTemplate?: PaperTemplateId;
  /** Called on Escape, backdrop click, Cancel, or after a successful export. */
  onClose: () => void;
  /** Optional hook for telemetry / toasts. */
  onExported?: (blob: Blob, fileName: string) => void;
  /**
   * UI theme for the dialog itself (the PDF is always light).
   * Defaults to `appState.theme`.
   */
  theme?: "light" | "dark";
}

const SCALE_OPTIONS = [
  { value: 1, label: "1x — screen (smallest file)" },
  { value: 2, label: "2x — print (recommended)" },
  { value: 3, label: "3x — high detail" },
  { value: 4, label: "4x — maximum (slow, large file)" },
];

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export const ExportDialog: React.FC<ExportDialogProps> = ({
  elements,
  files,
  appState,
  currentPageNumber = null,
  defaultFileName = "document",
  defaultPaperTemplate = "blank",
  onClose,
  onExported,
  theme,
}) => {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);
  const restoreFocusRef = useRef<Element | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const unmountedRef = useRef(false);

  const titleId = useId();
  const descriptionId = useId();
  const rangeErrorId = useId();
  const exportErrorId = useId();

  const pageFrames = useMemo(() => getOrderedPageFrames(elements), [elements]);
  const totalPages = pageFrames.length;

  const pageSizeLabel = useMemo(() => {
    if (totalPages === 0) {
      return null;
    }
    const names = new Set(
      pageFrames.map(
        (frame) =>
          matchPageSizeName(frame.width, frame.height) ??
          `${Math.round(frame.width)}x${Math.round(frame.height)}px`,
      ),
    );
    return names.size === 1 ? [...names][0] : "Mixed sizes";
  }, [pageFrames, totalPages]);

  const [rangeMode, setRangeMode] = useState<PageRangeMode>("all");
  const [customRange, setCustomRange] = useState(
    currentPageNumber ? String(currentPageNumber) : "1",
  );
  const [scale, setScale] = useState(2);
  const [includeBackground, setIncludeBackground] = useState(true);
  const [fileName, setFileName] = useState(
    defaultFileName.replace(/\.pdf$/i, ""),
  );

  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);
  const [status, setStatus] = useState("");
  const [exportError, setExportError] = useState<string | null>(null);

  const customRangeResult = useMemo(
    () =>
      rangeMode === "custom"
        ? parsePageRange(customRange, totalPages)
        : ({ ok: true, pages: [] } as const),
    [rangeMode, customRange, totalPages],
  );
  const rangeError = customRangeResult.ok ? null : customRangeResult.error;

  // --- lifecycle: focus restore -------------------------------------------
  useEffect(() => {
    unmountedRef.current = false;
    restoreFocusRef.current = document.activeElement;
    // defer so the portal content exists
    const id = window.setTimeout(() => {
      firstFieldRef.current?.focus();
    }, 0);
    return () => {
      unmountedRef.current = true;
      window.clearTimeout(id);
      abortRef.current?.abort();
      const toRestore = restoreFocusRef.current;
      if (toRestore instanceof HTMLElement && document.contains(toRestore)) {
        toRestore.focus();
      }
    };
  }, []);

  const requestClose = useCallback(() => {
    abortRef.current?.abort();
    onClose();
  }, [onClose]);

  // --- Escape + focus trap -------------------------------------------------
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        event.preventDefault();
        requestClose();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const root = dialogRef.current;
      if (!root) {
        return;
      }
      const focusable = [
        ...root.querySelectorAll<HTMLElement>(FOCUSABLE),
      ].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !root.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [requestClose],
  );

  // --- export --------------------------------------------------------------
  const handleExport = useCallback(async () => {
    if (isExporting) {
      return;
    }
    setExportError(null);

    if (totalPages === 0) {
      setExportError("This document has no pages to export.");
      setStatus("Export failed: this document has no pages to export.");
      return;
    }

    let pages: number[] | null = null;
    if (rangeMode === "current") {
      if (!currentPageNumber) {
        setExportError("No current page is known.");
        return;
      }
      pages = [currentPageNumber];
    } else if (rangeMode === "custom") {
      const parsed = parsePageRange(customRange, totalPages);
      if (!parsed.ok) {
        setExportError(parsed.error);
        setStatus(`Export failed: ${parsed.error}`);
        return;
      }
      pages = parsed.pages;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    const expected = pages ? pages.length : totalPages;
    setIsExporting(true);
    setProgress({ completed: 0, total: expected });
    setStatus(`Exporting ${expected} page${expected === 1 ? "" : "s"}…`);

    try {
      const blob = await exportDocumentToPdf({
        elements,
        files,
        appState,
        pageRange: pages,
        scale,
        includeBackground,
        defaultPaperTemplate,
        fileName,
        signal: controller.signal,
        onProgress: (completed, total) => {
          if (!unmountedRef.current) {
            setProgress({ completed, total });
            setStatus(`Rendered page ${completed} of ${total}.`);
          }
        },
      });

      if (unmountedRef.current || controller.signal.aborted) {
        return;
      }

      const outName = toPdfFileName(fileName);
      downloadPdfBlob(blob, outName);
      onExported?.(blob, outName);
      setStatus(`Export complete. ${outName} downloaded.`);
      setIsExporting(false);
      onClose();
    } catch (error) {
      if (unmountedRef.current) {
        return;
      }
      const message =
        error instanceof PdfExportError
          ? error.message
          : error instanceof Error
          ? error.message
          : String(error);
      setExportError(message);
      setStatus(`Export failed: ${message}`);
      setIsExporting(false);
      setProgress(null);
    } finally {
      abortRef.current = null;
    }
  }, [
    isExporting,
    totalPages,
    rangeMode,
    currentPageNumber,
    customRange,
    elements,
    files,
    appState,
    scale,
    includeBackground,
    defaultPaperTemplate,
    fileName,
    onExported,
    onClose,
  ]);

  const percent =
    progress && progress.total > 0
      ? Math.round((progress.completed / progress.total) * 100)
      : 0;

  const canExport =
    !isExporting &&
    totalPages > 0 &&
    !(rangeMode === "custom" && rangeError) &&
    !(rangeMode === "current" && !currentPageNumber);

  return createPortal(
    <div
      // mirrors Excalidraw's own portal containers (see
      // `useCreatePortalContainer`): the theme custom properties are scoped
      // to `.excalidraw`, so a portal outside the editor needs these classes
      // for light/dark to work at all.
      className={`excalidraw gn-export-backdrop${
        (theme ?? appState?.theme) === "dark" ? " theme--dark" : ""
      }`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          requestClose();
        }
      }}
    >
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        className="gn-export-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        ref={dialogRef}
        onKeyDown={onKeyDown}
      >
        <div className="gn-export-dialog__header">
          <h2 id={titleId} className="gn-export-dialog__title">
            Export to PDF
          </h2>
          <button
            type="button"
            className="gn-export-dialog__close"
            onClick={requestClose}
            aria-label="Close export dialog"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <p id={descriptionId} className="gn-export-dialog__description">
          {totalPages === 0
            ? "This document has no pages yet."
            : `${totalPages} page${totalPages === 1 ? "" : "s"}${
                pageSizeLabel ? ` · ${pageSizeLabel}` : ""
              }. Exported in light theme for printing.`}
        </p>

        <div className="gn-export-dialog__body">
          <fieldset className="gn-export-field">
            <legend className="gn-export-field__legend">Pages</legend>
            <div className="gn-export-radios">
              <label className="gn-export-radio">
                <input
                  ref={firstFieldRef}
                  type="radio"
                  name="gn-export-range"
                  value="all"
                  checked={rangeMode === "all"}
                  disabled={isExporting}
                  onChange={() => setRangeMode("all")}
                />
                <span>All pages</span>
              </label>
              <label className="gn-export-radio">
                <input
                  type="radio"
                  name="gn-export-range"
                  value="current"
                  checked={rangeMode === "current"}
                  disabled={isExporting || !currentPageNumber}
                  onChange={() => setRangeMode("current")}
                />
                <span>
                  Current page
                  {currentPageNumber ? ` (${currentPageNumber})` : ""}
                </span>
              </label>
              <label className="gn-export-radio">
                <input
                  type="radio"
                  name="gn-export-range"
                  value="custom"
                  checked={rangeMode === "custom"}
                  disabled={isExporting}
                  onChange={() => setRangeMode("custom")}
                />
                <span>Custom range</span>
              </label>
            </div>

            <label className="gn-export-label" htmlFor="gn-export-custom-range">
              Page range
            </label>
            <input
              id="gn-export-custom-range"
              className="gn-export-input"
              type="text"
              inputMode="numeric"
              placeholder="e.g. 1-3,5"
              value={customRange}
              disabled={isExporting || rangeMode !== "custom"}
              aria-invalid={rangeMode === "custom" && !!rangeError}
              aria-describedby={
                rangeMode === "custom" && rangeError ? rangeErrorId : undefined
              }
              onChange={(event) => setCustomRange(event.target.value)}
            />
            {rangeMode === "custom" && rangeError && (
              <p id={rangeErrorId} className="gn-export-error" role="alert">
                {rangeError}
              </p>
            )}
          </fieldset>

          <div className="gn-export-field">
            <label className="gn-export-label" htmlFor="gn-export-scale">
              Resolution
            </label>
            <select
              id="gn-export-scale"
              className="gn-export-input"
              value={scale}
              disabled={isExporting}
              onChange={(event) => setScale(Number(event.target.value))}
            >
              {SCALE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="gn-export-field">
            <label className="gn-export-checkbox" htmlFor="gn-export-bg">
              <input
                id="gn-export-bg"
                type="checkbox"
                checked={includeBackground}
                disabled={isExporting}
                onChange={(event) => setIncludeBackground(event.target.checked)}
              />
              <span>Include page background (paper &amp; colour)</span>
            </label>
          </div>

          <div className="gn-export-field">
            <label className="gn-export-label" htmlFor="gn-export-filename">
              File name
            </label>
            <div className="gn-export-filename">
              <input
                id="gn-export-filename"
                className="gn-export-input"
                type="text"
                value={fileName}
                disabled={isExporting}
                onChange={(event) => setFileName(event.target.value)}
              />
              <span className="gn-export-filename__suffix" aria-hidden="true">
                .pdf
              </span>
            </div>
          </div>
        </div>

        {isExporting && progress && (
          <div className="gn-export-progress">
            <div
              className="gn-export-progress__track"
              role="progressbar"
              aria-label="Export progress"
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progress.completed}
              aria-valuetext={`Page ${progress.completed} of ${progress.total}`}
            >
              <div
                className="gn-export-progress__bar"
                style={{ width: `${percent}%` }}
              />
            </div>
            <span className="gn-export-progress__text">
              {progress.completed} / {progress.total} pages
            </span>
          </div>
        )}

        {exportError && (
          <p id={exportErrorId} className="gn-export-error" role="alert">
            {exportError}
          </p>
        )}

        {/* single polite live region for progress + completion */}
        <div
          className="gn-export-visually-hidden"
          aria-live="polite"
          role="status"
        >
          {status}
        </div>

        <div className="gn-export-dialog__footer">
          <button
            type="button"
            className="gn-export-button"
            onClick={requestClose}
          >
            {isExporting ? "Cancel" : "Close"}
          </button>
          <button
            type="button"
            className="gn-export-button gn-export-button--primary"
            onClick={handleExport}
            disabled={!canExport}
          >
            {isExporting ? "Exporting…" : "Export PDF"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default ExportDialog;
