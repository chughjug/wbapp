/**
 * The callback-shaped entry point a nav bar / taskbar can call.
 *
 * ```tsx
 * const graph = useGraphDialog(excalidrawAPI);
 *
 * <NavBar onInsertGraph={graph.open} />
 * {graph.dialog}
 * ```
 *
 * `open()` starts a new graph, `open(spec)` starts from a spec, and
 * `editSelected()` re-opens whichever graph is selected (returning `false`
 * when the selection is not one of ours, so a menu can hide the item).
 */

import React, { useCallback, useMemo, useState } from "react";

import { GraphDialog } from "./GraphDialog";
import { getGraphSpec, getSelectedGraphElement } from "./insertGraph";

import type { GraphSpec } from "./spec";
import type { InsertGraphResult } from "./insertGraph";
import type { ExcalidrawImageElement } from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

export interface UseGraphDialogOptions {
  onInserted?: (result: InsertGraphResult) => void;
  theme?: "light" | "dark";
}

export interface GraphDialogController {
  /** True while the dialog is mounted. */
  isOpen: boolean;
  /** Open the insert dialog, optionally seeded with a spec. */
  open: (spec?: GraphSpec) => void;
  /** Open the dialog on an existing graph element. */
  openForElement: (element: ExcalidrawImageElement) => boolean;
  /** Re-edit the selected graph. Returns false when there isn't one. */
  editSelected: () => boolean;
  close: () => void;
  /** Render this somewhere in the tree — it portals to `document.body`. */
  dialog: React.ReactNode;
}

export const useGraphDialog = (
  excalidrawAPI: ExcalidrawImperativeAPI | null,
  options: UseGraphDialogOptions = {},
): GraphDialogController => {
  const [state, setState] = useState<{
    spec?: GraphSpec;
    element: ExcalidrawImageElement | null;
  } | null>(null);

  const close = useCallback(() => setState(null), []);

  const open = useCallback((spec?: GraphSpec) => {
    setState({ spec, element: null });
  }, []);

  const openForElement = useCallback((element: ExcalidrawImageElement) => {
    const spec = getGraphSpec(element);
    if (!spec) {
      return false;
    }
    setState({ spec, element });
    return true;
  }, []);

  const editSelected = useCallback(() => {
    if (!excalidrawAPI) {
      return false;
    }
    const element = getSelectedGraphElement(excalidrawAPI);
    return element ? openForElement(element) : false;
  }, [excalidrawAPI, openForElement]);

  const { onInserted, theme } = options;

  const dialog = useMemo(() => {
    if (!state || !excalidrawAPI) {
      return null;
    }
    return (
      <GraphDialog
        excalidrawAPI={excalidrawAPI}
        onClose={close}
        onInserted={onInserted}
        initialSpec={state.spec}
        editElement={state.element}
        theme={theme}
      />
    );
  }, [close, excalidrawAPI, onInserted, state, theme]);

  return {
    isOpen: state !== null,
    open,
    openForElement,
    editSelected,
    close,
    dialog,
  };
};
