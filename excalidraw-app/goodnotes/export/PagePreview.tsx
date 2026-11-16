/**
 * Visual preview of exactly the pages that will be exported.
 *
 * Thumbnails come from the same `renderPage` path as the real export, so
 * "1-3,5" stops being a guess: the student sees page 5 and can tell at a
 * glance it's the one they meant. Each thumbnail's encoded PNG size doubles
 * as the sample the file-size estimate is built from.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";

import { canvasToBlob, createPageRenderer } from "./renderPage";
import { yieldToUi } from "./exportPdf";

import type { PageSizeSample } from "./estimate";
import type { PageRenderer } from "./renderPage";
import type { PaperTemplateId } from "../types";

/** Rendered thumbnail width in device px (shown at half this, so it's crisp). */
const THUMB_TARGET_PX = 232;
/** How many thumbnails to actually render; the rest collapse into "+N more". */
export const MAX_THUMBNAILS = 12;
/**
 * Scale used for the file-size samples. Larger than a thumbnail so the
 * extrapolation to 1x–4x is short, small enough to be nearly free.
 */
const CALIBRATION_SCALE = 0.5;
/** Pages measured for the size estimate. */
const CALIBRATION_PAGES = 2;

export interface PagePreviewItem {
  pageNumber: number;
  /** Object URL of the thumbnail, or `null` while it renders. */
  url: string | null;
  /** Aspect ratio (w/h) of the page, known before the render finishes. */
  aspect: number;
  failed: boolean;
}

export interface UseSceneRendererOptions {
  elements: readonly ExcalidrawElement[];
  files: BinaryFiles | null;
  appState?: Partial<AppState>;
  defaultPaperTemplate?: PaperTemplateId;
}

export interface UseSceneRendererResult {
  /** `null` until the scene's page images have decoded. */
  renderer: PageRenderer | null;
  /** Scene-level failure (not a single page). */
  error: string | null;
}

/**
 * Builds the shared page renderer for a scene, once.
 *
 * The `preloadPageImages` inside `createPageRenderer` is what stops
 * image-backed pages previewing (and exporting) blank, so everything that
 * draws a page waits on this.
 */
export const useSceneRenderer = ({
  elements,
  files,
  appState,
  defaultPaperTemplate = "blank",
}: UseSceneRendererOptions): UseSceneRendererResult => {
  const [renderer, setRenderer] = useState<PageRenderer | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    createPageRenderer({ elements, files, appState, defaultPaperTemplate })
      .then((next) => {
        if (!cancelled) {
          setRenderer(next);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
    // appState is read once, at build time; it must not retrigger the build
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elements, files, defaultPaperTemplate]);

  return { renderer, error };
};

export interface UsePagePreviewsOptions {
  renderer: PageRenderer | null;
  /** 1-based page numbers to preview, in order. */
  pages: readonly number[];
  includeBackground: boolean;
  /** Pause rendering (e.g. while an export is running). */
  paused?: boolean;
}

export interface UsePagePreviewsResult {
  items: PagePreviewItem[];
  /** Pages selected but not thumbnailed, because of {@link MAX_THUMBNAILS}. */
  overflowCount: number;
  /** Size samples for `estimateExportBytes`. */
  samples: PageSizeSample[];
  isRendering: boolean;
}

/**
 * Renders preview thumbnails for `pages`, sequentially and cancellably.
 *
 * Thumbnails are cached per page *version*, so changing the range re-uses
 * what's already drawn and only new pages cost anything.
 */
export const usePagePreviews = ({
  renderer,
  pages,
  includeBackground,
  paused = false,
}: UsePagePreviewsOptions): UsePagePreviewsResult => {
  const [, forceRender] = useState(0);
  const [isRendering, setIsRendering] = useState(false);

  // key -> object URL. Lives for the dialog's lifetime; revoked on unmount.
  const cacheRef = useRef(new Map<string, string>());
  const failedRef = useRef(new Set<string>());
  const samplesRef = useRef(new Map<number, PageSizeSample>());
  const generationRef = useRef(0);

  useEffect(() => {
    const cache = cacheRef.current;
    const generation = generationRef;
    return () => {
      cache.forEach((url) => URL.revokeObjectURL(url));
      cache.clear();
      // invalidate any in-flight render loop
      generation.current++;
    };
  }, []);

  const visiblePages = useMemo(() => pages.slice(0, MAX_THUMBNAILS), [pages]);
  const visibleKey = visiblePages.join(",");

  useEffect(() => {
    if (!renderer || paused) {
      return;
    }
    const generation = ++generationRef.current;
    let active = true;

    const stillCurrent = () => active && generation === generationRef.current;

    const measure = async (pageNumber: number, scale: number) => {
      const frame = renderer.frames[pageNumber - 1];
      if (!frame) {
        return null;
      }
      const canvas = await renderer.renderPage(frame, {
        scale,
        includeBackground,
      });
      return canvasToBlob(canvas, "image/png");
    };

    const run = async () => {
      setIsRendering(true);
      for (const pageNumber of visiblePages) {
        if (!stillCurrent()) {
          return;
        }
        const frame = renderer.frames[pageNumber - 1];
        if (!frame) {
          continue;
        }
        const key = `${frame.id}:${frame.version}:${
          includeBackground ? "bg" : "nobg"
        }`;
        if (cacheRef.current.has(key) || failedRef.current.has(key)) {
          continue;
        }
        try {
          const blob = await measure(
            pageNumber,
            THUMB_TARGET_PX / Math.max(frame.width, 1),
          );
          if (!stillCurrent()) {
            return;
          }
          if (blob) {
            cacheRef.current.set(key, URL.createObjectURL(blob));
          }
        } catch {
          failedRef.current.add(key);
        }
        forceRender((n) => n + 1);
        await yieldToUi();
      }

      // Size calibration: a couple of pages at a bigger scale, so the
      // estimate isn't extrapolated ten-fold from a thumbnail.
      for (const pageNumber of visiblePages.slice(0, CALIBRATION_PAGES)) {
        if (!stillCurrent()) {
          return;
        }
        if (samplesRef.current.has(pageNumber)) {
          continue;
        }
        try {
          const blob = await measure(pageNumber, CALIBRATION_SCALE);
          if (!stillCurrent()) {
            return;
          }
          if (blob) {
            samplesRef.current.set(pageNumber, {
              pageNumber,
              scale: CALIBRATION_SCALE,
              bytes: blob.size,
            });
            forceRender((n) => n + 1);
          }
        } catch {
          // a page that won't render is reported by its thumbnail already
        }
        await yieldToUi();
      }

      if (stillCurrent()) {
        setIsRendering(false);
      }
    };

    void run();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderer, visibleKey, includeBackground, paused]);

  const items: PagePreviewItem[] = visiblePages.map((pageNumber) => {
    const frame = renderer?.frames[pageNumber - 1];
    const key = frame
      ? `${frame.id}:${frame.version}:${includeBackground ? "bg" : "nobg"}`
      : null;
    return {
      pageNumber,
      url: key ? cacheRef.current.get(key) ?? null : null,
      aspect: frame ? frame.width / Math.max(frame.height, 1) : 0.77,
      failed: key ? failedRef.current.has(key) : false,
    };
  });

  return {
    items,
    overflowCount: Math.max(0, pages.length - visiblePages.length),
    samples: [...samplesRef.current.values()],
    isRendering,
  };
};

export interface PagePreviewStripProps {
  items: readonly PagePreviewItem[];
  overflowCount: number;
  /** Shown when nothing is selected / the range is invalid. */
  emptyMessage?: string;
  /** Describes the selection for screen readers, e.g. "Pages 1–3, 5". */
  label: string;
}

/**
 * Horizontal strip of page thumbnails. A list, not a grid of images: a
 * screen-reader user gets "Pages 1–3, 5, list, 4 items" and then each page
 * number, which is the information the picture carries.
 */
export const PagePreviewStrip: React.FC<PagePreviewStripProps> = ({
  items,
  overflowCount,
  emptyMessage = "No pages selected.",
  label,
}) => {
  if (items.length === 0) {
    return <p className="gn-export-preview__empty">{emptyMessage}</p>;
  }

  return (
    <ul className="gn-export-preview" aria-label={label}>
      {items.map((item) => (
        <li key={item.pageNumber} className="gn-export-preview__item">
          <div
            className="gn-export-preview__frame"
            style={{ aspectRatio: `${item.aspect}` }}
          >
            {item.failed ? (
              <span className="gn-export-preview__failed" aria-hidden="true">
                !
              </span>
            ) : item.url ? (
              <img
                className="gn-export-preview__image"
                src={item.url}
                alt=""
                draggable={false}
              />
            ) : (
              <span className="gn-export-preview__spinner" aria-hidden="true" />
            )}
          </div>
          <span className="gn-export-preview__number">
            {item.failed
              ? `Page ${item.pageNumber} (preview failed)`
              : item.pageNumber}
          </span>
        </li>
      ))}
      {overflowCount > 0 && (
        <li className="gn-export-preview__item gn-export-preview__item--more">
          <div className="gn-export-preview__frame gn-export-preview__frame--more">
            <span>+{overflowCount}</span>
          </div>
          <span className="gn-export-preview__number">more</span>
        </li>
      )}
    </ul>
  );
};
