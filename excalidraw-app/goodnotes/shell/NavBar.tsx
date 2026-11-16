/**
 * The GoodNotes shell's single navigation bar.
 *
 * ONE bar, THREE explicit zones — the whole point of this module is that the
 * editor has exactly one place to look for a control:
 *
 * ```
 * ┌ LEFT ────────────────────────┬ CENTRE ─────────────────┬ RIGHT ─────────┐
 * │ pages · search · Write/Read  │ tools only              │ actions · Share│
 * └──────────────────────────────┴─────────────────────────┴────────────────┘
 * ```
 *
 * - **LEFT** is "where am I / what am I doing": the page-panel toggle (with
 *   the page counter folded into it), the search field and the Write/Read
 *   segmented control.
 * - **CENTRE** is tools and nothing else — select, lasso, pen, highlighter,
 *   eraser │ shapes, text, image, sticky. No colours, no widths: tool
 *   *settings* belong to the floating Active Tool Menu, for which this bar
 *   only exposes the {@link NavBarProps.onActiveToolMenu} hook point.
 * - **RIGHT** is "do something to the document": undo/redo, import PDF, add
 *   page │ Share (primary) and a "…" overflow for the rest.
 *
 * Reused wholesale from the old taskbar (same files, now shared):
 * `../taskbar/tools` (the only place we touch `ExcalidrawImperativeAPI`),
 * `../taskbar/model` (the control model + the pure overflow solver) and
 * `../taskbar/icons`. The bar still mirrors the editor through an
 * `excalidrawAPI.onChange` subscription, so `aria-pressed` never lies when the
 * tool is changed by a keyboard shortcut or another surface.
 *
 * Accessibility contract:
 * - the centre cluster is a real `role="toolbar"`: one tab stop, roving
 *   tabindex, Arrow/Home/End navigation, `aria-pressed` on every toggle;
 * - the Write/Read control is a `role="radiogroup"` with arrow-key roving;
 * - every icon-only control has a text accessible name, and `:focus-visible`
 *   rings are visible in both themes;
 * - `prefers-reduced-motion: reduce` removes every transition.
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

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import {
  AddPageIcon,
  ArrowIcon,
  BackdropIcon,
  DiamondIcon,
  EllipseIcon,
  EraserIcon,
  ExportPdfIcon,
  HighlighterIcon,
  ImageIcon,
  ImportPdfIcon,
  LassoIcon,
  LineIcon,
  MoreIcon,
  PagesPanelIcon,
  PenIcon,
  ReadIcon,
  RectangleIcon,
  RedoIcon,
  SearchIcon,
  SelectIcon,
  ShapesIcon,
  ShareIcon,
  StickyIcon,
  TextIcon,
  UndoIcon,
  WriteIcon,
} from "../taskbar/icons";
import { TaskbarMenu } from "../taskbar/Menu";
import { LAYOUT, planOverflow } from "../taskbar/model";
import { activateTool, toolFromAppState } from "../taskbar/tools";

import "./NavBar.scss";

import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";

import type { PenPreset } from "../types";

import type { TaskbarMenuSection } from "../taskbar/Menu";
import type {
  TaskbarControl,
  TaskbarMenuItem,
  TaskbarGroupId,
  TaskbarShapeId,
  TaskbarToolId,
} from "../taskbar/model";

/**
 * Body class that hides the Excalidraw chrome this bar replaces: the top
 * shapes toolbar, the top-left hamburger island and the top-right island.
 * Added/removed by the `suppressDefaultChrome` prop. See `INTEGRATION.md`.
 *
 * It deliberately leaves the bottom-left footer (the zoom / undo pill) alone.
 */
export const SUPPRESS_DEFAULT_CHROME_CLASS = "gn-shell-suppress-default-ui";

/**
 * Body class set while the left page panel is open, so Excalidraw's own
 * bottom-left footer slides clear of it. Exported for the panel; hosts do not
 * normally need it.
 */
export const PAGE_PANEL_OPEN_CLASS = "gn-shell-page-panel-open";

/** Editing posture. `read` is a presentation hint; the host owns view mode. */
export type ShellMode = "write" | "read";

const SHAPE_ITEMS: { id: TaskbarShapeId; label: string; icon: ReactNode }[] = [
  { id: "rectangle", label: "Rectangle", icon: <RectangleIcon /> },
  { id: "ellipse", label: "Ellipse", icon: <EllipseIcon /> },
  { id: "diamond", label: "Diamond", icon: <DiamondIcon /> },
  { id: "arrow", label: "Arrow", icon: <ArrowIcon /> },
  { id: "line", label: "Line", icon: <LineIcon /> },
];

const GROUP_LABEL: Record<TaskbarGroupId, string> = {
  draw: "Draw",
  insert: "Insert",
  document: "Document",
  pages: "Pages",
};

/**
 * Width (px) below which the bar starts folding the side zones: the search
 * field becomes an icon button and the right-zone action run moves into "…".
 * The centre cluster has its own, measured overflow on top of this.
 */
const TIGHT_WIDTH = 900;
/** Below this the Write/Read control drops its text labels. */
const COMPACT_WIDTH = 1180;

export interface NavBarProps {
  /**
   * The editor to drive. `null` is fine (controls render and no-op) so the bar
   * can mount before `excalidrawAPI` resolves.
   */
  excalidrawAPI: ExcalidrawImperativeAPI | null;

  /** Bar theme. Defaults to the editor's own `appState.theme`. */
  theme?: "light" | "dark";

  // ---- LEFT zone ----------------------------------------------------------

  /** Toggle the left page panel. Control hidden when absent. */
  onTogglePagePanel?: () => void;
  /** Reflected as `aria-pressed` on the page-panel toggle. */
  pagePanelOpen?: boolean;

  /**
   * Open/close the host's search UI. Rendered as an icon button when there is
   * no `onSearchChange`, and always at narrow widths.
   */
  onToggleSearch?: () => void;
  /** Controlled search text. Pass with `onSearchChange` for an inline field. */
  searchQuery?: string;
  /** Inline search field's change handler. Field hidden when absent. */
  onSearchChange?: (query: string) => void;
  /** Enter pressed in the inline search field. */
  onSearchSubmit?: (query: string) => void;
  /** Placeholder for the inline field. Default `"Search notes"`. */
  searchPlaceholder?: string;

  /** Current posture. Segmented control hidden unless `onModeChange` is set. */
  mode?: ShellMode;
  /** Switch posture. In `read` the centre tools render as unavailable. */
  onModeChange?: (mode: ShellMode) => void;

  // ---- CENTRE zone --------------------------------------------------------

  /**
   * Smart / lasso selection (`goodnotes/fuzzy-select`). When passed it backs
   * the centre's lasso slot; without it the slot drives Excalidraw's own
   * `lasso` tool. Pass `fuzzySelectActive` to make it a toggle.
   */
  onFuzzySelect?: () => void;
  fuzzySelectDisabled?: boolean;
  /** Reflected as `aria-pressed` on the lasso slot. */
  fuzzySelectActive?: boolean;

  /**
   * Controlled active slot. Leave undefined and the bar tracks the editor
   * itself (it subscribes to `onChange` and mirrors `appState.activeTool`).
   */
  activeTool?: TaskbarToolId | null;
  /** Fired after the editor has been switched, for hosts that mirror state. */
  onToolChange?: (tool: TaskbarToolId, shape?: TaskbarShapeId) => void;

  /** Ink for the pen slot. Defaults to a medium black freedraw. */
  penPreset?: PenPreset;
  /** Ink for the highlighter slot. Defaults to 40% yellow, bold. */
  highlighterPreset?: PenPreset;

  /**
   * HOOK POINT for the floating Active Tool Menu (owned by another module).
   * Called with the slot and its button element when the user activates the
   * tool that is *already* active — the GoodNotes "tap the pen again for its
   * settings" gesture. This bar renders no colours or widths itself.
   */
  onActiveToolMenu?: (
    tool: TaskbarToolId,
    anchor: HTMLButtonElement | null,
  ) => void;

  // ---- RIGHT zone ---------------------------------------------------------

  /** Undo. Control hidden when absent. */
  onUndo?: () => void;
  undoDisabled?: boolean;
  /** Redo. Control hidden when absent. */
  onRedo?: () => void;
  redoDisabled?: boolean;

  /** Open the PDF import flow. Control hidden when absent. */
  onImportPdf?: () => void;
  importPdfDisabled?: boolean;

  /** Open the PDF export flow. Lives in the "…" menu. Hidden when absent. */
  onExportPdf?: () => void;
  exportPdfDisabled?: boolean;

  /** Open the image-backdrop picker. Lives in the "…" menu. Hidden when absent. */
  onOpenBackdrops?: () => void;
  backdropsDisabled?: boolean;
  /** Reflected as a tick in the "…" menu when the backdrop panel is open. */
  backdropsActive?: boolean;

  /** Append a page. Control hidden when absent. */
  onAddPage?: () => void;
  addPageDisabled?: boolean;
  /** Total pages — folded into the page-panel toggle's label. */
  pageCount?: number;
  /** 1-based page currently in view. */
  currentPage?: number;

  /** Primary action. Hidden when absent. */
  onShare?: () => void;
  shareDisabled?: boolean;
  /** Label of the primary action. Default `"Share"`. */
  shareLabel?: string;

  /** Extra entries appended to the "…" menu. */
  moreItems?: TaskbarMenuItem[];

  // ---- presentation -------------------------------------------------------

  /**
   * Add {@link SUPPRESS_DEFAULT_CHROME_CLASS} to `<body>` while mounted, which
   * hides Excalidraw's shapes toolbar, hamburger island and top-right island.
   * Default `false`; removing the prop (or unmounting) restores them.
   */
  suppressDefaultChrome?: boolean;
  /** @deprecated Old taskbar name for {@link NavBarProps.suppressDefaultChrome}. */
  suppressDefaultToolbar?: boolean;
  /** Accessible name of the bar. Default `"Editor navigation"`. */
  ariaLabel?: string;
  className?: string;
}

const useLatest = <T,>(value: T) => {
  const ref = useRef(value);
  ref.current = value;
  return ref;
};

export const NavBar = ({
  excalidrawAPI,
  theme,
  onTogglePagePanel,
  pagePanelOpen,
  onToggleSearch,
  searchQuery,
  onSearchChange,
  onSearchSubmit,
  searchPlaceholder = "Search notes",
  mode,
  onModeChange,
  onFuzzySelect,
  fuzzySelectDisabled,
  fuzzySelectActive,
  activeTool: controlledTool,
  onToolChange,
  penPreset,
  highlighterPreset,
  onActiveToolMenu,
  onUndo,
  undoDisabled,
  onRedo,
  redoDisabled,
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
  onShare,
  shareDisabled,
  shareLabel = "Share",
  moreItems,
  suppressDefaultChrome = false,
  suppressDefaultToolbar = false,
  ariaLabel = "Editor navigation",
  className,
}: NavBarProps) => {
  const reactId = useId().replace(/:/g, "");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());

  const [internalTool, setInternalTool] = useState<TaskbarToolId | null>(
    "select",
  );
  const [activeShape, setActiveShape] = useState<TaskbarShapeId>("rectangle");
  const [openMenu, setOpenMenu] = useState<"shapes" | "tools" | "more" | null>(
    null,
  );
  const [focusId, setFocusId] = useState<string | null>(null);
  const [centreWidth, setCentreWidth] = useState(0);
  const [barWidth, setBarWidth] = useState(0);
  const [widths, setWidths] = useState<Map<string, number>>(new Map());
  const [moreWidth, setMoreWidth] = useState(0);
  const [editorTheme, setEditorTheme] = useState<"light" | "dark">("light");

  const activeTool =
    controlledTool === undefined ? internalTool : controlledTool;
  const readMode = mode === "read";

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
      if (readMode) {
        return;
      }
      // "tap the active tool again" is the Active Tool Menu gesture
      if (
        onActiveToolMenu &&
        activeTool === tool &&
        (tool !== "shape" || !shape || shape === activeShape)
      ) {
        onActiveToolMenu(tool, buttonRefs.current.get(tool) ?? null);
        return;
      }
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
    [
      readMode,
      onActiveToolMenu,
      activeTool,
      excalidrawAPI,
      penPreset,
      highlighterPreset,
      activeShape,
      onToolChangeRef,
    ],
  );

  // ---- centre cluster: tools only -----------------------------------------

  const toolControls = useMemo<TaskbarControl[]>(() => {
    const tool = (
      id: TaskbarToolId,
      label: string,
      icon: ReactNode,
      shortcut: string,
      priority: number,
      group: TaskbarGroupId,
    ): TaskbarControl => ({
      id,
      group,
      label,
      icon,
      kind: "toggle",
      pressed: activeTool === id,
      disabled: readMode,
      shortcut,
      inlineText: label,
      priority,
      onSelect: () => selectTool(id),
    });

    const list: TaskbarControl[] = [
      tool("select", "Select", <SelectIcon />, "V", 100, "draw"),
    ];

    // the lasso slot: the host's smart selection when it has one, otherwise
    // Excalidraw's own lasso tool
    list.push(
      onFuzzySelect
        ? {
            id: "lasso",
            group: "draw",
            label: "Lasso select",
            description: "Smart selection",
            icon: <LassoIcon />,
            kind: fuzzySelectActive === undefined ? "action" : "toggle",
            pressed: fuzzySelectActive,
            disabled: readMode || fuzzySelectDisabled,
            inlineText: "Lasso",
            priority: 90,
            onSelect: onFuzzySelect,
          }
        : tool("lasso", "Lasso select", <LassoIcon />, "Q", 90, "draw"),
    );

    list.push(tool("pen", "Pen", <PenIcon />, "P", 99, "draw"));
    list.push(
      tool("highlighter", "Highlighter", <HighlighterIcon />, "H", 95, "draw"),
    );
    list.push(tool("eraser", "Eraser", <EraserIcon />, "E", 94, "draw"));

    list.push({
      id: "shape",
      group: "insert",
      label: "Shapes",
      description: `Current shape: ${
        SHAPE_ITEMS.find((s) => s.id === activeShape)?.label ?? "rectangle"
      }`,
      icon: <ShapesIcon />,
      kind: "menu",
      pressed: activeTool === "shape",
      disabled: readMode,
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

    list.push(tool("text", "Text", <TextIcon />, "T", 80, "insert"));
    list.push(tool("image", "Image", <ImageIcon />, "9", 60, "insert"));
    list.push(tool("sticky", "Sticky note", <StickyIcon />, "N", 65, "insert"));

    return list;
  }, [
    activeTool,
    activeShape,
    readMode,
    selectTool,
    onFuzzySelect,
    fuzzySelectActive,
    fuzzySelectDisabled,
  ]);

  // ---- measurement & centre overflow --------------------------------------

  // A `visibility: hidden` copy of every tool at its natural width. Measuring
  // the ghost (rather than the live cluster) keeps a control's width known
  // even while it sits in the overflow menu, so the cluster can expand again.
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
  }, [toolControls]);

  useLayoutEffect(() => {
    const node = rootRef.current;
    if (!node) {
      return;
    }
    const read = () => {
      const total = node.getBoundingClientRect().width;
      setBarWidth(total);
      const centre = node.querySelector<HTMLElement>("[data-gn-centre]");
      setCentreWidth(centre?.getBoundingClientRect().width ?? total / 3);
    };
    read();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(read);
    observer.observe(node);
    const centre = node.querySelector<HTMLElement>("[data-gn-centre]");
    if (centre) {
      observer.observe(centre);
    }
    return () => observer.disconnect();
  }, []);

  const density: "comfortable" | "compact" | "tight" =
    barWidth && barWidth < TIGHT_WIDTH
      ? "tight"
      : barWidth && barWidth < COMPACT_WIDTH
      ? "compact"
      : "comfortable";

  const { visible: visibleTools, overflow: overflowTools } = useMemo(
    () => planOverflow(toolControls, widths, moreWidth, centreWidth),
    [toolControls, widths, moreWidth, centreWidth],
  );

  // a menu whose trigger just overflowed must not stay open
  useEffect(() => {
    if (openMenu === "shapes" && !visibleTools.some((c) => c.id === "shape")) {
      setOpenMenu(null);
    }
    if (openMenu === "tools" && overflowTools.length === 0) {
      setOpenMenu(null);
    }
  }, [openMenu, visibleTools, overflowTools.length]);

  // ---- roving tabindex (centre cluster only) ------------------------------

  const toolsMoreId = `${reactId}-tools-more`;

  const focusOrder = useMemo(() => {
    const ids = visibleTools
      .filter((c) => c.kind !== "status" && !c.disabled)
      .map((c) => c.id);
    if (overflowTools.length) {
      ids.push(toolsMoreId);
    }
    return ids;
  }, [visibleTools, overflowTools.length, toolsMoreId]);

  // read mode disables every tool; keep the cluster reachable all the same
  const fallbackFocusId = visibleTools[0]?.id ?? null;
  const activeFocusId =
    focusId && focusOrder.includes(focusId)
      ? focusId
      : focusOrder[0] ?? fallbackFocusId;

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

  // ---- default-chrome suppression -----------------------------------------

  const suppress = suppressDefaultChrome || suppressDefaultToolbar;

  useEffect(() => {
    if (!suppress || typeof document === "undefined") {
      return;
    }
    document.body.classList.add(SUPPRESS_DEFAULT_CHROME_CLASS);
    return () => document.body.classList.remove(SUPPRESS_DEFAULT_CHROME_CLASS);
  }, [suppress]);

  // ---- rendering ----------------------------------------------------------

  const registerRef = (id: string) => (node: HTMLButtonElement | null) => {
    if (node) {
      buttonRefs.current.set(id, node);
    } else {
      buttonRefs.current.delete(id);
    }
  };

  const renderTool = (control: TaskbarControl, measuring: boolean) => {
    const describedById = control.description
      ? `${reactId}-${control.id}-desc`
      : undefined;
    const isMenu = control.kind === "menu";
    const expanded = isMenu && openMenu === "shapes";
    const buttonId = `${reactId}-${control.id}`;

    return (
      <div
        key={control.id}
        className="gn-nav__slot"
        data-gn-measure={measuring ? control.id : undefined}
      >
        <button
          id={measuring ? undefined : buttonId}
          ref={measuring ? undefined : registerRef(control.id)}
          type="button"
          className="gn-nav__button gn-nav__button--tool"
          data-control={control.id}
          data-kind={control.kind}
          // read mode keeps the cluster focusable but inert: `aria-disabled`
          // rather than `disabled`, so the toolbar never loses its tab stop
          aria-disabled={control.disabled || undefined}
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
            if (measuring || control.disabled) {
              return;
            }
            setFocusId(control.id);
            if (isMenu) {
              // activating the already-active shape slot belongs to the
              // Active Tool Menu; otherwise open the shape picker
              if (onActiveToolMenu && control.pressed) {
                onActiveToolMenu(
                  "shape",
                  buttonRefs.current.get(control.id) ?? null,
                );
                return;
              }
              setOpenMenu((open) => (open === "shapes" ? null : "shapes"));
              return;
            }
            setOpenMenu(null);
            control.onSelect?.();
          }}
        >
          {control.icon}
          <span className="gn-nav__sr">{control.label}</span>
        </button>
        {describedById && (
          <span id={describedById} className="gn-nav__sr">
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
            className="gn-nav__separator"
            role="separator"
            aria-orientation="vertical"
          />,
        );
      }
      nodes.push(renderTool(control, measuring));
      previousGroup = control.group as TaskbarGroupId;
    }
    return nodes;
  };

  const toolOverflowSections = useMemo<TaskbarMenuSection[]>(() => {
    const sections: TaskbarMenuSection[] = [];
    for (const group of ["draw", "insert"] as const) {
      const inGroup = overflowTools.filter((c) => c.group === group);
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
    return sections;
  }, [overflowTools]);

  // ---- right zone ---------------------------------------------------------

  const demote = density === "tight";

  /** Right-zone action buttons, in order. `demoted` ones go to the "…" menu. */
  const rightActions = useMemo(() => {
    const actions: {
      id: string;
      label: string;
      icon: ReactNode;
      group: TaskbarGroupId;
      onSelect: () => void;
      disabled?: boolean;
      demoted?: boolean;
    }[] = [];
    if (onUndo) {
      actions.push({
        id: "undo",
        label: "Undo",
        icon: <UndoIcon />,
        group: "document",
        disabled: undoDisabled,
        onSelect: onUndo,
      });
    }
    if (onRedo) {
      actions.push({
        id: "redo",
        label: "Redo",
        icon: <RedoIcon />,
        group: "document",
        disabled: redoDisabled,
        onSelect: onRedo,
      });
    }
    if (onImportPdf) {
      actions.push({
        id: "import-pdf",
        label: "Import PDF",
        icon: <ImportPdfIcon />,
        group: "document",
        disabled: importPdfDisabled,
        onSelect: onImportPdf,
        demoted: demote,
      });
    }
    if (onAddPage) {
      actions.push({
        id: "add-page",
        label: "Add page",
        icon: <AddPageIcon />,
        group: "pages",
        disabled: addPageDisabled,
        onSelect: onAddPage,
        demoted: demote,
      });
    }
    return actions;
  }, [
    onUndo,
    undoDisabled,
    onRedo,
    redoDisabled,
    onImportPdf,
    importPdfDisabled,
    onAddPage,
    addPageDisabled,
    demote,
  ]);

  const moreId = `${reactId}-more`;

  const moreSections = useMemo<TaskbarMenuSection[]>(() => {
    const sections: TaskbarMenuSection[] = [];

    const demoted = rightActions.filter((action) => action.demoted);
    if (demoted.length) {
      sections.push({
        id: "actions",
        label: "Document",
        items: demoted.map((action) => ({
          id: action.id,
          label: action.label,
          icon: action.icon,
          disabled: action.disabled,
          onSelect: action.onSelect,
        })),
      });
    }

    const documentItems: TaskbarMenuItem[] = [];
    if (onExportPdf) {
      documentItems.push({
        id: "export-pdf",
        label: "Export to PDF",
        icon: <ExportPdfIcon />,
        disabled: exportPdfDisabled,
        onSelect: onExportPdf,
      });
    }
    if (onOpenBackdrops) {
      documentItems.push({
        id: "backdrops",
        label: "Image backdrop…",
        icon: <BackdropIcon />,
        checked: backdropsActive,
        disabled: backdropsDisabled,
        onSelect: onOpenBackdrops,
      });
    }
    if (documentItems.length) {
      sections.push({ id: "export", label: "Export", items: documentItems });
    }

    if (moreItems?.length) {
      sections.push({ id: "host", items: moreItems });
    }
    return sections;
  }, [
    rightActions,
    onExportPdf,
    exportPdfDisabled,
    onOpenBackdrops,
    backdropsActive,
    backdropsDisabled,
    moreItems,
  ]);

  const renderAction = (action: (typeof rightActions)[number]) => (
    <button
      key={action.id}
      type="button"
      className="gn-nav__button"
      data-control={action.id}
      disabled={action.disabled}
      title={action.label}
      onClick={action.onSelect}
    >
      {action.icon}
      <span className="gn-nav__sr">{action.label}</span>
    </button>
  );

  // ---- left zone ----------------------------------------------------------

  const pagesLabel =
    typeof pageCount === "number" && pageCount > 0
      ? `Pages, page ${currentPage ?? 1} of ${pageCount}`
      : "Pages";

  const showInlineSearch = !!onSearchChange && density !== "tight";
  const showSearchButton = !!onToggleSearch && !showInlineSearch;

  const modeButtons: { id: ShellMode; label: string; icon: ReactNode }[] = [
    { id: "write", label: "Write", icon: <WriteIcon /> },
    { id: "read", label: "Read", icon: <ReadIcon /> },
  ];

  const onModeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }
    event.preventDefault();
    const next: ShellMode = mode === "read" ? "write" : "read";
    onModeChange?.(next);
    requestAnimationFrame(() => buttonRefs.current.get(`mode-${next}`)?.focus());
  };

  const resolvedTheme = theme ?? editorTheme;

  return (
    <div
      className={`gn-nav-scope excalidraw${
        resolvedTheme === "dark" ? " theme--dark" : ""
      }${className ? ` ${className}` : ""}`}
      data-testid="goodnotes-navbar"
    >
      <div
        ref={rootRef}
        className="gn-nav"
        data-density={density}
        role="group"
        aria-label={ariaLabel}
      >
        {/* ---- LEFT ---------------------------------------------------- */}
        <div className="gn-nav__zone gn-nav__zone--left">
          {onTogglePagePanel && (
            <button
              type="button"
              className="gn-nav__button gn-nav__button--wide"
              data-control="pages-panel"
              aria-pressed={!!pagePanelOpen}
              title={pagesLabel}
              onClick={onTogglePagePanel}
            >
              <PagesPanelIcon />
              <span className="gn-nav__sr">{pagesLabel}</span>
              {typeof pageCount === "number" && pageCount > 0 && (
                <span className="gn-nav__count" aria-hidden="true">
                  {currentPage ?? 1}/{pageCount}
                </span>
              )}
            </button>
          )}

          {showInlineSearch && (
            <div className="gn-nav__search">
              <span className="gn-nav__search-icon" aria-hidden="true">
                <SearchIcon />
              </span>
              <label className="gn-nav__sr" htmlFor={`${reactId}-search`}>
                Search notes
              </label>
              <input
                id={`${reactId}-search`}
                type="search"
                className="gn-nav__search-input"
                placeholder={searchPlaceholder}
                value={searchQuery ?? ""}
                onChange={(event) => onSearchChange?.(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    onSearchSubmit?.(event.currentTarget.value);
                  }
                }}
              />
            </div>
          )}

          {showSearchButton && (
            <button
              type="button"
              className="gn-nav__button"
              data-control="search"
              title="Search"
              onClick={onToggleSearch}
            >
              <SearchIcon />
              <span className="gn-nav__sr">Search</span>
            </button>
          )}

          {onModeChange && (
            <div
              className="gn-nav__segmented"
              role="radiogroup"
              aria-label="Mode"
              onKeyDown={onModeKeyDown}
            >
              {modeButtons.map((item) => {
                const checked = (mode ?? "write") === item.id;
                return (
                  <button
                    key={item.id}
                    ref={registerRef(`mode-${item.id}`)}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    tabIndex={checked ? 0 : -1}
                    className="gn-nav__segment"
                    data-control={`mode-${item.id}`}
                    title={`${item.label} mode`}
                    onClick={() => onModeChange(item.id)}
                  >
                    {item.icon}
                    <span
                      className={
                        density === "comfortable"
                          ? "gn-nav__segment-text"
                          : "gn-nav__sr"
                      }
                    >
                      {item.label}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ---- CENTRE (tools only) -------------------------------------- */}
        <div
          className="gn-nav__zone gn-nav__zone--centre"
          data-gn-centre=""
          role="toolbar"
          aria-label="Drawing tools"
          aria-orientation="horizontal"
          onKeyDown={onToolbarKeyDown}
        >
          {withSeparators(visibleTools, false)}

          {overflowTools.length > 0 && (
            <div className="gn-nav__slot">
              <button
                id={toolsMoreId}
                ref={registerRef(toolsMoreId)}
                type="button"
                className="gn-nav__button gn-nav__button--tool"
                data-control="tools-more"
                tabIndex={activeFocusId === toolsMoreId ? 0 : -1}
                aria-haspopup="menu"
                aria-expanded={openMenu === "tools"}
                title={`More tools (${overflowTools.length})`}
                onFocus={() => setFocusId(toolsMoreId)}
                onClick={() => {
                  setFocusId(toolsMoreId);
                  setOpenMenu((open) => (open === "tools" ? null : "tools"));
                }}
              >
                <MoreIcon />
                <span className="gn-nav__sr">
                  More tools, {overflowTools.length} hidden
                </span>
              </button>
              {openMenu === "tools" && (
                <TaskbarMenu
                  id={`${reactId}-tools-menu`}
                  labelledBy={toolsMoreId}
                  sections={toolOverflowSections}
                  onClose={(opts) => {
                    setOpenMenu(null);
                    if (opts?.restoreFocus !== false) {
                      buttonRefs.current.get(toolsMoreId)?.focus();
                    }
                  }}
                />
              )}
            </div>
          )}
        </div>

        {/* ---- RIGHT ----------------------------------------------------- */}
        <div
          className="gn-nav__zone gn-nav__zone--right"
          role="group"
          aria-label="Document actions"
        >
          {(() => {
            const shown = rightActions.filter((action) => !action.demoted);
            const nodes: ReactNode[] = [];
            let previousGroup: TaskbarGroupId | null = null;
            for (const action of shown) {
              if (previousGroup !== null && action.group !== previousGroup) {
                nodes.push(
                  <span
                    key={`sep-${action.id}`}
                    className="gn-nav__separator"
                    role="separator"
                    aria-orientation="vertical"
                  />,
                );
              }
              nodes.push(renderAction(action));
              previousGroup = action.group;
            }
            return nodes;
          })()}

          {onShare && (
            <button
              type="button"
              className="gn-nav__share"
              data-control="share"
              disabled={shareDisabled}
              onClick={onShare}
            >
              <ShareIcon />
              <span
                className={
                  density === "tight" ? "gn-nav__sr" : "gn-nav__share-text"
                }
              >
                {shareLabel}
              </span>
            </button>
          )}

          {moreSections.length > 0 && (
            <div className="gn-nav__slot">
              <button
                id={moreId}
                ref={registerRef(moreId)}
                type="button"
                className="gn-nav__button"
                data-control="more"
                aria-haspopup="menu"
                aria-expanded={openMenu === "more"}
                title="More"
                onClick={() =>
                  setOpenMenu((open) => (open === "more" ? null : "more"))
                }
              >
                <MoreIcon />
                <span className="gn-nav__sr">More actions</span>
              </button>
              {openMenu === "more" && (
                <TaskbarMenu
                  id={`${reactId}-more-menu`}
                  labelledBy={moreId}
                  align="end"
                  sections={moreSections}
                  onClose={(opts) => {
                    setOpenMenu(null);
                    if (opts?.restoreFocus !== false) {
                      buttonRefs.current.get(moreId)?.focus();
                    }
                  }}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Measuring copy of the centre cluster: inert + visibility:hidden, so
          it is out of the tab order and the accessibility tree but still has
          real layout. */}
      <div
        ref={ghostRef}
        className="gn-nav__zone gn-nav__zone--centre gn-nav--ghost"
        aria-hidden="true"
        inert
        style={{ gap: LAYOUT.gap }}
      >
        {withSeparators(toolControls, true)}
        <span className="gn-nav__slot" data-gn-measure="__more__">
          <span className="gn-nav__button gn-nav__button--tool">
            <MoreIcon />
          </span>
        </span>
      </div>
    </div>
  );
};

export default NavBar;
