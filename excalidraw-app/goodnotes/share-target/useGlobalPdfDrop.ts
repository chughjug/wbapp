/**
 * Window-wide drag-and-drop of PDFs.
 *
 * Two things make this fiddly enough to deserve its own hook:
 *
 * 1. **Drag counting.** `dragleave` fires every time the pointer crosses into
 *    a child element, so a naive "hide on dragleave" overlay flickers.
 *    We keep a depth counter and only drop the highlight at zero (or on
 *    `drop`/`dragend`, which can arrive without a matching `dragleave`).
 * 2. **Beating the canvas to the file.** Excalidraw's own `drop` handler
 *    takes any file dropped on the canvas and would reject a PDF. We listen
 *    in the **capture** phase and `stopPropagation()` only when the drag
 *    actually carries a PDF, so every other drop (images, `.excalidraw`
 *    scenes, text) reaches the editor exactly as before.
 *
 * During `dragover` the browser does not let a page read file contents, only
 * item types — so the highlight is a *guess* based on the MIME type (and
 * empty types count, because iOS and some file managers report none). The
 * authoritative `%PDF-` check happens on drop, in `importSharedPdfs`.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { dragHasPdf, filesFromDataTransfer } from "./importSharedPdfs";

export interface UseGlobalPdfDropOptions {
  /** Called with the dropped files (not yet validated as real PDFs). */
  onFiles: (files: File[]) => void;
  /** Stop listening (e.g. while an import is already running). */
  disabled?: boolean;
  /** Defaults to `window`. Pass an element to scope the drop area. */
  target?: HTMLElement | Document | Window | null;
}

export interface UseGlobalPdfDropResult {
  /** True while a drag that looks like a PDF is over the target. */
  isDragging: boolean;
}

export const useGlobalPdfDrop = ({
  onFiles,
  disabled = false,
  target,
}: UseGlobalPdfDropOptions): UseGlobalPdfDropResult => {
  const [isDragging, setIsDragging] = useState(false);
  const depth = useRef(0);
  const onFilesRef = useRef(onFiles);
  onFilesRef.current = onFiles;

  const reset = useCallback(() => {
    depth.current = 0;
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (disabled) {
      reset();
      return;
    }
    const node: EventTarget =
      target ?? (typeof window === "undefined" ? ({} as EventTarget) : window);
    if (typeof (node as EventTarget).addEventListener !== "function") {
      return;
    }

    const onDragEnter = (event: Event) => {
      const dragEvent = event as DragEvent;
      if (!dragHasPdf(dragEvent.dataTransfer)) {
        return;
      }
      depth.current += 1;
      setIsDragging(true);
    };

    const onDragOver = (event: Event) => {
      const dragEvent = event as DragEvent;
      if (!dragHasPdf(dragEvent.dataTransfer)) {
        return;
      }
      // without preventDefault the browser navigates to the file on drop
      dragEvent.preventDefault();
      if (dragEvent.dataTransfer) {
        dragEvent.dataTransfer.dropEffect = "copy";
      }
      if (depth.current === 0) {
        // some browsers skip dragenter when the drag starts inside the page
        depth.current = 1;
        setIsDragging(true);
      }
    };

    const onDragLeave = (event: Event) => {
      const dragEvent = event as DragEvent;
      if (!dragHasPdf(dragEvent.dataTransfer)) {
        return;
      }
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) {
        setIsDragging(false);
      }
    };

    const onDrop = (event: Event) => {
      const dragEvent = event as DragEvent;
      const files = filesFromDataTransfer(dragEvent.dataTransfer);
      const candidates = files.filter(
        (file) =>
          file.type === "application/pdf" || /\.pdf$/i.test(file.name ?? ""),
      );
      if (!candidates.length) {
        reset();
        return;
      }
      // only now do we take the event away from the editor's own handler
      dragEvent.preventDefault();
      dragEvent.stopPropagation();
      reset();
      onFilesRef.current(candidates);
    };

    node.addEventListener("dragenter", onDragEnter, true);
    node.addEventListener("dragover", onDragOver, true);
    node.addEventListener("dragleave", onDragLeave, true);
    node.addEventListener("dragend", reset, true);
    node.addEventListener("drop", onDrop, true);

    return () => {
      node.removeEventListener("dragenter", onDragEnter, true);
      node.removeEventListener("dragover", onDragOver, true);
      node.removeEventListener("dragleave", onDragLeave, true);
      node.removeEventListener("dragend", reset, true);
      node.removeEventListener("drop", onDrop, true);
    };
  }, [disabled, reset, target]);

  return { isDragging };
};
