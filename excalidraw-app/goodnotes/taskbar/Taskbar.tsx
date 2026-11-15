/**
 * The GoodNotes taskbar: one centred bar at the top of the editor that owns
 * every primary action, replacing Excalidraw's scattered default chrome.
 *
 * Design notes live next to the code they explain; the short version:
 *
 * - **One bar, four groups.** Tools / image / document / pages, separated by
 *   hairlines rather than boxes, so the bar reads as a single object.
 * - **The bar owns the shell, never the behaviour.** Fuzzy select, PDF import
 *   and image backdrops arrive as optional callbacks; their controls simply do
 *   not exist until a callback is passed. The taskbar can therefore ship and
 *   be reviewed before those features land.
 * - **Overflow, never wrap.** A hidden measuring copy of the bar gives real
 *   widths, and controls move into a "More" menu in ascending priority until
 *   the bar fits. The visible bar is never wider than its container.
 * - **It is a real toolbar.** `role="toolbar"`, one tab stop, arrow keys to
 *   move within it, `aria-pressed` on the tool toggles, `aria-haspopup` on the
 *   two menus.
 */

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  AddPageIcon,
  ArrowIcon,
  BackdropIcon,
  DiamondIcon,
  EllipseIcon,
  EraserIcon,
  ExportPdfIcon,
  FuzzySelectIcon,
  HighlighterIcon,
  ImageIcon,
  ImportPdfIcon,
  LineIcon,
  MoreIcon,
  PenIcon,
  RectangleIcon,
  SelectIcon,
  ShapesIcon,
  TextIcon,
} from "./icons";
import { TaskbarMenu } from "./Menu";
import { LAYOUT, planOverflow } from "./model";
import { activateTool, toolFromAppState } from "./tools";

import "./Taskbar.scss";

import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import type { PenPreset } from "../types";

import type { TaskbarMenuSection } from "./Menu";
import type {
  TaskbarControl,
  TaskbarGroupId,
  TaskbarShapeId,
  TaskbarToolId,
} from "./model";

/** Body class that hides Excalidraw's own top shape toolbar. See INTEGRATION.md. */
export const SUPPRESS_DEFAULT_TOOLBAR_CLASS = "gn-taskbar-suppress-default-ui";

const SHAPE_ITEMS: { id: TaskbarShapeId; label: string; icon: ReactNode }[] = [
  { id: "rectangle", label: "Rectangle", icon: <RectangleIcon /> },
  { id: "ellipse", label: "Ellipse", icon: <EllipseIcon /> },
  { id: "diamond", label: "Diamond", icon: <DiamondIcon /> },
  { id: "arrow", label: "Arrow", icon: <ArrowIcon /> },
  { id: "line", label: "Line", icon: <LineIcon /> },
];

const GROUP_LABEL: Record<TaskbarGroupId, string> = {
  tools: "Tools",
  image: "Image",
  document: "Document",
  pages: "Pages",
};

export interface TaskbarProps {
  /**
   * The editor to drive. `null` is fine (the bar renders disabled-ish and
   * no-ops) so you can render it before `excalidrawAPI` resolves.
   */
  excalidrawAPI: ExcalidrawImperativeAPI | null;

  /**
   * Theme for the bar's own colours. Defaults to the editor's current theme,
   * read from `appState`. Pass it explicitly if you theme the app yourself.
   */
  theme?: "light" | "dark";

  // ---- injected features (owned by other modules) -------------------------

  /**
   * Lasso / smart selection aimed at images. Omit and the control is not
   * rendered at all; pass `fuzzySelectDisabled` to render it greyed instead
   * (useful while the feature is loading).
   */
  onFuzzySelect?: () => void;
  fuzzySelectDisabled?: boolean;
  /** Reflected as `aria-pressed` if fuzzy select is a mode rather than a one-shot. */
  fuzzySelectActive?: boolean;

  /** Open the PDF import flow. Control hidden when absent. */
  onImportPdf?: () => void;
  importPdfDisabled?: boolean;

  /** Open the PDF export flow (e.g. `goodnotes/export`'s dialog). Hidden when absent. */
  onExportPdf?: () => void;
  exportPdfDisabled?: boolean;

  /** Open the custom-image-backdrop picker. Hidden when absent. */
  onOpenBackdrops?: () => void;
  backdropsDisabled?: boolean;
  /** Reflected as `aria-pressed` when the backdrop panel is open. */
  backdropsActive?: boolean;

  // ---- pages --------------------------------------------------------------

  /** Append a page. Control hidden when absent. */
  onAddPage?: () => void;
  addPageDisabled?: boolean;
  /** Total pages; with `currentPage`, renders the "3 / 12" indicator. */
  pageCount?: number;
  /** 1-based page currently in view. */
  currentPage?: number;

  // ---- tool state ---------------------------------------------------------

  /**
   * Controlled active slot. Leave undefined to let the bar track the editor
   * itself (it subscribes to `onChange` and mirrors `appState.activeTool`).
   */
  activeTool?: TaskbarToolId | null;
  /** Fired after the editor has been switched, for hosts that mirror state. */
  onToolChange?: (tool: TaskbarToolId, shape?: TaskbarShapeId) => void;

  /** Ink used by the pen slot. Defaults to a medium black freedraw. */
  penPreset?: PenPreset;
  /** Ink used by the highlighter slot. Defaults to 40% yellow, bold. */
  highlighterPreset?: PenPreset;

  // ---- presentation -------------------------------------------------------

  /**
   * Add/remove {@link SUPPRESS_DEFAULT_TOOLBAR_CLASS} on `<body>` while
   * mounted, which hides Excalidraw's built-in shapes toolbar. Default `false`
   * — opt in once you are happy the taskbar covers what you need.
   */
  suppressDefaultToolbar?: boolean;
  /** Accessible name of the toolbar. Default `"Note tools"`. */
  ariaLabel?: string;
  /** Show text labels beside icons where room allows. Default `false`. */
  showLabels?: boolean;
  className?: string;
}

const useLatest = <T,>(value: T) => {
  const ref = useRef(value);
  ref.current = value;
  return ref;
};

export const Taskbar = ({
  excalidrawAPI,
  theme,
  onFuzzySelect,
  fuzzySelectDisabled,
  fuzzySelectActive,
  onImportPdf,
  importPdfDisabled,
  onExportPdf,
  exportPdfDisabled,
  onOpenBackdrops,
  backdropsDisabled,
  backdropsActive,
  onAddPage,
  addPageDisabled,
  pageCount,
  currentPage,
  activeTool: controlledTool,
  onToolChange,
  penPreset,
  highlighterPreset,
  suppressDefaultToolbar = false,
  ariaLabel = "Note tools",
  showLabels = false,
  className,
}: TaskbarProps) => {
  const reactId = useId().replace(/:/g, "");
  const barRef = useRef<HTMLDivElement | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());

  const [internalTool, setInternalTool] = useState<TaskbarToolId | null>(
    "select",
  );
  const [activeShape, setActiveShape] = useState<TaskbarShapeId>("rectangle");
  const [openMenu, setOpenMenu] = useState<"shapes" | "more" | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [widths, setWidths] = useState<Map<string, number>>(new Map());
  const [moreWidth, setMoreWidth] = useState(0);
  const [editorTheme, setEditorTheme] = useState<"light" | "dark">("light");

  const activeTool =
    controlledTool === undefined ? internalTool : controlledTool;

  // ---- editor sync --------------------------------------------------------

  const onToolChangeRef = useLatest(onToolChange);

  useEffect(() => {
    if (!excalidrawAPI || excalidrawAPI.isDestroyed) {
      return;
    }
    const sync = () => {
      const appState = excalidrawAPI.getAppState();
      setEditorTheme(appState.theme === "dark" ? "dark" : "light");
      const mapped = toolFromAppState(appState as any);
      setInternalTool(mapped.tool);
      if (mapped.shape) {
        setActiveShape(mapped.shape);
      }
    };
    sync();
    // mirrors tool changes made outside the bar (keyboard shortcuts, Escape,
    // the pen tray) so `aria-pressed` never lies
    return excalidrawAPI.onChange(sync);
  }, [excalidrawAPI]);

  const selectTool = useCallback(
    (tool: TaskbarToolId, shape?: TaskbarShapeId) => {
      if (tool === "shape" && shape) {
        setActiveShape(shape);
      }
      activateTool(excalidrawAPI, tool, {
        pen: penPreset,
        highlighter: highlighterPreset,
        shape: tool === "shape" ? shape ?? activeShape : undefined,
      });
      setInternalTool(tool);
      onToolChangeRef.current?.(tool, tool === "shape" ? shape : undefined);
    },
    [excalidrawAPI, penPreset, highlighterPreset, activeShape, onToolChangeRef],
  );

  // ---- control model ------------------------------------------------------

  const controls = useMemo<TaskbarControl[]>(() => {
    const list: TaskbarControl[] = [];

    const tool = (
      id: TaskbarToolId,
      label: string,
      icon: ReactNode,
      shortcut: string,
      priority: number,
    ): TaskbarControl => ({
      id,
      group: "tools",
      label,
      icon,
      kind: "toggle",
      pressed: activeTool === id,
      shortcut,
      inlineText: label,
      priority,
      onSelect: () => selectTool(id),
    });

    list.push(tool("select", "Select", <SelectIcon />, "V", 100));

    if (onFuzzySelect) {
      list.push({
        id: "fuzzy-select",
        group: "tools",
        label: "Fuzzy select",
        description: "Smart selection for images",
        icon: <FuzzySelectIcon />,
        kind: fuzzySelectActive === undefined ? "action" : "toggle",
        pressed: fuzzySelectActive,
        disabled: fuzzySelectDisabled,
        inlineText: "Fuzzy",
        priority: 55,
        onSelect: onFuzzySelect,
      });
    }

    list.push(tool("pen", "Pen", <PenIcon />, "P", 99));
    list.push(tool("highlighter", "Highlighter", <HighlighterIcon />, "H", 95));
    list.push(tool("eraser", "Eraser", <EraserIcon />, "E", 94));

    list.push({
      id: "shape",
      group: "tools",
      label: "Shapes",
      description: `Current shape: ${
        SHAPE_ITEMS.find((s) => s.id === activeShape)?.label ?? "rectangle"
      }`,
      icon: <ShapesIcon />,
      kind: "menu",
      pressed: activeTool === "shape",
      inlineText: "Shapes",
      priority: 70,
      items: SHAPE_ITEMS.map((shape) => ({
        id: shape.id,
        label: shape.label,
        icon: shape.icon,
        checked: activeTool === "shape" && activeShape === shape.id,
        onSelect: () => selectTool("shape", shape.id),
      })),
    });

    list.push(tool("text", "Text", <TextIcon />, "T", 80));
    list.push(tool("image", "Image", <ImageIcon />, "9", 60));

    if (onOpenBackdrops) {
      list.push({
        id: "backdrops",
        group: "image",
        label: "Image backdrop",
        description: "Choose a custom backdrop for the selected image",
        icon: <BackdropIcon />,
        kind: backdropsActive === undefined ? "action" : "toggle",
        pressed: backdropsActive,
        disabled: backdropsDisabled,
        inlineText: "Backdrop",
        priority: 40,
        onSelect: onOpenBackdrops,
      });
    }

    if (onImportPdf) {
      list.push({
        id: "import-pdf",
        group: "document",
        label: "Import PDF",
        icon: <ImportPdfIcon />,
        kind: "action",
        disabled: importPdfDisabled,
        inlineText: "Import",
        priority: 20,
        onSelect: onImportPdf,
      });
    }

    if (onExportPdf) {
      list.push({
        id: "export-pdf",
        group: "document",
        label: "Export to PDF",
        icon: <ExportPdfIcon />,
        kind: "action",
        disabled: exportPdfDisabled,
        inlineText: "Export",
        priority: 30,
        onSelect: onExportPdf,
      });
    }

    if (onAddPage) {
      list.push({
        id: "add-page",
        group: "pages",
        label: "Add page",
        icon: <AddPageIcon />,
        kind: "action",
        disabled: addPageDisabled,
        inlineText: "Add page",
        priority: 50,
        onSelect: onAddPage,
      });
    }

    if (typeof pageCount === "number" && pageCount > 0) {
      const current = currentPage ?? 1;
      list.push({
        id: "page-indicator",
        group: "pages",
        label: `Page ${current} of ${pageCount}`,
        icon: null,
        kind: "status",
        inlineText: `${current} / ${pageCount}`,
        priority: 10,
      });
    }

    return list;
  }, [
    activeTool,
    activeShape,
    selectTool,
    onFuzzySelect,
    fuzzySelectActive,
    fuzzySelectDisabled,
    onOpenBackdrops,
    backdropsActive,
    backdropsDisabled,
    onImportPdf,
    importPdfDisabled,
    onExportPdf,
    exportPdfDisabled,
    onAddPage,
    addPageDisabled,
    pageCount,
    currentPage,
  ]);

  // ---- measurement & overflow --------------------------------------------

  // The ghost is a visibility:hidden copy of every control at its natural
  // width. Measuring it (rather than the live bar) means a control's width is
  // known even while it sits in the More menu, so the bar can expand again.
  useLayoutEffect(() => {
    const ghost = ghostRef.current;
    if (!ghost) {
      return;
    }
    const next = new Map<string, number>();
    ghost.querySelectorAll<HTMLElement>("[data-gn-measure]").forEach((node) => {
      const id = node.dataset.gnMeasure!;
      const width = node.getBoundingClientRect().width;
      if (id === "__more__") {
        setMoreWidth(width);
      } else {
        next.set(id, width);
      }
    });
    setWidths(next);
  }, [controls, showLabels]);

  useLayoutEffect(() => {
    const node = barRef.current?.parentElement;
    if (!node || typeof ResizeObserver === "undefined") {
      setAvailableWidth(node?.getBoundingClientRect().width ?? 0);
      return;
    }
    const observer = new ResizeObserver((entries) => {
      setAvailableWidth(entries[0].contentRect.width);
    });
    observer.observe(node);
    setAvailableWidth(node.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  const { visible, overflow } = useMemo(
    () => planOverflow(controls, widths, moreWidth, availableWidth),
    [controls, widths, moreWidth, availableWidth],
  );

  // a menu whose trigger just overflowed must not stay open
  useEffect(() => {
    if (openMenu === "shapes" && !visible.some((c) => c.id === "shape")) {
      setOpenMenu(null);
    }
    if (openMenu === "more" && overflow.length === 0) {
      setOpenMenu(null);
    }
  }, [openMenu, visible, overflow.length]);

  // ---- roving tabindex ----------------------------------------------------

  const moreId = `${reactId}-more`;

  /** Ids that take focus, in visual order. Status text is excluded. */
  const focusOrder = useMemo(() => {
    const ids = visible
      .filter((c) => c.kind !== "status" && !c.disabled)
      .map((c) => c.id);
    if (overflow.length) {
      ids.push(moreId);
    }
    return ids;
  }, [visible, overflow.length, moreId]);

  const activeFocusId =
    focusId && focusOrder.includes(focusId) ? focusId : focusOrder[0] ?? null;

  const moveFocus = useCallback(
    (delta: number | "first" | "last") => {
      if (!focusOrder.length) {
        return;
      }
      const index = activeFocusId ? focusOrder.indexOf(activeFocusId) : 0;
      let next: number;
      if (delta === "first") {
        next = 0;
      } else if (delta === "last") {
        next = focusOrder.length - 1;
      } else {
        next = (index + delta + focusOrder.length) % focusOrder.length;
      }
      const id = focusOrder[next];
      setFocusId(id);
      buttonRefs.current.get(id)?.focus();
    },
    [focusOrder, activeFocusId],
  );

  const onToolbarKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (openMenu) {
      return; // the open menu owns the keyboard
    }
    switch (event.key) {
      case "ArrowRight":
        event.preventDefault();
        moveFocus(1);
        break;
      case "ArrowLeft":
        event.preventDefault();
        moveFocus(-1);
        break;
      case "Home":
        event.preventDefault();
        moveFocus("first");
        break;
      case "End":
        event.preventDefault();
        moveFocus("last");
        break;
      default:
        break;
    }
  };

  // ---- default-chrome suppression ----------------------------------------

  useEffect(() => {
    if (!suppressDefaultToolbar || typeof document === "undefined") {
      return;
    }
    document.body.classList.add(SUPPRESS_DEFAULT_TOOLBAR_CLASS);
    return () => document.body.classList.remove(SUPPRESS_DEFAULT_TOOLBAR_CLASS);
  }, [suppressDefaultToolbar]);

  // ---- rendering ----------------------------------------------------------

  const registerRef = (id: string) => (node: HTMLButtonElement | null) => {
    if (node) {
      buttonRefs.current.set(id, node);
    } else {
      buttonRefs.current.delete(id);
    }
  };

  const renderControl = (control: TaskbarControl, measuring: boolean) => {
    const describedById = control.description
      ? `${reactId}-${control.id}-desc`
      : undefined;

    if (control.kind === "status") {
      return (
        <span
          key={control.id}
          className="gn-taskbar__status"
          data-gn-measure={measuring ? control.id : undefined}
          aria-live={measuring ? undefined : "polite"}
        >
          <span className="gn-taskbar__sr">{control.label}</span>
          <span aria-hidden="true">{control.inlineText}</span>
        </span>
      );
    }

    const isMenu = control.kind === "menu";
    const expanded = isMenu && openMenu === "shapes";
    const buttonId = `${reactId}-${control.id}`;

    return (
      <div
        key={control.id}
        className="gn-taskbar__slot"
        data-gn-measure={measuring ? control.id : undefined}
      >
        <button
          id={measuring ? undefined : buttonId}
          ref={measuring ? undefined : registerRef(control.id)}
          type="button"
          className="gn-taskbar__button"
          data-control={control.id}
          data-kind={control.kind}
          disabled={control.disabled}
          tabIndex={measuring ? -1 : activeFocusId === control.id ? 0 : -1}
          aria-pressed={
            control.kind === "toggle" || isMenu ? !!control.pressed : undefined
          }
          aria-haspopup={isMenu ? "menu" : undefined}
          aria-expanded={isMenu ? expanded : undefined}
          aria-controls={isMenu && expanded ? `${reactId}-shapes` : undefined}
          aria-describedby={describedById}
          title={
            control.shortcut
              ? `${control.label} (${control.shortcut})`
              : control.label
          }
          onFocus={() => !measuring && setFocusId(control.id)}
          onClick={() => {
            if (measuring) {
              return;
            }
            setFocusId(control.id);
            if (isMenu) {
              setOpenMenu((open) => (open === "shapes" ? null : "shapes"));
              return;
            }
            setOpenMenu(null);
            control.onSelect?.();
          }}
        >
          {control.icon}
          <span className={showLabels ? "gn-taskbar__text" : "gn-taskbar__sr"}>
            {control.label}
          </span>
          {isMenu && <span className="gn-taskbar__caret" aria-hidden="true" />}
        </button>
        {describedById && (
          <span id={describedById} className="gn-taskbar__sr">
            {control.description}
          </span>
        )}
        {!measuring && isMenu && expanded && control.items && (
          <TaskbarMenu
            id={`${reactId}-shapes`}
            labelledBy={buttonId}
            radio
            sections={[{ id: "shapes", items: control.items }]}
            onClose={(opts) => {
              setOpenMenu(null);
              if (opts?.restoreFocus !== false) {
                buttonRefs.current.get(control.id)?.focus();
              }
            }}
          />
        )}
      </div>
    );
  };

  /** Interleave hairline separators at group boundaries. */
  const withSeparators = (list: TaskbarControl[], measuring: boolean) => {
    const nodes: ReactNode[] = [];
    let previousGroup: TaskbarGroupId | null = null;
    for (const control of list) {
      if (previousGroup !== null && control.group !== previousGroup) {
        nodes.push(
          <span
            key={`sep-${control.id}`}
            className="gn-taskbar__separator"
            role="separator"
            aria-orientation="vertical"
          />,
        );
      }
      nodes.push(renderControl(control, measuring));
      previousGroup = control.group;
    }
    return nodes;
  };

  const overflowSections = useMemo<TaskbarMenuSection[]>(() => {
    const sections: TaskbarMenuSection[] = [];
    for (const group of ["tools", "image", "document", "pages"] as const) {
      const inGroup = overflow.filter(
        (c) => c.group === group && c.kind !== "status",
      );
      if (!inGroup.length) {
        continue;
      }
      sections.push({
        id: group,
        label: GROUP_LABEL[group],
        items: inGroup.flatMap((control) =>
          control.items
            ? control.items.map((item) => ({
                ...item,
                id: `${control.id}-${item.id}`,
              }))
            : [
                {
                  id: control.id,
                  label: control.label,
                  icon: control.icon,
                  checked: control.pressed,
                  disabled: control.disabled,
                  onSelect: () => control.onSelect?.(),
                },
              ],
        ),
      });
    }
    const status = overflow.filter((c) => c.kind === "status");
    if (status.length) {
      sections.push({
        id: "status",
        label: "Position",
        items: status.map((control) => ({
          id: control.id,
          label: control.label,
          disabled: true,
          onSelect: () => {},
        })),
      });
    }
    return sections;
  }, [overflow]);

  const resolvedTheme = theme ?? editorTheme;

  return (
    <div
      className={`gn-taskbar-scope excalidraw${
        resolvedTheme === "dark" ? " theme--dark" : ""
      }${className ? ` ${className}` : ""}`}
      data-testid="goodnotes-taskbar"
    >
      <div
        ref={barRef}
        className="gn-taskbar"
        role="toolbar"
        aria-label={ariaLabel}
        aria-orientation="horizontal"
        onKeyDown={onToolbarKeyDown}
      >
        {withSeparators(visible, false)}

        {overflow.length > 0 && (
          <>
            <span
              className="gn-taskbar__separator"
              role="separator"
              aria-orientation="vertical"
            />
            <div className="gn-taskbar__slot">
              <button
                id={moreId}
                ref={registerRef(moreId)}
                type="button"
                className="gn-taskbar__button"
                data-control="more"
                tabIndex={activeFocusId === moreId ? 0 : -1}
                aria-haspopup="menu"
                aria-expanded={openMenu === "more"}
                aria-controls={
                  openMenu === "more" ? `${reactId}-more-menu` : undefined
                }
                title={`More (${overflow.length})`}
                onFocus={() => setFocusId(moreId)}
                onClick={() => {
                  setFocusId(moreId);
                  setOpenMenu((open) => (open === "more" ? null : "more"));
                }}
              >
                <MoreIcon />
                <span className="gn-taskbar__sr">
                  More tools, {overflow.length} hidden
                </span>
              </button>
              {openMenu === "more" && (
                <TaskbarMenu
                  id={`${reactId}-more-menu`}
                  labelledBy={moreId}
                  align="end"
                  sections={overflowSections}
                  onClose={(opts) => {
                    setOpenMenu(null);
                    if (opts?.restoreFocus !== false) {
                      buttonRefs.current.get(moreId)?.focus();
                    }
                  }}
                />
              )}
            </div>
          </>
        )}
      </div>

      {/* Measuring copy: inert + visibility:hidden, so it is out of the tab
          order and the accessibility tree but still has real layout. */}
      <div
        ref={ghostRef}
        className="gn-taskbar gn-taskbar--ghost"
        aria-hidden="true"
        inert
        style={{ gap: LAYOUT.gap }}
      >
        {withSeparators(controls, true)}
        <span className="gn-taskbar__slot" data-gn-measure="__more__">
          <span className="gn-taskbar__button">
            <MoreIcon />
          </span>
        </span>
      </div>
    </div>
  );
};

export default Taskbar;
