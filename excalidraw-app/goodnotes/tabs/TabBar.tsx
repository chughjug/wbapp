/**
 * The document tab strip.
 *
 * It renders ONLY when more than one document is open (override with
 * `showWhenSingle`). With a single document a full-width strip that names the
 * document you are already looking at is pure chrome; the title lives in the
 * floating bar's "…" menu instead.
 *
 * Presentational: it renders the tabs it is given and calls back. Navigation
 * is the host's job — activating a tab calls `onActivate(docId)` and the host
 * pushes `/d/<id>`; this component never touches `history`.
 *
 * Accessibility model (WAI-ARIA tabs, *manual* activation):
 *   - `role="tablist"` / `role="tab"` with `aria-selected`;
 *   - roving tabindex — exactly one tab is in the tab order at a time;
 *   - Left/Right move focus, Home/End jump to the ends, Enter/Space activate;
 *   - activation is manual on purpose: activating remounts the whole editor,
 *     which is far too expensive to do on every arrow keypress;
 *   - Delete/Backspace close the focused tab;
 *   - Ctrl/Cmd+Shift+Left/Right move the focused tab within the strip, so
 *     reordering is not mouse-only;
 *   - each close button is named "Close <title>", not a bare "×".
 */

import clsx from "clsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import "./TabBar.scss";

import type { OpenTab } from "./useOpenDocs";
import type { DragEvent, KeyboardEvent, MouseEvent } from "react";

export interface TabBarProps {
  /** Tabs in display order (from `useOpenDocs`). */
  tabs: OpenTab[];
  /** Active document id; the tab it names gets `aria-selected`. */
  activeId: string | null;
  /**
   * Activate a document. The host should push `/d/<docId>` and set its own
   * routing state — the strip itself does no navigation.
   */
  onActivate: (docId: string) => void;
  /** Close a tab. Neighbour activation is handled by the model, not here. */
  onClose: (docId: string) => void;
  /** Move a tab to a new index (drag-and-drop, or Ctrl/Cmd+Shift+Arrow). */
  onReorder?: (docId: string, toIndex: number) => void;
  /**
   * The "+" button: create a new document (same path as the floating bar's
   * New control). Hosts that want "browse the library" instead should wire
   * their own control — this strip's + means *new*.
   */
  onNewTab?: () => void;
  /** Optional "close other tabs", offered on a close button's Alt+click. */
  onCloseOthers?: (docId: string) => void;
  /**
   * Editor theme. The strip reads Excalidraw's own custom properties, which
   * are scoped to `.excalidraw` / `.theme--dark`, so it applies those classes
   * itself and needs to be told which.
   */
  theme?: "light" | "dark";
  /** Extra class on the root (positioning is the host's business). */
  className?: string;
  /** Accessible name for the tablist. */
  label?: string;
  /**
   * Render the strip even when only one document is open. Default `false`.
   *
   * With a single document the strip is pure cost — a full-width band whose
   * only job is to name the document you are already looking at. That name
   * now lives in the floating bar: it heads the "…" menu and describes the
   * Home control. The strip reappears the moment a second document is open,
   * which is the only point at which it is doing anything.
   */
  showWhenSingle?: boolean;
}

const FALLBACK_TITLE = "Untitled notebook";

/**
 * Stable 32-bit string hash (FNV-1a). Same input, same colour, forever —
 * which is the point: a course keeps its colour across sessions and devices.
 */
const hashString = (value: string): number => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

/**
 * The dot colour for a document: derived from its course when it has one (so
 * every "MATH 221" notebook matches), otherwise from its id (so untagged
 * notebooks are still told apart). Returned as an `hsl()` string tuned for
 * the given theme — the same hue, lifted and desaturated on dark so it stays
 * legible against a near-black strip.
 */
export const docDotColor = (
  input: { course?: string | null; id: string } | null,
  theme: "light" | "dark" = "light",
): string => {
  const seed = input
    ? input.course?.trim()
      ? `course:${input.course.trim().toLowerCase()}`
      : `doc:${input.id}`
    : "doc:unknown";
  const hash = hashString(seed);
  const hue = hash % 360;
  // avoid the muddy 50–70° band, where mid-saturation yellows read as grey
  const adjustedHue = hue >= 48 && hue <= 70 ? hue + 26 : hue;
  const saturation = 58 + ((hash >> 9) % 18);
  const lightness = theme === "dark" ? 62 : 46;
  return `hsl(${adjustedHue} ${saturation}% ${lightness}%)`;
};

const CloseIcon = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
    <path
      d="M5.5 5.5l9 9m0-9l-9 9"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  </svg>
);

const PlusIcon = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
    <path
      d="M10 4.5v11M4.5 10h11"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  </svg>
);

export const TabBar = ({
  tabs,
  activeId,
  onActivate,
  onClose,
  onReorder,
  onNewTab,
  onCloseOthers,
  theme = "light",
  className,
  label = "Open documents",
  showWhenSingle = false,
}: TabBarProps) => {
  const listRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  // which tab holds the roving tabindex; follows focus, not activation
  const [focusedId, setFocusedId] = useState<string | null>(activeId);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const ids = useMemo(() => tabs.map((tab) => tab.id), [tabs]);

  // keep the roving index pointing at something that still exists
  useEffect(() => {
    setFocusedId((current) =>
      current && ids.includes(current) ? current : activeId ?? ids[0] ?? null,
    );
  }, [ids, activeId]);

  const registerTab = useCallback(
    (id: string) => (node: HTMLButtonElement | null) => {
      if (node) {
        tabRefs.current.set(id, node);
      } else {
        tabRefs.current.delete(id);
      }
    },
    [],
  );

  const focusTab = useCallback((id: string) => {
    setFocusedId(id);
    tabRefs.current.get(id)?.focus();
  }, []);

  // scroll the active tab into view; the strip scrolls, it never wraps
  useEffect(() => {
    if (!activeId) {
      return;
    }
    const node = tabRefs.current.get(activeId);
    if (!node) {
      return;
    }
    const reduceMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    node.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      inline: "nearest",
      block: "nearest",
    });
  }, [activeId, ids.length]);

  const move = useCallback(
    (id: string, delta: number) => {
      if (!onReorder) {
        return;
      }
      const from = ids.indexOf(id);
      if (from === -1) {
        return;
      }
      const to = Math.max(0, Math.min(ids.length - 1, from + delta));
      if (to !== from) {
        onReorder(id, to);
      }
    },
    [ids, onReorder],
  );

  const onTabKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, id: string) => {
      const index = ids.indexOf(id);
      if (index === -1) {
        return;
      }
      const reorderModifier =
        event.shiftKey && (event.ctrlKey || event.metaKey);

      switch (event.key) {
        case "ArrowLeft":
        case "ArrowRight": {
          event.preventDefault();
          const delta = event.key === "ArrowLeft" ? -1 : 1;
          if (reorderModifier) {
            move(id, delta);
            // focus follows the tab the user is dragging with the keyboard
            requestAnimationFrame(() => focusTab(id));
            return;
          }
          const next = ids[(index + delta + ids.length) % ids.length];
          if (next) {
            focusTab(next);
          }
          return;
        }
        case "Home":
          event.preventDefault();
          if (ids[0]) {
            focusTab(ids[0]);
          }
          return;
        case "End":
          event.preventDefault();
          if (ids[ids.length - 1]) {
            focusTab(ids[ids.length - 1]);
          }
          return;
        case "Enter":
        case " ":
        case "Spacebar":
          event.preventDefault();
          onActivate(id);
          return;
        case "Delete":
        case "Backspace": {
          event.preventDefault();
          // focus the neighbour that will survive the close
          const neighbour = ids[index + 1] ?? ids[index - 1] ?? null;
          onClose(id);
          if (neighbour) {
            requestAnimationFrame(() => focusTab(neighbour));
          }
          break;
        }
        default:
          break;
      }
    },
    [ids, focusTab, move, onActivate, onClose],
  );

  const onTabPointerDown = useCallback(
    (event: MouseEvent<HTMLElement>, id: string) => {
      // middle click closes, as in a browser
      if (event.button === 1) {
        event.preventDefault();
        onClose(id);
      }
    },
    [onClose],
  );

  // --- drag and drop ------------------------------------------------------
  const onDragStart = useCallback(
    (event: DragEvent<HTMLDivElement>, id: string) => {
      if (!onReorder) {
        return;
      }
      setDragId(id);
      event.dataTransfer.effectAllowed = "move";
      // Firefox refuses to start a drag without payload
      event.dataTransfer.setData("text/plain", id);
    },
    [onReorder],
  );

  const onDragOverTab = useCallback(
    (event: DragEvent<HTMLDivElement>, index: number) => {
      if (!onReorder || !dragId) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const rect = event.currentTarget.getBoundingClientRect();
      const after = event.clientX > rect.left + rect.width / 2;
      setDropIndex(after ? index + 1 : index);
    },
    [dragId, onReorder],
  );

  const finishDrag = useCallback(() => {
    if (onReorder && dragId && dropIndex !== null) {
      const from = ids.indexOf(dragId);
      // dropping "after" a tab to the right of the source shifts by one once
      // the source is removed
      const to = dropIndex > from ? dropIndex - 1 : dropIndex;
      if (from !== -1 && to !== from) {
        onReorder(dragId, to);
      }
    }
    setDragId(null);
    setDropIndex(null);
  }, [dragId, dropIndex, ids, onReorder]);

  // Zero cost below two documents: no band, no height, no scrollport. The
  // hooks above have all already run, so this early return is legal.
  if (tabs.length <= 1 && !showWhenSingle) {
    return null;
  }

  if (tabs.length === 0 && !onNewTab) {
    return null;
  }

  return (
    <div
      className={clsx(
        "excalidraw",
        "gn-tabbar-scope",
        { "theme--dark": theme === "dark" },
        className,
      )}
    >
      <div className="gn-tabbar">
        <div
          className="gn-tabbar__list"
          role="tablist"
          aria-label={label}
          aria-orientation="horizontal"
          ref={listRef}
          onDragOver={(event) => {
            if (dragId) {
              event.preventDefault();
            }
          }}
          onDrop={(event) => {
            event.preventDefault();
            finishDrag();
          }}
        >
          {tabs.map((tab, index) => {
            const title = tab.meta?.title?.trim() || FALLBACK_TITLE;
            const isActive = tab.id === activeId;
            const isFocusTarget = focusedId
              ? tab.id === focusedId
              : index === 0;
            return (
              <div
                key={tab.id}
                // the wrapper exists for drag-and-drop and the close button;
                // the tablist's only semantic children are the tabs themselves
                role="presentation"
                className={clsx("gn-tabbar__tab", {
                  "gn-tabbar__tab--active": isActive,
                  "gn-tabbar__tab--dragging": dragId === tab.id,
                  "gn-tabbar__tab--drop-before": dropIndex === index,
                  "gn-tabbar__tab--drop-after":
                    dropIndex === index + 1 && index === tabs.length - 1,
                })}
                draggable={!!onReorder}
                onDragStart={(event) => onDragStart(event, tab.id)}
                onDragOver={(event) => onDragOverTab(event, index)}
                onDragEnd={finishDrag}
                onDrop={(event) => {
                  event.preventDefault();
                  finishDrag();
                }}
              >
                <button
                  type="button"
                  role="tab"
                  id={`gn-tab-${tab.id}`}
                  ref={registerTab(tab.id)}
                  className="gn-tabbar__tab-button"
                  aria-selected={isActive}
                  tabIndex={isFocusTarget ? 0 : -1}
                  title={
                    tab.meta?.course ? `${title} — ${tab.meta.course}` : title
                  }
                  onClick={() => {
                    setFocusedId(tab.id);
                    onActivate(tab.id);
                  }}
                  onFocus={() => setFocusedId(tab.id)}
                  onKeyDown={(event) => onTabKeyDown(event, tab.id)}
                  onMouseDown={(event) => onTabPointerDown(event, tab.id)}
                >
                  <span
                    className="gn-tabbar__dot"
                    aria-hidden="true"
                    style={{
                      backgroundColor: docDotColor(
                        tab.meta ?? { id: tab.id, course: null },
                        theme,
                      ),
                    }}
                  />
                  <span className="gn-tabbar__title">{title}</span>
                </button>
                <button
                  type="button"
                  className="gn-tabbar__close"
                  // the close button is not part of the tablist's roving
                  // tabindex; Delete/Backspace on the tab does the same job
                  tabIndex={-1}
                  aria-label={
                    onCloseOthers
                      ? `Close ${title} (hold Alt to close the other tabs instead)`
                      : `Close ${title}`
                  }
                  onClick={(event) => {
                    event.stopPropagation();
                    if (event.altKey && onCloseOthers) {
                      onCloseOthers(tab.id);
                    } else {
                      onClose(tab.id);
                    }
                  }}
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  <CloseIcon />
                </button>
              </div>
            );
          })}
        </div>
        {onNewTab && (
          <button
            type="button"
            className="gn-tabbar__new"
            aria-label="New document"
            title="New document"
            data-testid="goodnotes-tabbar-new"
            onClick={onNewTab}
          >
            <PlusIcon />
          </button>
        )}
      </div>
    </div>
  );
};

export default TabBar;
