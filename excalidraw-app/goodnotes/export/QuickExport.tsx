/**
 * One-click re-export: repeat the last export, no dialog at all.
 *
 * Exporting the same thing is the common case — a student submits, notices a
 * missing line, fixes it, and submits again. The second time should be one
 * tap. {@link useQuickExport} is the headless version (wire it to a menu
 * item); {@link QuickExportButton} is a ready-made toolbar control.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";

import { PdfExportError } from "./exportPdf";
import {
  describeLastExport,
  getLastExport,
  setLastExport,
  subscribeLastExport,
} from "./presets";
import { describeExportResult, runExport } from "./runExport";

import "./ExportDialog.scss";

import type { LastExport } from "./presets";
import type { ExportRunResult } from "./runExport";
import type { PaperTemplateId } from "../types";

export interface UseQuickExportOptions {
  /** Read lazily, at click time, so the scene is never stale. */
  getScene: () => {
    elements: readonly ExcalidrawElement[];
    files: BinaryFiles | null;
    appState?: Partial<AppState>;
  } | null;
  defaultPaperTemplate?: PaperTemplateId;
  /** 1-based page in view, for a remembered "This page only" export. */
  currentPageNumber?: number | null;
  /** Overrides the remembered file name (e.g. the document was renamed). */
  fileName?: string;
  onComplete?: (result: ExportRunResult) => void;
  onError?: (message: string) => void;
}

export interface UseQuickExportResult {
  /** The remembered export, or `null` when there isn't one yet. */
  last: LastExport | null;
  /** e.g. `"Submit"` — what the button should say it will repeat. */
  label: string | null;
  isExporting: boolean;
  progress: { completed: number; total: number } | null;
  /** Message for a live region: progress, completion or failure. */
  status: string;
  error: string | null;
  /** Repeat the last export. No-op when there isn't one. */
  run: () => Promise<void>;
  /** Stop a running quick export. */
  cancel: () => void;
}

/**
 * Headless one-click re-export.
 *
 * It deliberately re-reads the scene at click time rather than holding
 * props, so a toolbar button mounted once never exports a stale document.
 */
export const useQuickExport = ({
  getScene,
  defaultPaperTemplate = "blank",
  currentPageNumber = null,
  fileName,
  onComplete,
  onError,
}: UseQuickExportOptions): UseQuickExportResult => {
  const [last, setLast] = useState<LastExport | null>(() => getLastExport());
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    const unsubscribe = subscribeLastExport(setLast);
    return () => {
      aliveRef.current = false;
      abortRef.current?.abort();
      unsubscribe();
    };
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsExporting(false);
    setProgress(null);
    setStatus("Export cancelled. Nothing was saved.");
  }, []);

  const run = useCallback(async () => {
    const remembered = getLastExport();
    if (!remembered || isExporting) {
      return;
    }
    const scene = getScene();
    if (!scene) {
      const message = "The document isn't ready yet.";
      setError(message);
      setStatus(`Export failed: ${message}`);
      onError?.(message);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setIsExporting(true);
    setProgress({ completed: 0, total: 0 });
    setStatus(
      `Repeating your last export (${describeLastExport(remembered)})…`,
    );

    try {
      const result = await runExport({
        elements: scene.elements,
        files: scene.files,
        appState: scene.appState,
        defaultPaperTemplate,
        settings: remembered.settings,
        fileName: fileName ?? remembered.fileName,
        currentPageNumber,
        signal: controller.signal,
        onProgress: (completed, total) => {
          if (aliveRef.current && !controller.signal.aborted) {
            setProgress({ completed, total });
            setStatus(`Rendered page ${completed} of ${total}.`);
          }
        },
      });
      if (!aliveRef.current || controller.signal.aborted) {
        return;
      }
      setLastExport({
        ...remembered,
        fileName: fileName ?? remembered.fileName,
        at: Date.now(),
      });
      setStatus(describeExportResult(result));
      onComplete?.(result);
    } catch (err) {
      if (!aliveRef.current || controller.signal.aborted) {
        return;
      }
      const message =
        err instanceof PdfExportError || err instanceof Error
          ? err.message
          : String(err);
      setError(message);
      setStatus(`Export failed: ${message}`);
      onError?.(message);
    } finally {
      if (aliveRef.current) {
        setIsExporting(false);
      }
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }, [
    isExporting,
    getScene,
    defaultPaperTemplate,
    currentPageNumber,
    fileName,
    onComplete,
    onError,
  ]);

  return {
    last,
    label: last ? describeLastExport(last) : null,
    isExporting,
    progress,
    status,
    error,
    run,
    cancel,
  };
};

export interface QuickExportButtonProps extends UseQuickExportOptions {
  /** Extra class on the button, for toolbar styling. */
  className?: string;
  /**
   * Render nothing until there's something to repeat.
   * @default true
   */
  hideWhenUnavailable?: boolean;
  /** Overrides the label. Defaults to `Export again · <preset>`. */
  children?: React.ReactNode;
}

const RepeatIcon = () => (
  <svg
    className="gn-quick-export__icon"
    viewBox="0 0 20 20"
    width="16"
    height="16"
    aria-hidden="true"
    focusable="false"
  >
    <path
      d="M10 3.5a6.5 6.5 0 1 0 6.3 8.2"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
    <path d="M10 1.2 12.6 3.5 10 5.8z" fill="currentColor" />
  </svg>
);

/**
 * Toolbar button that repeats the last export with no dialog.
 *
 * Accessible by construction: a real `<button>` with an `aria-label` naming
 * what will be repeated, `aria-busy` while running, a polite live region for
 * progress and completion, and `role="alert"` for failures.
 */
export const QuickExportButton: React.FC<QuickExportButtonProps> = ({
  className,
  hideWhenUnavailable = true,
  children,
  ...options
}) => {
  const quick = useQuickExport(options);

  if (!quick.last && hideWhenUnavailable) {
    return null;
  }

  const label = quick.label ? `Export again (${quick.label})` : "Export again";

  return (
    <span className="gn-quick-export">
      <button
        type="button"
        className={`gn-export-button gn-quick-export__button${
          className ? ` ${className}` : ""
        }`}
        onClick={() => void quick.run()}
        disabled={!quick.last || quick.isExporting}
        aria-busy={quick.isExporting}
        aria-label={label}
        title={label}
      >
        <RepeatIcon />
        <span className="gn-quick-export__label">
          {children ??
            (quick.isExporting
              ? quick.progress && quick.progress.total > 0
                ? `Exporting ${quick.progress.completed}/${quick.progress.total}…`
                : "Exporting…"
              : "Export again")}
        </span>
      </button>
      <span
        className="gn-export-visually-hidden"
        aria-live="polite"
        role="status"
      >
        {quick.status}
      </span>
      {quick.error && (
        <span className="gn-export-visually-hidden" role="alert">
          {quick.error}
        </span>
      )}
    </span>
  );
};

export default QuickExportButton;
