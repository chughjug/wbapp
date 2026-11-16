/**
 * Undo / redo from outside the editor.
 *
 * WHY THIS IS A SYNTHETIC KEY EVENT. `ExcalidrawImperativeAPI` exposes
 * `history` as `{ clear }` only (see `packages/excalidraw/components/App.tsx`,
 * where the API object is built: `history: { clear: this.resetHistory }`), and
 * `actionManager.executeAction` is not exported either. The real `history`
 * object is attached to `window.h` in dev/test builds only. The one
 * *supported*, production-safe route into `createUndoAction` / `createRedoAction`
 * is therefore their `keyTest`:
 *
 * ```ts
 * // packages/excalidraw/actions/actionHistory.tsx
 * keyTest: (event) => event[KEYS.CTRL_OR_CMD] && matchKey(event, KEYS.Z) && !event.shiftKey
 * ```
 *
 * The app mounts `<Excalidraw handleKeyboardGlobally />`, so the editor's
 * `onKeyDown` is bound to `document`; dispatching a trusted-shaped
 * `KeyboardEvent` there runs the same code path as a real Cmd/Ctrl+Z,
 * including the mid-gesture guards in `executeHistoryAction` (it refuses to
 * undo while an element is being drawn or resized — which is exactly what we
 * want for a stray two-finger tap).
 *
 * Keyboard undo is untouched: this is an *additional* route, never the only
 * one.
 */

import { KEYS } from "@excalidraw/common";

/** Does the focused element swallow keystrokes (search box, text editor…)? */
const isTypingTarget = (doc: Document): boolean => {
  const active = doc.activeElement as HTMLElement | null;
  if (!active) {
    return false;
  }
  const tag = active.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    active.isContentEditable
  );
};

const dispatchHistoryKey = (
  shiftKey: boolean,
  doc: Document = document,
): boolean => {
  if (isTypingTarget(doc)) {
    // the user is writing in a field — Cmd+Z there belongs to the field
    return false;
  }
  const init: KeyboardEventInit = {
    key: shiftKey ? "Z" : "z",
    code: "KeyZ",
    shiftKey,
    bubbles: true,
    cancelable: true,
  };
  // `CTRL_OR_CMD` is "metaKey" on Apple platforms (so: on an iPad) and
  // "ctrlKey" elsewhere — exactly what the editor's `keyTest` reads.
  (init as Record<string, unknown>)[KEYS.CTRL_OR_CMD] = true;

  // NOTE: the editor calls `preventDefault()` on a shortcut it handled, so
  // `dispatchEvent` returns **false** on success. The return value is
  // therefore "we dispatched it", not "the browser's default ran".
  doc.dispatchEvent(new KeyboardEvent("keydown", init));
  return true;
};

/**
 * Triggers the editor's undo, as if the user had pressed Cmd/Ctrl+Z.
 *
 * @returns `false` only when it was suppressed because a text field has
 *   focus; `true` means the key event was delivered to the editor.
 */
export const requestUndo = (doc?: Document): boolean =>
  dispatchHistoryKey(false, doc);

/** Triggers the editor's redo (Cmd/Ctrl+Shift+Z). */
export const requestRedo = (doc?: Document): boolean =>
  dispatchHistoryKey(true, doc);
