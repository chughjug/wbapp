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
 */

import { useCallback, useEffect, useRef } from "react";

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

  return (
    <div
      ref={rootRef}
      id={id}
      className="gn-menu"
      data-align={align}
      role="menu"
      aria-labelledby={labelledBy}
      onKeyDown={onKeyDown}
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
};

export default TaskbarMenu;
