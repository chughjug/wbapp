/**
 * Cover thumbnails for the home screen.
 *
 * FINDING, AND WHY THIS FILE EXISTS: `DocMeta.thumbnail` has always been part
 * of the shared contract and both the card and the row have always rendered
 * it — but nothing in the app ever produced one. The only caller of
 * `setThumbnail` outside this module is `goodnotes/sync`, which merely
 * re-stores a thumbnail that arrived from another device. So on any device
 * that has not synced, every cover was the generated initials placeholder,
 * and a redesign that leans on recognising a notebook by sight was leaning on
 * nothing. The editor is where a thumbnail would naturally be captured, and
 * the editor is not ours to edit, so the library generates them itself, from
 * the scenes it already owns.
 *
 * How it behaves, and the constraints that shaped it:
 *  - lazily, and only for documents the shelf is actually showing;
 *  - one at a time, during idle time, and never while the tab is hidden —
 *    a scene can be megabytes and this must never compete with the UI;
 *  - page 1 only (the first `page:` frame), clipped to the page, so a
 *    twenty-page notebook does not render as twenty stamps;
 *  - skipped entirely when the page has no ink on it: a blank white square
 *    tells the student less than the coloured initials placeholder does;
 *  - stamped with the document's `updatedAt` in localStorage, so an edited
 *    notebook gets a fresh cover and an unchanged one is never re-rendered.
 *    (`DocMeta` has nowhere to record *when* a thumbnail was taken and the
 *     shared contract is not ours to widen — see the report.)
 */

import type {
  ExcalidrawElement,
  ExcalidrawFrameElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import { PAGE_FRAME_PREFIX } from "../types";

import { getScene, setThumbnail } from "./store";

import type { DocMeta } from "../types";

/** Longest edge of a generated cover, in px. Cards are ~220 CSS px wide. */
export const THUMBNAIL_MAX_PX = 440;

/** Scenes bigger than this are left alone; the cost is not worth the cover. */
const MAX_ELEMENTS = 4000;

const STAMP_KEY = "goodnotes:library:thumb-stamps";

type Stamps = Record<string, number>;

const readStamps = (): Stamps => {
  try {
    const raw = window.localStorage.getItem(STAMP_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? (parsed as Stamps) : {};
  } catch {
    return {};
  }
};

const writeStamp = (id: string, updatedAt: number) => {
  try {
    const stamps = readStamps();
    stamps[id] = updatedAt;
    window.localStorage.setItem(STAMP_KEY, JSON.stringify(stamps));
  } catch {
    /* private mode: covers are regenerated next session, nothing breaks */
  }
};

/**
 * Does this document want a (new) cover? True when it has none, or when it
 * has been edited since the one it has was taken.
 */
export const needsThumbnail = (doc: DocMeta, stamps = readStamps()): boolean =>
  doc.thumbnail == null || (stamps[doc.id] ?? 0) < doc.updatedAt;

const isPageFrame = (element: ExcalidrawElement): boolean =>
  element.type === "frame" &&
  typeof element.name === "string" &&
  element.name.startsWith(PAGE_FRAME_PREFIX);

/**
 * Render page 1 of a document to a PNG data URL, or `null` when there is
 * nothing worth rendering. Never throws.
 */
export const renderThumbnail = async (id: string): Promise<string | null> => {
  try {
    const scene = await getScene(id);
    if (!scene) {
      return null;
    }
    // `isDeleted` is the runtime guarantee the export's type asks for; the
    // predicate cannot narrow a union this wide, so assert once, here.
    const elements = scene.elements.filter(
      (element) => !element.isDeleted,
    ) as readonly NonDeletedExcalidrawElement[];
    if (elements.length === 0 || elements.length > MAX_ELEMENTS) {
      return null;
    }
    const page = elements.find(isPageFrame);
    // ink, as opposed to the page furniture itself
    const hasContent = elements.some(
      (element) => element.type !== "frame" && element.type !== "magicframe",
    );
    if (!hasContent) {
      return null;
    }

    const { exportScene } = await import("@excalidraw/excalidraw");
    const canvas = await exportScene({
      type: "canvas",
      data: { elements, files: scene.files },
      config: {
        exportingFrame:
          page && page.type === "frame"
            ? (page as NonDeletedExcalidrawElement & ExcalidrawFrameElement)
            : null,
        maxWidthOrHeight: THUMBNAIL_MAX_PX,
        padding: 0,
        theme: "light",
        canvasBackgroundColor: "#ffffff",
      },
    });
    return canvas.toDataURL("image/png");
  } catch (error: any) {
    console.warn("goodnotes/library: could not render a cover", error);
    return null;
  }
};

// ---------------------------------------------------------------------------
// the queue
// ---------------------------------------------------------------------------

/** Ids tried this session and found to have nothing to render. */
const barren = new Set<string>();
let running = false;

const whenIdle = (fn: () => void) => {
  const ric = (
    window as unknown as {
      requestIdleCallback?: (
        cb: () => void,
        opts?: { timeout: number },
      ) => void;
    }
  ).requestIdleCallback;
  if (ric) {
    ric(fn, { timeout: 2000 });
  } else {
    window.setTimeout(fn, 200);
  }
};

/**
 * Generate missing covers for `docs`, one at a time, during idle time.
 * Returns a function that cancels the run. Safe to call on every render:
 * a run already in flight is left alone.
 */
export const queueThumbnails = (docs: readonly DocMeta[]): (() => void) => {
  let cancelled = false;
  if (running) {
    return () => {
      cancelled = true;
    };
  }
  const stamps = readStamps();
  const pending = docs.filter(
    (doc) => !barren.has(doc.id) && needsThumbnail(doc, stamps),
  );
  if (pending.length === 0) {
    return () => {
      cancelled = true;
    };
  }

  running = true;
  const step = async (index: number): Promise<void> => {
    if (cancelled || index >= pending.length) {
      running = false;
      return;
    }
    if (document.visibilityState === "hidden") {
      running = false;
      return;
    }
    const doc = pending[index];
    const dataUrl = await renderThumbnail(doc.id);
    if (cancelled) {
      running = false;
      return;
    }
    if (dataUrl) {
      try {
        await setThumbnail(doc.id, dataUrl);
        writeStamp(doc.id, doc.updatedAt);
      } catch {
        barren.add(doc.id);
      }
    } else {
      barren.add(doc.id);
    }
    whenIdle(() => void step(index + 1));
  };

  whenIdle(() => void step(0));

  return () => {
    cancelled = true;
    running = false;
  };
};
