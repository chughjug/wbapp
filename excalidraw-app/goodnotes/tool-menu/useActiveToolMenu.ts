/**
 * Keeps the floating panel in step with the editor's *real* active tool.
 *
 * The source of truth is `appState.activeTool` (plus the highlighter marker in
 * `appState.currentItemCustomData`), read through the public
 * `ExcalidrawImperativeAPI.onChange` subscription. That is deliberate: it means
 * the panel follows keyboard tool switches (`p`, `e`, `r`, `t`, …), undo/redo,
 * and tool changes made by any other GoodNotes module, not just taps on the
 * nav bar.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { activateTool, toolFromAppState } from "./editor";

import type { ToolMenuShapeId, ToolMenuToolId } from "./editor";
import type { ToolMenuProps } from "./ToolMenu";

export interface UseActiveToolMenuOptions {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  /**
   * Open the panel by itself whenever the editor's tool changes to one the
   * panel supports (including keyboard switches). Defaults to `true` — that is
   * the whole "selecting a tool opens its settings" concept.
   */
  openOnToolChange?: boolean;
  /** Never open. Useful while a modal dialog is up. */
  disabled?: boolean;
}

export interface ActiveToolMenuController {
  /** The editor's current tool, mapped to a panel identity (`null` = unsupported). */
  tool: ToolMenuToolId | null;
  /** Whether the panel is currently shown. */
  isOpen: boolean;
  /**
   * Imperative open. With no `tool` it opens on whatever the editor is already
   * using; with one, it also activates that tool in the editor.
   * `trigger` is the element focus returns to when the panel closes.
   */
  open: (
    tool?: ToolMenuToolId,
    options?: { trigger?: HTMLElement | null; shape?: ToolMenuShapeId },
  ) => void;
  /** Imperative close. Returns focus to the trigger that opened the panel. */
  close: () => void;
  /** Open if closed, close if open on the same tool. */
  toggle: (
    tool?: ToolMenuToolId,
    options?: { trigger?: HTMLElement | null; shape?: ToolMenuShapeId },
  ) => void;
  /**
   * Callback-shaped entry point for a nav bar: hand it straight to a tool
   * button's `onClick`. It activates the tool in the editor and opens the
   * panel; tapping the already-active tool again closes it, the way a
   * GoodNotes tool button behaves.
   */
  onToolSelect: (
    tool: ToolMenuToolId,
    event?: { currentTarget?: HTMLElement | null } | HTMLElement | null,
  ) => void;
  /** Spread straight onto `<ToolMenu {...menuProps} />`. */
  menuProps: Pick<
    ToolMenuProps,
    "excalidrawAPI" | "open" | "tool" | "onClose" | "onToolChange"
  >;
}

const triggerFrom = (
  source?: { currentTarget?: HTMLElement | null } | HTMLElement | null,
): HTMLElement | null => {
  if (!source) {
    return null;
  }
  if (source instanceof HTMLElement) {
    return source;
  }
  return source.currentTarget ?? null;
};

export const useActiveToolMenu = ({
  excalidrawAPI,
  openOnToolChange = true,
  disabled = false,
}: UseActiveToolMenuOptions): ActiveToolMenuController => {
  const [tool, setTool] = useState<ToolMenuToolId | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);
  const openOnToolChangeRef = useRef(openOnToolChange);
  openOnToolChangeRef.current = openOnToolChange;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  // follow the editor's real tool
  useEffect(() => {
    if (!excalidrawAPI || excalidrawAPI.isDestroyed) {
      return;
    }
    let previous = toolFromAppState(excalidrawAPI.getAppState());
    setTool(previous);
    return excalidrawAPI.onChange((_elements, appState) => {
      const next = toolFromAppState(appState);
      if (next === previous) {
        return;
      }
      previous = next;
      setTool(next);
      if (next === null) {
        // selection / hand / frame / … — nothing honest to show
        setIsOpen(false);
      } else if (openOnToolChangeRef.current && !disabledRef.current) {
        setIsOpen(true);
      }
    });
  }, [excalidrawAPI]);

  useEffect(() => {
    if (disabled) {
      setIsOpen(false);
    }
  }, [disabled]);

  const close = useCallback(() => {
    setIsOpen((wasOpen) => {
      if (wasOpen) {
        const trigger = triggerRef.current;
        if (trigger && trigger.isConnected) {
          // focus must not be left on a node that is about to unmount
          trigger.focus();
        }
      }
      return false;
    });
  }, []);

  const open = useCallback<ActiveToolMenuController["open"]>(
    (nextTool, options) => {
      if (disabledRef.current) {
        return;
      }
      if (options?.trigger !== undefined) {
        triggerRef.current = options.trigger;
      }
      if (nextTool) {
        activateTool(excalidrawAPI, nextTool, { shape: options?.shape });
        setTool(nextTool);
      }
      setIsOpen(true);
    },
    [excalidrawAPI],
  );

  const toggle = useCallback<ActiveToolMenuController["toggle"]>(
    (nextTool, options) => {
      if (isOpen && (!nextTool || nextTool === tool)) {
        close();
        return;
      }
      open(nextTool, options);
    },
    [close, isOpen, open, tool],
  );

  const onToolSelect = useCallback<ActiveToolMenuController["onToolSelect"]>(
    (nextTool, source) => {
      const trigger = triggerFrom(source);
      if (isOpen && nextTool === tool) {
        close();
        return;
      }
      open(nextTool, { trigger });
    },
    [close, isOpen, open, tool],
  );

  const onToolChange = useCallback((nextTool: ToolMenuToolId) => {
    setTool(nextTool);
  }, []);

  return {
    tool,
    isOpen: isOpen && tool !== null && !disabled,
    open,
    close,
    toggle,
    onToolSelect,
    menuProps: {
      excalidrawAPI,
      open: isOpen && tool !== null && !disabled,
      tool,
      onClose: close,
      onToolChange,
    },
  };
};

export default useActiveToolMenu;
