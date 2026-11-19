/**
 * Typeset equations as scene objects.
 *
 * A student writing maths or physics notes needs `\int`, `\frac` and a
 * matrix to look like themselves. This module takes LaTeX, hands it to
 * MathJax, and puts the resulting SVG on the page as an ordinary image
 * element — so it saves, exports to PDF, moves and resizes like anything
 * else, and stays sharp at any zoom.
 *
 * The source rides along on the element, so an equation can be reopened
 * and corrected. The whole module mirrors `../graph`, which solved the
 * same problem for plots; the editor's rules about files and elements are
 * identical and worth following identically.
 *
 * MathJax is loaded on first use only — a notebook with no equations pays
 * nothing for this.
 */

export { MathDialog } from "./MathDialog";
export type { MathDialogProps } from "./MathDialog";

export { useMathDialog } from "./useMathDialog";
export type {
  MathDialogController,
  UseMathDialogOptions,
} from "./useMathDialog";

export {
  createMathSpec,
  describeMath,
  hasMathSource,
  normalizeMathSpec,
  DEFAULT_MATH_COLOR,
  DEFAULT_MATH_FONT_SIZE,
  MATH_CUSTOM_DATA_KEY,
  MATH_SPEC_VERSION,
  MAX_MATH_FONT_SIZE,
  MAX_TEX_LENGTH,
  MIN_MATH_FONT_SIZE,
} from "./spec";
export type { MathSpec } from "./spec";

export {
  configureMathjax,
  renderMathToSvg,
  resetMathjaxForTests,
  MathRenderError,
} from "./renderMath";
export type { MathRender, MathTypesetter } from "./renderMath";

export {
  editMath,
  getMathAltText,
  getMathCustomData,
  getMathSpec,
  getSelectedMathElement,
  insertMathIntoScene,
  isMathElement,
  mergeMathCustomData,
  renderMathToFile,
  updateMathElement,
} from "./insertMath";
export type {
  InsertMathOptions,
  InsertMathResult,
  MathCustomData,
  MathEditHandle,
  MathRaster,
  UpdateMathOptions,
} from "./insertMath";
