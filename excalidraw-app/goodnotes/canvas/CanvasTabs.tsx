/**
 * A real ARIA tablist: roving tabindex, Left/Right/Home/End, automatic
 * activation, and `aria-controls` pointing at the matching `tabpanel`.
 *
 * Automatic activation (the panel changes as focus moves) is the right
 * choice here because every panel is already loaded or loads lazily without
 * blocking — see the APG's tabs pattern.
 */

import React, { useCallback, useRef } from "react";

export interface CanvasTabSpec<Id extends string = string> {
  id: Id;
  label: string;
  /** Small count shown after the label; also folded into the accessible name. */
  badge?: number | null;
}

export interface CanvasTabsProps<Id extends string = string> {
  tabs: readonly CanvasTabSpec<Id>[];
  active: Id;
  onChange: (id: Id) => void;
  /** Prefix for the generated `id`s; must match the panels'. */
  idPrefix: string;
  label: string;
}

export const tabId = (prefix: string, id: string) => `${prefix}-tab-${id}`;
export const tabPanelId = (prefix: string, id: string) =>
  `${prefix}-panel-${id}`;

export const CanvasTabs = <Id extends string>({
  tabs,
  active,
  onChange,
  idPrefix,
  label,
}: CanvasTabsProps<Id>) => {
  const listRef = useRef<HTMLDivElement | null>(null);

  const focusTab = useCallback(
    (index: number) => {
      const next = tabs[(index + tabs.length) % tabs.length];
      if (!next) {
        return;
      }
      onChange(next.id);
      listRef.current
        ?.querySelector<HTMLButtonElement>(
          `#${CSS.escape(tabId(idPrefix, next.id))}`,
        )
        ?.focus();
    },
    [tabs, onChange, idPrefix],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const index = tabs.findIndex((tab) => tab.id === active);
      switch (event.key) {
        case "ArrowRight":
          event.preventDefault();
          focusTab(index + 1);
          break;
        case "ArrowLeft":
          event.preventDefault();
          focusTab(index - 1);
          break;
        case "Home":
          event.preventDefault();
          focusTab(0);
          break;
        case "End":
          event.preventDefault();
          focusTab(tabs.length - 1);
          break;
        default:
          break;
      }
    },
    [tabs, active, focusTab],
  );

  return (
    <div
      ref={listRef}
      className="gn-canvas-tablist"
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            id={tabId(idPrefix, tab.id)}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={tabPanelId(idPrefix, tab.id)}
            tabIndex={isActive ? 0 : -1}
            className={`gn-canvas-tab${
              isActive ? " gn-canvas-tab--active" : ""
            }`}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
            {typeof tab.badge === "number" ? (
              <span className="gn-canvas-tab__badge">{tab.badge}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
};
