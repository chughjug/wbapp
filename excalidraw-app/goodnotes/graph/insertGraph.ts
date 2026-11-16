/**
 * Putting a rendered graph into the Excalidraw scene — and getting it back
 * out again for editing.
 *
 * ## The ordering rule
 *
 * A valid scene file needs three things: a `fileId` produced by the editor's
 * own `generateIdFromFile` (a SHA-1 of the bytes, so the same picture is
 * stored once), a `mimeType`, and a `dataURL`. And
 * `excalidrawAPI.addFiles([...])` **must happen before** the image element
 * lands in the scene — otherwise the element briefly references a file the
 * editor cannot resolve, and the picture disappears on reload. Every entry
 * point here keeps that order.
 *
 * ## Re-editability
 *
 * The whole {@link GraphSpec} is stored on the element at
 * `customData.goodnotes.graph`, next to (never on top of) the other
 * GoodNotes keys. {@link editGraph} reads it back and hands you an `update`
 * function that re-renders into the *same* box and replaces the element in
 * one undo step, so changing the x-range is a re-render, not a redo.
 */

import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { newElementWith, newImageElement } from "@excalidraw/element";
import {
  generateIdFromFile,
  getDataURL,
} from "@excalidraw/excalidraw/data/blob";

import {
  DEFAULT_GRAPH_HEIGHT,
  DEFAULT_GRAPH_WIDTH,
  DEFAULT_PIXEL_RATIO,
  renderGraphToCanvas,
} from "./renderGraph";
import {
  describeGraph,
  GOODNOTES_CUSTOM_DATA_NAMESPACE,
  GRAPH_CUSTOM_DATA_KEY,
  normalizeGraphSpec,
} from "./spec";

import type { RenderGraphResult } from "./renderGraph";
import type { GraphSpec } from "./spec";
import type {
  ExcalidrawElement,
  ExcalidrawImageElement,
  FileId,
  NonDeleted,
} from "@excalidraw/element/types";
import type {
  BinaryFileData,
  DataURL,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";

type CustomDataRecord = Record<string, unknown>;

/** What the renderer produces, ready to hand to `addFiles`. */
export interface GraphRaster {
  file: BinaryFileData;
  fileId: FileId;
  /** Logical (CSS px) size — what the element should be. */
  width: number;
  height: number;
  /** The text alternative derived from the spec. */
  alt: string;
  render: RenderGraphResult;
}

export interface RenderGraphFileOptions {
  width?: number;
  height?: number;
  /** Device pixels per CSS px. Default 2 — "render at 2× for crispness". */
  pixelRatio?: number;
  /** `"image/png"` (default) keeps the thin lines and text crisp. */
  mimeType?: "image/png";
}

const canvasToBlob = (
  canvas: HTMLCanvasElement,
  mimeType: string,
): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("The browser could not turn the graph into an image."));
      }
    }, mimeType);
  });

/**
 * Renders a spec to a PNG and wraps it in a `BinaryFileData` whose id is the
 * editor's own SHA-1 of the bytes.
 */
export const renderGraphToFile = async (
  spec: GraphSpec,
  options: RenderGraphFileOptions = {},
): Promise<GraphRaster> => {
  const width = Math.round(options.width ?? DEFAULT_GRAPH_WIDTH);
  const height = Math.round(options.height ?? DEFAULT_GRAPH_HEIGHT);
  const mimeType = options.mimeType ?? "image/png";
  const canvas = document.createElement("canvas");
  const render = renderGraphToCanvas(canvas, spec, {
    width,
    height,
    pixelRatio: options.pixelRatio ?? DEFAULT_PIXEL_RATIO,
  });
  const blob = await canvasToBlob(canvas, mimeType);
  const alt = describeGraph(spec);
  const file = new File([blob], `${sanitizeFileName(alt)}.png`, {
    type: mimeType,
  });
  const fileId = (await generateIdFromFile(file)) as FileId;
  const dataURL = (await getDataURL(file)) as DataURL;
  const now = Date.now();
  // free the backing store eagerly
  canvas.width = 0;
  canvas.height = 0;
  return {
    fileId,
    width,
    height,
    alt,
    render,
    file: {
      id: fileId,
      mimeType,
      dataURL,
      created: now,
      lastRetrieved: now,
    },
  };
};

const sanitizeFileName = (text: string): string =>
  text
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 48) || "graph";

/* -------------------------------------------------------------------------- */
/* customData                                                                 */
/* -------------------------------------------------------------------------- */

/** What we persist on the element. The spec plus its text alternative. */
export interface GraphCustomData {
  spec: GraphSpec;
  /** Text alternative, kept denormalized so readers need not re-derive it. */
  alt: string;
  /** Logical size the raster was rendered at. */
  rendered: { width: number; height: number; pixelRatio: number };
  updatedAt: number;
}

/**
 * Merges our graph state into `customData.goodnotes.graph` **without
 * clobbering** sibling GoodNotes keys (`page`, `backdrop`, the pens marker…).
 * Pass `null` to remove only our key.
 */
export const mergeGraphCustomData = (
  element: Pick<ExcalidrawElement, "customData"> | undefined,
  state: GraphCustomData | null,
): CustomDataRecord | undefined => {
  const existing = (element?.customData as CustomDataRecord | undefined) ?? {};
  const existingNs =
    (existing[GOODNOTES_CUSTOM_DATA_NAMESPACE] as
      | CustomDataRecord
      | undefined) ?? {};
  const nextNs: CustomDataRecord = { ...existingNs };
  if (state) {
    nextNs[GRAPH_CUSTOM_DATA_KEY] = state;
  } else {
    delete nextNs[GRAPH_CUSTOM_DATA_KEY];
  }
  const next: CustomDataRecord = { ...existing };
  if (Object.keys(nextNs).length > 0) {
    next[GOODNOTES_CUSTOM_DATA_NAMESPACE] = nextNs;
  } else {
    delete next[GOODNOTES_CUSTOM_DATA_NAMESPACE];
  }
  return Object.keys(next).length > 0 ? next : undefined;
};

/** Reads our state back, validating it (saved scenes are untrusted input). */
export const getGraphCustomData = (
  element: ExcalidrawElement | null | undefined,
): GraphCustomData | null => {
  const ns = (element?.customData as CustomDataRecord | undefined)?.[
    GOODNOTES_CUSTOM_DATA_NAMESPACE
  ] as CustomDataRecord | undefined;
  const raw = ns?.[GRAPH_CUSTOM_DATA_KEY] as
    | Partial<GraphCustomData>
    | undefined;
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const spec = normalizeGraphSpec(raw.spec);
  if (!spec) {
    return null;
  }
  return {
    spec,
    alt: typeof raw.alt === "string" ? raw.alt : describeGraph(spec),
    rendered:
      raw.rendered && typeof raw.rendered === "object"
        ? raw.rendered
        : {
            width: DEFAULT_GRAPH_WIDTH,
            height: DEFAULT_GRAPH_HEIGHT,
            pixelRatio: DEFAULT_PIXEL_RATIO,
          },
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : 0,
  };
};

/** The spec stored on an element, or `null` if it is not one of our graphs. */
export const getGraphSpec = (
  element: ExcalidrawElement | null | undefined,
): GraphSpec | null => getGraphCustomData(element)?.spec ?? null;

/** Narrowing guard: is this element a graph we inserted? */
export const isGraphElement = (
  element: ExcalidrawElement | null | undefined,
): element is ExcalidrawImageElement =>
  !!element &&
  element.type === "image" &&
  !element.isDeleted &&
  getGraphCustomData(element) !== null;

/** The stored text alternative for a graph element, if it has one. */
export const getGraphAltText = (
  element: ExcalidrawElement | null | undefined,
): string | null => getGraphCustomData(element)?.alt ?? null;

/* -------------------------------------------------------------------------- */
/* inserting                                                                  */
/* -------------------------------------------------------------------------- */

export interface InsertGraphOptions extends RenderGraphFileOptions {
  /** Scene coordinates of the top-left corner. Default: viewport centre. */
  x?: number;
  y?: number;
  /** Select the new element after inserting. Default `true`. */
  select?: boolean;
  /**
   * Parent the image to a page frame that contains it, when one does.
   * Default `true`.
   */
  attachToFrame?: boolean;
}

export interface InsertGraphResult {
  element: NonDeleted<ExcalidrawImageElement>;
  raster: GraphRaster;
}

/** Scene-coordinate centre of what the user is currently looking at. */
const viewportCentre = (api: ExcalidrawImperativeAPI) => {
  const state = api.getAppState();
  const zoom = state.zoom?.value || 1;
  return {
    x: state.width / 2 / zoom - state.scrollX,
    y: state.height / 2 / zoom - state.scrollY,
  };
};

/** The smallest frame whose box contains the rectangle, if any. */
const frameContaining = (
  elements: readonly ExcalidrawElement[],
  rect: { x: number; y: number; width: number; height: number },
): ExcalidrawElement | null => {
  const candidates = elements.filter(
    (element) =>
      (element.type === "frame" || element.type === "magicframe") &&
      !element.isDeleted &&
      rect.x >= element.x &&
      rect.y >= element.y &&
      rect.x + rect.width <= element.x + element.width &&
      rect.y + rect.height <= element.y + element.height,
  );
  if (candidates.length === 0) {
    return null;
  }
  return candidates.reduce((smallest, element) =>
    element.width * element.height < smallest.width * smallest.height
      ? element
      : smallest,
  );
};

/**
 * Renders `spec` and inserts it into the live scene as an `image` element.
 *
 * Files are registered **before** the element is added. The spec rides along
 * in `customData.goodnotes.graph`, so {@link editGraph} can reopen it.
 */
export const insertGraphIntoScene = async (
  excalidrawAPI: ExcalidrawImperativeAPI,
  spec: GraphSpec,
  options: InsertGraphOptions = {},
): Promise<InsertGraphResult> => {
  const { select = true, attachToFrame = true, ...renderOptions } = options;
  const raster = await renderGraphToFile(spec, renderOptions);

  const elements = excalidrawAPI.getSceneElements();
  const centre = viewportCentre(excalidrawAPI);
  const x = options.x ?? Math.round(centre.x - raster.width / 2);
  const y = options.y ?? Math.round(centre.y - raster.height / 2);
  const box = { x, y, width: raster.width, height: raster.height };
  const frame = attachToFrame ? frameContaining(elements, box) : null;

  const customData = mergeGraphCustomData(undefined, {
    spec,
    alt: raster.alt,
    rendered: {
      width: raster.width,
      height: raster.height,
      pixelRatio: renderOptions.pixelRatio ?? DEFAULT_PIXEL_RATIO,
    },
    updatedAt: Date.now(),
  });

  const element = newImageElement({
    type: "image",
    x,
    y,
    width: raster.width,
    height: raster.height,
    fileId: raster.fileId,
    status: "saved",
    backgroundColor: "transparent",
    ...(frame ? { frameId: frame.id } : {}),
    customData,
  }) as NonDeleted<ExcalidrawImageElement>;

  // files FIRST — an element whose fileId cannot be resolved renders as a
  // broken placeholder and is dropped on reload
  excalidrawAPI.addFiles([raster.file]);
  excalidrawAPI.updateScene({
    elements: [...elements, element],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    ...(select
      ? {
          appState: {
            ...excalidrawAPI.getAppState(),
            selectedElementIds: { [element.id]: true },
          },
        }
      : {}),
  });

  return { element, raster };
};

/* -------------------------------------------------------------------------- */
/* editing                                                                    */
/* -------------------------------------------------------------------------- */

export interface UpdateGraphOptions {
  /**
   * Re-render at the element's current on-canvas size (so a resized graph
   * re-lays out its labels for the box it actually occupies) instead of the
   * size it was first drawn at. Default `true`.
   */
  useCurrentSize?: boolean;
  pixelRatio?: number;
}

/**
 * Re-renders an existing graph element from a new spec and swaps it in
 * place, as a single undo step. The element keeps its id, position, frame,
 * z-order, angle and lock state.
 */
export const updateGraphElement = async (
  excalidrawAPI: ExcalidrawImperativeAPI,
  element: ExcalidrawImageElement,
  nextSpec: GraphSpec,
  options: UpdateGraphOptions = {},
): Promise<InsertGraphResult> => {
  const { useCurrentSize = true, pixelRatio = DEFAULT_PIXEL_RATIO } = options;
  const stored = getGraphCustomData(element);
  const width = Math.round(
    useCurrentSize ? element.width : stored?.rendered.width ?? element.width,
  );
  const height = Math.round(
    useCurrentSize ? element.height : stored?.rendered.height ?? element.height,
  );
  const raster = await renderGraphToFile(nextSpec, {
    width,
    height,
    pixelRatio,
  });

  const next = newElementWith(element, {
    fileId: raster.fileId,
    status: "saved",
    // a new raster invalidates any crop taken against the old one
    crop: null,
    customData: mergeGraphCustomData(element, {
      spec: nextSpec,
      alt: raster.alt,
      rendered: { width, height, pixelRatio },
      updatedAt: Date.now(),
    }),
  }) as NonDeleted<ExcalidrawImageElement>;

  excalidrawAPI.addFiles([raster.file]);
  excalidrawAPI.updateScene({
    elements: excalidrawAPI
      .getSceneElements()
      .map((candidate) => (candidate.id === element.id ? next : candidate)),
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });

  return { element: next, raster };
};

export interface GraphEditHandle {
  /** The element being edited. */
  element: ExcalidrawImageElement;
  /** Its stored spec — seed the dialog with this. */
  spec: GraphSpec;
  /** Its stored text alternative. */
  alt: string;
  /** Re-render and replace in place. Resolves to the new element. */
  update: (
    nextSpec: GraphSpec,
    options?: UpdateGraphOptions,
  ) => Promise<InsertGraphResult>;
}

/**
 * The re-edit entry point. Give it a selected element; if it is one of our
 * graphs you get its spec back plus an `update` that re-renders in place.
 * Returns `null` for anything else, so a menu can decide whether to offer
 * the item at all.
 *
 * ```ts
 * const handle = editGraph(excalidrawAPI, selected);
 * if (handle) {
 *   openDialog(handle.spec, (next) => handle.update(next));
 * }
 * ```
 */
export const editGraph = (
  excalidrawAPI: ExcalidrawImperativeAPI,
  element: ExcalidrawElement | null | undefined,
): GraphEditHandle | null => {
  if (!isGraphElement(element)) {
    return null;
  }
  const stored = getGraphCustomData(element);
  if (!stored) {
    return null;
  }
  return {
    element,
    spec: stored.spec,
    alt: stored.alt,
    update: (nextSpec, options) =>
      updateGraphElement(excalidrawAPI, element, nextSpec, options),
  };
};

/** The single graph element in the current selection, if there is exactly one. */
export const getSelectedGraphElement = (
  excalidrawAPI: ExcalidrawImperativeAPI,
): ExcalidrawImageElement | null => {
  const selectedIds = excalidrawAPI.getAppState().selectedElementIds ?? {};
  const selected = excalidrawAPI
    .getSceneElements()
    .filter((element) => selectedIds[element.id]);
  if (selected.length !== 1) {
    return null;
  }
  return isGraphElement(selected[0]) ? selected[0] : null;
};
