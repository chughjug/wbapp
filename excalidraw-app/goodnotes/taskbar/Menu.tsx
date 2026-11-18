/**
 * The popover used by the "Shapes" control, the centre cluster's overflow
 * control and the nav bar's right-zone "more" (…) control. One implementation
 * so all three behave identically.
 *
 * Accessibility contract:
 * - `role="menu"` with `role="menuitem"` / `role="menuitemradio"` children.
 * - Opening moves focus to the first enabled item (or the checked one).
 * - Up/Down/Home/End move focus, with wrap-around; typing is not captured.
 * - Escape, Tab, outside pointerdown and selecting an item all close and
 *   return focus to the trigger, which is what keyboard users expect.
 *
 * WHY THIS RENDERS IN A PORTAL rather than next to its trigger: the floating
 * bar is a horizontal scroll container (`overflow-x: auto` keeps every control
 * on one row at phone widths), and `overflow` is not per-axis in the way it
 * looks — `overflow-y: hidden` on the same box clips a taller popover to the
 * bar's 44px content box, and the opening `focus()` then scrolls the bar to
 * reach the first item and carries every tool button off the top of the
 * screen. Measured before this change: 1 of 21 items hit-testable, bar
 * scrollTop 63, the Pen button at y=-13. Positioning is therefore computed
 * from the trigger's rect and applied as `position: fixed`.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import "./Menu.scss";

import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import type { TaskbarMenuItem } from "./model";

export interface TaskbarMenuSection {
  id: string;
  /** Rendered as a `role="group"` label. Omit for an unlabelled run. */
  label?: string;
  items: TaskbarMenuItem[];
}

export interface TaskbarMenuProps {
  id: string;
  /** `id` of the button that owns this menu, for `aria-labelledby`. */
  labelledBy: string;
  sections: TaskbarMenuSection[];
  /** `true` when items are mutually exclusive (renders `menuitemradio`). */
  radio?: boolean;
  onClose: (opts?: { restoreFocus?: boolean }) => void;
  align?: "start" | "end";
}

interface MenuFrame {
  style: {
    top?: number;
    bottom?: number;
    left?: number;
    right?: number;
    maxHeight: number;
  };
}

/** Gap between the trigger and the popover, in px. Matches the old `0.375rem`. */
const ANCHOR_GAP = 6;
/** Keep the popover this far from the viewport edge. */
const EDGE_MARGIN = 8;
/**
 * Below this much free space under the trigger the popover opens upward
 * instead — a bar pinned near the bottom of a phone screen would otherwise get
 * a two-item-tall menu.
 */
const MIN_SPACE_BELOW = 220;
/** The design cap, matching the `min(60vh, 28rem)` used when not portalled. */
const MAX_MENU_HEIGHT = 448;

/**
 * Where to mount the popover. The nearest `.excalidraw` ancestor rather than
 * `document.body`, because that element carries the editor's theme class and
 * every colour in `Menu.scss` is one of its custom properties — mounting on
 * the body would render a light menu in dark mode. `null` means "render in
 * place", which is what the tests (jsdom, no trigger in the document) and SSR
 * get.
 */
const portalHost = (labelledBy: string): HTMLElement | null => {
  if (typeof document === "undefined") {
    return null;
  }
  const trigger = document.getElementById(labelledBy);
  return trigger?.closest<HTMLElement>(".excalidraw") ?? null;
};

const measure = (labelledBy: string): MenuFrame | null => {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return null;
  }
  const trigger = document.getElementById(labelledBy);
  if (!trigger) {
    return null;
  }
  const rect = trigger.getBoundingClientRect();
  const viewportH = window.innerHeight;
  const viewportW = window.innerWidth;

  const spaceBelow = viewportH - rect.bottom - ANCHOR_GAP - EDGE_MARGIN;
  const spaceAbove = rect.top - ANCHOR_GAP - EDGE_MARGIN;
  const flipUp = spaceBelow < MIN_SPACE_BELOW && spaceAbove > spaceBelow;

  const vertical = flipUp
    ? { bottom: Math.round(viewportH - rect.top + ANCHOR_GAP) }
    : { top: Math.round(rect.bottom + ANCHOR_GAP) };

  // `data-align` decides which edge of the trigger the popover lines up with;
  // clamping keeps it on screen when that edge is close to one.
  const horizontal =
    rect.left > viewportW / 2
      ? { right: Math.round(Math.max(EDGE_MARGIN, viewportW - rect.right)) }
      : { left: Math.round(Math.max(EDGE_MARGIN, rect.left)) };

  return {
    style: {
      ...vertical,
      ...horizontal,
      // never taller than the original design cap, never shorter than a
      // usable stub (it scrolls internally below that)
      maxHeight: Math.round(
        Math.min(
          MAX_MENU_HEIGHT,
          Math.max(120, flipUp ? spaceAbove : spaceBelow),
        ),
      ),
    },
  };
};

export const TaskbarMenu = ({
  id,
  labelledBy,
  sections,
  radio = false,
  onClose,
  align = "start",
}: TaskbarMenuProps) => {
  const rootRef = useRef<HTMLDivElement | null>(null);

  const itemNodes = useCallback(
    () =>
      Array.from(
        rootRef.current?.querySelectorAll<HTMLButtonElement>(
          "[data-gn-menuitem]:not([disabled])",
        ) ?? [],
      ),
    [],
  );

  // focus the checked item if there is one, else the first enabled item
  useEffect(() => {
    const nodes = itemNodes();
    const checked = nodes.find(
      (node) => node.getAttribute("aria-checked") === "true",
    );
    (checked ?? nodes[0])?.focus();
  }, [itemNodes]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      if (!root || root.contains(event.target as Node)) {
        return;
      }
      // the trigger handles its own toggle; don't steal focus back from it
      onClose({ restoreFocus: false });
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true);
  }, [onClose]);

  const onKeyDown = (event: ReactKeyboardEvent) => {
    const nodes = itemNodes();
    const index = nodes.indexOf(document.activeElement as HTMLButtonElement);

    switch (event.key) {
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        onClose({ restoreFocus: true });
        return;
      case "Tab":
        onClose({ restoreFocus: true });
        return;
      case "ArrowDown":
        event.preventDefault();
        nodes[(index + 1 + nodes.length) % nodes.length]?.focus();
        return;
      case "ArrowUp":
        event.preventDefault();
        nodes[(index - 1 + nodes.length) % nodes.length]?.focus();
        return;
      case "Home":
        event.preventDefault();
        nodes[0]?.focus();
        return;
      case "End":
        event.preventDefault();
        nodes[nodes.length - 1]?.focus();
        break;
      default:
        break;
    }
  };

  /**
   * Fixed coordinates derived from the trigger. Recomputed on resize and on
   * any scroll (capture phase, so a scroll in any container counts), because
   * a fixed element does not follow its anchor on its own.
   */
  const [frame, setFrame] = useState<MenuFrame | null>(null);

  useLayoutEffect(() => {
    const place = () => setFrame(measure(labelledBy));
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [labelledBy]);

  const host = portalHost(labelledBy);

  const menu = (
    <div
      ref={rootRef}
      id={id}
      className={`gn-menu${host ? " gn-menu--fixed" : ""}`}
      data-align={align}
      role="menu"
      aria-labelledby={labelledBy}
      onKeyDown={onKeyDown}
      style={host && frame ? frame.style : undefined}
    >
      {sections.map((section) => (
        <div
          key={section.id}
          className="gn-menu__group"
          role={section.label ? "group" : "none"}
          aria-label={section.label}
        >
          {section.label && (
            <div className="gn-menu__heading" aria-hidden="true">
              {section.label}
            </div>
          )}
          {section.items.map((item) => (
            <button
              key={item.id}
              type="button"
              data-gn-menuitem=""
              className="gn-menu__item"
              role={radio ? "menuitemradio" : "menuitem"}
              aria-checked={radio ? !!item.checked : undefined}
              disabled={item.disabled}
              tabIndex={-1}
              onClick={() => {
                item.onSelect();
                onClose({ restoreFocus: true });
              }}
            >
              <span className="gn-menu__icon" aria-hidden="true">
                {item.icon}
              </span>
              <span className="gn-menu__label">{item.label}</span>
              {!radio && item.checked && (
                <span className="gn-menu__tick" aria-hidden="true">
                  ✓
                </span>
              )}
            </button>
          ))}
        </div>
      ))}
    </div>
  );

  return host ? createPortal(menu, host) : menu;
};

export default TaskbarMenu;
