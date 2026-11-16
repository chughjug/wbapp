/**
 * Bridge from a dashboard course card to the library's own course filter.
 *
 * WHY THIS IS DOM-DRIVEN: `Shelf` owns its `LibraryFilter` in local state and
 * exposes no `filter` / `onFilterChange` prop, and goodnotes/library is not
 * ours to edit. The alternatives were (a) re-implement the grid so the
 * dashboard could own the filter — explicitly forbidden, and a far worse
 * outcome than this; (b) make the course card inert, which is not a feature;
 * or (c) drive the control the library already renders. (c) wins: the card
 * activates the *same* sidebar button a mouse user would click, so there is
 * exactly one source of truth for the filter and the sidebar's `aria-current`
 * stays correct by construction.
 *
 * It is a known coupling to two class names (`gn-sidebar__item`,
 * `gn-sidebar__label`). Every function here fails soft: if the markup moves,
 * `selectCourseInShelf` returns false and the caller leaves the library
 * alone rather than throwing.
 */

import { splitCoursePath } from "../library";

const ITEM = ".gn-sidebar__item";
const LABEL = ".gn-sidebar__label";

/** Reconstruct a sidebar row's full course path from its nesting. */
const pathOfButton = (button: Element): string[] => {
  const segments: string[] = [];
  let node: Element | null = button.closest("li");
  while (node) {
    const label = node
      .querySelector(`:scope > .gn-sidebar__row ${LABEL}`)
      ?.textContent?.trim();
    if (!label) {
      break;
    }
    segments.unshift(label);
    node = node.parentElement?.closest("li") ?? null;
  }
  return segments;
};

/** The sidebar button for `coursePath`, or null when it is not rendered. */
export const findCourseButton = (
  root: ParentNode | null | undefined,
  coursePath: string,
): HTMLElement | null => {
  if (!root) {
    return null;
  }
  const wanted = splitCoursePath(coursePath);
  if (wanted.length === 0) {
    return null;
  }
  const buttons = Array.from(root.querySelectorAll<HTMLElement>(ITEM));
  for (const button of buttons) {
    const path = pathOfButton(button);
    if (
      path.length === wanted.length &&
      path.every((segment, index) => segment === wanted[index])
    ) {
      return button;
    }
  }
  return null;
};

/**
 * Select `coursePath` in the library below and move focus there, so a
 * keyboard user lands on the row they just chose instead of being silently
 * teleported. Returns false when the course has no row (e.g. a Canvas course
 * the user has no notebooks in yet).
 */
export const selectCourseInShelf = (
  root: ParentNode | null | undefined,
  coursePath: string,
): boolean => {
  const button = findCourseButton(root, coursePath);
  if (!button) {
    return false;
  }
  button.click();
  button.scrollIntoView({ block: "nearest" });
  button.focus();
  return true;
};
