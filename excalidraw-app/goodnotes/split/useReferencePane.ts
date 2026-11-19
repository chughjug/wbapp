/**
 * Owning the reference pane: which document is open alongside, how wide
 * it is, and whether there is room to put it beside rather than above.
 *
 * The choice of document is remembered per notebook. Opening a lecture
 * PDF next to week 3's notes is a pairing you come back to; being asked
 * to find it again every time you reopen the notebook is the friction
 * that stops people using a feature like this at all.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { clampSplit, splitOrientationFor } from "./renderReference";

const STORAGE_PREFIX = "goodnotes:reference:";

const readStored = (
  docId: string | null,
): { refId: string; split: number } | null => {
  if (!docId) {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${docId}`);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as { refId?: unknown; split?: unknown };
    if (typeof parsed.refId !== "string" || parsed.refId === "") {
      return null;
    }
    return {
      refId: parsed.refId,
      split: typeof parsed.split === "number" ? clampSplit(parsed.split) : 0.4,
    };
  } catch {
    return null;
  }
};

const writeStored = (
  docId: string | null,
  value: { refId: string; split: number } | null,
): void => {
  if (!docId) {
    return;
  }
  try {
    const key = `${STORAGE_PREFIX}${docId}`;
    if (value) {
      window.localStorage.setItem(key, JSON.stringify(value));
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // a device that cannot remember simply reopens without a pane
  }
};

export interface ReferencePaneController {
  /** The document open alongside, or null. */
  referenceId: string | null;
  /** Fraction of the workspace the pane takes, 0.2–0.8. */
  split: number;
  orientation: "side-by-side" | "stacked";
  open: (refId: string) => void;
  close: () => void;
  setSplit: (fraction: number) => void;
}

export const useReferencePane = (
  docId: string | null,
  /** Width of the workspace, for the side-by-side decision. */
  width: number,
): ReferencePaneController => {
  const [referenceId, setReferenceId] = useState<string | null>(null);
  const [split, setSplitState] = useState(0.4);

  // restore the pairing for this notebook
  useEffect(() => {
    const stored = readStored(docId);
    setReferenceId(stored?.refId ?? null);
    setSplitState(stored?.split ?? 0.4);
  }, [docId]);

  /**
   * Never alongside itself.
   *
   * Reachable in one tap: open notebook A with B alongside, then switch
   * to B from the pane's own picker or the command palette. Two live
   * copies of one document, one of them a stale raster, is a confusing
   * thing to look at and a worse thing to debug.
   */
  const effectiveId = referenceId === docId ? null : referenceId;

  const open = useCallback(
    (refId: string) => {
      if (!refId || refId === docId) {
        return;
      }
      setReferenceId(refId);
      writeStored(docId, { refId, split });
    },
    [docId, split],
  );

  const close = useCallback(() => {
    setReferenceId(null);
    writeStored(docId, null);
  }, [docId]);

  const setSplit = useCallback(
    (fraction: number) => {
      const next = clampSplit(fraction);
      setSplitState(next);
      if (effectiveId) {
        writeStored(docId, { refId: effectiveId, split: next });
      }
    },
    [docId, effectiveId],
  );

  const orientation = useMemo(() => splitOrientationFor(width), [width]);

  return {
    referenceId: effectiveId,
    split,
    orientation,
    open,
    close,
    setSplit,
  };
};
