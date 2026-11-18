/**
 * <FuzzySelectOverlay /> — the live lasso affordance.
 *
 * An absolutely positioned layer over Excalidraw's canvases that:
 *
 *   - captures a freehand loop while the tool is on (marching-ants dashed
 *     path drawn as you drag)
 *   - hit-tests the loop against the scene (see `lasso.ts`)
 *   - offers Copy / Duplicate / Dismiss in a small floating action bar
 *
 * It is **inert when inactive**: `pointer-events: none` on the root and on
 * the capture surface, no key handlers bound, nothing rendered. Drawing,
 * panning and normal selection all pass straight through to the canvas.
 *
 * ## Accessibility
 *
 *   - the action bar is a `role="toolbar"` of real `<button>`s with text
 *     labels (not icon-only), so every control has an accessible name
 *   - Copy is focused as soon as a selection exists, so the whole
 *     Copy/Duplicate/Dismiss flow is reachable with Tab + Enter from the
 *     keyboard alone; `Ctrl/⌘+C` and `Ctrl/⌘+D` are bound as shortcuts
 *     while a selection exists
 *   - `Escape` cancels: it aborts an in-progress stroke, else clears the
 *     selection, else turns the tool off
 *   - outcomes (copied, duplicated, nothing selected, clipboard blocked) are
 *     announced through an `aria-live="polite"` status region
 *   - focus rings use `:focus-visible` and the editor's `--color-primary`
 *   - `@media (prefers-reduced-motion: reduce)` stops the marching ants and
 *     the action bar's pop-in (see the `.scss`)
 *
 * See INTEGRATION.md for how to mount it.
 */

import {
  sceneCoordsToViewportCoords,
  viewportCoordsToSceneCoords,
} from "@excalidraw/common";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AppState } from "@excalidraw/excalidraw/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { fuzzySelectActivation, useFuzzySelectActive } from "./activation";
import {
  ClipboardCopyError,
  canCopyImageToClipboard,
  copyPngToClipboard,
  downloadRasterAsPng,
} from "./clipboard";
import { duplicateRasterIntoScene } from "./duplicate";
import {
  closeLassoPath,
  createLassoRecorder,
  isUsableLassoPath,
  selectElementsWithLasso,
} from "./lasso";
import { DEFAULT_RASTER_SCALE, rasterizeLassoSelection } from "./rasterize";

import "./FuzzySelectOverlay.scss";

import type { FuzzySelectActivation } from "./activation";
import type {
  LassoPath,
  LassoSelectionOptions,
  LassoSelectionResult,
  ScenePoint,
} from "./lasso";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FuzzySelectOverlayProps {
  /** The editor. The overlay renders nothing until this is non-null. */
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  /**
   * Controlled on/off. Omit to use the shared activation store, which is
   * what the taskbar's `activateFuzzySelect()` drives.
   */
  active?: boolean;
  /** Notified whenever the tool turns itself off (e.g. on `Escape`). */
  onActiveChange?: (active: boolean) => void;
  /** Alternative activation store, mainly for tests. */
  activation?: FuzzySelectActivation;
  /** Hit-testing options forwarded to `selectElementsWithLasso`. */
  selectionOptions?: LassoSelectionOptions;
  /** Device pixels per scene unit for the raster. @default 2 */
  rasterScale?: number;
  /** Scene-space offset of a duplicate from the original. */
  duplicateOffset?: { x: number; y: number };
  /**
   * Turn the tool off after a successful Copy/Duplicate. @default false —
   * a student usually wants to grab several things in a row.
   */
  deactivateOnAction?: boolean;
  /** Called after a successful copy / duplicate, for analytics or toasts. */
  onCopy?: (result: LassoSelectionResult) => void;
  onDuplicate?: (result: LassoSelectionResult) => void;
}

type Phase = "idle" | "drawing" | "selected" | "busy";

interface ViewTransform {
  scrollX: number;
  scrollY: number;
  zoom: number;
  offsetLeft: number;
  offsetTop: number;
  theme: "light" | "dark";
}

interface StatusMessage {
  text: string;
  tone: "info" | "error";
}

const INITIAL_VIEW: ViewTransform = {
  scrollX: 0,
  scrollY: 0,
  zoom: 1,
  offsetLeft: 0,
  offsetTop: 0,
  theme: "light",
};

/** Action bar height + a little breathing room, in px. */
const ACTION_BAR_GAP = 12;
const ACTION_BAR_ESTIMATED_WIDTH = 300;
const ACTION_BAR_ESTIMATED_HEIGHT = 40;

const readView = (state: AppState): ViewTransform => ({
  scrollX: state.scrollX,
  scrollY: state.scrollY,
  zoom: state.zoom.value,
  offsetLeft: state.offsetLeft,
  offsetTop: state.offsetTop,
  theme: state.theme === "dark" ? "dark" : "light",
});

const viewsEqual = (a: ViewTransform, b: ViewTransform) =>
  a.scrollX === b.scrollX &&
  a.scrollY === b.scrollY &&
  a.zoom === b.zoom &&
  a.offsetLeft === b.offsetLeft &&
  a.offsetTop === b.offsetTop &&
  a.theme === b.theme;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const FuzzySelectOverlay = ({
  excalidrawAPI,
  active: activeProp,
  onActiveChange,
  activation = fuzzySelectActivation,
  selectionOptions,
  rasterScale = DEFAULT_RASTER_SCALE,
  duplicateOffset,
  deactivateOnAction = false,
  onCopy,
  onDuplicate,
}: FuzzySelectOverlayProps) => {
  const storeActive = useFuzzySelectActive(activation);
  const active = activeProp ?? storeActive;

  const rootRef = useRef<HTMLDivElement>(null);
  const copyButtonRef = useRef<HTMLButtonElement>(null);
  const recorderRef = useRef(createLassoRecorder());
  const frameRef = useRef<number | null>(null);

  const [view, setView] = useState<ViewTransform>(INITIAL_VIEW);
  const [phase, setPhase] = useState<Phase>("idle");
  const [path, setPath] = useState<LassoPath>([]);
  const [selection, setSelection] = useState<LassoSelectionResult | null>(null);
  const [status, setStatus] = useState<StatusMessage | null>(null);

  const clipboardAvailable = useMemo(() => canCopyImageToClipboard(), []);

  // -- mirror the editor's view transform -----------------------------------

  useEffect(() => {
    if (!excalidrawAPI) {
      return;
    }
    setView(readView(excalidrawAPI.getAppState()));
    return excalidrawAPI.onChange((_elements, appState) => {
      const next = readView(appState);
      setView((prev) => (viewsEqual(prev, next) ? prev : next));
    });
  }, [excalidrawAPI]);

  // -- coordinate helpers ---------------------------------------------------

  const toScene = useCallback(
    (clientX: number, clientY: number): ScenePoint =>
      viewportCoordsToSceneCoords(
        { clientX, clientY },
        {
          zoom: { value: view.zoom as AppState["zoom"]["value"] },
          offsetLeft: view.offsetLeft,
          offsetTop: view.offsetTop,
          scrollX: view.scrollX,
          scrollY: view.scrollY,
        },
      ),
    [view],
  );

  /** scene -> coordinates local to this overlay's box */
  const toLocal = useCallback(
    (point: ScenePoint): { x: number; y: number } => {
      const client = sceneCoordsToViewportCoords(
        { sceneX: point.x, sceneY: point.y },
        {
          zoom: { value: view.zoom as AppState["zoom"]["value"] },
          offsetLeft: view.offsetLeft,
          offsetTop: view.offsetTop,
          scrollX: view.scrollX,
          scrollY: view.scrollY,
        },
      );
      const rect = rootRef.current?.getBoundingClientRect();
      return {
        x: client.x - (rect?.left ?? 0),
        y: client.y - (rect?.top ?? 0),
      };
    },
    [view],
  );

  // -- reset ----------------------------------------------------------------

  const clearSelection = useCallback(() => {
    recorderRef.current.reset();
    setPath([]);
    setSelection(null);
    setPhase("idle");
  }, []);

  const setActive = useCallback(
    (next: boolean) => {
      if (activeProp === undefined) {
        activation.setActive(next);
      }
      onActiveChange?.(next);
    },
    [activeProp, activation, onActiveChange],
  );

  // turning the tool off always discards work in progress
  useEffect(() => {
    if (!active) {
      clearSelection();
      setStatus(null);
    }
  }, [active, clearSelection]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
    },
    [],
  );

  // -- pointer capture ------------------------------------------------------

  const flushPath = useCallback(() => {
    frameRef.current = null;
    setPath(recorderRef.current.getPath().slice());
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!active || !excalidrawAPI) {
        return;
      }
      // left button / pen / touch only — let right-click reach the canvas
      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);

      setStatus(null);
      setSelection(null);
      recorderRef.current.start(toScene(event.clientX, event.clientY));
      setPath(recorderRef.current.getPath().slice());
      setPhase("drawing");
    },
    [active, excalidrawAPI, toScene],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!recorderRef.current.isRecording()) {
        return;
      }
      event.preventDefault();
      if (recorderRef.current.add(toScene(event.clientX, event.clientY))) {
        if (frameRef.current === null) {
          frameRef.current = requestAnimationFrame(flushPath);
        }
      }
    },
    [flushPath, toScene],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!recorderRef.current.isRecording() || !excalidrawAPI) {
        return;
      }
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }

      recorderRef.current.add(toScene(event.clientX, event.clientY));
      const finalPath = recorderRef.current.finish().slice();
      setPath(finalPath);

      // scale the "is this a real loop?" threshold with zoom, so the feel is
      // the same whether you're zoomed in on a word or out on a page
      const minArea = 16 / (view.zoom * view.zoom);

      if (!isUsableLassoPath(finalPath, minArea)) {
        clearSelection();
        return;
      }

      const result = selectElementsWithLasso(
        finalPath,
        excalidrawAPI.getSceneElements(),
        selectionOptions,
      );

      if (result.elements.length === 0 || !result.selectionBounds) {
        setSelection(null);
        setPhase("idle");
        setPath([]);
        setStatus({
          text: "Nothing inside the loop. Try drawing around the content you want.",
          tone: "info",
        });
        return;
      }

      setSelection(result);
      setPhase("selected");
      setStatus({
        text: `${result.elements.length} item${
          result.elements.length === 1 ? "" : "s"
        } selected. Copy, Duplicate, or press Escape to dismiss.`,
        tone: "info",
      });
    },
    [clearSelection, excalidrawAPI, selectionOptions, toScene, view.zoom],
  );

  const onPointerCancel = useCallback(() => {
    if (recorderRef.current.isRecording()) {
      clearSelection();
    }
  }, [clearSelection]);

  // focus Copy as soon as there is something to act on, so the keyboard path
  // starts where the user expects
  useEffect(() => {
    if (phase === "selected") {
      copyButtonRef.current?.focus();
    }
  }, [phase]);

  // -- actions --------------------------------------------------------------

  const rasterize = useCallback(async () => {
    if (!excalidrawAPI || !selection || !selection.selectionBounds) {
      return null;
    }
    return rasterizeLassoSelection({
      elements: selection.elements,
      files: excalidrawAPI.getFiles(),
      path,
      region: selection.selectionBounds,
      appState: excalidrawAPI.getAppState(),
      scale: rasterScale,
      theme: view.theme,
    });
  }, [excalidrawAPI, path, rasterScale, selection, view.theme]);

  const finishAction = useCallback(
    (message: StatusMessage) => {
      setStatus(message);
      clearSelection();
      if (deactivateOnAction) {
        setActive(false);
      }
    },
    [clearSelection, deactivateOnAction, setActive],
  );

  const handleCopy = useCallback(async () => {
    if (phase !== "selected" || !selection) {
      return;
    }
    setPhase("busy");
    try {
      const raster = await rasterize();
      if (!raster) {
        throw new Error("the selection could not be rendered");
      }
      await copyPngToClipboard(raster.blob);
      onCopy?.(selection);
      finishAction({ text: "Selection copied as an image.", tone: "info" });
    } catch (error) {
      setPhase("selected");
      if (error instanceof ClipboardCopyError) {
        setStatus({ text: error.message, tone: "error" });
      } else {
        setStatus({
          text: `The selection couldn't be copied: ${
            error instanceof Error ? error.message : String(error)
          }`,
          tone: "error",
        });
      }
    }
  }, [finishAction, onCopy, phase, rasterize, selection]);

  const handleDownload = useCallback(async () => {
    if (phase !== "selected") {
      return;
    }
    setPhase("busy");
    try {
      const raster = await rasterize();
      if (!raster) {
        throw new Error("the selection could not be rendered");
      }
      downloadRasterAsPng(raster.blob);
      finishAction({ text: "Selection saved as a PNG.", tone: "info" });
    } catch (error) {
      setPhase("selected");
      setStatus({
        text: `The selection couldn't be saved: ${
          error instanceof Error ? error.message : String(error)
        }`,
        tone: "error",
      });
    }
  }, [finishAction, phase, rasterize]);

  const handleDuplicate = useCallback(async () => {
    if (phase !== "selected" || !selection || !excalidrawAPI) {
      return;
    }
    setPhase("busy");
    try {
      const raster = await rasterize();
      if (!raster) {
        throw new Error("the selection could not be rendered");
      }
      await duplicateRasterIntoScene({
        excalidrawAPI,
        raster,
        offset: duplicateOffset,
      });
      onDuplicate?.(selection);
      finishAction({
        text: "Duplicate added to the page.",
        tone: "info",
      });
    } catch (error) {
      setPhase("selected");
      setStatus({
        text: `The selection couldn't be duplicated: ${
          error instanceof Error ? error.message : String(error)
        }`,
        tone: "error",
      });
    }
  }, [
    duplicateOffset,
    excalidrawAPI,
    finishAction,
    onDuplicate,
    phase,
    rasterize,
    selection,
  ]);

  const handleDismiss = useCallback(() => {
    clearSelection();
    setStatus(null);
  }, [clearSelection]);

  // -- keyboard -------------------------------------------------------------

  useEffect(() => {
    if (!active) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      // A modal surface on top owns the keyboard. Without this the lasso
      // overlay swallowed the first Escape aimed at the Pages panel (it runs
      // in the capture phase on `window`, so it wins over everything), and
      // the user had to press Escape twice to dismiss a dialog opened while
      // the lasso tool happened to be selected.
      const active = document.activeElement;
      if (
        active instanceof Element &&
        active.closest('[role="dialog"], [role="menu"]')
      ) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (recorderRef.current.isRecording()) {
          clearSelection();
        } else if (selection) {
          handleDismiss();
        } else {
          setActive(false);
        }
        return;
      }

      if (!selection || phase === "busy") {
        return;
      }

      const mod = event.metaKey || event.ctrlKey;
      if (mod && !event.shiftKey && !event.altKey) {
        if (event.key === "c" || event.key === "C") {
          event.preventDefault();
          event.stopPropagation();
          void handleCopy();
        } else if (event.key === "d" || event.key === "D") {
          event.preventDefault();
          event.stopPropagation();
          void handleDuplicate();
        }
      }
    };

    // capture phase, so the editor's own Ctrl+C / Escape handlers don't win
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [
    active,
    clearSelection,
    handleCopy,
    handleDismiss,
    handleDuplicate,
    phase,
    selection,
    setActive,
  ]);

  // -- geometry for rendering ----------------------------------------------

  const svgPoints = useMemo(() => {
    if (path.length === 0) {
      return "";
    }
    const ring = phase === "drawing" ? path : closeLassoPath(path);
    return ring
      .map((point) => {
        const local = toLocal(point);
        return `${local.x.toFixed(2)},${local.y.toFixed(2)}`;
      })
      .join(" ");
    // `view` is what makes the path follow pan/zoom; `toLocal` closes over it
  }, [path, phase, toLocal]);

  const actionBarPosition = useMemo(() => {
    if (!selection?.selectionBounds || !rootRef.current) {
      return null;
    }
    const rect = selection.selectionBounds;
    const topLeft = toLocal({ x: rect.x, y: rect.y });
    const bottomRight = toLocal({
      x: rect.x + rect.width,
      y: rect.y + rect.height,
    });

    const host = rootRef.current.getBoundingClientRect();
    const centreX = (topLeft.x + bottomRight.x) / 2;

    let top = bottomRight.y + ACTION_BAR_GAP;
    // flip above when there's no room below
    if (top + ACTION_BAR_ESTIMATED_HEIGHT > host.height - ACTION_BAR_GAP) {
      top = topLeft.y - ACTION_BAR_GAP - ACTION_BAR_ESTIMATED_HEIGHT;
    }
    top = Math.max(
      ACTION_BAR_GAP,
      Math.min(top, host.height - ACTION_BAR_ESTIMATED_HEIGHT - ACTION_BAR_GAP),
    );

    const left = Math.max(
      ACTION_BAR_GAP,
      Math.min(
        centreX - ACTION_BAR_ESTIMATED_WIDTH / 2,
        Math.max(
          ACTION_BAR_GAP,
          host.width - ACTION_BAR_ESTIMATED_WIDTH - ACTION_BAR_GAP,
        ),
      ),
    );

    return { left, top };
  }, [selection, toLocal]);

  // -- render ---------------------------------------------------------------

  if (!excalidrawAPI) {
    return null;
  }

  const showPath = path.length >= 2;
  const busy = phase === "busy";

  return (
    <div
      ref={rootRef}
      data-testid="gn-fuzzy-select"
      data-active={active ? "true" : "false"}
      data-phase={phase}
      className={[
        "excalidraw",
        "gn-fuzzy-select",
        view.theme === "dark" ? "theme--dark" : "",
        active ? "gn-fuzzy-select--active" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {/* Pointer capture surface. `pointer-events` is enabled by the
          `--active` modifier only, so the overlay is invisible to the
          pointer when the tool is off. */}
      <div
        className="gn-fuzzy-select__surface"
        aria-hidden="true"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      />

      {active && showPath && (
        <svg className="gn-fuzzy-select__svg" aria-hidden="true">
          <polygon className="gn-fuzzy-select__fill" points={svgPoints} />
          <polyline
            className="gn-fuzzy-select__ants-under"
            points={svgPoints}
          />
          <polyline className="gn-fuzzy-select__ants" points={svgPoints} />
        </svg>
      )}

      {active && selection && actionBarPosition && (
        <div
          role="toolbar"
          aria-label="Fuzzy selection actions"
          aria-orientation="horizontal"
          className="gn-fuzzy-select__actions"
          style={{ left: actionBarPosition.left, top: actionBarPosition.top }}
        >
          <span className="gn-fuzzy-select__count">
            {selection.elements.length} selected
          </span>
          <span className="gn-fuzzy-select__separator" aria-hidden="true" />
          {clipboardAvailable ? (
            <button
              ref={copyButtonRef}
              type="button"
              className="gn-fuzzy-select__button gn-fuzzy-select__button--primary"
              onClick={() => void handleCopy()}
              disabled={busy}
              title="Copy the selection to the clipboard as a PNG (Ctrl/⌘+C)"
            >
              Copy
            </button>
          ) : (
            <button
              ref={copyButtonRef}
              type="button"
              className="gn-fuzzy-select__button gn-fuzzy-select__button--primary"
              onClick={() => void handleDownload()}
              disabled={busy}
              title="This browser can't copy images to the clipboard — save the selection as a PNG instead"
            >
              Save PNG
            </button>
          )}
          <button
            type="button"
            className="gn-fuzzy-select__button"
            onClick={() => void handleDuplicate()}
            disabled={busy}
            title="Add a copy of the selection to the page (Ctrl/⌘+D)"
          >
            Duplicate
          </button>
          <button
            type="button"
            className="gn-fuzzy-select__button"
            onClick={handleDismiss}
            disabled={busy}
            title="Dismiss the selection (Escape)"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Always mounted so assistive tech picks up changes, rather than
          announcing the region's arrival. */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className={
          status
            ? `gn-fuzzy-select__status${
                status.tone === "error" ? " gn-fuzzy-select__status--error" : ""
              }`
            : "gn-fuzzy-select__sr-only"
        }
      >
        {status?.text ?? ""}
      </div>
    </div>
  );
};

export default FuzzySelectOverlay;
