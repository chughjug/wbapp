/**
 * React binding for `goodnotes/surface`: the surface mode (paper vs
 * whiteboard) of the open document, and the rotate-sheet action.
 *
 * Headless — it renders nothing. {@link SurfaceControls} is one possible UI
 * over `controlsProps`; the shell's bar or a menu can call `toggle()` /
 * `rotate()` directly instead.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { getPageCount } from "../pages";
import { setViewModeOverride } from "../paged";

import {
  getCurrentSheetIndex,
  rotateSheet as rotateSheetOnApi,
} from "./rotateSheet";
import {
  DEFAULT_SURFACE_MODE,
  getCurrentDocId,
  loadSurfaceMode,
  saveSurfaceMode,
  subscribeSurfaceMode,
} from "./surfaceMode";
import { applySurfaceMode, paperPagesFor } from "./whiteboard";

import type { RotateSheetResult } from "./rotateSheet";
import type { SurfaceMode } from "./surfaceMode";

export interface UseSurfaceOptions {
  /**
   * Document the mode belongs to. Defaults to the id in the URL (`/d/<id>`),
   * which is how the editor addresses documents.
   */
  docId?: string | null;
  /** Observe mode changes (e.g. to re-render a host menu). */
  onModeChange?: (mode: SurfaceMode) => void;
}

export interface UseSurfaceResult {
  /** `"paper"` (sheets) or `"whiteboard"` (endless canvas, no pages). */
  mode: SurfaceMode;
  isWhiteboard: boolean;
  setMode: (mode: SurfaceMode) => void;
  toggle: () => void;

  /** Number of page frames in the scene (unchanged by whiteboard mode). */
  pageCount: number;
  /**
   * `false` in whiteboard mode or in an empty document — the host should
   * HIDE page-count / add-page / rotate affordances rather than disable
   * them (see INTEGRATION.md § "dead buttons").
   */
  hasSheets: boolean;
  /** 0-based page under the viewport centre; `-1` when there is none. */
  currentSheetIndex: number;

  /** Turn one sheet (default: the current one) portrait ⇄ landscape. */
  rotate: (index?: number) => RotateSheetResult;
  /** Turn every sheet in the document. */
  rotateAll: () => RotateSheetResult;

  /** Pass to `<PaperBackgroundLayer pages={…} />`: `[]` for a whiteboard. */
  paperPages: [] | undefined;

  /** Text for an `aria-live="polite"` region. */
  announcement: string;

  /** Spread onto `<SurfaceControls />`. */
  controlsProps: {
    mode: SurfaceMode;
    hasSheets: boolean;
    announcement: string;
    onToggleMode: () => void;
    onRotate: () => void;
    onRotateAll: () => void;
  };
}

export const useSurface = (
  excalidrawAPI: ExcalidrawImperativeAPI | null,
  options: UseSurfaceOptions = {},
): UseSurfaceResult => {
  const docId = options.docId !== undefined ? options.docId : getCurrentDocId();

  const [mode, setModeState] = useState<SurfaceMode>(() =>
    typeof window === "undefined"
      ? DEFAULT_SURFACE_MODE
      : loadSurfaceMode(docId),
  );
  const [pageCount, setPageCount] = useState(0);
  const [currentSheetIndex, setCurrentSheetIndex] = useState(-1);
  const [announcement, setAnnouncement] = useState("");

  const onModeChangeRef = useRef(options.onModeChange);
  onModeChangeRef.current = options.onModeChange;

  // the document may change under us (tabs); re-read its stored mode
  useEffect(() => {
    setModeState(loadSurfaceMode(docId));
  }, [docId]);

  // other writers (another tab, a host menu calling saveSurfaceMode)
  useEffect(
    () =>
      subscribeSurfaceMode((next, changedDocId) => {
        if (changedDocId === (docId ?? null)) {
          setModeState(next);
        }
      }),
    [docId],
  );

  // the single place the editor is actually put into the mode
  useEffect(() => {
    applySurfaceMode(excalidrawAPI, mode);
    onModeChangeRef.current?.(mode);
  }, [excalidrawAPI, mode]);

  // leaving the editor must not leave paged view suspended for the next doc
  useEffect(
    () => () => {
      setViewModeOverride(null);
    },
    [],
  );

  // live page count / current sheet, cheap: only committed when they change
  useEffect(() => {
    if (!excalidrawAPI) {
      setPageCount(0);
      setCurrentSheetIndex(-1);
      return;
    }
    const sync = () => {
      const count = getPageCount(excalidrawAPI.getSceneElements());
      setPageCount((current) => (current === count ? current : count));
      const index = getCurrentSheetIndex(excalidrawAPI);
      setCurrentSheetIndex((current) => (current === index ? current : index));
    };
    sync();
    return excalidrawAPI.onChange(sync);
  }, [excalidrawAPI]);

  const setMode = useCallback(
    (next: SurfaceMode) => {
      saveSurfaceMode(docId, next);
      setModeState(next);
      setAnnouncement(
        next === "whiteboard"
          ? "Whiteboard on. Pages are hidden; the canvas is endless."
          : "Whiteboard off. Your pages are back.",
      );
    },
    [docId],
  );

  const toggle = useCallback(() => {
    setMode(mode === "whiteboard" ? "paper" : "whiteboard");
  }, [mode, setMode]);

  const announceRotation = useCallback((result: RotateSheetResult) => {
    if (!result.rotated) {
      setAnnouncement("There is no sheet to rotate.");
      return;
    }
    const orientation = result.landscape ? "landscape" : "portrait";
    const scaled =
      result.contentScale < 1
        ? ` Contents scaled to ${Math.round(
            result.contentScale * 100,
          )}% to fit.`
        : "";
    setAnnouncement(
      result.indices.length === 1
        ? `Sheet ${result.indices[0] + 1} is now ${orientation}.${scaled}`
        : `${result.indices.length} sheets rotated.${scaled}`,
    );
  }, []);

  const rotate = useCallback(
    (index?: number) => {
      const result = rotateSheetOnApi(excalidrawAPI, { index });
      announceRotation(result);
      return result;
    },
    [excalidrawAPI, announceRotation],
  );

  const rotateAll = useCallback(() => {
    const result = rotateSheetOnApi(excalidrawAPI, { all: true });
    announceRotation(result);
    return result;
  }, [excalidrawAPI, announceRotation]);

  const isWhiteboard = mode === "whiteboard";
  const hasSheets = !isWhiteboard && pageCount > 0;

  return useMemo(
    () => ({
      mode,
      isWhiteboard,
      setMode,
      toggle,
      pageCount,
      hasSheets,
      currentSheetIndex,
      rotate,
      rotateAll,
      paperPages: paperPagesFor(mode),
      announcement,
      controlsProps: {
        mode,
        hasSheets,
        announcement,
        onToggleMode: toggle,
        onRotate: () => rotate(),
        onRotateAll: () => rotateAll(),
      },
    }),
    [
      mode,
      isWhiteboard,
      setMode,
      toggle,
      pageCount,
      hasSheets,
      currentSheetIndex,
      rotate,
      rotateAll,
      announcement,
    ],
  );
};
