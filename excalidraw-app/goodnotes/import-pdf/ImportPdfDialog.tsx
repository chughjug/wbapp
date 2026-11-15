/**
 * Accessible "Import PDF" dialog.
 *
 * Mount it only while open (`{isOpen && <ImportPdfDialog … />}`) so focus
 * handling stays simple; it renders into a portal on `document.body`.
 *
 * Accessibility: `role="dialog" aria-modal`, labelled title/description,
 * every control has a real `<label>`, focus is moved in on mount, trapped
 * with Tab/Shift+Tab and restored on close, Escape closes (and cancels a
 * running import first), progress is announced through `aria-live="polite"`,
 * errors through `role="alert"`, and the drop zone is a real `<button>` so it
 * works from the keyboard. Animations are disabled under
 * `prefers-reduced-motion: reduce`.
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

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import {
  DEFAULT_RENDER_SCALE,
  describePdfImportError,
  importPdfIntoScene,
  isPdfjsAvailable,
  parsePageRange,
  PdfImportError,
  PDFJS_PACKAGE,
  PDFJS_VERSION_RANGE,
  readPdfPageCount,
  RENDER_SCALE_OPTIONS,
  type ImportPdfResult,
  type PdfPageSizing,
} from "./importPdf";

import "./ImportPdfDialog.scss";

import type { PaperTemplateId } from "../types";

export interface ImportPdfDialogProps {
  excalidrawAPI: ExcalidrawImperativeAPI;
  /** Called on Escape, backdrop click, Cancel, or after a successful import. */
  onClose: () => void;
  /** Fired after pages land in the scene (for toasts / telemetry). */
  onImported?: (result: ImportPdfResult) => void;
  /** Paper template recorded on the imported page frames. Default `"blank"`. */
  template?: PaperTemplateId;
  /** Dialog theme. Defaults to the editor's current theme. */
  theme?: "light" | "dark";
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const formatBytes = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const isPdfFile = (file: File) =>
  file.type === "application/pdf" || /\.pdf$/i.test(file.name);

export const ImportPdfDialog: React.FC<ImportPdfDialogProps> = ({
  excalidrawAPI,
  onClose,
  onImported,
  template = "blank",
  theme,
}) => {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const dropZoneRef = useRef<HTMLButtonElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const restoreFocusRef = useRef<Element | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const unmountedRef = useRef(false);

  const titleId = useId();
  const descriptionId = useId();
  const rangeHintId = useId();
  const rangeErrorId = useId();
  const errorId = useId();
  const progressId = useId();
  const fileInputId = useId();
  const scaleId = useId();
  const sizingId = useId();
  const rangeInputId = useId();

  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [password, setPassword] = useState("");
  const [needsPassword, setNeedsPassword] = useState(false);
  const [rangeMode, setRangeMode] = useState<"all" | "custom">("all");
  const [customRange, setCustomRange] = useState("1-");
  const [scale, setScale] = useState<number>(DEFAULT_RENDER_SCALE);
  const [sizing, setSizing] = useState<PdfPageSizing>("preset");
  const [extractText, setExtractText] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dependencyMissing, setDependencyMissing] = useState(false);

  const editorTheme =
    theme ?? (excalidrawAPI.getAppState?.().theme as "light" | "dark") ?? "light";

  // ---- dependency probe ---------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    isPdfjsAvailable().then((available) => {
      if (!cancelled && !available) {
        setDependencyMissing(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- focus management ---------------------------------------------------
  useEffect(() => {
    unmountedRef.current = false;
    restoreFocusRef.current = document.activeElement;
    // defer so the portal content exists
    const id = window.requestAnimationFrame(() => {
      dropZoneRef.current?.focus();
    });
    return () => {
      unmountedRef.current = true;
      window.cancelAnimationFrame(id);
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

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        event.preventDefault();
        // first Escape stops a running import; a second one closes
        if (abortRef.current) {
          abortRef.current.abort();
          return;
        }
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
      ].filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (focusable.length === 0) {
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [requestClose],
  );

  // ---- file selection -----------------------------------------------------
  const acceptFile = useCallback(
    async (candidate: File) => {
      setError(null);
      setNeedsPassword(false);
      setPassword("");
      setPageCount(null);
      if (!isPdfFile(candidate)) {
        setFile(null);
        setError(`"${candidate.name}" is not a PDF.`);
        return;
      }
      setFile(candidate);
      try {
        const count = await readPdfPageCount(candidate);
        if (!unmountedRef.current) {
          // reading the PDF proves pdf.js is reachable after all (e.g. the
          // host called configurePdfjs() after this dialog mounted)
          setDependencyMissing(false);
          setPageCount(count);
          setCustomRange(`1-${count}`);
        }
      } catch (err) {
        if (unmountedRef.current) {
          return;
        }
        if (err instanceof PdfImportError) {
          if (err.code === "password-required") {
            setNeedsPassword(true);
            setError(
              "This PDF is password-protected. Enter its password to continue.",
            );
            return;
          }
          if (err.code === "missing-dependency") {
            setDependencyMissing(true);
            return;
          }
        }
        setError(describePdfImportError(err));
      }
    },
    [],
  );

  const onFileInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const picked = event.target.files?.[0];
      if (picked) {
        void acceptFile(picked);
      }
      // allow re-picking the same file
      event.target.value = "";
    },
    [acceptFile],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setIsDragging(false);
      const dropped = event.dataTransfer?.files?.[0];
      if (dropped) {
        void acceptFile(dropped);
      }
    },
    [acceptFile],
  );

  // ---- page range ---------------------------------------------------------
  const selectedPages = useMemo(() => {
    if (!pageCount) {
      return null;
    }
    if (rangeMode === "all") {
      return Array.from({ length: pageCount }, (_, i) => i + 1);
    }
    return parsePageRange(customRange, pageCount);
  }, [customRange, pageCount, rangeMode]);

  const rangeError =
    rangeMode === "custom" && pageCount
      ? selectedPages === null
        ? "Use page numbers and ranges, e.g. 1-3, 7, 10-."
        : selectedPages.length === 0
        ? `That range selects no pages (this PDF has ${pageCount}).`
        : null
      : null;

  const canImport =
    !!file &&
    !busy &&
    !dependencyMissing &&
    !rangeError &&
    (!needsPassword || password.length > 0);

  // ---- import -------------------------------------------------------------
  const runImport = useCallback(async () => {
    if (!file) {
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
    setProgress({ completed: 0, total: selectedPages?.length ?? 0 });
    try {
      const result = await importPdfIntoScene(excalidrawAPI, file, {
        pageNumbers:
          rangeMode === "custom" && selectedPages ? selectedPages : undefined,
        scale,
        pageSizing: sizing,
        template,
        extractText,
        password: password || undefined,
        signal: controller.signal,
        onProgress: (completed, total) => {
          if (!unmountedRef.current) {
            setProgress({ completed, total });
          }
        },
      });
      if (unmountedRef.current) {
        return;
      }
      onImported?.(result);
      onClose();
    } catch (err) {
      if (unmountedRef.current) {
        return;
      }
      setBusy(false);
      setProgress(null);
      if (err instanceof PdfImportError) {
        if (err.code === "cancelled") {
          setError("Import cancelled.");
          return;
        }
        if (err.code === "password-required") {
          setNeedsPassword(true);
        }
        if (err.code === "missing-dependency") {
          setDependencyMissing(true);
        }
      }
      setError(describePdfImportError(err));
    } finally {
      abortRef.current = null;
    }
  }, [
    excalidrawAPI,
    extractText,
    file,
    onClose,
    onImported,
    password,
    rangeMode,
    scale,
    selectedPages,
    sizing,
    template,
  ]);

  const percent =
    progress && progress.total > 0
      ? Math.round((progress.completed / progress.total) * 100)
      : 0;

  return createPortal(
    <div
      className={`excalidraw gn-import-pdf-backdrop theme--${editorTheme}`}
      data-theme={editorTheme}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          requestClose();
        }
      }}
    >
      <div
        className="gn-import-pdf-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        ref={dialogRef}
        onKeyDown={onKeyDown}
      >
        <div className="gn-import-pdf-dialog__header">
          <h2 className="gn-import-pdf-dialog__title" id={titleId}>
            Import PDF
          </h2>
          <button
            type="button"
            className="gn-import-pdf-dialog__close"
            onClick={requestClose}
            aria-label="Close PDF import"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <p className="gn-import-pdf-dialog__description" id={descriptionId}>
          Each PDF page becomes a new page at the end of this document, as a
          picture you can write on. The text in the picture is{" "}
          <strong>not</strong> selectable or searchable.
        </p>

        {dependencyMissing && (
          <div className="gn-import-pdf-dialog__banner" role="alert">
            <strong>PDF rendering is unavailable.</strong> This build is
            missing the <code>{PDFJS_PACKAGE}</code> package (
            <code>{PDFJS_VERSION_RANGE}</code>). Install it and reload:
            <code className="gn-import-pdf-dialog__code">
              yarn workspace excalidraw-app add {PDFJS_PACKAGE}
            </code>
          </div>
        )}

        {/* ---- file ---- */}
        <button
          type="button"
          ref={dropZoneRef}
          className={`gn-import-pdf-dropzone${
            isDragging ? " gn-import-pdf-dropzone--active" : ""
          }`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
          disabled={busy}
          aria-describedby={descriptionId}
        >
          {file ? (
            <>
              <span className="gn-import-pdf-dropzone__name">{file.name}</span>
              <span className="gn-import-pdf-dropzone__meta">
                {formatBytes(file.size)}
                {pageCount !== null
                  ? ` · ${pageCount} page${pageCount === 1 ? "" : "s"}`
                  : ""}{" "}
                · choose a different file
              </span>
            </>
          ) : (
            <>
              <span className="gn-import-pdf-dropzone__name">
                Choose a PDF, or drop one here
              </span>
              <span className="gn-import-pdf-dropzone__meta">
                PDF files only
              </span>
            </>
          )}
        </button>
        <input
          id={fileInputId}
          ref={fileInputRef}
          className="gn-import-pdf-dialog__file-input"
          type="file"
          accept="application/pdf,.pdf"
          onChange={onFileInputChange}
          tabIndex={-1}
          aria-hidden="true"
        />

        {needsPassword && (
          <div className="gn-import-pdf-field">
            <label htmlFor={`${fileInputId}-pw`}>PDF password</label>
            <input
              id={`${fileInputId}-pw`}
              type="password"
              value={password}
              autoComplete="off"
              onChange={(event) => setPassword(event.target.value)}
              disabled={busy}
            />
          </div>
        )}

        {/* ---- page range ---- */}
        <fieldset className="gn-import-pdf-fieldset" disabled={busy || !file}>
          <legend>Pages</legend>
          <div className="gn-import-pdf-radio">
            <input
              type="radio"
              id={`${rangeInputId}-all`}
              name={rangeInputId}
              checked={rangeMode === "all"}
              onChange={() => setRangeMode("all")}
            />
            <label htmlFor={`${rangeInputId}-all`}>
              All pages{pageCount ? ` (${pageCount})` : ""}
            </label>
          </div>
          <div className="gn-import-pdf-radio">
            <input
              type="radio"
              id={`${rangeInputId}-custom`}
              name={rangeInputId}
              checked={rangeMode === "custom"}
              onChange={() => setRangeMode("custom")}
            />
            <label htmlFor={`${rangeInputId}-custom`}>Page range</label>
          </div>
          <div className="gn-import-pdf-field">
            <label htmlFor={rangeInputId} className="gn-import-pdf-visually-hidden">
              Page range
            </label>
            <input
              id={rangeInputId}
              type="text"
              inputMode="numeric"
              value={customRange}
              // typing in the field IS the "page range" choice — a disabled
              // input would be unreachable from the keyboard and invisible to
              // screen readers' form navigation
              onChange={(event) => {
                setCustomRange(event.target.value);
                setRangeMode("custom");
              }}
              onFocus={() => setRangeMode("custom")}
              aria-describedby={rangeError ? rangeErrorId : rangeHintId}
              aria-invalid={!!rangeError}
            />
            <p className="gn-import-pdf-hint" id={rangeHintId}>
              e.g. <code>1-3, 7, 10-</code>
            </p>
            {rangeError && (
              <p className="gn-import-pdf-error" id={rangeErrorId} role="alert">
                {rangeError}
              </p>
            )}
          </div>
        </fieldset>

        {/* ---- quality ---- */}
        <div className="gn-import-pdf-field">
          <label htmlFor={scaleId}>Render quality</label>
          <select
            id={scaleId}
            value={scale}
            onChange={(event) => setScale(Number(event.target.value))}
            disabled={busy}
          >
            {RENDER_SCALE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="gn-import-pdf-hint">
            Higher quality stays sharp when you zoom in, but makes the document
            bigger.
          </p>
        </div>

        {/* ---- page sizing ---- */}
        <div className="gn-import-pdf-field">
          <label htmlFor={sizingId}>Page size</label>
          <select
            id={sizingId}
            value={sizing}
            onChange={(event) =>
              setSizing(event.target.value as PdfPageSizing)
            }
            disabled={busy}
          >
            <option value="preset">
              Fit to the closest standard page (Letter / A4 / Legal)
            </option>
            <option value="exact">Keep the PDF&apos;s exact dimensions</option>
          </select>
        </div>

        <div className="gn-import-pdf-checkbox">
          <input
            type="checkbox"
            id={`${sizingId}-text`}
            checked={extractText}
            onChange={(event) => setExtractText(event.target.checked)}
            disabled={busy}
          />
          <label htmlFor={`${sizingId}-text`}>
            Save the PDF&apos;s text with each page (hidden metadata for future
            search — the page itself stays a picture)
          </label>
        </div>

        {/* ---- progress ---- */}
        <div
          className="gn-import-pdf-progress"
          aria-live="polite"
          aria-atomic="true"
          id={progressId}
        >
          {busy && progress ? (
            <>
              <div
                className="gn-import-pdf-progress__track"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={progress.total}
                aria-valuenow={progress.completed}
                aria-valuetext={`Page ${progress.completed} of ${progress.total}`}
              >
                <div
                  className="gn-import-pdf-progress__bar"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <p className="gn-import-pdf-progress__label">
                Importing page {Math.min(progress.completed + 1, progress.total)}{" "}
                of {progress.total}…
              </p>
            </>
          ) : null}
        </div>

        {error && (
          <p className="gn-import-pdf-error" id={errorId} role="alert">
            {error}
          </p>
        )}

        {/* ---- actions ---- */}
        <div className="gn-import-pdf-dialog__actions">
          <button
            type="button"
            className="gn-import-pdf-button"
            onClick={() => {
              if (busy && abortRef.current) {
                abortRef.current.abort();
                return;
              }
              requestClose();
            }}
          >
            {busy ? "Cancel import" : "Cancel"}
          </button>
          <button
            type="button"
            className="gn-import-pdf-button gn-import-pdf-button--primary"
            onClick={() => void runImport()}
            disabled={!canImport}
            aria-describedby={progressId}
          >
            {busy
              ? "Importing…"
              : selectedPages && rangeMode === "custom"
              ? `Import ${selectedPages.length} page${
                  selectedPages.length === 1 ? "" : "s"
                }`
              : "Import"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
