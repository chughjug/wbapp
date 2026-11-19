/**
 * Notebook starters.
 *
 * Creating a notebook already asks for paper, size and orientation — three
 * questions whose answers a student does not actually hold in their head.
 * "Cornell, A4, portrait" is not what anyone is thinking at the start of a
 * lecture; "this is lecture notes" is. A starter is that sentence: one
 * choice that fills in the three settings *and* lays down whatever
 * scaffolding the format implies.
 *
 * What a starter is NOT:
 *
 * - **Not a new paper ruling.** Cornell and staff paper already exist in
 *   `goodnotes/paper`, and a starter picks one rather than redefining it.
 *   The starter's own contribution is the combination plus the headings.
 * - **Not a locked template.** Everything it writes is ordinary text on the
 *   page: selectable, editable, deletable. Nothing downstream treats a
 *   seeded element differently from one the student typed, which is why
 *   the outline, search and export all pick them up for free.
 *
 * Seeded text is deliberately sparse. A lab report gets four headings, not
 * a form; a problem set gets numbers, not boxes. The scaffolding is there
 * to save the first minute of writing, and anything more becomes something
 * to delete before you can start.
 */

import type { PageSizeName, PaperTemplateId } from "../types";

export interface StarterSeedText {
  /** The line to write. */
  text: string;
  /** Fraction of page height to place it at, 0 (top) to 1 (bottom). */
  atY: number;
  /** Fraction of page width for the left edge. */
  atX: number;
  fontSize: number;
}

export interface NotebookStarter {
  id: string;
  label: string;
  /** One line explaining when to pick it, shown under the label. */
  description: string;
  template: PaperTemplateId;
  size: PageSizeName;
  landscape: boolean;
  /** Lines written onto the first page. Empty for a starter that seeds none. */
  seed: readonly StarterSeedText[];
}

/** Body text size used for seeded scaffolding; matches Excalidraw's medium. */
const BODY = 20;
/** Heading size — above the 1.25x ratio the outline needs to see a heading. */
const HEADING = 28;

/**
 * The starters, in the order the picker shows them.
 *
 * "Blank" is first and is the one with no opinions, because it is what
 * most notebooks are and nobody should have to scroll past four presets to
 * get an empty page.
 */
export const NOTEBOOK_STARTERS: readonly NotebookStarter[] = [
  {
    id: "blank",
    label: "Blank",
    description: "An empty page.",
    template: "blank",
    size: "A4",
    landscape: false,
    seed: [],
  },
  {
    id: "lecture",
    label: "Lecture notes",
    description: "Cornell layout — cue column for questions, summary below.",
    template: "cornell",
    size: "A4",
    landscape: false,
    // The cue column and summary bar are drawn by the Cornell paper itself,
    // so the only thing worth writing is the one line the ruling cannot
    // know: what this lecture was about. It doubles as the page's heading,
    // which is what puts the notebook in the contents list.
    seed: [{ text: "Topic", atX: 0.32, atY: 0.06, fontSize: HEADING }],
  },
  {
    id: "problem-set",
    label: "Problem set",
    description: "Lined, numbered 1 to 5 with room to work.",
    template: "lined",
    size: "A4",
    landscape: false,
    seed: [
      { text: "Problem set", atX: 0.08, atY: 0.05, fontSize: HEADING },
      { text: "1.", atX: 0.08, atY: 0.15, fontSize: BODY },
      { text: "2.", atX: 0.08, atY: 0.32, fontSize: BODY },
      { text: "3.", atX: 0.08, atY: 0.49, fontSize: BODY },
      { text: "4.", atX: 0.08, atY: 0.66, fontSize: BODY },
      { text: "5.", atX: 0.08, atY: 0.83, fontSize: BODY },
    ],
  },
  {
    id: "lab",
    label: "Lab report",
    description: "Grid paper with Aim, Method, Results, Conclusion.",
    template: "grid",
    size: "A4",
    landscape: false,
    seed: [
      { text: "Aim", atX: 0.08, atY: 0.06, fontSize: HEADING },
      { text: "Method", atX: 0.08, atY: 0.28, fontSize: HEADING },
      { text: "Results", atX: 0.08, atY: 0.5, fontSize: HEADING },
      { text: "Conclusion", atX: 0.08, atY: 0.78, fontSize: HEADING },
    ],
  },
  {
    id: "music",
    label: "Music",
    description: "Staff paper, landscape.",
    template: "staff",
    size: "A4",
    landscape: true,
    seed: [],
  },
  {
    id: "sketch",
    label: "Sketching",
    description: "Dotted paper, landscape.",
    template: "dotted",
    size: "A4",
    landscape: true,
    seed: [],
  },
];

export const getStarter = (id: string | null | undefined): NotebookStarter =>
  NOTEBOOK_STARTERS.find((starter) => starter.id === id) ??
  NOTEBOOK_STARTERS[0];

/** Does this starter write anything onto the page? */
export const starterSeedsContent = (starter: NotebookStarter): boolean =>
  starter.seed.length > 0;
