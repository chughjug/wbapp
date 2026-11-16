/**
 * The one popup primitive the home screen uses.
 *
 * The redesign trades *resident* controls for *revealed* ones, so the quality
 * of this component is the quality of the screen: every control that left the
 * toolbar or the card now lives behind one of these.
 *
 * Why a portal and fixed positioning: card menus open from inside
 * `.gn-shelf__content`, which scrolls (and therefore clips). An absolutely
 * positioned panel would be cut off at the first card near an edge. The panel
 * is rendered to `document.body`, positioned from the trigger's viewport rect,
 * flipped and clamped to stay on screen, and repositioned on scroll/resize.
 *
 * Accessibility
 *  - the trigger owns `aria-expanded` / `aria-haspopup` (caller's job) and
 *    focus returns to it on close, always;
 *  - `Escape` closes from anywhere inside, and so does a click outside or
 *    focus leaving the panel — so a popover can never be orphaned;
 *  - `role="menu"` panels get roving focus with Up/Down/Home/End; `role`
 *    `"dialog"` panels (which hold arbitrary host content, e.g. the PDF
 *    import slot) do not, because arrow keys belong to that content;
 *  - the panel re-declares `excalidraw` + `theme--dark`, because a portal to
 *    `document.body` escapes the themed subtree it came from.
 */

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { useShelfTheme } from "./theme";

const MARGIN = 8;

export interface PopoverProps {
  /** The control the panel hangs off. Focus returns here on close. */
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  /** `"menu"` enables roving arrow-key focus. Default `"dialog"`. */
  role?: "menu" | "dialog";
  /** Accessible name of the panel. */
  label: string;
  /** Align the panel's inline end with the anchor's. Default true. */
  alignEnd?: boolean;
  className?: string;
  children: React.ReactNode;
}

const focusablesIn = (root: HTMLElement): HTMLElement[] =>
  [
    ...root.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((el) => el.offsetParent !== null || el === document.activeElement);

export const Popover = ({
  anchorRef,
  onClose,
  role = "dialog",
  label,
  alignEnd = true,
  className,
  children,
}: PopoverProps) => {
  const theme = useShelfTheme();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const place = useCallback(() => {
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (!anchor || !panel) {
      return;
    }
    const a = anchor.getBoundingClientRect();
    const p = panel.getBoundingClientRect();
    let top = a.bottom + 6;
    if (top + p.height > window.innerHeight - MARGIN) {
      // not enough room below — flip above, then clamp
      top = Math.max(MARGIN, a.top - p.height - 6);
    }
    let left = alignEnd ? a.right - p.width : a.left;
    left = Math.min(left, window.innerWidth - p.width - MARGIN);
    left = Math.max(MARGIN, left);
    setPos({ top, left });
  }, [anchorRef, alignEnd]);

  useLayoutEffect(() => {
    place();
  }, [place, children]);

  // Move focus in only once the panel has a position. Until `place()` has
  // run the panel is `visibility: hidden` — and `focus()` on a hidden
  // element is a no-op, which would silently leave focus on the trigger and
  // make every keyboard interaction inside the panel impossible.
  const focused = useRef(false);
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || !pos || focused.current) {
      return;
    }
    focused.current = true;
    focusablesIn(panel)[0]?.focus();
  }, [pos]);

  useEffect(() => {
    const onScrollOrResize = () => place();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [place]);

  // Escape at the document level, not just inside the panel: focus can be
  // anywhere (the trigger, a host control inside the slot that moved it), and
  // a popover you cannot dismiss with Escape is a trap.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        anchorRef.current?.focus();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [anchorRef, onClose]);

  // close on outside pointer-down; the anchor itself toggles, so skip it
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (
        panelRef.current?.contains(target) ||
        anchorRef.current?.contains(target)
      ) {
        return;
      }
      onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [anchorRef, onClose]);

  const close = useCallback(() => {
    anchorRef.current?.focus();
    onClose();
  }, [anchorRef, onClose]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      event.preventDefault();
      close();
      return;
    }
    if (role !== "menu") {
      return;
    }
    const panel = panelRef.current;
    if (!panel) {
      return;
    }
    const items = focusablesIn(panel);
    const index = items.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (event.key === "ArrowDown") {
      next = index < 0 ? 0 : (index + 1) % items.length;
    } else if (event.key === "ArrowUp") {
      next = index <= 0 ? items.length - 1 : index - 1;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = items.length - 1;
    }
    if (next >= 0) {
      event.preventDefault();
      items[next]?.focus();
    }
  };

  return createPortal(
    <div
      className={`excalidraw gn-portal${
        theme === "dark" ? " theme--dark" : ""
      }`}
    >
      <div
        ref={panelRef}
        role={role}
        aria-label={label}
        aria-modal={role === "dialog" ? false : undefined}
        tabIndex={-1}
        className={`gn-popover${className ? ` ${className}` : ""}`}
        style={{
          top: pos?.top ?? 0,
          left: pos?.left ?? 0,
          visibility: pos ? "visible" : "hidden",
        }}
        onKeyDown={onKeyDown}
        onBlur={(event) => {
          // focus left the panel entirely (and did not land on the trigger)
          const to = event.relatedTarget as Node | null;
          if (
            to &&
            !panelRef.current?.contains(to) &&
            !anchorRef.current?.contains(to)
          ) {
            onClose();
          }
        }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
};

/** One row in a `role="menu"` popover. */
export const MenuItem = ({
  label,
  onClick,
  icon,
  checked,
  danger,
  description,
}: {
  label: string;
  onClick: () => void;
  icon?: React.ReactNode;
  /** Present => the row is a `menuitemradio`. */
  checked?: boolean;
  danger?: boolean;
  description?: string;
}) => (
  <button
    type="button"
    role={checked === undefined ? "menuitem" : "menuitemradio"}
    aria-checked={checked}
    className={`gn-menuitem${danger ? " gn-menuitem--danger" : ""}`}
    onClick={onClick}
  >
    <span className="gn-menuitem__glyph" aria-hidden="true">
      {checked === undefined ? icon : checked ? "✓" : null}
    </span>
    <span className="gn-menuitem__label">
      {label}
      {description ? (
        <span className="gn-menuitem__desc">{description}</span>
      ) : null}
    </span>
  </button>
);

/** A labelled run of menu rows. */
export const MenuGroup = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) => (
  <div role="group" aria-label={label} className="gn-menugroup">
    <p className="gn-menugroup__label" aria-hidden="true">
      {label}
    </p>
    {children}
  </div>
);

export default Popover;

/**
 * A trigger button plus its popover, with the open/close state and the
 * `aria-expanded`/`aria-haspopup` wiring done once instead of at every site.
 *
 * `children` is a render prop so a menu can close itself after acting
 * without every item needing its own `onClose` plumbing.
 */
export const MenuButton = ({
  label,
  title,
  buttonClassName,
  panelClassName,
  role = "menu",
  alignEnd,
  icon,
  text,
  children,
}: {
  /** Accessible name of the trigger. */
  label: string;
  /** Accessible name of the panel. Defaults to `label`. */
  title?: string;
  buttonClassName?: string;
  panelClassName?: string;
  role?: "menu" | "dialog";
  alignEnd?: boolean;
  icon?: React.ReactNode;
  /** Visible text on the trigger, when it is not icon-only. */
  text?: React.ReactNode;
  children: (close: () => void) => React.ReactNode;
}) => {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const closeAndReturn = useCallback(() => {
    ref.current?.focus();
    setOpen(false);
  }, []);

  return (
    <>
      <button
        type="button"
        ref={ref}
        className={buttonClassName ?? "gn-icon-button"}
        aria-label={text ? undefined : label}
        aria-haspopup={role === "menu" ? "menu" : "dialog"}
        aria-expanded={open}
        onClick={() => setOpen((it) => !it)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {icon}
        {text}
      </button>
      {open && (
        <Popover
          anchorRef={ref}
          onClose={close}
          role={role}
          label={title ?? label}
          alignEnd={alignEnd}
          className={panelClassName}
        >
          {children(closeAndReturn)}
        </Popover>
      )}
    </>
  );
};
