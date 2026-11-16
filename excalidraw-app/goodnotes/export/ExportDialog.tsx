/**
 * The export experience.
 *
 * Four presets up front — Submit, Share, Images, This page only — a live
 * preview of exactly the pages that will leave the app, an honest size and
 * time estimate, real progress with a cancel that works, and the OS share
 * sheet on tablets. Every knob the old dialog had is still here, behind
 * "More options"; touching one just switches the preset to "Custom".
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
  estimateExportBytes,
  estimateSeconds,
  formatDuration,
  formatFileSize,
} from "./estimate";
import { formatPageList, matchPageSizeName } from "./pageFrames";
import { clampScale, PdfExportError } from "./exportPdf";
import {
  PagePreviewStrip,
  usePagePreviews,
  useSceneRenderer,
} from "./PagePreview";
import {
  DEFAULT_PRESET_ID,
  EXPORT_PRESETS,
  getLastExport,
  getPreset,
  matchPreset,
  setLastExport,
} from "./presets";
import { describeExportResult, resolvePages, runExport } from "./runExport";
import { supportsFileShare } from "./share";

import "./ExportDialog.scss";

import type { ExportRunResult } from "./runExport";
import type { ExportPresetId, ExportSettings, PageRangeMode } from "./presets";
import type { PaperTemplateId } from "../types";

export type { PageRangeMode } from "./presets";

export interface ExportDialogProps {
  /** The full scene. */
  elements: readonly ExcalidrawElement[];
  files: BinaryFiles | null;
  appState?: Partial<AppState>;
  /**
   * 1-based page number currently in view, used by "This page only".
   * When omitted, that preset is disabled.
   */
  currentPageNumber?: number | null;
  /** Pre-filled filename (with or without the `.pdf` suffix). */
  defaultFileName?: string;
  /**
   * Paper template used for pages whose frame name doesn't encode one.
   * Pass the document's default (e.g. `DocMeta.defaultTemplate`).
   */
  defaultPaperTemplate?: PaperTemplateId;
  /** Called on Escape, backdrop click, Cancel, or Done. */
  onClose: () => void;
  /**
   * Legacy hook for telemetry / toasts — fired with the *first* produced
   * file. Prefer {@link ExportDialogProps.onExportComplete}.
   */
  onExported?: (blob: Blob, fileName: string) => void;
  /** Fired once per successful export, with every file. */
  onExportComplete?: (result: ExportRunResult) => void;
  /**
   * UI theme for the dialog itself (the output is always light).
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

type Phase = "idle" | "exporting" | "done" | "cancelled";

export const ExportDialog: React.FC<ExportDialogProps> = ({
  elements,
  files,
  appState,
  currentPageNumber = null,
  defaultFileName = "document",
  defaultPaperTemplate = "blank",
  onClose,
  onExported,
  onExportComplete,
  theme,
}) => {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);
  const doneButtonRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusRef = useRef<Element | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const unmountedRef = useRef(false);

  const titleId = useId();
  const descriptionId = useId();
  const rangeErrorId = useId();
  const previewCaptionId = useId();
  const optionsId = useId();

  // --- settings ------------------------------------------------------------
  const remembered = useRef(getLastExport()).current;

  const [settings, setSettings] = useState<ExportSettings>(() => {
    const initial = remembered
      ? remembered.settings
      : getPreset(DEFAULT_PRESET_ID).settings;
    return {
      ...initial,
      customRange:
        initial.pageMode === "custom"
          ? initial.customRange
          : String(currentPageNumber ?? 1),
    };
  });
  const [fileName, setFileName] = useState(
    defaultFileName.replace(/\.(pdf|png)$/i, ""),
  );
  const [showOptions, setShowOptions] = useState(false);

  // --- run state -----------------------------------------------------------
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);
  const [status, setStatus] = useState("");
  const [exportError, setExportError] = useState<string | null>(null);
  const isExporting = phase === "exporting";

  /**
   * Which preset is lit is *derived* from the settings, never stored: touch
   * any knob in More options and the preset quietly becomes "Custom",
   * because that is now what it is.
   */
  const presetId: ExportPresetId | null = useMemo(
    () => matchPreset(settings),
    [settings],
  );

  const update = useCallback((patch: Partial<ExportSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const applyPreset = useCallback((id: ExportPresetId) => {
    const preset = getPreset(id);
    setSettings((prev) => ({
      ...preset.settings,
      customRange: prev.customRange,
    }));
    setExportError(null);
    setPhase("idle");
  }, []);

  // --- the pages this will actually export ---------------------------------
  const { renderer, error: rendererError } = useSceneRenderer({
    elements,
    files,
    appState,
    defaultPaperTemplate,
  });

  const totalPages = renderer?.frames.length ?? 0;

  const resolved = useMemo(
    () => resolvePages({ settings, totalPages, currentPageNumber }),
    [settings, totalPages, currentPageNumber],
  );
  const selectedPages = useMemo(
    () => (resolved.ok ? resolved.pages : []),
    [resolved],
  );
  const rangeError = resolved.ok ? null : resolved.error;

  const preview = usePagePreviews({
    renderer,
    pages: selectedPages,
    includeBackground: settings.includeBackground,
    paused: isExporting,
  });

  const pageSizeLabel = useMemo(() => {
    const frames = renderer?.frames ?? [];
    if (frames.length === 0) {
      return null;
    }
    const names = new Set(
      frames.map(
        (frame) =>
          matchPageSizeName(frame.width, frame.height) ??
          `${Math.round(frame.width)}x${Math.round(frame.height)}px`,
      ),
    );
    return names.size === 1 ? [...names][0] : "Mixed sizes";
  }, [renderer]);

  const estimatedBytes = useMemo(
    () =>
      estimateExportBytes({
        samples: preview.samples,
        pages: selectedPages,
        scale: clampScale(settings.scale),
        format: settings.format,
      }),
    [preview.samples, selectedPages, settings.scale, settings.format],
  );

  const estimatedSeconds = estimateSeconds(
    selectedPages.length,
    clampScale(settings.scale),
  );

  const canShare = supportsFileShare();

  // --- lifecycle: focus restore -------------------------------------------
  useEffect(() => {
    unmountedRef.current = false;
    restoreFocusRef.current = document.activeElement;
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

  // move focus to "Done" when an export finishes, so Enter dismisses
  useEffect(() => {
    if (phase === "done") {
      doneButtonRef.current?.focus();
    }
  }, [phase]);

  const cancelExport = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase("cancelled");
    setProgress(null);
    setStatus("Export cancelled. Nothing was saved.");
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
        // while running, Escape stops the export rather than hiding it
        if (isExporting) {
          cancelExport();
        } else {
          requestClose();
        }
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
    [requestClose, cancelExport, isExporting],
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
    if (!resolved.ok) {
      setExportError(resolved.error);
      setStatus(`Export failed: ${resolved.error}`);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    const expected = resolved.pages.length;
    setPhase("exporting");
    setProgress({ completed: 0, total: expected });
    setStatus(`Exporting ${expected} page${expected === 1 ? "" : "s"}…`);

    try {
      const result = await runExport({
        elements,
        files,
        appState,
        defaultPaperTemplate,
        settings,
        fileName,
        currentPageNumber,
        signal: controller.signal,
        renderer: renderer ?? undefined,
        onProgress: (completed, total) => {
          if (!unmountedRef.current && !controller.signal.aborted) {
            setProgress({ completed, total });
            setStatus(`Rendered page ${completed} of ${total}.`);
          }
        },
      });

      if (unmountedRef.current || controller.signal.aborted) {
        return;
      }

      setLastExport({
        presetId,
        settings,
        fileName,
        at: Date.now(),
      });

      const first = result.files[0];
      if (first) {
        onExported?.(first.blob, first.fileName);
      }
      onExportComplete?.(result);
      setStatus(
        `${describeExportResult(result)} ${formatFileSize(
          result.totalBytes,
        )} total.`,
      );
      setProgress({ completed: expected, total: expected });
      setPhase("done");
    } catch (error) {
      if (unmountedRef.current || controller.signal.aborted) {
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
      setPhase("idle");
      setProgress(null);
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }, [
    isExporting,
    totalPages,
    resolved,
    elements,
    files,
    appState,
    defaultPaperTemplate,
    settings,
    fileName,
    currentPageNumber,
    renderer,
    presetId,
    onExported,
    onExportComplete,
  ]);

  const percent =
    progress && progress.total > 0
      ? Math.round((progress.completed / progress.total) * 100)
      : 0;

  const canExport = !isExporting && totalPages > 0 && resolved.ok;

  const pageListLabel = selectedPages.length
    ? `Page${selectedPages.length === 1 ? "" : "s"} ${formatPageList(
        selectedPages,
      )}`
    : "No pages selected";

  const actionLabel = (() => {
    if (settings.format === "png") {
      return `Export ${selectedPages.length || ""} image${
        selectedPages.length === 1 ? "" : "s"
      }`.replace("  ", " ");
    }
    return settings.delivery === "auto" && canShare
      ? "Share PDF"
      : "Export PDF";
  })();

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
        if (event.target === event.currentTarget && !isExporting) {
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
            Export
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
              }. Always exported as white paper with black ink.`}
        </p>

        <div className="gn-export-dialog__body">
          {/* ---------------- presets ---------------- */}
          <fieldset className="gn-export-field">
            <legend className="gn-export-field__legend">
              What do you need?
            </legend>
            <div className="gn-export-presets">
              {EXPORT_PRESETS.map((preset, index) => {
                const disabled =
                  isExporting ||
                  (preset.needsCurrentPage && !currentPageNumber);
                return (
                  <label
                    key={preset.id}
                    className={`gn-export-preset${
                      presetId === preset.id ? " gn-export-preset--on" : ""
                    }${disabled ? " gn-export-preset--disabled" : ""}`}
                  >
                    <input
                      ref={index === 0 ? firstFieldRef : undefined}
                      type="radio"
                      name="gn-export-preset"
                      value={preset.id}
                      checked={presetId === preset.id}
                      disabled={disabled}
                      onChange={() => applyPreset(preset.id)}
                    />
                    <span className="gn-export-preset__text">
                      <span className="gn-export-preset__label">
                        {preset.label}
                      </span>
                      <span className="gn-export-preset__description">
                        {preset.id === "share" && !canShare
                          ? "Smaller PDF · every page · downloads here"
                          : preset.description}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
            {presetId === null && (
              <p className="gn-export-hint">
                Custom settings — see More options below.
              </p>
            )}
          </fieldset>

          {/* ---------------- preview ---------------- */}
          <div className="gn-export-field">
            <span className="gn-export-field__legend">Preview</span>
            {rendererError ? (
              <p className="gn-export-error" role="alert">
                {rendererError}
              </p>
            ) : (
              <PagePreviewStrip
                items={preview.items}
                overflowCount={preview.overflowCount}
                label={`${pageListLabel} — pages that will be exported`}
                emptyMessage={
                  rangeError ?? "Nothing selected — pick pages in More options."
                }
              />
            )}
            <p id={previewCaptionId} className="gn-export-caption">
              {selectedPages.length === 0
                ? "No pages selected."
                : `${pageListLabel} · ${
                    settings.format === "png"
                      ? `${selectedPages.length} PNG file${
                          selectedPages.length === 1 ? "" : "s"
                        }`
                      : "1 PDF"
                  } · ${
                    estimatedBytes === null
                      ? "estimating size…"
                      : `~${formatFileSize(estimatedBytes)}`
                  }${
                    estimatedSeconds > 8
                      ? ` · ${formatDuration(estimatedSeconds)}`
                      : ""
                  }`}
            </p>
          </div>

          {/* ---------------- more options ---------------- */}
          <div className="gn-export-field">
            <button
              type="button"
              className="gn-export-disclosure"
              aria-expanded={showOptions}
              aria-controls={optionsId}
              onClick={() => setShowOptions((open) => !open)}
            >
              <span
                className={`gn-export-disclosure__caret${
                  showOptions ? " gn-export-disclosure__caret--open" : ""
                }`}
                aria-hidden="true"
              >
                ▸
              </span>
              More options
            </button>

            <div
              id={optionsId}
              className="gn-export-options"
              hidden={!showOptions}
            >
              <fieldset className="gn-export-field">
                <legend className="gn-export-field__legend">Format</legend>
                <div className="gn-export-radios">
                  <label className="gn-export-radio">
                    <input
                      type="radio"
                      name="gn-export-format"
                      value="pdf"
                      checked={settings.format === "pdf"}
                      disabled={isExporting}
                      onChange={() => update({ format: "pdf" })}
                    />
                    <span>PDF (one file)</span>
                  </label>
                  <label className="gn-export-radio">
                    <input
                      type="radio"
                      name="gn-export-format"
                      value="png"
                      checked={settings.format === "png"}
                      disabled={isExporting}
                      onChange={() => update({ format: "png" })}
                    />
                    <span>PNG images (one file per page)</span>
                  </label>
                </div>
              </fieldset>

              <fieldset className="gn-export-field">
                <legend className="gn-export-field__legend">Pages</legend>
                <div className="gn-export-radios">
                  {(
                    [
                      ["all", "All pages"],
                      [
                        "current",
                        `Current page${
                          currentPageNumber ? ` (${currentPageNumber})` : ""
                        }`,
                      ],
                      ["custom", "Custom range"],
                    ] as [PageRangeMode, string][]
                  ).map(([mode, label]) => (
                    <label className="gn-export-radio" key={mode}>
                      <input
                        type="radio"
                        name="gn-export-range"
                        value={mode}
                        checked={settings.pageMode === mode}
                        disabled={
                          isExporting ||
                          (mode === "current" && !currentPageNumber)
                        }
                        onChange={() => update({ pageMode: mode })}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>

                <label
                  className="gn-export-label"
                  htmlFor="gn-export-custom-range"
                >
                  Page range
                </label>
                <input
                  id="gn-export-custom-range"
                  className="gn-export-input"
                  type="text"
                  inputMode="numeric"
                  placeholder="e.g. 1-3,5"
                  value={settings.customRange}
                  disabled={isExporting || settings.pageMode !== "custom"}
                  aria-invalid={settings.pageMode === "custom" && !!rangeError}
                  aria-describedby={
                    settings.pageMode === "custom" && rangeError
                      ? rangeErrorId
                      : previewCaptionId
                  }
                  onChange={(event) =>
                    update({ customRange: event.target.value })
                  }
                />
                {settings.pageMode === "custom" && rangeError && (
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
                  value={settings.scale}
                  disabled={isExporting}
                  onChange={(event) =>
                    update({ scale: Number(event.target.value) })
                  }
                >
                  {SCALE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="gn-export-field">
                <label className="gn-export-label" htmlFor="gn-export-delivery">
                  When it's ready
                </label>
                <select
                  id="gn-export-delivery"
                  className="gn-export-input"
                  value={settings.delivery}
                  disabled={isExporting}
                  onChange={(event) =>
                    update({
                      delivery:
                        event.target.value === "auto" ? "auto" : "download",
                    })
                  }
                >
                  <option value="download">Save to this device</option>
                  <option value="auto">
                    {canShare
                      ? "Open the share sheet"
                      : "Open the share sheet (not available here — saves instead)"}
                  </option>
                </select>
              </div>

              <div className="gn-export-field">
                <label className="gn-export-checkbox" htmlFor="gn-export-bg">
                  <input
                    id="gn-export-bg"
                    type="checkbox"
                    checked={settings.includeBackground}
                    disabled={isExporting}
                    onChange={(event) =>
                      update({ includeBackground: event.target.checked })
                    }
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
                  <span
                    className="gn-export-filename__suffix"
                    aria-hidden="true"
                  >
                    {settings.format === "png" ? "-page-1.png" : ".pdf"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {progress && (phase === "exporting" || phase === "done") && (
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

        {phase === "done" && <p className="gn-export-done">{status}</p>}
        {phase === "cancelled" && (
          <p className="gn-export-hint">Export cancelled. Nothing was saved.</p>
        )}

        {exportError && (
          <p className="gn-export-error" role="alert">
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
          {isExporting ? (
            <button
              type="button"
              className="gn-export-button"
              onClick={cancelExport}
            >
              Cancel
            </button>
          ) : (
            <button
              type="button"
              className="gn-export-button"
              onClick={requestClose}
            >
              Close
            </button>
          )}
          {phase === "done" ? (
            <button
              type="button"
              ref={doneButtonRef}
              className="gn-export-button gn-export-button--primary"
              onClick={onClose}
            >
              Done
            </button>
          ) : (
            <button
              type="button"
              className="gn-export-button gn-export-button--primary"
              onClick={handleExport}
              disabled={!canExport}
            >
              {isExporting ? "Exporting…" : actionLabel}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default ExportDialog;
