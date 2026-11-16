/**
 * Compatibility shim for the old `Taskbar` export.
 *
 * The bar itself now lives in `goodnotes/shell` as `NavBar` and defaults to
 * `placement="flow"` — a band the host stacks under the document tab strip.
 * The old call site renders the bar as a floating overlay *after* the editor,
 * with no band layout around it, so this shim keeps the legacy
 * `placement="fixed"` default. Pass `placement` explicitly to override.
 *
 * @deprecated Import `NavBar` (and `PagePanel`) from `goodnotes/shell` and
 * follow `goodnotes/shell/INTEGRATION.md`.
 */

import { NavBar } from "../shell/NavBar";

import type { NavBarProps } from "../shell/NavBar";

export type TaskbarProps = NavBarProps;

export const Taskbar = ({ placement = "fixed", ...props }: TaskbarProps) => (
  <NavBar placement={placement} {...props} />
);

export default Taskbar;
