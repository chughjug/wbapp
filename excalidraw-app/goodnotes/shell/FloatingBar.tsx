/**
 * The GoodNotes editor's ONE floating bar.
 *
 * The editor used to carry six permanent bands — a page rail, a tool-settings
 * band, page controls, a tab strip, a nav bar and the zoom pill — which ate
 * 28.5% of an iPad Pro 11" viewport. This replaces the nav bar with a single
 * ~46px pill that *floats over* the canvas instead of displacing it, so the
 * page gets the full height of the stage:
 *
 * ```
 *        ┌──────────────────────────────────────────────────┐
 *        │ ⌂ · ▤ 2/12 │ ✒ ▰ ⌫ ◌ ▶ │ + │ … │
 *        └──────────────────────────────────────────────────┘
 * ```
 *
 * Ten visible controls, in three runs:
 *
 * - **Home · Pages** — where am I. Pages carries a compact "2/12" counter and
 *   opens the page overlay ({@link PagePanel}), which is a dialog, not a
 *   column: it costs nothing when closed.
 * - **pen · highlighter · eraser · lasso · select** — the five tools a note
 *   app actually uses mid-stroke. Everything else is one tap further away.
 * - **"+"** — secondary inserts: text, the five shapes, image, sticky note,
 *   import PDF, insert graph.
 * - **"…"** — document actions: new document, add page, undo/redo, share,
 *   export PDF, image backdrop, search, read mode, theme, plus whatever the
 *   host appends through {@link FloatingBarProps.moreItems}.
 *
 * Nothing that the old twenty-odd-control nav bar could reach became
 * unreachable; see `INTEGRATION.md` for the capability audit.
 *
 * Accessibility contract (a floating bar makes this harder, not optional):
 * - the whole bar is one `role="toolbar"`: a single tab stop, roving
 *   tabindex, Arrow/Home/End between controls;
 * - `aria-pressed` on every tool toggle, mirrored from the editor through
 *   `excalidrawAPI.onChange`, so it never lies when a keyboard shortcut or
 *   another surface changes the tool;
 * - "+" and "…" are real menus (`aria-haspopup="menu"` / `aria-expanded`),
 *   focus moves into them on open and returns to the trigger on close;
 * - the Pages control is `aria-haspopup="dialog"` / `aria-expanded`;
 * - every icon-only control carries a visually-hidden text name;
 * - `:focus-visible` rings are visible against both themes and against the
 *   translucent bar; `prefers-reduced-motion: reduce` removes all motion.
 *
 * Pointer contract: the bar's positioning wrapper spans the stage but is
 * `pointer-events: none`; only the pill itself takes pointer events. A stroke
 * that starts one pixel outside the pill reaches the canvas.
 */

import {
  useCallback,
  useEffect,
  useId,
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
  HomeIcon,
  ImageIcon,
  ImportPdfIcon,
  LassoIcon,
  LineIcon,
  MoreIcon,
  NewDocumentIcon,
  PagesPanelIcon,
  PenIcon,
  ReadIcon,
  RectangleIcon,
  RedoIcon,
  SearchIcon,
  SelectIcon,
  ShareIcon,
  StickyIcon,
  TextIcon,
  UndoIcon,
} from "../taskbar/icons";
import { TaskbarMenu } from "../taskbar/Menu";
import { activateTool, toolFromAppState } from "../taskbar/tools";

import { GraphIcon, PlusIcon, SettingsIcon, ThemeIcon } from "./icons";

import "./FloatingBar.scss";

import type { ReactNode } from "react";

import type { PenPreset } from "../types";

import type { TaskbarMenuSection } from "../taskbar/Menu";
import type {
  TaskbarMenuItem,
  TaskbarShapeId,
  TaskbarToolId,
} from "../taskbar/model";

/**
 * Body class that hides the Excalidraw chrome this bar replaces: the top
 * shapes toolbar, the top-left hamburger island and the top-right island.
 * Added/removed by the `suppressDefaultChrome` prop. See `INTEGRATION.md`.
 *
 * It deliberately leaves the bottom-left footer (the zoom / undo pill) alone —
 * that pill is Excalidraw's own and is a second route to undo/redo.
 */
export const SUPPRESS_DEFAULT_CHROME_CLASS = "gn-shell-suppress-default-ui";

/**
 * Body class set while the page overlay is open. The overlay is a dialog
 * inside the stage, so hosts do not normally need this; it exists so a host
 * can, say, pause an animation while the overlay is up.
 */
export const PAGE_PANEL_OPEN_CLASS = "gn-shell-page-panel-open";

/** Editing posture. `read` is a presentation hint; the host owns view mode. */
export type ShellMode = "write" | "read";

/**
 * Where the bar is anchored.
 *
 * - `floating` (default) — `position: absolute`, centred near the top of the
 *   nearest positioned ancestor. That ancestor should be the editor stage
 *   (`.gn-shell-stage`, which is what `.gn-shell-body` now is), so the bar
 *   floats over the canvas and the page keeps the full height.
 * - `fixed` — the same pill, anchored to the viewport instead of the stage.
 *   Use it when the bar is mounted outside the stage.
 * - `flow` — **deprecated**. The old band behaviour; it is now an alias for
 *   `floating`, because a band is precisely what this module removed.
 */
export type ShellPlacement = "floating" | "fixed" | "flow";

const SHAPE_ITEMS: { id: TaskbarShapeId; label: string; icon: ReactNode }[] = [
  { id: "rectangle", label: "Rectangle", icon: <RectangleIcon /> },
  { id: "ellipse", label: "Ellipse", icon: <EllipseIcon /> },
  { id: "diamond", label: "Diamond", icon: <DiamondIcon /> },
  { id: "arrow", label: "Arrow", icon: <ArrowIcon /> },
  { id: "line", label: "Line", icon: <LineIcon /> },
];

/** The five tools that earn a permanent slot, in bar order. */
const PRIMARY_TOOLS: {
  id: Extract<
    TaskbarToolId,
    "pen" | "highlighter" | "eraser" | "lasso" | "select"
  >;
  label: string;
  icon: ReactNode;
  shortcut: string;
}[] = [
  { id: "pen", label: "Pen", icon: <PenIcon />, shortcut: "P" },
  {
    id: "highlighter",
    label: "Highlighter",
    icon: <HighlighterIcon />,
    shortcut: "H",
  },
  { id: "eraser", label: "Eraser", icon: <EraserIcon />, shortcut: "E" },
  { id: "lasso", label: "Lasso select", icon: <LassoIcon />, shortcut: "Q" },
  { id: "select", label: "Select", icon: <SelectIcon />, shortcut: "V" },
];

export interface FloatingBarProps {
  /**
   * The editor to drive. `null` is fine (controls render and no-op) so the bar
   * can mount before `excalidrawAPI` resolves.
   */
  excalidrawAPI: ExcalidrawImperativeAPI | null;

  /** Bar theme. Defaults to the editor's own `appState.theme`. */
  theme?: "light" | "dark";

  // ---- identity -----------------------------------------------------------

  /** Back to the document library. Control hidden when absent. */
  onHome?: () => void;
  /**
   * The open document's title. There is no tab strip with one document open,
   * so the title lives here: it heads the "…" menu and is the Home control's
   * accessible description.
   */
  documentTitle?: string;

  /** Open/close the page overlay. Control hidden when absent. */
  onTogglePagePanel?: () => void;
  /** Reflected as `aria-expanded` on the Pages control. */
  pagePanelOpen?: boolean;
  /** Total pages — rendered as the compact "n/N" counter. */
  pageCount?: number;
  /** 1-based page currently in view. */
  currentPage?: number;

  // ---- tools --------------------------------------------------------------

  /**
   * Smart / lasso selection (`goodnotes/fuzzy-select`). When passed it backs
   * the bar's lasso slot; without it the slot drives Excalidraw's own `lasso`
   * tool. Pass `fuzzySelectActive` to make it a toggle.
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

  // ---- "+" (secondary inserts) --------------------------------------------

  /** Open the PDF import flow. Item hidden when absent. */
  onImportPdf?: () => void;
  importPdfDisabled?: boolean;
  /** Open the graph-insert dialog. Item hidden when absent. */
  onInsertGraph?: () => void;
  insertGraphDisabled?: boolean;
  /** Extra entries appended to the "+" menu. */
  insertItems?: TaskbarMenuItem[];

  // ---- "…" (document actions) ---------------------------------------------

  /** Create a brand-new document and open it. Item hidden when absent. */
  onNewDocument?: () => void;
  /** Undo. Item hidden when absent. */
  onUndo?: () => void;
  undoDisabled?: boolean;
  /** Redo. Item hidden when absent. */
  onRedo?: () => void;
  redoDisabled?: boolean;
  /** Append a page. Item hidden when absent. */
  onAddPage?: () => void;
  addPageDisabled?: boolean;
  /** Open the PDF export flow. Item hidden when absent. */
  onExportPdf?: () => void;
  exportPdfDisabled?: boolean;
  /** Open the image-backdrop picker. Item hidden when absent. */
  onOpenBackdrops?: () => void;
  backdropsDisabled?: boolean;
  /** Reflected as a tick in the "…" menu when the backdrop panel is open. */
  backdropsActive?: boolean;
  /** Primary share action. Item hidden when absent. */
  onShare?: () => void;
  shareDisabled?: boolean;
  /** Label of the share item. Default `"Share"`. */
  shareLabel?: string;
  /** Open the host's search UI. Item hidden when absent. */
  onToggleSearch?: () => void;

  /** Current posture. Item hidden unless `onModeChange` is set. */
  mode?: ShellMode;
  /** Switch posture. In `read` the tools render as unavailable. */
  onModeChange?: (mode: ShellMode) => void;

  /**
   * Toggle light/dark.
   *
   * The theme item is always in the "…" menu — theme was previously only
   * reachable from Excalidraw's hamburger island, which `suppressDefaultChrome`
   * hides. When this prop is omitted the bar falls back to flipping
   * `appState.theme` through `excalidrawAPI`, which is correct for a host that
   * lets the editor own its theme.
   *
   * **A host that passes `theme` to `<Excalidraw>` (as this app does, from
   * `goodnotes/dark`'s `useDarkMode`) controls the theme, and that fallback
   * cannot win — such a host MUST pass `onToggleTheme`.** See
   * `INTEGRATION.md`, which gives the one-line wiring.
   */
  onToggleTheme?: () => void;

  /** Extra entries appended to the "…" menu (settings, host commands, …). */
  moreItems?: TaskbarMenuItem[];

  // ---- presentation -------------------------------------------------------

  /**
   * Add {@link SUPPRESS_DEFAULT_CHROME_CLASS} to `<body>` while mounted, which
   * hides Excalidraw's shapes toolbar, hamburger island and top-right island.
   * Default `false`; removing the prop (or unmounting) restores them.
   */
  suppressDefaultChrome?: boolean;
  /** @deprecated Old taskbar name for {@link FloatingBarProps.suppressDefaultChrome}. */
  suppressDefaultToolbar?: boolean;
  /** See {@link ShellPlacement}. Default `"floating"`. */
  placement?: ShellPlacement;
  /** Accessible name of the bar. Default `"Editor toolbar"`. */
  ariaLabel?: string;
  className?: string;
}

const useLatest = <T,>(value: T) => {
  const ref = useRef(value);
  ref.current = value;
  return ref;
};

export const FloatingBar = ({
  excalidrawAPI,
  theme,
  onHome,
  documentTitle,
  onTogglePagePanel,
  pagePanelOpen,
  pageCount,
  currentPage,
  onFuzzySelect,
  fuzzySelectDisabled,
  fuzzySelectActive,
  activeTool: controlledTool,
  onToolChange,
  penPreset,
  highlighterPreset,
  onActiveToolMenu,
  onImportPdf,
  importPdfDisabled,
  onInsertGraph,
  insertGraphDisabled,
  insertItems,
  onNewDocument,
  onUndo,
  undoDisabled,
  onRedo,
  redoDisabled,
  onAddPage,
  addPageDisabled,
  onExportPdf,
  exportPdfDisabled,
  onOpenBackdrops,
  backdropsDisabled,
  backdropsActive,
  onShare,
  shareDisabled,
  shareLabel = "Share",
  onToggleSearch,
  mode,
  onModeChange,
  onToggleTheme,
  moreItems,
  suppressDefaultChrome = false,
  suppressDefaultToolbar = false,
  placement = "floating",
  ariaLabel = "Editor toolbar",
  className,
}: FloatingBarProps) => {
  const reactId = useId().replace(/:/g, "");
  const barRef = useRef<HTMLDivElement | null>(null);
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());

  const [internalTool, setInternalTool] = useState<TaskbarToolId | null>(
    "select",
  );
  const [activeShape, setActiveShape] = useState<TaskbarShapeId>("rectangle");
  const [openMenu, setOpenMenu] = useState<"insert" | "more" | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
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
    // the active-tool menu) so `aria-pressed` never lies
    return excalidrawAPI.onChange(sync);
  }, [excalidrawAPI]);

  const resolvedTheme = theme ?? editorTheme;

  const selectTool = useCallback(
    (tool: TaskbarToolId, shape?: TaskbarShapeId) => {
      if (readMode) {
        return;
      }
      // "tap the active tool again" is the Active Tool Menu gesture
      if (
        onActiveToolMenu &&
        activeTool === tool &&
        (tool !== "shape" || !shape || shape === activeShape) &&
        (tool === "pen" ||
          tool === "highlighter" ||
          tool === "eraser" ||
          tool === "shape" ||
          tool === "text")
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

  // Theme is only otherwise reachable from Excalidraw's hamburger island,
  // which `suppressDefaultChrome` hides — so the bar can always toggle it.
  const toggleTheme = useCallback(() => {
    if (onToggleTheme) {
      onToggleTheme();
      return;
    }
    if (!excalidrawAPI || excalidrawAPI.isDestroyed) {
      return;
    }
    const next =
      excalidrawAPI.getAppState().theme === "dark" ? "light" : "dark";
    excalidrawAPI.updateScene({ appState: { theme: next } });
  }, [onToggleTheme, excalidrawAPI]);

  // ---- default-chrome suppression -----------------------------------------

  const suppress = suppressDefaultChrome || suppressDefaultToolbar;

  useEffect(() => {
    if (!suppress || typeof document === "undefined") {
      return;
    }
    document.body.classList.add(SUPPRESS_DEFAULT_CHROME_CLASS);
    return () => document.body.classList.remove(SUPPRESS_DEFAULT_CHROME_CLASS);
  }, [suppress]);

  // ---- menus --------------------------------------------------------------

  const insertId = `${reactId}-insert`;
  const moreId = `${reactId}-more`;
  const pagesId = `${reactId}-pages`;

  const insertSections = useMemo<TaskbarMenuSection[]>(() => {
    const sections: TaskbarMenuSection[] = [];
    const place: TaskbarMenuItem[] = [
      {
        id: "text",
        label: "Text",
        icon: <TextIcon />,
        checked: activeTool === "text",
        disabled: readMode,
        onSelect: () => selectTool("text"),
      },
      {
        id: "image",
        label: "Image",
        icon: <ImageIcon />,
        checked: activeTool === "image",
        disabled: readMode,
        onSelect: () => selectTool("image"),
      },
      {
        id: "sticky",
        label: "Sticky note",
        icon: <StickyIcon />,
        checked: activeTool === "sticky",
        disabled: readMode,
        onSelect: () => selectTool("sticky"),
      },
    ];
    sections.push({ id: "place", label: "Insert", items: place });

    sections.push({
      id: "shapes",
      label: "Shapes",
      items: SHAPE_ITEMS.map((shape) => ({
        id: `shape-${shape.id}`,
        label: shape.label,
        icon: shape.icon,
        checked: activeTool === "shape" && activeShape === shape.id,
        disabled: readMode,
        onSelect: () => selectTool("shape", shape.id),
      })),
    });

    const files: TaskbarMenuItem[] = [];
    if (onImportPdf) {
      files.push({
        id: "import-pdf",
        label: "Import PDF…",
        icon: <ImportPdfIcon />,
        disabled: importPdfDisabled,
        onSelect: onImportPdf,
      });
    }
    if (onInsertGraph) {
      files.push({
        id: "insert-graph",
        label: "Insert graph…",
        icon: <GraphIcon />,
        disabled: insertGraphDisabled,
        onSelect: onInsertGraph,
      });
    }
    if (insertItems?.length) {
      files.push(...insertItems);
    }
    if (files.length) {
      sections.push({ id: "files", label: "Bring in", items: files });
    }
    return sections;
  }, [
    activeTool,
    activeShape,
    readMode,
    selectTool,
    onImportPdf,
    importPdfDisabled,
    onInsertGraph,
    insertGraphDisabled,
    insertItems,
  ]);

  const moreSections = useMemo<TaskbarMenuSection[]>(() => {
    const sections: TaskbarMenuSection[] = [];

    const doc: TaskbarMenuItem[] = [];
    if (onNewDocument) {
      doc.push({
        id: "new-document",
        label: "New document",
        icon: <NewDocumentIcon />,
        onSelect: onNewDocument,
      });
    }
    if (onAddPage) {
      doc.push({
        id: "add-page",
        label: "Add page",
        icon: <AddPageIcon />,
        disabled: addPageDisabled,
        onSelect: onAddPage,
      });
    }
    if (onUndo) {
      doc.push({
        id: "undo",
        label: "Undo",
        icon: <UndoIcon />,
        disabled: undoDisabled,
        onSelect: onUndo,
      });
    }
    if (onRedo) {
      doc.push({
        id: "redo",
        label: "Redo",
        icon: <RedoIcon />,
        disabled: redoDisabled,
        onSelect: onRedo,
      });
    }
    if (doc.length) {
      // the title heads the menu: with one document open there is no tab
      // strip to carry it
      sections.push({
        id: "doc",
        label: documentTitle?.trim() || "Document",
        items: doc,
      });
    }

    const out: TaskbarMenuItem[] = [];
    if (onShare) {
      out.push({
        id: "share",
        label: shareLabel,
        icon: <ShareIcon />,
        disabled: shareDisabled,
        onSelect: onShare,
      });
    }
    if (onExportPdf) {
      out.push({
        id: "export-pdf",
        label: "Export to PDF…",
        icon: <ExportPdfIcon />,
        disabled: exportPdfDisabled,
        onSelect: onExportPdf,
      });
    }
    if (onOpenBackdrops) {
      out.push({
        id: "backdrops",
        label: "Image backdrop…",
        icon: <BackdropIcon />,
        checked: backdropsActive,
        disabled: backdropsDisabled,
        onSelect: onOpenBackdrops,
      });
    }
    if (out.length) {
      sections.push({ id: "out", label: "Share & export", items: out });
    }

    const view: TaskbarMenuItem[] = [];
    if (onToggleSearch) {
      view.push({
        id: "search",
        label: "Search…",
        icon: <SearchIcon />,
        onSelect: onToggleSearch,
      });
    }
    if (onModeChange) {
      view.push({
        id: "read-mode",
        label: "Read mode",
        icon: <ReadIcon />,
        checked: readMode,
        onSelect: () => onModeChange(readMode ? "write" : "read"),
      });
    }
    view.push({
      id: "theme",
      label: resolvedTheme === "dark" ? "Light theme" : "Dark theme",
      icon: <ThemeIcon />,
      onSelect: toggleTheme,
    });
    sections.push({ id: "view", label: "View", items: view });

    if (moreItems?.length) {
      sections.push({
        id: "host",
        label: "More",
        items: moreItems.map((item) => ({
          icon: <SettingsIcon />,
          ...item,
        })),
      });
    }
    return sections;
  }, [
    documentTitle,
    onNewDocument,
    onAddPage,
    addPageDisabled,
    onUndo,
    undoDisabled,
    onRedo,
    redoDisabled,
    onShare,
    shareDisabled,
    shareLabel,
    onExportPdf,
    exportPdfDisabled,
    onOpenBackdrops,
    backdropsActive,
    backdropsDisabled,
    onToggleSearch,
    onModeChange,
    readMode,
    resolvedTheme,
    toggleTheme,
    moreItems,
  ]);

  // ---- roving tabindex over the whole bar ---------------------------------

  const focusOrder = useMemo(() => {
    const ids: string[] = [];
    if (onHome) {
      ids.push("home");
    }
    if (onTogglePagePanel) {
      ids.push(pagesId);
    }
    for (const tool of PRIMARY_TOOLS) {
      ids.push(tool.id);
    }
    if (insertSections.length) {
      ids.push(insertId);
    }
    if (moreSections.length) {
      ids.push(moreId);
    }
    return ids;
  }, [
    onHome,
    onTogglePagePanel,
    pagesId,
    insertSections.length,
    insertId,
    moreSections.length,
    moreId,
  ]);

  const activeFocusId =
    focusId && focusOrder.includes(focusId) ? focusId : focusOrder[0] ?? null;

  const moveFocus = useCallback(
    (delta: number | "first" | "last") => {
      if (!focusOrder.length) {
        return;
      }
      const index = activeFocusId ? focusOrder.indexOf(activeFocusId) : 0;
      const next =
        delta === "first"
          ? 0
          : delta === "last"
          ? focusOrder.length - 1
          : (index + delta + focusOrder.length) % focusOrder.length;
      const id = focusOrder[next];
      setFocusId(id);
      buttonRefs.current.get(id)?.focus();
    },
    [focusOrder, activeFocusId],
  );

  /**
   * Toolbar navigation is bound on the DOCUMENT, in the capture phase, rather
   * than as a React `onKeyDown` on the bar.
   *
   * `goodnotes/paged` claims Arrow/Home/End at document capture to turn the
   * page, and its guard is "the target is inside `.excalidraw`" — which the
   * bar's root is, because that is the scope Excalidraw's colour tokens live
   * in. It calls `stopPropagation()`, so a React handler never sees the key.
   * Capturing at the document and calling `preventDefault()` means the bar
   * gets its keys back (that controller bails on `defaultPrevented`) without
   * either module reaching into the other.
   */
  const moveFocusRef = useLatest(moveFocus);
  const menuOpenRef = useLatest(!!openMenu);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        menuOpenRef.current ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
        return; // an open menu owns the keyboard; modifiers are the host's
      }
      const active = document.activeElement;
      if (
        !(active instanceof HTMLElement) ||
        !barRef.current?.contains(active) ||
        active.closest(".gn-menu")
      ) {
        return;
      }
      const delta =
        event.key === "ArrowRight"
          ? 1
          : event.key === "ArrowLeft"
          ? -1
          : event.key === "Home"
          ? ("first" as const)
          : event.key === "End"
          ? ("last" as const)
          : null;
      if (delta === null) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      moveFocusRef.current(delta);
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [moveFocusRef, menuOpenRef]);

  // ---- rendering ----------------------------------------------------------

  const registerRef = (id: string) => (node: HTMLButtonElement | null) => {
    if (node) {
      buttonRefs.current.set(id, node);
    } else {
      buttonRefs.current.delete(id);
    }
  };

  const tabIndexFor = (id: string) => (activeFocusId === id ? 0 : -1);

  const pagesLabel =
    typeof pageCount === "number" && pageCount > 0
      ? `Pages, page ${currentPage ?? 1} of ${pageCount}`
      : "Pages";

  const titleDescId = documentTitle?.trim()
    ? `${reactId}-doc-title`
    : undefined;

  const anchorPlacement = placement === "fixed" ? "fixed" : "floating";

  return (
    <div
      className={`gn-bar-scope gn-bar-scope--${anchorPlacement} excalidraw${
        resolvedTheme === "dark" ? " theme--dark" : ""
      }${className ? ` ${className}` : ""}`}
      data-testid="goodnotes-navbar"
    >
      <div
        ref={barRef}
        className="gn-bar"
        data-testid="goodnotes-floating-bar"
        role="toolbar"
        aria-label={ariaLabel}
        aria-orientation="horizontal"
      >
        {/* ---- identity ------------------------------------------------- */}
        {onHome && (
          <button
            type="button"
            ref={registerRef("home")}
            className="gn-bar__button"
            data-control="home"
            tabIndex={tabIndexFor("home")}
            aria-describedby={titleDescId}
            title={
              documentTitle?.trim()
                ? `All documents — leaves “${documentTitle.trim()}”`
                : "All documents"
            }
            onFocus={() => setFocusId("home")}
            onClick={onHome}
          >
            <HomeIcon />
            <span className="gn-bar__sr">All documents</span>
          </button>
        )}
        {titleDescId && (
          <span id={titleDescId} className="gn-bar__sr">
            {`Open document: ${documentTitle!.trim()}`}
          </span>
        )}

        {onTogglePagePanel && (
          <button
            type="button"
            id={pagesId}
            ref={registerRef(pagesId)}
            className="gn-bar__button gn-bar__button--wide"
            data-control="pages-panel"
            tabIndex={tabIndexFor(pagesId)}
            aria-haspopup="dialog"
            aria-expanded={!!pagePanelOpen}
            title={pagesLabel}
            onFocus={() => setFocusId(pagesId)}
            onClick={onTogglePagePanel}
          >
            <PagesPanelIcon />
            <span className="gn-bar__sr">{pagesLabel}</span>
            {typeof pageCount === "number" && pageCount > 0 && (
              <span className="gn-bar__count" aria-hidden="true">
                {currentPage ?? 1}/{pageCount}
              </span>
            )}
          </button>
        )}

        <span
          className="gn-bar__separator"
          role="separator"
          aria-orientation="vertical"
        />

        {/* ---- the five tools -------------------------------------------- */}
        {PRIMARY_TOOLS.map((tool) => {
          const isLassoSlot = tool.id === "lasso" && !!onFuzzySelect;
          const pressed = isLassoSlot
            ? !!fuzzySelectActive
            : activeTool === tool.id;
          const disabled =
            readMode || (isLassoSlot ? !!fuzzySelectDisabled : false);
          const label = isLassoSlot
            ? "Lasso select (smart selection)"
            : tool.label;
          return (
            <button
              key={tool.id}
              type="button"
              ref={registerRef(tool.id)}
              className="gn-bar__button gn-bar__button--tool"
              data-control={tool.id}
              tabIndex={tabIndexFor(tool.id)}
              // read mode keeps the toolbar focusable but inert:
              // `aria-disabled`, never `disabled`, so no tab stop disappears
              aria-disabled={disabled || undefined}
              aria-pressed={pressed}
              title={`${label} (${tool.shortcut})`}
              onFocus={() => setFocusId(tool.id)}
              onClick={() => {
                setFocusId(tool.id);
                setOpenMenu(null);
                if (disabled) {
                  return;
                }
                if (isLassoSlot) {
                  onFuzzySelect?.();
                  return;
                }
                selectTool(tool.id);
              }}
            >
              {tool.icon}
              <span className="gn-bar__sr">{label}</span>
            </button>
          );
        })}

        <span
          className="gn-bar__separator"
          role="separator"
          aria-orientation="vertical"
        />

        {/* ---- "+" secondary inserts -------------------------------------- */}
        {insertSections.length > 0 && (
          <div className="gn-bar__slot">
            <button
              type="button"
              id={insertId}
              ref={registerRef(insertId)}
              className="gn-bar__button"
              data-control="insert"
              tabIndex={tabIndexFor(insertId)}
              aria-haspopup="menu"
              aria-expanded={openMenu === "insert"}
              aria-controls={
                openMenu === "insert" ? `${insertId}-menu` : undefined
              }
              title="Insert"
              onFocus={() => setFocusId(insertId)}
              onClick={() => {
                setFocusId(insertId);
                setOpenMenu((open) => (open === "insert" ? null : "insert"));
              }}
            >
              <PlusIcon />
              <span className="gn-bar__sr">Insert — text, shapes and more</span>
            </button>
            {openMenu === "insert" && (
              <TaskbarMenu
                id={`${insertId}-menu`}
                labelledBy={insertId}
                sections={insertSections}
                onClose={(opts) => {
                  setOpenMenu(null);
                  if (opts?.restoreFocus !== false) {
                    buttonRefs.current.get(insertId)?.focus();
                  }
                }}
              />
            )}
          </div>
        )}

        {/* ---- "…" document actions ---------------------------------------- */}
        {moreSections.length > 0 && (
          <div className="gn-bar__slot">
            <button
              type="button"
              id={moreId}
              ref={registerRef(moreId)}
              className="gn-bar__button"
              data-control="more"
              tabIndex={tabIndexFor(moreId)}
              aria-haspopup="menu"
              aria-expanded={openMenu === "more"}
              aria-controls={openMenu === "more" ? `${moreId}-menu` : undefined}
              title="Document actions"
              onFocus={() => setFocusId(moreId)}
              onClick={() => {
                setFocusId(moreId);
                setOpenMenu((open) => (open === "more" ? null : "more"));
              }}
            >
              <MoreIcon />
              <span className="gn-bar__sr">Document actions</span>
            </button>
            {openMenu === "more" && (
              <TaskbarMenu
                id={`${moreId}-menu`}
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
  );
};

export default FloatingBar;
