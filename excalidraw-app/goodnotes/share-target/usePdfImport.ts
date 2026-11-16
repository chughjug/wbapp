/**
 * One import run, as React state: progress, cancellation and per-file errors.
 *
 * Shared by the drop zone, the share-target receive screen and the
 * window-wide drop overlay so all three announce progress identically — the
 * `message` field is written to be read aloud by a screen reader through an
 * `aria-live="polite"` region, and `errorText` through `role="alert"`.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import {
  importPdfsAsNewDocuments,
  type ImportSharedPdfsOptions,
  type ImportedSharedPdf,
  type SharedPdfFailure,
  type SharedPdfProgress,
} from "./importSharedPdfs";

export type PdfImportStatus = "idle" | "importing" | "done" | "error";

export interface PdfImportState {
  status: PdfImportStatus;
  progress: SharedPdfProgress | null;
  /** 0..1, or `null` while the page count is still unknown. */
  fraction: number | null;
  created: ImportedSharedPdf[];
  failed: SharedPdfFailure[];
  /** Polite, human-readable status line. Empty when idle. */
  message: string;
  /** Assertive error text, or null. */
  errorText: string | null;
}

export interface UsePdfImportOptions {
  pdfOptions?: ImportSharedPdfsOptions["pdfOptions"];
  /** Fired once per created document, as soon as it exists. */
  onDocumentCreated?: (doc: ImportedSharedPdf) => void;
  /** Fired once when the whole batch settles. */
  onSettled?: (
    created: ImportedSharedPdf[],
    failed: SharedPdfFailure[],
  ) => void;
}

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

const describe = (progress: SharedPdfProgress): string => {
  const prefix =
    progress.fileCount > 1
      ? `File ${progress.fileIndex + 1} of ${progress.fileCount}: `
      : "";
  switch (progress.phase) {
    case "checking":
      return `${prefix}Opening ${progress.fileName}…`;
    case "rendering":
      return progress.pageCount
        ? `${prefix}Importing page ${progress.pagesCompleted} of ${progress.pageCount} of ${progress.fileName}…`
        : `${prefix}Importing ${progress.fileName}…`;
    case "saving":
      return `${prefix}Saving ${progress.fileName}…`;
    case "done":
    default:
      return "Import finished.";
  }
};

const initialState: PdfImportState = {
  status: "idle",
  progress: null,
  fraction: null,
  created: [],
  failed: [],
  message: "",
  errorText: null,
};

export interface UsePdfImportResult extends PdfImportState {
  /** Start importing. Resolves when the batch settles. */
  run: (files: readonly File[]) => Promise<void>;
  /** Abort a running import; already-created documents are kept. */
  cancel: () => void;
  /** Back to `idle`, clearing progress and errors. */
  reset: () => void;
  isImporting: boolean;
}

export const usePdfImport = (
  options: UsePdfImportOptions = {},
): UsePdfImportResult => {
  const [state, setState] = useState<PdfImportState>(initialState);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState(initialState);
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const run = useCallback(async (files: readonly File[]) => {
    if (!files.length) {
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;

    setState({
      ...initialState,
      status: "importing",
      message: `Preparing ${plural(files.length, "file")}…`,
    });

    try {
      const { created, failed } = await importPdfsAsNewDocuments(files, {
        pdfOptions: optionsRef.current.pdfOptions,
        signal: controller.signal,
        onDocumentCreated: (doc) => optionsRef.current.onDocumentCreated?.(doc),
        onProgress: (progress) => {
          if (!mountedRef.current || progress.phase === "done") {
            return;
          }
          setState((previous) => ({
            ...previous,
            progress,
            fraction:
              progress.pageCount > 0
                ? Math.min(
                    1,
                    (progress.fileIndex +
                      progress.pagesCompleted / progress.pageCount) /
                      progress.fileCount,
                  )
                : null,
            message: describe(progress),
          }));
        },
      });

      if (!mountedRef.current) {
        return;
      }

      const pages = created.reduce((total, doc) => total + doc.pageCount, 0);
      const succeeded = created.length > 0;
      setState({
        status: succeeded ? "done" : "error",
        progress: null,
        fraction: succeeded ? 1 : null,
        created,
        failed,
        message: succeeded
          ? `Imported ${plural(pages, "page")} into ${plural(
              created.length,
              "document",
            )}.`
          : "",
        errorText: failed.length
          ? failed.map((failure) => failure.message).join(" ")
          : succeeded
          ? null
          : "Nothing could be imported.",
      });
      optionsRef.current.onSettled?.(created, failed);
    } catch (error) {
      if (!mountedRef.current) {
        return;
      }
      const aborted = (error as Error | undefined)?.name === "AbortError";
      setState({
        ...initialState,
        status: aborted ? "idle" : "error",
        message: aborted ? "Import cancelled." : "",
        errorText: aborted
          ? null
          : (error as Error | undefined)?.message ??
            "The import failed for an unknown reason.",
      });
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }, []);

  return {
    ...state,
    run,
    cancel,
    reset,
    isImporting: state.status === "importing",
  };
};
