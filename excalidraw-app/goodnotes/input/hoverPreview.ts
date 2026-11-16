/**
 * Stylus hover preview: a nib-sized dot showing where the pen will land,
 * drawn while an Apple Pencil hovers above the glass.
 *
 * FEATURE DETECTION, NOT ASSUMPTION. Hover for a stylus is reported only by
 * some hardware/browser combinations (on iPadOS, only an Apple Pencil Pro /
 * Pencil hover-capable pairing on an M2-or-later iPad Pro emits
 * `pointerover` / `pointermove` with `pointerType === "pen"` and
 * `buttons === 0` before contact). The overlay therefore creates no DOM and
 * shows nothing until such an event actually arrives — `isSupported()` flips
 * to `true` only after one has been observed.
 *
 * Deliberately imperative (no React state): hover moves arrive at the display
 * refresh rate and must not re-render the app.
 */

import {
  HOVER_PREVIEW_IDLE_HIDE_MS,
  HOVER_PREVIEW_MAX_SIZE_PX,
  HOVER_PREVIEW_MIN_SIZE_PX,
} from "./constants";

export interface HoverPreview {
  /** Position/show the dot. Call on a hovering-pen pointer event. */
  show: (x: number, y: number, diameter: number) => void;
  /** Hide it (pen contact, pen left the sensor, feature switched off). */
  hide: () => void;
  /** Has a real pen-hover event ever been seen in this session? */
  isSupported: () => boolean;
  /** Remove the element and timers. */
  destroy: () => void;
}

export const createHoverPreview = (doc: Document = document): HoverPreview => {
  let element: HTMLDivElement | null = null;
  let supported = false;
  let hideTimer: number | undefined;

  const ensure = (): HTMLDivElement => {
    if (!element) {
      element = doc.createElement("div");
      element.className = "gn-input-hover-preview";
      element.setAttribute("aria-hidden", "true");
      doc.body.appendChild(element);
    }
    return element;
  };

  return {
    show: (x, y, diameter) => {
      supported = true;
      const size = Math.max(
        HOVER_PREVIEW_MIN_SIZE_PX,
        Math.min(HOVER_PREVIEW_MAX_SIZE_PX, diameter),
      );
      const node = ensure();
      node.style.width = `${size}px`;
      node.style.height = `${size}px`;
      node.style.transform = `translate(${x - size / 2}px, ${y - size / 2}px)`;
      node.classList.add("gn-input-hover-preview--visible");

      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => {
        node.classList.remove("gn-input-hover-preview--visible");
      }, HOVER_PREVIEW_IDLE_HIDE_MS);
    },
    hide: () => {
      window.clearTimeout(hideTimer);
      element?.classList.remove("gn-input-hover-preview--visible");
    },
    isSupported: () => supported,
    destroy: () => {
      window.clearTimeout(hideTimer);
      element?.remove();
      element = null;
    },
  };
};
