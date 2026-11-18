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
 *        │ ⌂ · ▤ 2/12 │ ✒ ▰ ⌫ ◌ ▶ ✋ │ + │ … │
 *        └──────────────────────────────────────────────────┘
 * ```
 *
 * Eleven visible controls, in three runs:
 *
 * - **Home · Pages** — where am I. Pages carries a compact "2/12" counter and
 *   opens the page overlay ({@link PagePanel}), which is a dialog, not a
 *   column: it costs nothing when closed.
 * - **pen · highlighter · eraser · lasso · select · hand** — the six tools a
 *   note app actually uses mid-stroke. Everything else is one tap further
 *   away. Hand (pan) is last because it and Select are the non-marking
 *   tools; see {@link HAND_TOOL} for why it earns a permanent slot.
 * - **"+"** — secondary inserts: text, the five shapes, image, sticky note,
 *   import PDF, insert graph.
 * - **"…"** — document actions: new document, add page, undo/redo, share,
 *   export PDF, image backdrop, search, read mode, theme, plus whatever the
 *   host appends through {@link FloatingBarProps.moreItems}.
 *
 * Nothing that the old twenty-odd-control nav bar could reach became
 * unreachable; see `INTEGRATION.md` for the capability audit, and § 9 there
 * for the measured chrome cost of the Hand control (+0.17 pp, 2.10% →
 * 2.27% of a 1194x834 viewport).
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

import { activateExtraTool } from "../tool-menu/editor";

import {
  GraphIcon,
  HandIcon,
  PlusIcon,
  SettingsIcon,
  ThemeIcon,
} from "./icons";

import { BarToolSubmenu } from "./BarToolSubmenu";
import { DockInkOrb } from "./DockInkOrb";

import "./FloatingBar.scss";

import type { ReactNode } from "react";

import type { PenPreset } from "../types";

import type { TaskbarMenuSection } from "../taskbar/Menu";
import type {
  TaskbarMenuItem,
  TaskbarShapeId,
  TaskbarToolId,
} from "../taskbar/model";
import type { ToolMenuToolId } from "../tool-menu/editor";

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

/**
 * Controls that can be pinned to the main bar (always visible) instead of
 * living only inside "+" / "…". Pass a custom list for flexibility, `"all"`
 * for the richest bar, or `"minimal"` for the original lean set.
 */
export type FloatingBarPinnedControl =
  | "title"
  | "undo"
  | "redo"
  | "text"
  | "image"
  | "sticky"
  | "addPage"
  | "share"
  | "exportPdf"
  | "search";

const ALL_PINNED_CONTROLS: readonly FloatingBarPinnedControl[] = [
  "title",
  "undo",
  "redo",
  "text",
  "image",
  "sticky",
  "addPage",
  "share",
  "exportPdf",
  "search",
];

/** Default: slim always-on dock — colour/size live on the under-dock + orb. */
const DEFAULT_PINNED_CONTROLS: readonly FloatingBarPinnedControl[] = [
  "undo",
  "redo",
];

const resolvePinnedControls = (
  value: FloatingBarProps["pinnedControls"],
): ReadonlySet<FloatingBarPinnedControl> => {
  if (value === "minimal") {
    return new Set();
  }
  if (value === "all") {
    return new Set(ALL_PINNED_CONTROLS);
  }
  return new Set(value ?? DEFAULT_PINNED_CONTROLS);
};

const SHAPE_ITEMS: { id: TaskbarShapeId; label: string; icon: ReactNode }[] = [
  { id: "rectangle", label: "Rectangle", icon: <RectangleIcon /> },
  { id: "ellipse", label: "Ellipse", icon: <EllipseIcon /> },
  { id: "diamond", label: "Diamond", icon: <DiamondIcon /> },
  { id: "arrow", label: "Arrow", icon: <ArrowIcon /> },
  { id: "line", label: "Line", icon: <LineIcon /> },
];

/**
 * The five tools that earn a permanent slot, in bar order.
 *
 * ── A shortcut here is a PROMISE, so each one was pressed ──────────────────
 * Every letter a–z and Shift+a–z was pressed in the running app with the
 * canvas focused and `appState.activeTool` read back. Two of the five
 * advertised letters turned out to be wrong, and both were wrong *before*
 * the Hand control existed:
 *
 * - **Highlighter said `H`.** `h` is the editor's own binding for the HAND
 *   tool (`TOOLS.hand: { letterKey: KEYS.H, toggle: true }` in
 *   `packages/excalidraw/components/Tools.tsx`) and nothing in this app ever
 *   bound it to the highlighter. Pressing `h` has always given you the hand
 *   tool; the label simply said otherwise. It is now `Shift+P` — "the other
 *   pen", next to the pen's own `P` — and bound below.
 *
 *   `Shift+H` was the obvious candidate and was REJECTED on measurement: it
 *   is `actionFlipHorizontal` (`keyTest: event.shiftKey && event.code ===
 *   CODES.H`), which arrives already `defaultPrevented` and flips whatever
 *   is selected. `Shift+P` was checked the same way — not
 *   `defaultPrevented`, and inert both with and without a selection.
 * - **Lasso said `Q`.** `q` toggles the editor's TOOL LOCK
 *   (`activeTool.locked`, measured `false -> true -> false`). `TOOLS.lasso`
 *   has no `letterKey` at all, and a scan of all 26 letters reached the
 *   lasso with none of them. The claim is therefore removed rather than
 *   replaced: the slot is usually the host's smart-selection hook
 *   (`onFuzzySelect`), which no engine key could reach anyway.
 *
 * The other three were verified honest: `p` → `freedraw`, `e` → `eraser`,
 * `v` → `selection`.
 *
 * `shortcut: null` means "this control has no keyboard route", and the
 * parenthetical is left off the tooltip entirely — an empty promise is worse
 * than no promise.
 */
const PRIMARY_TOOLS: {
  id: Extract<
    TaskbarToolId,
    "pen" | "highlighter" | "eraser" | "lasso" | "select"
  >;
  label: string;
  icon: ReactNode;
  shortcut: string | null;
}[] = [
  { id: "pen", label: "Pen", icon: <PenIcon />, shortcut: "P" },
  {
    id: "highlighter",
    label: "Highlighter",
    icon: <HighlighterIcon />,
    shortcut: "⇧P",
  },
  { id: "eraser", label: "Eraser", icon: <EraserIcon />, shortcut: "E" },
  { id: "lasso", label: "Lasso select", icon: <LassoIcon />, shortcut: null },
  { id: "select", label: "Select", icon: <SelectIcon />, shortcut: "V" },
];

/**
 * The two ink shortcuts this module binds itself, and why it has to.
 *
 * The highlighter is not an editor tool: it is `freedraw` plus a `customData`
 * marker, so the engine has no binding to give it and never will. `Shift+P`
 * is therefore bound here. The guard list below is the same one
 * `goodnotes/paged`'s controller uses for its arrow keys.
 *
 * `P` is bound here too, and that is not redundant. The engine's `p` gives
 * you `freedraw` and nothing else — it does not clear the highlighter
 * marker. So after `Shift+H`, pressing `p` would leave you highlighting
 * while the Pen tooltip claimed otherwise: exactly the lie this change
 * exists to remove. Binding it makes `P` mean the Pen *slot*, ink and all,
 * the same as tapping the button.
 *
 * Neither binding fights the engine:
 * - `Shift+P` is measured to be unbound. Every `Shift`+letter and every free
 *   plain letter was pressed in the running app, with and without a
 *   selection, and `Shift+P` changed nothing and was not
 *   `defaultPrevented`. (`findToolByKey` in `Tools.tsx` skips a plain-bound
 *   tool when Shift is held, so `freedraw` declines `Shift+P` too.)
 * - the `P` handler listens in the BUBBLE phase on `document`, i.e. after
 *   the editor's own handler has already run, and does not call
 *   `preventDefault` — it completes the engine's action instead of replacing
 *   it, and works whether or not the engine saw the key.
 */
const INK_SHORTCUT_KEYS: Record<string, "pen" | "highlighter"> = {
  p: "pen",
  "shift+p": "highlighter",
};

/**
 * The hand (pan) slot.
 *
 * NOT a {@link TaskbarToolId}: `goodnotes/taskbar`'s model has no `hand`
 * slot and `toolFromAppState` maps the editor's `hand` tool to `null`, so
 * the bar tracks it from `appState.activeTool.type` directly and activates
 * it through `goodnotes/tool-menu`'s `activateExtraTool`. That keeps the
 * taskbar model untouched (this module does not own it) while still never
 * lying about `aria-pressed`.
 *
 * ── Why it earns a permanent slot, as an eleventh control ──────────────────
 * The bar was cut to ten controls on purpose and an extra one is a real
 * cost, so the test applied to the other five tools was applied here: can
 * the user afford to reach it through a menu? No. Panning is a MODE you
 * enter and leave continuously while writing — zoom in to a corner, write,
 * shove the paper, write — and a two-tap mode switch through "…" turns that
 * rhythm into a chore. It is also the only control that makes a zoomed-in
 * page navigable with a mouse or a single finger without a modifier key.
 *
 * It sits last in the tool run, next to Select, because the two are the
 * non-marking tools: everything to the left of them leaves ink.
 */
const HAND_TOOL = {
  id: "hand",
  label: "Hand (pan)",
  shortcut: "H",
} as const;

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
  /**
   * Fired whenever the bar changes the active tool, including to "hand",
   * which is an engine tool rather than one of the bar's own slots — the
   * host needs to hear about that one too, to dismiss surfaces (the lasso
   * overlay) that would otherwise sit on top of it.
   */
  onToolChange?: (tool: TaskbarToolId | "hand", shape?: TaskbarShapeId) => void;

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

  /**
   * `true` while the full Active Tool Menu is open. The compact submenu under
   * the bar carries the same five colours and five widths, and the menu opens
   * directly over it — leaving two orphaned swatches poking out at its edge
   * and three live copies of one control on screen. The submenu is the
   * quick row; while the full panel is up it has nothing to add, so it
   * stands down.
   */
  activeToolMenuOpen?: boolean;

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

  /**
   * Always-visible extras on the main bar. Defaults to title, undo/redo,
   * text, image, add page, and share. Use `"minimal"` for the lean original
   * bar, `"all"` to pin every supported control, or pass a custom list.
   *
   * A control only appears when its host callback exists (e.g. `share` needs
   * `onShare`). Page counter / separators stay visible at every width.
   */
  pinnedControls?: readonly FloatingBarPinnedControl[] | "all" | "minimal";

  /**
   * When true (default), pinned controls are omitted from "+" / "…" so the
   * bar is the single place to reach them. Set false to keep duplicates in
   * menus for discoverability.
   */
  hidePinnedFromMenus?: boolean;

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
  activeToolMenuOpen = false,
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
  pinnedControls,
  hidePinnedFromMenus = true,
  suppressDefaultChrome = false,
  suppressDefaultToolbar = false,
  placement = "floating",
  ariaLabel = "Editor toolbar",
  className,
}: FloatingBarProps) => {
  const pinned = useMemo(
    () => resolvePinnedControls(pinnedControls),
    [pinnedControls],
  );
  const isPinned = useCallback(
    (id: FloatingBarPinnedControl) => pinned.has(id),
    [pinned],
  );
  const reactId = useId().replace(/:/g, "");
  const barRef = useRef<HTMLDivElement | null>(null);
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());

  const [internalTool, setInternalTool] = useState<TaskbarToolId | null>(
    "select",
  );
  const [activeShape, setActiveShape] = useState<TaskbarShapeId>("rectangle");
  const [openMenu, setOpenMenu] = useState<"insert" | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [editorTheme, setEditorTheme] = useState<"light" | "dark">("light");
  /**
   * Mirrored straight from the editor, never from `controlledTool`: `hand`
   * is not a `TaskbarToolId`, so a host driving the bar's active slot has no
   * way to express it.
   */
  const [handActive, setHandActive] = useState(false);

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
      setHandActive(appState.activeTool.type === "hand");
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

  /**
   * Hand is a TOGGLE, not a one-way trip: pressing it while it is active
   * goes back to Select. Without that, a bar whose other tools all swap
   * straight to another tool would leave the one mode you cannot leave by
   * pressing the same button again.
   */
  const toggleHand = useCallback(() => {
    if (readMode || !excalidrawAPI || excalidrawAPI.isDestroyed) {
      return;
    }
    if (excalidrawAPI.getAppState().activeTool.type === "hand") {
      activateTool(excalidrawAPI, "select");
      setInternalTool("select");
      setHandActive(false);
      onToolChangeRef.current?.("select");
      return;
    }
    activateExtraTool(excalidrawAPI, "hand");
    setHandActive(true);
    // Announce the way IN as well as the way out. Every other control on
    // this bar reports its tool change, and the host uses that to drop the
    // lasso overlay; hand reported only on the way back to Select, so
    // picking Hand while the lasso was on left the overlay live on top of
    // it — two buttons showing as pressed and the canvas swallowing the
    // drag.
    onToolChangeRef.current?.("hand");
  }, [readMode, excalidrawAPI, onToolChangeRef]);

  /**
   * The ink shortcuts. See {@link INK_SHORTCUT_KEYS} for why this module
   * binds any key at all, and why neither binding fights the engine.
   *
   * It calls `activateTool` rather than {@link selectTool} on purpose: a
   * keyboard shortcut must never open the Active Tool Menu, which
   * `selectTool` does when the tool you ask for is already the active one.
   */
  const runInkShortcut = useLatest((tool: "pen" | "highlighter") => {
    if (readMode || !excalidrawAPI || excalidrawAPI.isDestroyed) {
      return;
    }
    activateTool(excalidrawAPI, tool, {
      pen: penPreset,
      highlighter: highlighterPreset,
    });
    setInternalTool(tool);
    setHandActive(false);
    onToolChangeRef.current?.(tool);
  });

  useEffect(() => {
    if (typeof document === "undefined" || !excalidrawAPI) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.repeat
      ) {
        return;
      }
      const combo = `${
        event.shiftKey ? "shift+" : ""
      }${event.key.toLowerCase()}`;
      const tool = INK_SHORTCUT_KEYS[combo];
      if (!tool) {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT")
      ) {
        return; // the user is typing
      }
      // the editor or this bar must own the keyboard — not an open menu,
      // and not some other app surface (the shelf, a dialog, settings)
      const owned =
        target === document.body ||
        (target instanceof Element &&
          !target.closest(".gn-menu") &&
          !!(
            target.closest(".excalidraw-container") || target.closest(".gn-bar")
          ));
      if (!owned) {
        return;
      }
      const appState = excalidrawAPI.getAppState();
      if (appState.editingTextElement || appState.openDialog) {
        return;
      }
      if (event.shiftKey) {
        // Shift+P reaches no engine tool, so this handler is the whole
        // binding and must claim the key. Plain `p` is deliberately NOT
        // claimed — see `INK_SHORTCUT_KEYS`.
        event.preventDefault();
      }
      runInkShortcut.current(tool);
    };
    // BUBBLE phase, so the editor's own handler has already run
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [excalidrawAPI, runInkShortcut]);

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
  const pagesId = `${reactId}-pages`;

  const insertSections = useMemo<TaskbarMenuSection[]>(() => {
    const sections: TaskbarMenuSection[] = [];
    const place: TaskbarMenuItem[] = [];
    if (!(hidePinnedFromMenus && isPinned("text"))) {
      place.push({
        id: "text",
        label: "Text",
        icon: <TextIcon />,
        checked: activeTool === "text",
        disabled: readMode,
        onSelect: () => selectTool("text"),
      });
    }
    if (!(hidePinnedFromMenus && isPinned("image"))) {
      place.push({
        id: "image",
        label: "Image",
        icon: <ImageIcon />,
        checked: activeTool === "image",
        disabled: readMode,
        onSelect: () => selectTool("image"),
      });
    }
    if (!(hidePinnedFromMenus && isPinned("sticky"))) {
      place.push({
        id: "sticky",
        label: "Sticky note",
        icon: <StickyIcon />,
        checked: activeTool === "sticky",
        disabled: readMode,
        onSelect: () => selectTool("sticky"),
      });
    }
    if (place.length) {
      sections.push({ id: "place", label: "Insert", items: place });
    }

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
    hidePinnedFromMenus,
    isPinned,
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
    if (onAddPage && !(hidePinnedFromMenus && isPinned("addPage"))) {
      doc.push({
        id: "add-page",
        label: "Add page",
        icon: <AddPageIcon />,
        disabled: addPageDisabled,
        onSelect: onAddPage,
      });
    }
    if (onUndo && !(hidePinnedFromMenus && isPinned("undo"))) {
      doc.push({
        id: "undo",
        label: "Undo",
        icon: <UndoIcon />,
        disabled: undoDisabled,
        onSelect: onUndo,
      });
    }
    if (onRedo && !(hidePinnedFromMenus && isPinned("redo"))) {
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
    if (onShare && !(hidePinnedFromMenus && isPinned("share"))) {
      out.push({
        id: "share",
        label: shareLabel,
        icon: <ShareIcon />,
        disabled: shareDisabled,
        onSelect: onShare,
      });
    }
    if (onExportPdf && !(hidePinnedFromMenus && isPinned("exportPdf"))) {
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
    if (onToggleSearch && !(hidePinnedFromMenus && isPinned("search"))) {
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
    hidePinnedFromMenus,
    isPinned,
  ]);

  /**
   * The "…" control is gone: document actions fold into the "+" overflow so
   * the dock stays one row of tools. Present / settings / theme / share stay
   * reachable from that same menu.
   */
  const overflowSections = useMemo<TaskbarMenuSection[]>(
    () => [...insertSections, ...moreSections],
    [insertSections, moreSections],
  );

  const showPinnedTitle = isPinned("title") && !!documentTitle?.trim();
  const showPinnedText = isPinned("text");
  const showPinnedImage = isPinned("image");
  const showPinnedSticky = isPinned("sticky");
  const showPinnedUndo = isPinned("undo") && !!onUndo;
  const showPinnedRedo = isPinned("redo") && !!onRedo;
  const showPinnedAddPage = isPinned("addPage") && !!onAddPage;
  const showPinnedShare = isPinned("share") && !!onShare;
  const showPinnedExport = isPinned("exportPdf") && !!onExportPdf;
  const showPinnedSearch = isPinned("search") && !!onToggleSearch;
  const showPinnedActionCluster =
    showPinnedUndo ||
    showPinnedRedo ||
    showPinnedAddPage ||
    showPinnedShare ||
    showPinnedExport ||
    showPinnedSearch;

  // ---- roving tabindex over the whole bar ---------------------------------

  const focusOrder = useMemo(() => {
    const ids: string[] = [];
    if (onHome) {
      ids.push("home");
    }
    if (onNewDocument) {
      ids.push("new-document");
    }
    if (onTogglePagePanel) {
      ids.push(pagesId);
    }
    for (const tool of PRIMARY_TOOLS) {
      ids.push(tool.id);
    }
    ids.push(HAND_TOOL.id);
    if (showPinnedText) {
      ids.push("pin-text");
    }
    if (showPinnedImage) {
      ids.push("pin-image");
    }
    if (showPinnedSticky) {
      ids.push("pin-sticky");
    }
    if (overflowSections.length) {
      ids.push(insertId);
    }
    if (showPinnedUndo) {
      ids.push("pin-undo");
    }
    if (showPinnedRedo) {
      ids.push("pin-redo");
    }
    if (showPinnedAddPage) {
      ids.push("pin-add-page");
    }
    if (showPinnedShare) {
      ids.push("pin-share");
    }
    if (showPinnedExport) {
      ids.push("pin-export");
    }
    if (showPinnedSearch) {
      ids.push("pin-search");
    }
    return ids;
  }, [
    onHome,
    onNewDocument,
    onTogglePagePanel,
    pagesId,
    overflowSections.length,
    insertId,
    showPinnedText,
    showPinnedImage,
    showPinnedSticky,
    showPinnedUndo,
    showPinnedRedo,
    showPinnedAddPage,
    showPinnedShare,
    showPinnedExport,
    showPinnedSearch,
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

  const submenuTool: ToolMenuToolId | null =
    activeTool === "pen" ||
    activeTool === "highlighter" ||
    activeTool === "eraser" ||
    activeTool === "shape" ||
    activeTool === "text"
      ? activeTool
      : null;

  return (
    <div
      className={`gn-bar-scope gn-bar-scope--${anchorPlacement} excalidraw${
        resolvedTheme === "dark" ? " theme--dark" : ""
      }${className ? ` ${className}` : ""}`}
      data-testid="goodnotes-navbar"
    >
      <div className="gn-bar-stack">
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

          {onNewDocument && (
            <button
              type="button"
              ref={registerRef("new-document")}
              className="gn-bar__button"
              data-control="new-document"
              data-testid="goodnotes-new-document"
              tabIndex={tabIndexFor("new-document")}
              title={
                typeof navigator !== "undefined" &&
                /Mac|iPhone|iPad|iPod/i.test(
                  navigator.platform || navigator.userAgent,
                )
                  ? "New document (⌘N)"
                  : "New document (Ctrl+N)"
              }
              aria-keyshortcuts="Control+N Meta+N"
              onFocus={() => setFocusId("new-document")}
              onClick={onNewDocument}
            >
              <NewDocumentIcon />
              <span className="gn-bar__sr">New document</span>
            </button>
          )}

          {showPinnedTitle && (
            <span className="gn-bar__title" title={documentTitle!.trim()}>
              {documentTitle!.trim()}
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
                title={tool.shortcut ? `${label} (${tool.shortcut})` : label}
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

          <button
            type="button"
            ref={registerRef(HAND_TOOL.id)}
            className="gn-bar__button gn-bar__button--tool"
            data-control={HAND_TOOL.id}
            tabIndex={tabIndexFor(HAND_TOOL.id)}
            aria-disabled={readMode || undefined}
            aria-pressed={handActive}
            title={`${HAND_TOOL.label} (${HAND_TOOL.shortcut})`}
            onFocus={() => setFocusId(HAND_TOOL.id)}
            onClick={() => {
              setFocusId(HAND_TOOL.id);
              setOpenMenu(null);
              toggleHand();
            }}
          >
            <HandIcon />
            <span className="gn-bar__sr">{HAND_TOOL.label}</span>
          </button>

          <span
            className="gn-bar__separator"
            role="separator"
            aria-orientation="vertical"
          />

          {/* ---- pinned inserts (always on the bar) -------------------------- */}
          {showPinnedText && (
            <button
              type="button"
              ref={registerRef("pin-text")}
              className="gn-bar__button gn-bar__button--tool"
              data-control="pin-text"
              tabIndex={tabIndexFor("pin-text")}
              aria-disabled={readMode || undefined}
              aria-pressed={activeTool === "text"}
              title="Text"
              onFocus={() => setFocusId("pin-text")}
              onClick={() => {
                setFocusId("pin-text");
                setOpenMenu(null);
                if (!readMode) {
                  selectTool("text");
                }
              }}
            >
              <TextIcon />
              <span className="gn-bar__sr">Text</span>
            </button>
          )}
          {showPinnedImage && (
            <button
              type="button"
              ref={registerRef("pin-image")}
              className="gn-bar__button gn-bar__button--tool"
              data-control="pin-image"
              tabIndex={tabIndexFor("pin-image")}
              aria-disabled={readMode || undefined}
              aria-pressed={activeTool === "image"}
              title="Image"
              onFocus={() => setFocusId("pin-image")}
              onClick={() => {
                setFocusId("pin-image");
                setOpenMenu(null);
                if (!readMode) {
                  selectTool("image");
                }
              }}
            >
              <ImageIcon />
              <span className="gn-bar__sr">Image</span>
            </button>
          )}
          {showPinnedSticky && (
            <button
              type="button"
              ref={registerRef("pin-sticky")}
              className="gn-bar__button gn-bar__button--tool"
              data-control="pin-sticky"
              tabIndex={tabIndexFor("pin-sticky")}
              aria-disabled={readMode || undefined}
              aria-pressed={activeTool === "sticky"}
              title="Sticky note"
              onFocus={() => setFocusId("pin-sticky")}
              onClick={() => {
                setFocusId("pin-sticky");
                setOpenMenu(null);
                if (!readMode) {
                  selectTool("sticky");
                }
              }}
            >
              <StickyIcon />
              <span className="gn-bar__sr">Sticky note</span>
            </button>
          )}

          {/* ---- "+" overflow (insert + former "…" document actions) -------- */}
          {overflowSections.length > 0 && (
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
                title="Insert and document actions"
                onFocus={() => setFocusId(insertId)}
                onClick={() => {
                  setFocusId(insertId);
                  setOpenMenu((open) => (open === "insert" ? null : "insert"));
                }}
              >
                <PlusIcon />
                <span className="gn-bar__sr">
                  Insert, share, settings and more
                </span>
              </button>
              {openMenu === "insert" && (
                <TaskbarMenu
                  id={`${insertId}-menu`}
                  labelledBy={insertId}
                  sections={overflowSections}
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

          {showPinnedActionCluster && (
            <span
              className="gn-bar__separator"
              role="separator"
              aria-orientation="vertical"
            />
          )}

          {showPinnedUndo && (
            <button
              type="button"
              ref={registerRef("pin-undo")}
              className="gn-bar__button"
              data-control="pin-undo"
              tabIndex={tabIndexFor("pin-undo")}
              disabled={undoDisabled}
              title="Undo"
              onFocus={() => setFocusId("pin-undo")}
              onClick={() => {
                setFocusId("pin-undo");
                setOpenMenu(null);
                onUndo?.();
              }}
            >
              <UndoIcon />
              <span className="gn-bar__sr">Undo</span>
            </button>
          )}
          {showPinnedRedo && (
            <button
              type="button"
              ref={registerRef("pin-redo")}
              className="gn-bar__button"
              data-control="pin-redo"
              tabIndex={tabIndexFor("pin-redo")}
              disabled={redoDisabled}
              title="Redo"
              onFocus={() => setFocusId("pin-redo")}
              onClick={() => {
                setFocusId("pin-redo");
                setOpenMenu(null);
                onRedo?.();
              }}
            >
              <RedoIcon />
              <span className="gn-bar__sr">Redo</span>
            </button>
          )}
          {showPinnedAddPage && (
            <button
              type="button"
              ref={registerRef("pin-add-page")}
              className="gn-bar__button"
              data-control="pin-add-page"
              tabIndex={tabIndexFor("pin-add-page")}
              disabled={addPageDisabled}
              title="Add page"
              onFocus={() => setFocusId("pin-add-page")}
              onClick={() => {
                setFocusId("pin-add-page");
                setOpenMenu(null);
                onAddPage?.();
              }}
            >
              <AddPageIcon />
              <span className="gn-bar__sr">Add page</span>
            </button>
          )}
          {showPinnedShare && (
            <button
              type="button"
              ref={registerRef("pin-share")}
              className="gn-bar__button"
              data-control="pin-share"
              tabIndex={tabIndexFor("pin-share")}
              disabled={shareDisabled}
              title={shareLabel}
              onFocus={() => setFocusId("pin-share")}
              onClick={() => {
                setFocusId("pin-share");
                setOpenMenu(null);
                onShare?.();
              }}
            >
              <ShareIcon />
              <span className="gn-bar__sr">{shareLabel}</span>
            </button>
          )}
          {showPinnedExport && (
            <button
              type="button"
              ref={registerRef("pin-export")}
              className="gn-bar__button"
              data-control="pin-export"
              tabIndex={tabIndexFor("pin-export")}
              disabled={exportPdfDisabled}
              title="Export to PDF"
              onFocus={() => setFocusId("pin-export")}
              onClick={() => {
                setFocusId("pin-export");
                setOpenMenu(null);
                onExportPdf?.();
              }}
            >
              <ExportPdfIcon />
              <span className="gn-bar__sr">Export to PDF</span>
            </button>
          )}
          {showPinnedSearch && (
            <button
              type="button"
              ref={registerRef("pin-search")}
              className="gn-bar__button"
              data-control="pin-search"
              tabIndex={tabIndexFor("pin-search")}
              title="Search"
              onFocus={() => setFocusId("pin-search")}
              onClick={() => {
                setFocusId("pin-search");
                setOpenMenu(null);
                onToggleSearch?.();
              }}
            >
              <SearchIcon />
              <span className="gn-bar__sr">Search</span>
            </button>
          )}
        </div>
        {!readMode && !activeToolMenuOpen && (
          <BarToolSubmenu
            excalidrawAPI={excalidrawAPI}
            activeTool={submenuTool}
            compact
          />
        )}
      </div>
      {!readMode && (
        <DockInkOrb excalidrawAPI={excalidrawAPI} activeTool={submenuTool} />
      )}
    </div>
  );
};

export default FloatingBar;
