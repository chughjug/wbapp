/**
 * GoodNotes "Universal Object Menu" — a contextual action bar that appears
 * directly above the selected object.
 *
 * Instead of travelling to a toolbar, the actions come to the object: select
 * an image and you get Duplicate / Backdrop / Crop / Replace / Delete; select
 * ink and you get colour, width, "Convert to shape"; text gets size and
 * colour; a shape gets fill and stroke; a multi-selection gets Group,
 * Duplicate and Delete and nothing else.
 *
 * ## Positioning
 *
 * The bar is `position: fixed` and placed from the selection's bounding box.
 * `useSelectedElements` projects that box from scene to **client**
 * coordinates with the editor's own `sceneCoordsToViewportCoords`, so the
 * numbers can be used verbatim as `left`/`top`. Recomputation is coalesced
 * to one per animation frame (see that hook), which is what keeps a drag
 * from re-rendering on every pointer event.
 *
 * The bar sits `MENU_GAP` px above the box; when it would cross the top of
 * the canvas it flips below (`data-placement="below"`), and it is always
 * clamped inside the canvas rectangle, so it never escapes the viewport.
 *
 * ## Coordinating with other GoodNotes modules
 *
 * `goodnotes/fuzzy-select` is a modal tool whose overlay covers the window.
 * The menu subscribes to that module's activation store and hides itself
 * while the lasso is on; a host can suppress it for any other reason with
 * the `hidden` prop. See INTEGRATION.md.
 *
 * ## Accessibility
 *
 * Real `<button>`s inside `role="toolbar"`, every one with an accessible
 * name; Left/Right (and Home/End) move focus along the bar; Escape closes an
 * open sub-row, and a second Escape dismisses the menu by clearing the
 * selection; focus is visible via `:focus-visible`; all colour comes from
 * Excalidraw's own custom properties so light and dark both work; the
 * appear/flip transition is dropped under
 * `@media (prefers-reduced-motion: reduce)`.
 */

import clsx from "clsx";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import type {
  ExcalidrawFreeDrawElement,
  ExcalidrawImageElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";

import { useFuzzySelectActive } from "../fuzzy-select/activation";

import {
  FILL_COLOR_PICKS,
  FONT_SIZE_OPTIONS,
  INK_WIDTHS,
  SHAPE_STROKE_WIDTHS,
  STROKE_COLOR_PICKS,
  canConvertToShape,
  canGroupSelection,
  convertInkToShape,
  deleteSelection,
  duplicateSelection,
  groupSelection,
  replaceImage,
  setBackgroundColor,
  setFontSize,
  setStrokeColor,
  setStrokeWidth,
  startCropping,
} from "./actions";
import { useSelectedElements } from "./useSelectedElements";

import "./ObjectMenu.scss";

import type { ObjectSelection } from "./useSelectedElements";

/** Gap between the selection box and the bar, in CSS px. */
const MENU_GAP = 12;
/** Minimum distance kept from the edges of the canvas. */
const VIEWPORT_MARGIN = 8;
/** Fallback size used for the very first frame, before measuring. */
const ESTIMATED_SIZE = { width: 280, height: 40 };

export interface ObjectMenuProps {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
  /**
   * Opens the backdrops panel for the selected image. Pass
   * `useBackdropPanel(api).open`. **When omitted the "Backdrop…" item is not
   * rendered** — the menu never shows an action it cannot perform.
   */
  onOpenBackdrop?: () => void;
  /**
   * Force the menu out of the way (a modal tool of your own, a tour, …).
   * The lasso tool of `goodnotes/fuzzy-select` is handled automatically.
   */
  hidden?: boolean;
  /** Called after an action ran, for host-level toasts/telemetry. */
  onAction?: (action: string) => void;
}

type SubRow = "stroke" | "fill" | "width" | "fontSize" | null;

interface Placement {
  left: number;
  top: number;
  placement: "above" | "below";
}

const computePlacement = (
  selection: ObjectSelection,
  size: { width: number; height: number },
): Placement => {
  const { viewportBounds: box, viewport } = selection;

  const canvasLeft = viewport.offsetLeft;
  const canvasTop = viewport.offsetTop;
  const canvasRight = viewport.offsetLeft + viewport.width;
  const canvasBottom = viewport.offsetTop + viewport.height;

  const centerX = (box.x1 + box.x2) / 2;
  let left = centerX - size.width / 2;
  left = Math.min(
    Math.max(left, canvasLeft + VIEWPORT_MARGIN),
    Math.max(
      canvasLeft + VIEWPORT_MARGIN,
      canvasRight - size.width - VIEWPORT_MARGIN,
    ),
  );

  const above = box.y1 - MENU_GAP - size.height;
  const fitsAbove = above >= canvasTop + VIEWPORT_MARGIN;
  let top = fitsAbove ? above : box.y2 + MENU_GAP;
  const placement: Placement["placement"] = fitsAbove ? "above" : "below";

  top = Math.min(
    Math.max(top, canvasTop + VIEWPORT_MARGIN),
    Math.max(
      canvasTop + VIEWPORT_MARGIN,
      canvasBottom - size.height - VIEWPORT_MARGIN,
    ),
  );

  return { left, top, placement };
};

/* -------------------------------------------------------------------------- */
/* small presentational pieces                                                 */
/* -------------------------------------------------------------------------- */

const MenuButton = ({
  label,
  onClick,
  expanded,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  expanded?: boolean;
  danger?: boolean;
  children?: React.ReactNode;
}) => (
  <button
    type="button"
    className={clsx("goodnotes-object-menu__button", {
      "goodnotes-object-menu__button--danger": danger,
      "is-expanded": expanded,
    })}
    aria-label={label}
    title={label}
    {...(expanded === undefined ? {} : { "aria-expanded": expanded })}
    onClick={onClick}
  >
    {children ?? label}
  </button>
);

const Swatch = ({
  color,
  label,
  active,
  onSelect,
}: {
  color: string;
  label: string;
  active: boolean;
  onSelect: () => void;
}) => (
  <button
    type="button"
    className="goodnotes-object-menu__swatch"
    aria-label={label}
    title={label}
    aria-pressed={active}
    onClick={onSelect}
  >
    <span
      className={clsx("goodnotes-object-menu__swatch-chip", {
        "is-transparent": color === "transparent",
      })}
      style={{ background: color }}
      aria-hidden="true"
    />
  </button>
);

/* -------------------------------------------------------------------------- */
/* the bar                                                                     */
/* -------------------------------------------------------------------------- */

export const ObjectMenu = ({
  excalidrawAPI,
  onOpenBackdrop,
  hidden = false,
  onAction,
}: ObjectMenuProps) => {
  const selection = useSelectedElements(excalidrawAPI);
  const lassoActive = useFuzzySelectActive();

  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(ESTIMATED_SIZE);
  const [subRow, setSubRow] = useState<SubRow>(null);

  const visible = !!selection && !hidden && !lassoActive && !!excalidrawAPI;

  // A different selection starts from a collapsed bar.
  const selectionKey = selection ? selection.ids.join(",") : "";
  useEffect(() => {
    setSubRow(null);
  }, [selectionKey]);

  // Measure after every layout-affecting change so the flip/clamp maths uses
  // the real size rather than the estimate.
  useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node) {
      return;
    }
    const rect = node.getBoundingClientRect();
    setSize((previous) =>
      Math.abs(previous.width - rect.width) < 0.5 &&
      Math.abs(previous.height - rect.height) < 0.5
        ? previous
        : { width: rect.width, height: rect.height },
    );
  }, [visible, selectionKey, subRow, selection?.kind]);

  const run = useCallback(
    (name: string, fn: () => unknown) => {
      void Promise.resolve(fn())
        .then(() => onAction?.(name))
        .catch((error) => {
          console.error(`[goodnotes/object-menu] ${name} failed`, error);
          excalidrawAPI?.setToast({
            message: `Could not ${name.replace(/-/g, " ")}`,
            closable: true,
          });
        });
    },
    [excalidrawAPI, onAction],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        if (subRow) {
          setSubRow(null);
          return;
        }
        excalidrawAPI?.selection.clear();
        return;
      }
      if (
        event.key !== "ArrowLeft" &&
        event.key !== "ArrowRight" &&
        event.key !== "Home" &&
        event.key !== "End"
      ) {
        return;
      }
      const node = containerRef.current;
      if (!node) {
        return;
      }
      const buttons = Array.from(
        node.querySelectorAll<HTMLButtonElement>("button:not([disabled])"),
      );
      if (!buttons.length) {
        return;
      }
      const index = buttons.indexOf(
        document.activeElement as HTMLButtonElement,
      );
      event.preventDefault();
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
          ? buttons.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) %
            buttons.length;
      buttons[next]?.focus();
    },
    [excalidrawAPI, subRow],
  );

  const placement = useMemo(
    () => (selection ? computePlacement(selection, size) : null),
    [selection, size],
  );

  if (!visible || !selection || !placement || !excalidrawAPI) {
    return null;
  }

  const { kind, element } = selection;
  const toggle = (row: Exclude<SubRow, null>) =>
    setSubRow((current) => (current === row ? null : row));

  const duplicate = (
    <MenuButton
      key="duplicate"
      label="Duplicate"
      onClick={() => run("duplicate", () => duplicateSelection(excalidrawAPI))}
    />
  );
  const remove = (
    <MenuButton
      key="delete"
      label="Delete"
      danger
      onClick={() => run("delete", () => deleteSelection(excalidrawAPI))}
    />
  );

  const items: React.ReactNode[] = [];

  if (kind === "multiple") {
    if (canGroupSelection(selection.elements)) {
      items.push(
        <MenuButton
          key="group"
          label="Group"
          onClick={() => run("group", () => groupSelection(excalidrawAPI))}
        />,
      );
    }
    items.push(duplicate, remove);
  } else if (kind === "image" && element) {
    const image = element as ExcalidrawImageElement;
    items.push(duplicate);
    if (onOpenBackdrop) {
      items.push(
        <MenuButton
          key="backdrop"
          label="Backdrop…"
          onClick={() => run("open-backdrop", onOpenBackdrop)}
        />,
      );
    }
    items.push(
      <MenuButton
        key="crop"
        label="Crop"
        onClick={() =>
          run("crop", () => startCropping(excalidrawAPI, image.id))
        }
      />,
      <MenuButton
        key="replace"
        label="Replace"
        onClick={() => run("replace", () => replaceImage(excalidrawAPI, image))}
      />,
      remove,
    );
  } else if (kind === "freedraw" && element) {
    const ink = element as ExcalidrawFreeDrawElement;
    items.push(
      <MenuButton
        key="ink-color"
        label="Ink colour"
        expanded={subRow === "stroke"}
        onClick={() => toggle("stroke")}
      >
        <span
          className="goodnotes-object-menu__swatch-chip"
          style={{ background: ink.strokeColor }}
          aria-hidden="true"
        />
        <span>Colour</span>
      </MenuButton>,
      <MenuButton
        key="ink-width"
        label="Ink width"
        expanded={subRow === "width"}
        onClick={() => toggle("width")}
      >
        Width
      </MenuButton>,
    );
    if (canConvertToShape(ink, selection.viewport.zoom)) {
      items.push(
        <MenuButton
          key="convert"
          label="Convert to shape"
          onClick={() =>
            run("convert-to-shape", () => convertInkToShape(excalidrawAPI, ink))
          }
        />,
      );
    }
    items.push(duplicate, remove);
  } else if (kind === "text" && element) {
    const text = element as ExcalidrawTextElement;
    items.push(
      <MenuButton
        key="font-size"
        label="Font size"
        expanded={subRow === "fontSize"}
        onClick={() => toggle("fontSize")}
      >
        Size
      </MenuButton>,
      <MenuButton
        key="text-color"
        label="Text colour"
        expanded={subRow === "stroke"}
        onClick={() => toggle("stroke")}
      >
        <span
          className="goodnotes-object-menu__swatch-chip"
          style={{ background: text.strokeColor }}
          aria-hidden="true"
        />
        <span>Colour</span>
      </MenuButton>,
      duplicate,
      remove,
    );
  } else if (kind === "shape" && element) {
    items.push(
      <MenuButton
        key="fill"
        label="Fill colour"
        expanded={subRow === "fill"}
        onClick={() => toggle("fill")}
      >
        <span
          className={clsx("goodnotes-object-menu__swatch-chip", {
            "is-transparent": element.backgroundColor === "transparent",
          })}
          style={{ background: element.backgroundColor }}
          aria-hidden="true"
        />
        <span>Fill</span>
      </MenuButton>,
      <MenuButton
        key="stroke"
        label="Stroke colour"
        expanded={subRow === "stroke"}
        onClick={() => toggle("stroke")}
      >
        <span
          className="goodnotes-object-menu__swatch-chip"
          style={{ background: element.strokeColor }}
          aria-hidden="true"
        />
        <span>Stroke</span>
      </MenuButton>,
      <MenuButton
        key="stroke-width"
        label="Stroke width"
        expanded={subRow === "width"}
        onClick={() => toggle("width")}
      >
        Width
      </MenuButton>,
      duplicate,
      remove,
    );
  } else {
    items.push(duplicate, remove);
  }

  const widths = kind === "freedraw" ? INK_WIDTHS : SHAPE_STROKE_WIDTHS;

  return (
    <div
      ref={containerRef}
      className="goodnotes-object-menu"
      data-placement={placement.placement}
      data-kind={kind}
      data-testid="goodnotes-object-menu"
      role="toolbar"
      aria-label="Object actions"
      aria-orientation="horizontal"
      style={{ left: `${placement.left}px`, top: `${placement.top}px` }}
      onKeyDown={onKeyDown}
      // The canvas treats a pointerdown as "start drawing / deselect"; the
      // bar is an overlay, so it keeps its own events to itself.
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="goodnotes-object-menu__row">{items}</div>

      {subRow === "stroke" && (
        <div
          className="goodnotes-object-menu__row goodnotes-object-menu__row--sub"
          role="group"
          aria-label={kind === "freedraw" ? "Ink colour" : "Stroke colour"}
        >
          {STROKE_COLOR_PICKS.map((pick) => (
            <Swatch
              key={pick.value}
              color={pick.value}
              label={pick.label}
              active={element?.strokeColor === pick.value}
              onSelect={() =>
                run("set-stroke-colour", () =>
                  setStrokeColor(excalidrawAPI, pick.value),
                )
              }
            />
          ))}
        </div>
      )}

      {subRow === "fill" && (
        <div
          className="goodnotes-object-menu__row goodnotes-object-menu__row--sub"
          role="group"
          aria-label="Fill colour"
        >
          {FILL_COLOR_PICKS.map((pick) => (
            <Swatch
              key={pick.value}
              color={pick.value}
              label={pick.label}
              active={element?.backgroundColor === pick.value}
              onSelect={() =>
                run("set-fill-colour", () =>
                  setBackgroundColor(excalidrawAPI, pick.value),
                )
              }
            />
          ))}
        </div>
      )}

      {subRow === "width" && (
        <div
          className="goodnotes-object-menu__row goodnotes-object-menu__row--sub"
          role="group"
          aria-label={kind === "freedraw" ? "Ink width" : "Stroke width"}
        >
          {widths.map((option) => (
            <button
              key={option.label}
              type="button"
              className="goodnotes-object-menu__button goodnotes-object-menu__button--option"
              aria-label={option.label}
              aria-pressed={element?.strokeWidth === option.value}
              onClick={() =>
                run("set-stroke-width", () =>
                  setStrokeWidth(excalidrawAPI, option.value),
                )
              }
            >
              <span
                className="goodnotes-object-menu__width-dot"
                style={{
                  height: `${Math.max(2, option.value * 2)}px`,
                }}
                aria-hidden="true"
              />
            </button>
          ))}
        </div>
      )}

      {subRow === "fontSize" && (
        <div
          className="goodnotes-object-menu__row goodnotes-object-menu__row--sub"
          role="group"
          aria-label="Font size"
        >
          {FONT_SIZE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className="goodnotes-object-menu__button goodnotes-object-menu__button--option"
              aria-label={option.title}
              title={option.title}
              aria-pressed={
                (element as ExcalidrawTextElement | null)?.fontSize ===
                option.value
              }
              onClick={() =>
                run("set-font-size", () =>
                  setFontSize(excalidrawAPI, option.value),
                )
              }
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default ObjectMenu;
