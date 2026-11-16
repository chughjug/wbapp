/**
 * Multi-selection state for the shelf.
 *
 * Deliberately order-agnostic: the hook stores a set of ids plus an *anchor*
 * (the last item selected by a plain click or Space), and every range
 * operation takes the currently visible, currently sorted id list as an
 * argument. That means a range selection always follows what the user can
 * see, and re-sorting or re-filtering never scrambles a stored range.
 */

import { useCallback, useMemo, useRef, useState } from "react";

export interface UseSelectionResult {
  selected: ReadonlySet<string>;
  count: number;
  isSelected: (id: string) => boolean;
  /** Last item selected without a modifier — the base of a Shift range. */
  anchor: string | null;
  setAnchor: (id: string | null) => void;
  /** Cmd/Ctrl-click, or Space. */
  toggle: (id: string) => void;
  /** Plain click on a checkbox-free selection: replace the selection. */
  selectOnly: (id: string) => void;
  /** Shift-click / Shift+Arrow: anchor..id inclusive, replacing the range. */
  selectRange: (id: string, ordered: readonly string[]) => void;
  /** Shift+Arrow without collapsing what is already selected. */
  extendRange: (id: string, ordered: readonly string[]) => void;
  selectAll: (ids: readonly string[]) => void;
  clear: () => void;
  /** Drop ids that no longer exist. No-op (same Set) when nothing changes. */
  retain: (ids: readonly string[]) => void;
}

const rangeBetween = (
  ordered: readonly string[],
  from: string | null,
  to: string,
): string[] => {
  const end = ordered.indexOf(to);
  if (end < 0) {
    return [];
  }
  const start = from ? ordered.indexOf(from) : -1;
  if (start < 0) {
    return [to];
  }
  const [lo, hi] = start <= end ? [start, end] : [end, start];
  return ordered.slice(lo, hi + 1);
};

export const useSelection = (): UseSelectionResult => {
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const anchorRef = useRef<string | null>(null);
  const [anchor, setAnchorState] = useState<string | null>(null);

  const setAnchor = useCallback((id: string | null) => {
    anchorRef.current = id;
    setAnchorState(id);
  }, []);

  const toggle = useCallback(
    (id: string) => {
      setSelected((current) => {
        const next = new Set(current);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
      setAnchor(id);
    },
    [setAnchor],
  );

  const selectOnly = useCallback(
    (id: string) => {
      setSelected(new Set([id]));
      setAnchor(id);
    },
    [setAnchor],
  );

  const selectRange = useCallback(
    (id: string, ordered: readonly string[]) => {
      const range = rangeBetween(ordered, anchorRef.current, id);
      setSelected(new Set(range));
      // the anchor deliberately stays put, so dragging the range back and
      // forth with Shift+Arrow keeps growing/shrinking from the same base
      if (!anchorRef.current) {
        setAnchor(id);
      }
    },
    [setAnchor],
  );

  const extendRange = useCallback(
    (id: string, ordered: readonly string[]) => {
      const range = rangeBetween(ordered, anchorRef.current, id);
      setSelected((current) => new Set([...current, ...range]));
      if (!anchorRef.current) {
        setAnchor(id);
      }
    },
    [setAnchor],
  );

  const selectAll = useCallback(
    (ids: readonly string[]) => {
      setSelected(new Set(ids));
      setAnchor(ids.length ? ids[ids.length - 1] : null);
    },
    [setAnchor],
  );

  const clear = useCallback(() => {
    setSelected((current) => (current.size === 0 ? current : new Set()));
    setAnchor(null);
  }, [setAnchor]);

  const retain = useCallback((ids: readonly string[]) => {
    const keep = new Set(ids);
    setSelected((current) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of current) {
        if (keep.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, []);

  return useMemo(
    () => ({
      selected,
      count: selected.size,
      isSelected: (id: string) => selected.has(id),
      anchor,
      setAnchor,
      toggle,
      selectOnly,
      selectRange,
      extendRange,
      selectAll,
      clear,
      retain,
    }),
    [
      selected,
      anchor,
      setAnchor,
      toggle,
      selectOnly,
      selectRange,
      extendRange,
      selectAll,
      clear,
      retain,
    ],
  );
};
