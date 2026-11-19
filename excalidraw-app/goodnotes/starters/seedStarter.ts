/**
 * Writing a starter's scaffolding onto the first page.
 *
 * Positions in a starter are fractions of the page, not absolute
 * coordinates, so one definition works for A4, Letter and landscape alike.
 * This turns them into real text elements parented to the page frame.
 *
 * Parenting matters more than it looks: an element with the page's
 * `frameId` moves with the page, exports with the page, is found by search
 * *on that page*, and shows up in the contents list as that page's
 * heading. A seeded line dropped at the right pixel coordinates but with
 * no `frameId` would look identical and behave wrongly in all four.
 */

import { newTextElement } from "@excalidraw/element";

import type {
  ExcalidrawFrameElement,
  ExcalidrawTextElement,
  NonDeleted,
} from "@excalidraw/element/types";

import type { NotebookStarter } from "./starters";

/**
 * Text elements for `starter`, laid out inside `frame`.
 *
 * Returns an empty array for a starter that seeds nothing, so callers can
 * splice the result in unconditionally.
 */
export const buildStarterElements = (
  starter: NotebookStarter,
  frame: Pick<ExcalidrawFrameElement, "id" | "x" | "y" | "width" | "height">,
): NonDeleted<ExcalidrawTextElement>[] =>
  starter.seed.map((line) =>
    newTextElement({
      text: line.text,
      fontSize: line.fontSize,
      x: frame.x + frame.width * line.atX,
      y: frame.y + frame.height * line.atY,
      frameId: frame.id,
      // Scaffolding, not the student's own writing: grey rather than
      // black so a heading they have not replaced reads as a prompt,
      // and so their first real stroke is visibly darker than it.
      strokeColor: "#868e96",
    }),
  );
