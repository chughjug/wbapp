/**
 * The callback-shaped entry point a bar or a menu can call.
 *
 * ```tsx
 * const math = useMathDialog(excalidrawAPI);
 *
 * <NavBar insertItems={[{ id: "equation", label: "Insert equation…", onSelect: math.open }]} />
 * {math.dialog}
 * ```
 *
 * `open()` starts a new equation, `open(spec)` starts from one, and
 * `editSelected()` reopens whichever equation is selected (returning
 * `false` when the selection is not one of ours, so a menu can hide the
 * item).
 */

import React, { useCallback, useMemo, useState } from "react";

import type { ExcalidrawImageElement } from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { MathDialog } from "./MathDialog";
import { getMathSpec, getSelectedMathElement } from "./insertMath";

import type { InsertMathResult } from "./insertMath";
import type { MathSpec } from "./spec";

export interface UseMathDialogOptions {
  onInserted?: (result: InsertMathResult) => void;
  theme?: "light" | "dark";
}

export interface MathDialogController {
  isOpen: boolean;
  open: (spec?: MathSpec) => void;
  openForElement: (element: ExcalidrawImageElement) => boolean;
  editSelected: () => boolean;
  close: () => void;
  /** Render this somewhere in the tree — it portals to `document.body`. */
  dialog: React.ReactNode;
}

export const useMathDialog = (
  excalidrawAPI: ExcalidrawImperativeAPI | null,
  options: UseMathDialogOptions = {},
): MathDialogController => {
  const [state, setState] = useState<{
    spec?: MathSpec;
    element: ExcalidrawImageElement | null;
  } | null>(null);

  const close = useCallback(() => setState(null), []);

  const open = useCallback((spec?: MathSpec) => {
    setState({ spec, element: null });
  }, []);

  const openForElement = useCallback((element: ExcalidrawImageElement) => {
    const spec = getMathSpec(element);
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
    const element = getSelectedMathElement(excalidrawAPI);
    return element ? openForElement(element) : false;
  }, [excalidrawAPI, openForElement]);

  const { onInserted, theme } = options;

  const dialog = useMemo(() => {
    if (!state || !excalidrawAPI) {
      return null;
    }
    return (
      <MathDialog
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
