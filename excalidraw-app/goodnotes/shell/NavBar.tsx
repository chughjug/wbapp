/**
 * Compatibility surface for the old three-zone `NavBar`.
 *
 * The bar it named was a full-width BAND: 1194x52 of permanent chrome with
 * twenty-odd controls in three zones. It has been replaced by
 * {@link FloatingBar} — one ~46px pill that floats over the canvas with ten
 * visible controls. `NavBar` is now an alias so existing importers (notably
 * `goodnotes/taskbar`'s deprecated `Taskbar` shim) keep compiling.
 *
 * @deprecated Import `FloatingBar` from `goodnotes/shell`. The props are the
 * same object; a handful of band-only ones are gone (see `INTEGRATION.md`).
 */

export {
  FloatingBar as NavBar,
  FloatingBar,
  SUPPRESS_DEFAULT_CHROME_CLASS,
  PAGE_PANEL_OPEN_CLASS,
} from "./FloatingBar";

export type {
  FloatingBarProps,
  FloatingBarProps as NavBarProps,
  ShellMode,
  ShellPlacement,
} from "./FloatingBar";

export { FloatingBar as default } from "./FloatingBar";
