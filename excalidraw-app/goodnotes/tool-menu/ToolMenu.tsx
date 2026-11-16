import { FONT_FAMILY, FONT_SIZES } from "@excalidraw/common";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";

import type { StrokeVariability } from "@excalidraw/element/types";
import type {
  AppState,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";

import {
  PEN_WIDTHS,
  loadPenPresets,
  resetPenPresets,
  savePenPresets,
} from "../pens/presets";

import {
  activateTool,
  applyInk,
  applyPreset,
  applyShapeStyle,
  applyTextStyle,
  isHighlighterActive,
  setToolLocked,
  shapeFromAppState,
} from "./editor";
import {
  EDGE_MARGIN,
  describePosition,
  loadToolMenuPosition,
  moveByKeyboard,
  placementToPixels,
  saveToolMenuPosition,
  snapToEdge,
} from "./position";

import "./ToolMenu.scss";

import type {
  ToolMenuShapeId,
  ToolMenuToolId,
  ToolMenuWidthKey,
} from "./editor";
import type { ToolMenuPosition } from "./position";
import type { PenPreset } from "../types";

/* -------------------------------------------------------------------------- */
/*  Palettes                                                                    */
/* -------------------------------------------------------------------------- */

interface Swatch {
  value: string;
  label: string;
}

/**
 * Five ink colours, shown as DIRECT one-tap controls. The GoodNotes UI study
 * this panel is a response to found colour buried two submenus deep; nothing
 * here is nested.
 */
const INK_SWATCHES: readonly Swatch[] = [
  { value: "#1e1e1e", label: "Black" },
  { value: "#e03131", label: "Red" },
  { value: "#1971c2", label: "Blue" },
  { value: "#2f9e44", label: "Green" },
  { value: "#f08c00", label: "Orange" },
];

const HIGHLIGHTER_SWATCHES: readonly Swatch[] = [
  { value: "#ffd43b", label: "Yellow" },
  { value: "#a9e34b", label: "Lime" },
  { value: "#66d9e8", label: "Cyan" },
  { value: "#ffa8a8", label: "Pink" },
  { value: "#d0bfff", label: "Lilac" },
];

const FILL_SWATCHES: readonly Swatch[] = [
  { value: "transparent", label: "No fill" },
  { value: "#ffc9c9", label: "Red fill" },
  { value: "#b2f2bb", label: "Green fill" },
  { value: "#a5d8ff", label: "Blue fill" },
  { value: "#ffec99", label: "Yellow fill" },
];

const WIDTH_OPTIONS: readonly { value: ToolMenuWidthKey; label: string }[] = [
  { value: "thin", label: "Thin" },
  { value: "medium", label: "Medium" },
  { value: "bold", label: "Bold" },
];

const SHAPE_OPTIONS: readonly { value: ToolMenuShapeId; label: string }[] = [
  { value: "rectangle", label: "Rectangle" },
  { value: "ellipse", label: "Ellipse" },
  { value: "diamond", label: "Diamond" },
  { value: "arrow", label: "Arrow" },
  { value: "line", label: "Line" },
];

const FONT_SIZE_OPTIONS: readonly { value: number; label: string }[] = [
  { value: FONT_SIZES.sm, label: "Small" },
  { value: FONT_SIZES.md, label: "Medium" },
  { value: FONT_SIZES.lg, label: "Large" },
  { value: FONT_SIZES.xl, label: "Extra large" },
];

const FONT_FAMILY_OPTIONS: readonly {
  value: AppState["currentItemFontFamily"];
  label: string;
}[] = [
  {
    value: FONT_FAMILY.Excalifont as AppState["currentItemFontFamily"],
    label: "Hand-drawn",
  },
  {
    value: FONT_FAMILY.Nunito as AppState["currentItemFontFamily"],
    label: "Normal",
  },
  {
    value: FONT_FAMILY["Comic Shanns"] as AppState["currentItemFontFamily"],
    label: "Code",
  },
];

const TOOL_TITLES: Record<ToolMenuToolId, string> = {
  pen: "Pen",
  highlighter: "Highlighter",
  eraser: "Eraser",
  shape: "Shape",
  text: "Text",
};

/* -------------------------------------------------------------------------- */
/*  Editor state mirror                                                         */
/* -------------------------------------------------------------------------- */

interface EditorStyle {
  strokeColor: string;
  backgroundColor: string;
  widthKey: ToolMenuWidthKey;
  opacity: number;
  variability: StrokeVariability;
  roundness: AppState["currentItemRoundness"];
  fontSize: number;
  fontFamily: AppState["currentItemFontFamily"];
  shape: ToolMenuShapeId | null;
  locked: boolean;
  highlighter: boolean;
  theme: "light" | "dark";
}

const readStyle = (appState: AppState): EditorStyle => ({
  strokeColor: appState.currentItemStrokeColor,
  backgroundColor: appState.currentItemBackgroundColor,
  widthKey: appState.currentItemStrokeWidthKey,
  opacity: appState.currentItemOpacity,
  variability: appState.currentItemStrokeVariability,
  roundness: appState.currentItemRoundness,
  fontSize: appState.currentItemFontSize,
  fontFamily: appState.currentItemFontFamily,
  shape: shapeFromAppState(appState),
  locked: appState.activeTool.locked,
  highlighter: isHighlighterActive(appState),
  theme: appState.theme === "dark" ? "dark" : "light",
});

const FALLBACK_STYLE: EditorStyle = {
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  widthKey: "medium",
  opacity: 100,
  variability: "constant",
  roundness: "round",
  fontSize: FONT_SIZES.md,
  fontFamily: FONT_FAMILY.Excalifont as AppState["currentItemFontFamily"],
  shape: null,
  locked: false,
  highlighter: false,
  theme: "light",
};

/** Mirror the handful of `appState` keys the panel reflects. */
const useEditorStyle = (
  excalidrawAPI: ExcalidrawImperativeAPI | null,
): EditorStyle => {
  const [style, setStyle] = useState<EditorStyle>(() =>
    excalidrawAPI && !excalidrawAPI.isDestroyed
      ? readStyle(excalidrawAPI.getAppState())
      : FALLBACK_STYLE,
  );

  useEffect(() => {
    if (!excalidrawAPI || excalidrawAPI.isDestroyed) {
      return;
    }
    setStyle(readStyle(excalidrawAPI.getAppState()));
    return excalidrawAPI.onChange((_elements, appState) => {
      const next = readStyle(appState);
      setStyle((current) =>
        (Object.keys(next) as (keyof EditorStyle)[]).every(
          (key) => current[key] === next[key],
        )
          ? current
          : next,
      );
    });
  }, [excalidrawAPI]);

  return style;
};

/* -------------------------------------------------------------------------- */
/*  Small accessible primitives                                                 */
/* -------------------------------------------------------------------------- */

const Group = ({
  legend,
  children,
  className,
}: {
  legend: string;
  children: ReactNode;
  className?: string;
}) => (
  <fieldset className={`gn-tool-menu__group ${className ?? ""}`.trim()}>
    <legend className="gn-tool-menu__legend">{legend}</legend>
    <div className="gn-tool-menu__row">{children}</div>
  </fieldset>
);

/**
 * A native `<input type="radio">` in a label. Native radios (rather than
 * `role="radio"` on a div) give arrow-key roving, group semantics and the
 * checked state for free, in every AT.
 */
const Radio = <T extends string | number>({
  name,
  value,
  checked,
  label,
  onSelect,
  children,
  className,
}: {
  name: string;
  value: T;
  checked: boolean;
  label: string;
  onSelect: (value: T) => void;
  children?: ReactNode;
  className?: string;
}) => (
  <label className={`gn-tool-menu__radio ${className ?? ""}`.trim()}>
    <input
      type="radio"
      className="gn-tool-menu__radio-input"
      name={name}
      checked={checked}
      value={String(value)}
      onChange={() => onSelect(value)}
    />
    {children ?? <span className="gn-tool-menu__radio-text">{label}</span>}
    {children ? <span className="gn-tool-menu__sr-only">{label}</span> : null}
  </label>
);

/* -------------------------------------------------------------------------- */
/*  Props                                                                       */
/* -------------------------------------------------------------------------- */

export interface ToolMenuProps {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  /** Whether the panel is shown. Nothing renders when `false`. */
  open: boolean;
  /** Which tool's settings to show. Nothing renders when `null`. */
  tool: ToolMenuToolId | null;
  /** Called on Escape, on the close button, and when the tool loses support. */
  onClose: () => void;
  /**
   * Fired when the panel itself switches the editor's tool (a preset chip, or
   * a shape-kind radio). Lets a nav bar keep its own highlight in sync.
   */
  onToolChange?: (tool: ToolMenuToolId) => void;
  /**
   * Scope Excalidraw's CSS custom properties onto the panel's own root. Pass
   * this ONLY when the panel is mounted outside `<Excalidraw>`; inside it, the
   * properties are already in scope and the extra `.excalidraw` class is
   * unnecessary. Defaults to the editor's own theme when omitted.
   */
  scopeTheme?: "light" | "dark" | false;
  className?: string;
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The floating "Active Tool Menu": a small panel showing the settings for the
 * tool that is currently active, instead of a permanently-docked ribbon.
 */
export const ToolMenu = ({
  excalidrawAPI,
  open,
  tool,
  onClose,
  onToolChange,
  scopeTheme,
  className,
}: ToolMenuProps) => {
  const style = useEditorStyle(excalidrawAPI);
  const panelRef = useRef<HTMLDivElement | null>(null);

  /* ---------------------------- presets ---------------------------------- */

  const [presets, setPresets] = useState<PenPreset[]>(() => loadPenPresets());
  const [activePresetId, setActivePresetId] = useState<string | null>(null);

  const visiblePresets = useMemo(() => {
    if (tool === "pen") {
      return presets.filter((preset) => preset.tool === "freedraw");
    }
    if (tool === "highlighter") {
      return presets.filter((preset) => preset.tool === "highlighter");
    }
    if (tool === "eraser") {
      return presets.filter((preset) => preset.tool === "eraser");
    }
    return [];
  }, [presets, tool]);

  /**
   * Live editing: while a preset chip is selected, every colour / width /
   * opacity change is written back onto that preset and persisted, which is
   * what makes the retired PenTray's saved pens keep working here.
   */
  const updateActivePreset = useCallback((patch: Partial<PenPreset>) => {
    setActivePresetId((id) => {
      if (id) {
        setPresets((current) => {
          const next = current.map((preset) =>
            preset.id === id ? { ...preset, ...patch } : preset,
          );
          savePenPresets(next);
          return next;
        });
      }
      return id;
    });
  }, []);

  const onPresetClick = useCallback(
    (preset: PenPreset) => {
      setActivePresetId(preset.id);
      applyPreset(excalidrawAPI, preset);
      onToolChange?.(
        preset.tool === "eraser"
          ? "eraser"
          : preset.tool === "highlighter"
          ? "highlighter"
          : "pen",
      );
    },
    [excalidrawAPI, onToolChange],
  );

  const onResetPresets = useCallback(() => {
    setPresets(resetPenPresets());
    setActivePresetId(null);
  }, []);

  /* ---------------------------- position --------------------------------- */

  const [position, setPosition] = useState<ToolMenuPosition>(() =>
    loadToolMenuPosition(),
  );
  const [panelSize, setPanelSize] = useState({ width: 264, height: 240 });
  const [drag, setDrag] = useState<{ left: number; top: number } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [viewport, setViewport] = useState(() => ({
    width: typeof window === "undefined" ? 1024 : window.innerWidth,
    height: typeof window === "undefined" ? 768 : window.innerHeight,
  }));

  useEffect(() => {
    const onResize = () =>
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useLayoutEffect(() => {
    const node = panelRef.current;
    if (!node) {
      return;
    }
    const measure = () => {
      const rect = node.getBoundingClientRect();
      setPanelSize((current) =>
        Math.abs(current.width - rect.width) < 1 &&
        Math.abs(current.height - rect.height) < 1
          ? current
          : { width: rect.width, height: rect.height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [open, tool]);

  const placement = useMemo(
    () => drag ?? placementToPixels(position, panelSize, viewport),
    [drag, position, panelSize, viewport],
  );

  const commitPosition = useCallback((next: ToolMenuPosition) => {
    setPosition(next);
    saveToolMenuPosition(next);
  }, []);

  const dragStateRef = useRef<{
    pointerId: number;
    dx: number;
    dy: number;
  } | null>(null);

  const onHandlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0 && event.pointerType === "mouse") {
        return;
      }
      const node = panelRef.current;
      if (!node) {
        return;
      }
      const rect = node.getBoundingClientRect();
      dragStateRef.current = {
        pointerId: event.pointerId,
        dx: event.clientX - rect.left,
        dy: event.clientY - rect.top,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      setDrag({ left: rect.left, top: rect.top });
      event.preventDefault();
    },
    [],
  );

  const onHandlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const state = dragStateRef.current;
      if (!state || state.pointerId !== event.pointerId) {
        return;
      }
      setDrag({
        left: Math.min(
          viewport.width - panelSize.width,
          Math.max(0, event.clientX - state.dx),
        ),
        top: Math.min(
          viewport.height - panelSize.height,
          Math.max(0, event.clientY - state.dy),
        ),
      });
    },
    [panelSize, viewport],
  );

  const endDrag = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const state = dragStateRef.current;
      if (!state || state.pointerId !== event.pointerId) {
        return;
      }
      dragStateRef.current = null;
      setDrag((current) => {
        if (current) {
          const snapped = snapToEdge(current, panelSize, viewport);
          commitPosition({
            edge: snapped.edge,
            offsets: { ...position.offsets, [snapped.edge]: snapped.offset },
          });
        }
        return null;
      });
    },
    [commitPosition, panelSize, position.offsets, viewport],
  );

  const onHandleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      const result = moveByKeyboard(
        position,
        event.key,
        event.shiftKey,
        panelSize,
        viewport,
      );
      if (!result) {
        return;
      }
      event.preventDefault();
      commitPosition(result.position);
      setAnnouncement(result.announcement);
    },
    [commitPosition, panelSize, position, viewport],
  );

  /* ---------------------------- escape ----------------------------------- */

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.stopPropagation();
        onClose();
      }
    };
    // capture phase: Excalidraw also listens for Escape on window
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose]);

  if (!open || !tool) {
    return null;
  }

  /* ---------------------------- handlers --------------------------------- */

  const onColor = (color: string) => {
    applyInk(excalidrawAPI, { color });
    updateActivePreset({ color });
  };

  const onWidth = (widthKey: ToolMenuWidthKey) => {
    applyInk(excalidrawAPI, { widthKey });
    updateActivePreset({ width: PEN_WIDTHS[widthKey] });
  };

  const onOpacity = (opacity: number) => {
    applyInk(excalidrawAPI, { opacity });
    updateActivePreset({ opacity });
  };

  const swatches = tool === "highlighter" ? HIGHLIGHTER_SWATCHES : INK_SWATCHES;
  const isCustomColor = !swatches.some(
    (swatch) => swatch.value.toLowerCase() === style.strokeColor.toLowerCase(),
  );

  const colorGroup = (legend: string, onPick: (color: string) => void) => (
    <Group legend={legend} className="gn-tool-menu__group--swatches">
      {swatches.map((swatch) => (
        <Radio
          key={swatch.value}
          name="gn-tool-menu-color"
          value={swatch.value}
          checked={
            swatch.value.toLowerCase() === style.strokeColor.toLowerCase()
          }
          label={`${swatch.label} ink`}
          onSelect={onPick}
          className="gn-tool-menu__radio--swatch"
        >
          <span
            className="gn-tool-menu__swatch"
            aria-hidden="true"
            style={{ ["--gn-swatch" as string]: swatch.value }}
          />
        </Radio>
      ))}
      <label
        className="gn-tool-menu__radio gn-tool-menu__radio--swatch gn-tool-menu__custom"
        data-active={isCustomColor || undefined}
      >
        <input
          type="color"
          className="gn-tool-menu__color-input"
          value={
            /^#[0-9a-f]{6}$/i.test(style.strokeColor)
              ? style.strokeColor
              : "#1e1e1e"
          }
          onChange={(event) => onPick(event.target.value)}
        />
        <span
          className="gn-tool-menu__swatch gn-tool-menu__swatch--custom"
          aria-hidden="true"
          style={{
            ["--gn-swatch" as string]: isCustomColor
              ? style.strokeColor
              : "transparent",
          }}
        >
          +
        </span>
        <span className="gn-tool-menu__sr-only">Custom colour</span>
      </label>
    </Group>
  );

  const widthGroup = (onPick: (key: ToolMenuWidthKey) => void) => (
    <Group legend="Width" className="gn-tool-menu__group--widths">
      {WIDTH_OPTIONS.map((option) => (
        <Radio
          key={option.value}
          name="gn-tool-menu-width"
          value={option.value}
          checked={style.widthKey === option.value}
          label={`${option.label} width`}
          onSelect={onPick}
          className="gn-tool-menu__radio--width"
        >
          <span
            className="gn-tool-menu__width-dot"
            aria-hidden="true"
            data-width={option.value}
          />
        </Radio>
      ))}
    </Group>
  );

  const opacityControl = (onChange: (value: number) => void) => (
    <div className="gn-tool-menu__field">
      <label className="gn-tool-menu__legend" htmlFor="gn-tool-menu-opacity">
        Opacity
      </label>
      <input
        id="gn-tool-menu-opacity"
        className="gn-tool-menu__range"
        type="range"
        min={10}
        max={100}
        step={5}
        value={style.opacity}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <output className="gn-tool-menu__output" htmlFor="gn-tool-menu-opacity">
        {style.opacity}%
      </output>
    </div>
  );

  const presetChips =
    visiblePresets.length > 0 ? (
      <Group legend="Saved pens" className="gn-tool-menu__group--presets">
        {visiblePresets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className="gn-tool-menu__chip"
            aria-pressed={preset.id === activePresetId}
            onClick={() => onPresetClick(preset)}
          >
            <span
              className="gn-tool-menu__chip-dot"
              aria-hidden="true"
              style={{
                ["--gn-swatch" as string]:
                  preset.tool === "eraser" ? "transparent" : preset.color,
              }}
            />
            {preset.label}
          </button>
        ))}
        <button
          type="button"
          className="gn-tool-menu__text-button"
          onClick={onResetPresets}
        >
          Reset pens
        </button>
      </Group>
    ) : null;

  /* ---------------------------- panels ----------------------------------- */

  let body: ReactNode = null;

  if (tool === "pen" || tool === "highlighter") {
    body = (
      <>
        {presetChips}
        {colorGroup(tool === "highlighter" ? "Colour" : "Ink", onColor)}
        {widthGroup(onWidth)}
        {tool === "highlighter" ? opacityControl(onOpacity) : null}
        {tool === "pen" ? (
          <>
            <Group legend="Nib" className="gn-tool-menu__group--nib">
              {(
                [
                  { value: "variable", label: "Fountain (tapered)" },
                  { value: "constant", label: "Ballpoint (even)" },
                ] as const
              ).map((option) => (
                <Radio
                  key={option.value}
                  name="gn-tool-menu-nib"
                  value={option.value}
                  checked={style.variability === option.value}
                  label={option.label}
                  onSelect={(value) =>
                    applyInk(excalidrawAPI, {
                      variability: value as StrokeVariability,
                    })
                  }
                />
              ))}
            </Group>
            <p className="gn-tool-menu__note">
              Fountain and ballpoint map onto Excalidraw&rsquo;s real stroke
              pressure setting. A pencil nib would need a stroke texture the
              editor does not have, so it is not offered here.
            </p>
          </>
        ) : null}
      </>
    );
  } else if (tool === "eraser") {
    body = (
      <>
        {presetChips}
        <p className="gn-tool-menu__note">
          Excalidraw&rsquo;s eraser removes a whole stroke on contact. It has no
          brush size and no per-kind filter, so there is nothing here to size or
          to limit to highlighter strokes &mdash; shipping either control would
          be a dial wired to nothing.
        </p>
      </>
    );
  } else if (tool === "shape") {
    body = (
      <>
        <Group legend="Shape" className="gn-tool-menu__group--shapes">
          {SHAPE_OPTIONS.map((option) => (
            <Radio
              key={option.value}
              name="gn-tool-menu-shape"
              value={option.value}
              checked={style.shape === option.value}
              label={option.label}
              onSelect={(value) => {
                activateTool(excalidrawAPI, "shape", {
                  shape: value as ToolMenuShapeId,
                });
                onToolChange?.("shape");
              }}
            />
          ))}
        </Group>
        <Group legend="Stroke" className="gn-tool-menu__group--swatches">
          {INK_SWATCHES.map((swatch) => (
            <Radio
              key={swatch.value}
              name="gn-tool-menu-shape-stroke"
              value={swatch.value}
              checked={
                swatch.value.toLowerCase() === style.strokeColor.toLowerCase()
              }
              label={`${swatch.label} stroke`}
              onSelect={(value) =>
                applyShapeStyle(excalidrawAPI, { strokeColor: value })
              }
              className="gn-tool-menu__radio--swatch"
            >
              <span
                className="gn-tool-menu__swatch"
                aria-hidden="true"
                style={{ ["--gn-swatch" as string]: swatch.value }}
              />
            </Radio>
          ))}
        </Group>
        <Group legend="Fill" className="gn-tool-menu__group--swatches">
          {FILL_SWATCHES.map((swatch) => (
            <Radio
              key={swatch.value}
              name="gn-tool-menu-shape-fill"
              value={swatch.value}
              checked={
                swatch.value.toLowerCase() ===
                style.backgroundColor.toLowerCase()
              }
              label={swatch.label}
              onSelect={(value) =>
                applyShapeStyle(excalidrawAPI, { backgroundColor: value })
              }
              className="gn-tool-menu__radio--swatch"
            >
              <span
                className="gn-tool-menu__swatch"
                aria-hidden="true"
                data-transparent={swatch.value === "transparent" || undefined}
                style={{ ["--gn-swatch" as string]: swatch.value }}
              />
            </Radio>
          ))}
        </Group>
        {widthGroup((widthKey) => applyShapeStyle(excalidrawAPI, { widthKey }))}
        <Group legend="Edges">
          {(
            [
              { value: "sharp", label: "Sharp edges" },
              { value: "round", label: "Round edges" },
            ] as const
          ).map((option) => (
            <Radio
              key={option.value}
              name="gn-tool-menu-roundness"
              value={option.value}
              checked={style.roundness === option.value}
              label={option.label}
              onSelect={(value) =>
                applyShapeStyle(excalidrawAPI, {
                  roundness: value as AppState["currentItemRoundness"],
                })
              }
            />
          ))}
        </Group>
        {opacityControl((opacity) =>
          applyShapeStyle(excalidrawAPI, { opacity }),
        )}
      </>
    );
  } else {
    body = (
      <>
        <Group legend="Colour" className="gn-tool-menu__group--swatches">
          {INK_SWATCHES.map((swatch) => (
            <Radio
              key={swatch.value}
              name="gn-tool-menu-text-color"
              value={swatch.value}
              checked={
                swatch.value.toLowerCase() === style.strokeColor.toLowerCase()
              }
              label={`${swatch.label} text`}
              onSelect={(value) =>
                applyTextStyle(excalidrawAPI, { color: value })
              }
              className="gn-tool-menu__radio--swatch"
            >
              <span
                className="gn-tool-menu__swatch"
                aria-hidden="true"
                style={{ ["--gn-swatch" as string]: swatch.value }}
              />
            </Radio>
          ))}
        </Group>
        <Group legend="Size">
          {FONT_SIZE_OPTIONS.map((option) => (
            <Radio
              key={option.value}
              name="gn-tool-menu-font-size"
              value={option.value}
              checked={style.fontSize === option.value}
              label={option.label}
              onSelect={(value) =>
                applyTextStyle(excalidrawAPI, { fontSize: Number(value) })
              }
            />
          ))}
        </Group>
        <Group legend="Font">
          {FONT_FAMILY_OPTIONS.map((option) => (
            <Radio
              key={String(option.value)}
              name="gn-tool-menu-font-family"
              value={String(option.value)}
              checked={style.fontFamily === option.value}
              label={option.label}
              onSelect={() =>
                applyTextStyle(excalidrawAPI, { fontFamily: option.value })
              }
            />
          ))}
        </Group>
        {opacityControl((opacity) =>
          applyTextStyle(excalidrawAPI, { opacity }),
        )}
      </>
    );
  }

  /* ---------------------------- render ----------------------------------- */

  const resolvedTheme = scopeTheme === undefined ? style.theme : scopeTheme;
  const scopeClass =
    scopeTheme === false
      ? ""
      : ` excalidraw${resolvedTheme === "dark" ? " theme--dark" : ""}`;

  const titleId = "gn-tool-menu-title";

  return (
    <div
      className={`gn-tool-menu-scope${scopeClass}`}
      data-testid="gn-tool-menu-scope"
    >
      <div
        ref={panelRef}
        className={`gn-tool-menu ${className ?? ""}`.trim()}
        data-testid="gn-tool-menu"
        data-edge={position.edge}
        data-dragging={drag ? "true" : undefined}
        role="dialog"
        aria-labelledby={titleId}
        style={{
          left: `${Math.round(placement.left)}px`,
          top: `${Math.round(placement.top)}px`,
          maxHeight: `calc(100vh - ${EDGE_MARGIN * 2}px)`,
        }}
      >
        <div className="gn-tool-menu__header">
          <button
            type="button"
            className="gn-tool-menu__handle"
            data-testid="gn-tool-menu-handle"
            aria-label={`Move tool settings. ${describePosition(
              position,
            )}. Use the arrow keys to move it, shift for larger steps.`}
            onPointerDown={onHandlePointerDown}
            onPointerMove={onHandlePointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={onHandleKeyDown}
          >
            <span className="gn-tool-menu__grip" aria-hidden="true" />
          </button>
          <h2 className="gn-tool-menu__title" id={titleId}>
            {TOOL_TITLES[tool]}
          </h2>
          <button
            type="button"
            className="gn-tool-menu__close"
            aria-label={`Close ${TOOL_TITLES[tool].toLowerCase()} settings`}
            onClick={onClose}
          >
            <span aria-hidden="true">&times;</span>
          </button>
        </div>

        <div className="gn-tool-menu__body">{body}</div>

        <div className="gn-tool-menu__footer">
          <label className="gn-tool-menu__toggle">
            <input
              type="checkbox"
              checked={style.locked}
              onChange={(event) =>
                setToolLocked(excalidrawAPI, event.target.checked)
              }
            />
            <span>Keep tool active</span>
          </label>
        </div>

        <p className="gn-tool-menu__sr-only" role="status" aria-live="polite">
          {announcement}
        </p>
      </div>
    </div>
  );
};

export default ToolMenu;
