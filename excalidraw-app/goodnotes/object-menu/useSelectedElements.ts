/**
 * GoodNotes object menu — selection subscription.
 *
 * `useSelectedElements` is the single source of truth the floating menu is
 * driven from. It subscribes to `excalidrawAPI.onChange(...)` and derives,
 * from the raw `(elements, appState)` pair:
 *
 *  - which non-deleted elements are selected,
 *  - what *kind* of selection that is (image / ink / text / shape / many),
 *  - the selection's bounding box in **scene** coordinates and the same box
 *    converted to **client (viewport)** coordinates,
 *  - whether a modal editor state (text editing, cropping, an open dialog, a
 *    gesture still in progress) should suppress the menu entirely.
 *
 * ## Why this is not just `useState` in a change handler
 *
 * `onChange` fires on *every* pointer move while dragging, on every zoom
 * tick, and on plenty of state changes that do not move the selection at
 * all. Two things keep that from thrashing React:
 *
 *  1. **rAF coalescing** — handlers only stash the latest snapshot in a ref
 *     and schedule one recompute per animation frame, so a burst of pointer
 *     events costs one derivation, not twenty.
 *  2. **Signature equality** — the derived value is committed only when a
 *     cheap string signature (ids + kind + box rounded to half a pixel +
 *     summed element versions + theme) actually changed. A selection that
 *     sits still produces a *stable object identity* across any number of
 *     `onChange` calls, so consumers can safely put it in dependency arrays.
 */

import { sceneCoordsToViewportCoords } from "@excalidraw/common";
import { getCommonBounds, getSelectedElements } from "@excalidraw/element";
import { useCallback, useEffect, useRef, useState } from "react";

import type { Bounds } from "@excalidraw/common";
import type {
  ExcalidrawElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

/** The kinds of selection the menu knows how to build a bar for. */
export type ObjectSelectionKind =
  | "image"
  | "freedraw"
  | "text"
  | "shape"
  | /** a single element of a type with no type-specific actions */ "other"
  | "multiple";

/** Element types treated as "shape" (fill + stroke are both meaningful). */
const SHAPE_TYPES = new Set<ExcalidrawElement["type"]>([
  "rectangle",
  "diamond",
  "ellipse",
]);

/** The viewport transform the box was projected with. */
export interface SelectionViewport {
  scrollX: number;
  scrollY: number;
  zoom: number;
  offsetLeft: number;
  offsetTop: number;
  width: number;
  height: number;
}

/** An axis-aligned rectangle in client (viewport) pixels. */
export interface ViewportRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface ObjectSelection {
  kind: ObjectSelectionKind;
  /** Selected, non-deleted elements. Never empty. */
  elements: readonly NonDeletedExcalidrawElement[];
  /** The lone selected element, or `null` for a multi-selection. */
  element: NonDeletedExcalidrawElement | null;
  ids: readonly string[];
  /** `[x1, y1, x2, y2]` in scene coordinates (rotation included). */
  sceneBounds: Bounds;
  /**
   * The same box in client coordinates — i.e. what `getBoundingClientRect()`
   * would report — so a `position: fixed` menu can use it directly.
   */
  viewportBounds: ViewportRect;
  viewport: SelectionViewport;
  theme: "light" | "dark";
  /** A drag / resize / rotate is in flight. The menu still tracks it. */
  interacting: boolean;
}

/**
 * Reasons the menu must stay out of the way even though something is
 * selected. Returning `null` from the hook for these keeps the decision in
 * one place instead of scattering it through the component.
 */
const isSuppressedByEditorState = (appState: AppState): boolean =>
  !!appState.editingTextElement ||
  !!appState.croppingElementId ||
  !!appState.newElement ||
  !!appState.selectedLinearElement?.isEditing ||
  !!appState.openDialog ||
  appState.viewModeEnabled ||
  appState.isLoading;

const deriveKind = (
  elements: readonly NonDeletedExcalidrawElement[],
): ObjectSelectionKind => {
  if (elements.length > 1) {
    return "multiple";
  }
  const { type } = elements[0];
  if (type === "image") {
    return "image";
  }
  if (type === "freedraw") {
    return "freedraw";
  }
  if (type === "text") {
    return "text";
  }
  if (SHAPE_TYPES.has(type)) {
    return "shape";
  }
  return "other";
};

/** Half-pixel rounding: enough to drop jitter, fine enough to track a drag. */
const q = (value: number) => Math.round(value * 2) / 2;

const signatureOf = (selection: ObjectSelection | null): string => {
  if (!selection) {
    return "none";
  }
  const { viewportBounds: b } = selection;
  let versions = 0;
  for (const element of selection.elements) {
    versions += element.version;
  }
  return [
    selection.kind,
    selection.ids.join(","),
    `${q(b.x1)}:${q(b.y1)}:${q(b.x2)}:${q(b.y2)}`,
    versions,
    selection.theme,
    selection.interacting ? 1 : 0,
  ].join("|");
};

const deriveSelection = (
  elements: readonly ExcalidrawElement[],
  appState: AppState,
): ObjectSelection | null => {
  if (isSuppressedByEditorState(appState)) {
    return null;
  }

  const selected = getSelectedElements(elements, appState, {
    includeBoundTextElement: false,
    includeElementsInFrames: false,
  });

  if (!selected.length) {
    return null;
  }

  const sceneBounds = getCommonBounds(selected);
  const [x1, y1, x2, y2] = sceneBounds;

  const viewport: SelectionViewport = {
    scrollX: appState.scrollX,
    scrollY: appState.scrollY,
    zoom: appState.zoom.value,
    offsetLeft: appState.offsetLeft,
    offsetTop: appState.offsetTop,
    width: appState.width,
    height: appState.height,
  };

  const topLeft = sceneCoordsToViewportCoords(
    { sceneX: x1, sceneY: y1 },
    appState,
  );
  const bottomRight = sceneCoordsToViewportCoords(
    { sceneX: x2, sceneY: y2 },
    appState,
  );

  return {
    kind: deriveKind(selected),
    elements: selected,
    element: selected.length === 1 ? selected[0] : null,
    ids: selected.map((element) => element.id),
    sceneBounds,
    viewportBounds: {
      x1: topLeft.x,
      y1: topLeft.y,
      x2: bottomRight.x,
      y2: bottomRight.y,
    },
    viewport,
    theme: appState.theme === "dark" ? "dark" : "light",
    interacting:
      appState.selectedElementsAreBeingDragged ||
      !!appState.resizingElement ||
      !!appState.isRotating,
  };
};

/**
 * Subscribes to the editor and reports the current selection, or `null` when
 * there is nothing to act on. The returned object is referentially stable
 * until the selection, its bounding box, its styles or the theme change.
 */
export const useSelectedElements = (
  excalidrawAPI: ExcalidrawImperativeAPI | null,
): ObjectSelection | null => {
  const [selection, setSelection] = useState<ObjectSelection | null>(null);
  const signatureRef = useRef<string>("none");
  const frameRef = useRef<number | null>(null);
  const latestRef = useRef<{
    elements: readonly ExcalidrawElement[];
    appState: AppState;
  } | null>(null);

  const commit = useCallback(() => {
    frameRef.current = null;
    const latest = latestRef.current;
    if (!latest) {
      return;
    }
    const next = deriveSelection(latest.elements, latest.appState);
    const signature = signatureOf(next);
    if (signature === signatureRef.current) {
      return;
    }
    signatureRef.current = signature;
    setSelection(next);
  }, []);

  const schedule = useCallback(
    (elements: readonly ExcalidrawElement[], appState: AppState) => {
      latestRef.current = { elements, appState };
      if (frameRef.current !== null) {
        return;
      }
      frameRef.current =
        typeof requestAnimationFrame === "function"
          ? requestAnimationFrame(commit)
          : (setTimeout(commit, 16) as unknown as number);
    },
    [commit],
  );

  useEffect(() => {
    if (!excalidrawAPI) {
      signatureRef.current = "none";
      setSelection(null);
      return;
    }

    // `onChange` does not fire on subscribe, so seed from the live scene.
    schedule(excalidrawAPI.getSceneElements(), excalidrawAPI.getAppState());

    const unsubscribe = excalidrawAPI.onChange((elements, appState) => {
      schedule(elements, appState);
    });

    return () => {
      unsubscribe();
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [excalidrawAPI, schedule]);

  // The box is in client coordinates, so a window resize or a page scroll
  // moves it without the scene changing. Excalidraw recomputes its own
  // offsets on resize (which fires `onChange`), but a page-level scroll does
  // not reach the editor at all — re-derive from the live scene for both.
  useEffect(() => {
    if (!excalidrawAPI) {
      return;
    }
    const reread = () => {
      schedule(excalidrawAPI.getSceneElements(), excalidrawAPI.getAppState());
    };
    window.addEventListener("resize", reread);
    window.addEventListener("scroll", reread, true);
    return () => {
      window.removeEventListener("resize", reread);
      window.removeEventListener("scroll", reread, true);
    };
  }, [excalidrawAPI, schedule]);

  return selection;
};
