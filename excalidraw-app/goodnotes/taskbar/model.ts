/**
 * The taskbar's data model: what a control is, which groups exist, and how the
 * bar decides what to drop into the overflow ("More") menu.
 *
 * Nothing here renders or touches the editor; `Taskbar.tsx` builds this model
 * from props and `tools.ts` applies the editor side effects. Keeping the model
 * declarative is what makes the overflow maths, the roving tabindex and the
 * More menu share one source of truth.
 */

import type { ReactNode } from "react";

/** Tool slots the taskbar can own. Not 1:1 with Excalidraw tool types. */
export type TaskbarToolId =
  | "select"
  | "pen"
  | "highlighter"
  | "eraser"
  | "shape"
  | "text"
  | "image";

/** Shapes offered behind the single "Shapes" control. */
export type TaskbarShapeId =
  | "rectangle"
  | "ellipse"
  | "diamond"
  | "arrow"
  | "line";

/** Logical clusters, rendered left to right with a separator between them. */
export type TaskbarGroupId = "tools" | "image" | "document" | "pages";

export const GROUP_ORDER: readonly TaskbarGroupId[] = [
  "tools",
  "image",
  "document",
  "pages",
];

/**
 * One control in the bar.
 *
 * `priority` drives overflow only: the lowest priority still-visible item is
 * the next one moved into the More menu. It is deliberately independent of
 * visual order so the bar can keep, say, the pen next to the eraser while
 * dropping "Import PDF" first.
 */
export interface TaskbarControl {
  id: string;
  group: TaskbarGroupId;
  /** Accessible name. Also the More-menu label and the tooltip text. */
  label: string;
  icon: ReactNode;
  /**
   * `toggle` renders `aria-pressed`; `action` is a plain button; `menu` opens a
   * popover and renders `aria-haspopup`/`aria-expanded`; `status` is read-only
   * text (never focusable, never part of the roving tabindex).
   */
  kind: "toggle" | "action" | "menu" | "status";
  pressed?: boolean;
  disabled?: boolean;
  /** Shown in the tooltip and appended to the accessible description. */
  shortcut?: string;
  /** Extra text for screen readers (e.g. "Page 3 of 12"). */
  description?: string;
  /** Rendered next to the icon when the bar is not in icon-only mode. */
  inlineText?: string;
  onSelect?: () => void;
  /** Higher = kept longer when space runs out. */
  priority: number;
  /** Sub-items, for `kind: "menu"`. Flattened into the More menu on overflow. */
  items?: TaskbarMenuItem[];
}

export interface TaskbarMenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  checked?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

/**
 * Geometry constants mirroring `Taskbar.scss`. They only feed the overflow
 * estimate, so being a pixel out just makes the bar marginally conservative.
 */
export const LAYOUT = {
  /** `gap` between controls inside the bar. */
  gap: 4,
  /** Left + right padding of the bar. */
  paddingX: 12,
  /** Width a separator occupies (its own box, gaps counted separately). */
  separator: 1,
  /** Safety margin so we never render a bar that is 1px too wide. */
  slack: 2,
} as const;

export interface OverflowPlan {
  visible: TaskbarControl[];
  overflow: TaskbarControl[];
}

/**
 * Decide which controls fit.
 *
 * Pure and synchronous: given measured widths and the available width it
 * returns the split. Controls are removed in ascending `priority` (ties broken
 * by reverse document order, so the right-most of equals goes first) until the
 * estimate fits, then re-sorted back into document order.
 *
 * Unmeasured controls (first paint, before the measuring pass has run) are
 * treated as visible — the bar renders complete and then settles, which is far
 * less jarring than starting fully collapsed.
 */
export const planOverflow = (
  controls: readonly TaskbarControl[],
  widths: ReadonlyMap<string, number>,
  moreButtonWidth: number,
  availableWidth: number,
): OverflowPlan => {
  if (!controls.length) {
    return { visible: [], overflow: [] };
  }
  if (!availableWidth || widths.size === 0) {
    return { visible: [...controls], overflow: [] };
  }

  const widthOf = (control: TaskbarControl) => widths.get(control.id) ?? 0;

  const measure = (visible: readonly TaskbarControl[], hasMore: boolean) => {
    if (!visible.length) {
      return hasMore ? moreButtonWidth + LAYOUT.paddingX : 0;
    }
    let total = LAYOUT.paddingX + LAYOUT.slack;
    let slots = 0;
    let previousGroup: TaskbarGroupId | null = null;
    for (const control of visible) {
      if (previousGroup !== null && control.group !== previousGroup) {
        total += LAYOUT.separator;
        slots += 1;
      }
      total += widthOf(control);
      slots += 1;
      previousGroup = control.group;
    }
    if (hasMore) {
      total += LAYOUT.separator + moreButtonWidth;
      slots += 2;
    }
    return total + LAYOUT.gap * Math.max(0, slots - 1);
  };

  // candidates for removal, least important first
  const order = controls
    .map((control, index) => ({ control, index }))
    .sort((a, b) =>
      a.control.priority === b.control.priority
        ? b.index - a.index
        : a.control.priority - b.control.priority,
    );

  const removed = new Set<string>();
  let cursor = 0;

  while (
    measure(
      controls.filter((c) => !removed.has(c.id)),
      removed.size > 0,
    ) > availableWidth &&
    cursor < order.length
  ) {
    removed.add(order[cursor].control.id);
    cursor += 1;
  }

  return {
    visible: controls.filter((c) => !removed.has(c.id)),
    overflow: controls.filter((c) => removed.has(c.id)),
  };
};
