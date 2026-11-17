/**
 * <PaperBackgroundLayer /> — an absolutely positioned canvas that paints the
 * paper for every page, UNDERNEATH Excalidraw's own canvases.
 *
 * It is purely presentational: it never handles pointer input
 * (`pointer-events: none`) and never touches the Excalidraw scene.
 *
 * See INTEGRATION.md in this folder for how to mount it.
 */

import { supportsResizeObserver } from "@excalidraw/common";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { PAGE_FRAME_PREFIX } from "../types";

import { getPageImageBackground, onPageImageReady } from "./pageImages";
import {
  PAPER_TEMPLATES,
  renderPaper,
  rulingOpacityForZoom,
} from "./templates";

import "./PaperBackgroundLayer.scss";

import type { PageImageBackground } from "./pageImages";
import type { PaperTheme } from "./templates";
import type { PaperTemplateId } from "../types";

/** A page's scene-space rectangle plus the template it should be drawn with. */
export interface PaperPageRect {
  id: string;
  /** Scene coordinates of the page's top-left corner. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** 0-based position in the document, parsed from the frame name when present. */
  index: number;
  /** Template parsed from the frame name, if it encoded one. */
  template?: PaperTemplateId;
  /**
   * Image background recorded on the frame's `customData`
   * (`goodnotesPageImage`). Drawn between the sheet and the rulings.
   */
  image?: PageImageBackground;
}

const isPaperTemplateId = (value: string): value is PaperTemplateId =>
  Object.prototype.hasOwnProperty.call(PAPER_TEMPLATES, value);

/**
 * LOCAL helper (deliberately not shared with goodnotes/pages): derive page
 * rectangles from frame elements whose `name` starts with PAGE_FRAME_PREFIX.
 *
 * Recognised name shapes (everything after the prefix is optional):
 *   "page:"  "page:3"  "page:3:lined"  "page:lined"
 */
export const getPaperPageRects = (
  elements: readonly ExcalidrawElement[] | null | undefined,
): PaperPageRect[] => {
  if (!elements?.length) {
    return [];
  }

  const pages: PaperPageRect[] = [];

  for (const element of elements) {
    if (element.type !== "frame" || element.isDeleted) {
      continue;
    }
    const name = (element as { name?: string | null }).name;
    if (typeof name !== "string" || !name.startsWith(PAGE_FRAME_PREFIX)) {
      continue;
    }

    const parts = name
      .slice(PAGE_FRAME_PREFIX.length)
      .split(":")
      .map((part) => part.trim())
      .filter(Boolean);

    let index = Number.NaN;
    let template: PaperTemplateId | undefined;

    for (const part of parts) {
      if (isPaperTemplateId(part)) {
        template = part;
      } else if (Number.isFinite(Number(part))) {
        index = Number(part);
      }
    }

    if (!template) {
      // the pages module stores the ruling in `customData`, not in the name
      const stored = (element.customData as Record<string, unknown> | undefined)
        ?.goodnotesPage as { template?: PaperTemplateId } | undefined;
      if (stored?.template && isPaperTemplateId(stored.template)) {
        template = stored.template;
      }
    }

    pages.push({
      image: getPageImageBackground(element),
      id: element.id,
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
      index: Number.isFinite(index) ? index : pages.length,
      template,
    });
  }

  return pages.sort((a, b) => a.y - b.y || a.x - b.x);
};

export interface PaperBackgroundLayerProps {
  /**
   * Scene elements; page rectangles are derived from the page frames in here.
   * Ignored when `pages` is supplied.
   */
  elements?: readonly ExcalidrawElement[];
  /** Pre-computed page rectangles (takes precedence over `elements`). */
  pages?: readonly PaperPageRect[];
  /** appState.scrollX */
  scrollX: number;
  /** appState.scrollY */
  scrollY: number;
  /** appState.zoom.value */
  zoom: number;
  /** appState.theme */
  theme: PaperTheme;
  /** appState.offsetLeft / offsetTop, if the layer is not flush with the editor. */
  offsetLeft?: number;
  offsetTop?: number;
  /** Template used for pages whose frame name doesn't encode one. */
  defaultTemplate?: PaperTemplateId;
  /** Per-page override; wins over the frame name and `defaultTemplate`. */
  templateForPage?: (page: PaperPageRect) => PaperTemplateId | undefined;
  /**
   * Per-page image-background override; wins over the frame's own
   * `customData`. Pass `null` from the callback to suppress the image.
   */
  imageForPage?: (
    page: PaperPageRect,
  ) => PageImageBackground | null | undefined;
  /** Extra class on the wrapper canvas. */
  className?: string;
}

/** Scene px -> viewport CSS px. */
const toViewport = (scene: number, scroll: number, zoom: number) =>
  (scene + scroll) * zoom;

export const PaperBackgroundLayer = (props: PaperBackgroundLayerProps) => {
  const {
    elements,
    pages,
    scrollX,
    scrollY,
    zoom,
    theme,
    offsetLeft = 0,
    offsetTop = 0,
    defaultTemplate = "blank",
    templateForPage,
    imageForPage,
    className,
  } = props;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  // latest props, read inside the rAF callback so we never redraw stale state
  const stateRef = useRef(props);
  stateRef.current = props;
  const sizeRef = useRef({ width: 0, height: 0 });

  const draw = useCallback(() => {
    rafRef.current = null;

    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const {
      elements: els,
      pages: explicitPages,
      scrollX: sx,
      scrollY: sy,
      zoom: z,
      theme: currentTheme,
      offsetLeft: ox = 0,
      offsetTop: oy = 0,
      defaultTemplate: fallbackTemplate = "blank",
      templateForPage: pick,
      imageForPage: pickImage,
    } = stateRef.current;

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const { width: cssWidth, height: cssHeight } = sizeRef.current;

    const pixelWidth = Math.max(1, Math.floor(cssWidth * dpr));
    const pixelHeight = Math.max(1, Math.floor(cssHeight * dpr));

    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pixelWidth, pixelHeight);

    const pageList = explicitPages ?? getPaperPageRects(els);
    if (!pageList.length || cssWidth <= 0 || cssHeight <= 0) {
      return;
    }

    for (const page of pageList) {
      const left = toViewport(page.x, sx, z) + ox;
      const top = toViewport(page.y, sy, z) + oy;
      const w = page.width * z;
      const h = page.height * z;

      // viewport culling
      if (
        left > cssWidth ||
        top > cssHeight ||
        left + w < 0 ||
        top + h < 0 ||
        w <= 0 ||
        h <= 0
      ) {
        continue;
      }

      const templateId =
        pick?.(page) ?? page.template ?? fallbackTemplate ?? "blank";
      const override = pickImage?.(page);
      const image = override === null ? undefined : override ?? page.image;

      ctx.save();
      // device pixels -> CSS px -> page-local scene px
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.translate(left, top);
      ctx.scale(z, z);
      renderPaper(ctx, templateId, page.width, page.height, {
        theme: currentTheme,
        image,
        rulingOpacity: rulingOpacityForZoom(z),
      });
      ctx.restore();
    }
  }, []);

  const schedule = useCallback(() => {
    if (rafRef.current !== null) {
      return;
    }
    rafRef.current = requestAnimationFrame(draw);
  }, [draw]);

  // size the canvas to its parent
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas) {
      return;
    }

    const measure = () => {
      const rect = (parent ?? canvas).getBoundingClientRect();
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      if (
        width !== sizeRef.current.width ||
        height !== sizeRef.current.height
      ) {
        sizeRef.current = { width, height };
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        schedule();
      }
    };

    measure();

    // ResizeObserver is feature-detected throughout this repo (and absent in
    // jsdom); the window resize listener below is the fallback.
    const observer = supportsResizeObserver
      ? new ResizeObserver(measure)
      : null;
    observer?.observe(parent ?? canvas);
    window.addEventListener("resize", measure);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [schedule]);

  // redraw whenever anything observable changes
  useEffect(() => {
    schedule();
  }, [
    schedule,
    elements,
    pages,
    scrollX,
    scrollY,
    zoom,
    theme,
    offsetLeft,
    offsetTop,
    defaultTemplate,
    templateForPage,
    imageForPage,
  ]);

  // A page image decodes asynchronously; the first paint shows a placeholder.
  // Repaint as soon as any decode lands.
  useEffect(() => onPageImageReady(() => schedule()), [schedule]);

  // repaint when the display's pixel ratio changes (monitor switch / browser zoom)
  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }
    const query = window.matchMedia(
      `(resolution: ${window.devicePixelRatio || 1}dppx)`,
    );
    const onChange = () => schedule();
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, [schedule]);

  useEffect(
    () => () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    },
    [],
  );

  return (
    <canvas
      ref={canvasRef}
      className={`goodnotes-paper-layer${className ? ` ${className}` : ""}`}
      aria-hidden="true"
    />
  );
};

export default PaperBackgroundLayer;
