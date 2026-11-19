/**
 * Putting a typeset equation into the scene — and getting it back out to
 * edit.
 *
 * This follows the graph module's contract exactly, because the rules are
 * the editor's, not ours:
 *
 *  - the file is registered with `addFiles` **before** the element lands in
 *    the scene, or the element briefly points at a file the editor cannot
 *    resolve and the picture is dropped on reload;
 *  - the `fileId` is the editor's own SHA-1 of the bytes, so two copies of
 *    the same equation are stored once;
 *  - the whole spec rides along in `customData.goodnotes.math`, beside (and
 *    never on top of) the other GoodNotes keys, so an equation can be
 *    corrected rather than deleted and retyped.
 *
 * Unlike a graph, the image is an SVG rather than a PNG: the typesetter
 * emits paths, so there is no reason to flatten them to pixels and every
 * reason not to — it stays sharp at any zoom and in an exported PDF, and
 * the bytes are smaller.
 */

import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { newElementWith, newImageElement } from "@excalidraw/element";
import {
  generateIdFromFile,
  getDataURL,
} from "@excalidraw/excalidraw/data/blob";

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

import { renderMathToSvg } from "./renderMath";
import {
  GOODNOTES_CUSTOM_DATA_NAMESPACE,
  MATH_CUSTOM_DATA_KEY,
  describeMath,
  normalizeMathSpec,
} from "./spec";

import type { MathRender } from "./renderMath";
import type { MathSpec } from "./spec";

type CustomDataRecord = Record<string, unknown>;

const MIME_TYPE = "image/svg+xml";

/** What the renderer produces, ready to hand to `addFiles`. */
export interface MathRaster {
  file: BinaryFileData;
  fileId: FileId;
  width: number;
  height: number;
  alt: string;
  render: MathRender;
}

const sanitizeFileName = (text: string): string =>
  text
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 48) || "equation";

/** Typesets a spec and wraps the SVG in a `BinaryFileData`. */
export const renderMathToFile = async (spec: MathSpec): Promise<MathRaster> => {
  const render = await renderMathToSvg(spec);
  const file = new File([render.svg], `${sanitizeFileName(render.alt)}.svg`, {
    type: MIME_TYPE,
  });
  const fileId = (await generateIdFromFile(file)) as FileId;
  const dataURL = (await getDataURL(file)) as DataURL;
  const now = Date.now();
  return {
    fileId,
    width: render.width,
    height: render.height,
    alt: render.alt,
    render,
    file: {
      id: fileId,
      mimeType: MIME_TYPE,
      dataURL,
      created: now,
      lastRetrieved: now,
    },
  };
};

/* -------------------------------------------------------------------------- */
/* customData                                                                 */
/* -------------------------------------------------------------------------- */

/** What we persist on the element: the spec plus its text alternative. */
export interface MathCustomData {
  spec: MathSpec;
  alt: string;
  /** Logical size the SVG was laid out at. */
  rendered: { width: number; height: number };
  updatedAt: number;
}

/**
 * Merges our state into `customData.goodnotes.math` without clobbering
 * sibling GoodNotes keys (`page`, `backdrop`, `graph`…). Pass `null` to
 * remove only our key.
 */
export const mergeMathCustomData = (
  element: Pick<ExcalidrawElement, "customData"> | undefined,
  state: MathCustomData | null,
): CustomDataRecord | undefined => {
  const existing = (element?.customData as CustomDataRecord | undefined) ?? {};
  const existingNs =
    (existing[GOODNOTES_CUSTOM_DATA_NAMESPACE] as
      | CustomDataRecord
      | undefined) ?? {};
  const nextNs: CustomDataRecord = { ...existingNs };
  if (state) {
    nextNs[MATH_CUSTOM_DATA_KEY] = state;
  } else {
    delete nextNs[MATH_CUSTOM_DATA_KEY];
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
export const getMathCustomData = (
  element: ExcalidrawElement | null | undefined,
): MathCustomData | null => {
  const ns = (element?.customData as CustomDataRecord | undefined)?.[
    GOODNOTES_CUSTOM_DATA_NAMESPACE
  ] as CustomDataRecord | undefined;
  const raw = ns?.[MATH_CUSTOM_DATA_KEY] as Partial<MathCustomData> | undefined;
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const spec = normalizeMathSpec(raw.spec);
  if (!spec) {
    return null;
  }
  return {
    spec,
    alt: typeof raw.alt === "string" ? raw.alt : describeMath(spec),
    rendered:
      raw.rendered &&
      typeof raw.rendered === "object" &&
      typeof raw.rendered.width === "number" &&
      typeof raw.rendered.height === "number"
        ? raw.rendered
        : { width: 0, height: 0 },
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : 0,
  };
};

/** The spec stored on an element, or `null` if it is not one of our equations. */
export const getMathSpec = (
  element: ExcalidrawElement | null | undefined,
): MathSpec | null => getMathCustomData(element)?.spec ?? null;

/** Narrowing guard: is this element an equation we inserted? */
export const isMathElement = (
  element: ExcalidrawElement | null | undefined,
): element is ExcalidrawImageElement =>
  !!element &&
  element.type === "image" &&
  !element.isDeleted &&
  getMathCustomData(element) !== null;

/** The stored text alternative for an equation element, if it has one. */
export const getMathAltText = (
  element: ExcalidrawElement | null | undefined,
): string | null => getMathCustomData(element)?.alt ?? null;

/* -------------------------------------------------------------------------- */
/* inserting                                                                  */
/* -------------------------------------------------------------------------- */

export interface InsertMathOptions {
  /** Scene coordinates of the top-left corner. Default: viewport centre. */
  x?: number;
  y?: number;
  /** Select the new element after inserting. Default `true`. */
  select?: boolean;
  /** Parent to a page frame that contains it, when one does. Default `true`. */
  attachToFrame?: boolean;
}

export interface InsertMathResult {
  element: NonDeleted<ExcalidrawImageElement>;
  raster: MathRaster;
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

/** Typesets `spec` and inserts it into the live scene as an `image`. */
export const insertMathIntoScene = async (
  excalidrawAPI: ExcalidrawImperativeAPI,
  spec: MathSpec,
  options: InsertMathOptions = {},
): Promise<InsertMathResult> => {
  const { select = true, attachToFrame = true } = options;
  const raster = await renderMathToFile(spec);

  const elements = excalidrawAPI.getSceneElements();
  const centre = viewportCentre(excalidrawAPI);
  const x = options.x ?? Math.round(centre.x - raster.width / 2);
  const y = options.y ?? Math.round(centre.y - raster.height / 2);
  const box = { x, y, width: raster.width, height: raster.height };
  const frame = attachToFrame ? frameContaining(elements, box) : null;

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
    customData: mergeMathCustomData(undefined, {
      spec,
      alt: raster.alt,
      rendered: { width: raster.width, height: raster.height },
      updatedAt: Date.now(),
    }),
  }) as NonDeleted<ExcalidrawImageElement>;

  // files FIRST — see the module note
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

export interface UpdateMathOptions {
  /**
   * Keep the box the element currently occupies instead of resizing to the
   * new typeset size. Default `false`: an equation that gained a fraction
   * is taller, and squashing it into the old box would distort the glyphs —
   * unlike a graph, which re-lays-out to fit.
   */
  keepCurrentSize?: boolean;
}

/**
 * Re-typesets an existing equation element and swaps it in place as a
 * single undo step. The element keeps its id, position, frame, z-order,
 * angle and lock state.
 *
 * The new box is scaled about the element's **top-left**, which is where
 * the student's eye and the surrounding ink already are.
 */
export const updateMathElement = async (
  excalidrawAPI: ExcalidrawImperativeAPI,
  element: ExcalidrawImageElement,
  nextSpec: MathSpec,
  options: UpdateMathOptions = {},
): Promise<InsertMathResult> => {
  const raster = await renderMathToFile(nextSpec);
  const stored = getMathCustomData(element);

  // Honour any resize the student has already done: if the element is at
  // 1.5× the size it was typeset at, the new one should be too.
  const previous = stored?.rendered;
  const scale =
    previous && previous.width > 0 && element.width > 0
      ? element.width / previous.width
      : 1;
  const width = options.keepCurrentSize
    ? element.width
    : Math.round(raster.width * scale);
  const height = options.keepCurrentSize
    ? element.height
    : Math.round(raster.height * scale);

  const next = newElementWith(element, {
    fileId: raster.fileId,
    status: "saved",
    width,
    height,
    // a new picture invalidates any crop taken against the old one
    crop: null,
    customData: mergeMathCustomData(element, {
      spec: nextSpec,
      alt: raster.alt,
      rendered: { width: raster.width, height: raster.height },
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

export interface MathEditHandle {
  element: ExcalidrawImageElement;
  spec: MathSpec;
  alt: string;
  update: (
    nextSpec: MathSpec,
    options?: UpdateMathOptions,
  ) => Promise<InsertMathResult>;
}

/**
 * The re-edit entry point. Returns `null` for anything that is not one of
 * our equations, so a menu can decide whether to offer the item at all.
 */
export const editMath = (
  excalidrawAPI: ExcalidrawImperativeAPI,
  element: ExcalidrawElement | null | undefined,
): MathEditHandle | null => {
  if (!isMathElement(element)) {
    return null;
  }
  const stored = getMathCustomData(element);
  if (!stored) {
    return null;
  }
  return {
    element,
    spec: stored.spec,
    alt: stored.alt,
    update: (nextSpec, options) =>
      updateMathElement(excalidrawAPI, element, nextSpec, options),
  };
};

/** The single equation in the current selection, if there is exactly one. */
export const getSelectedMathElement = (
  excalidrawAPI: ExcalidrawImperativeAPI,
): ExcalidrawImageElement | null => {
  const selectedIds = excalidrawAPI.getAppState().selectedElementIds ?? {};
  const selected = excalidrawAPI
    .getSceneElements()
    .filter((element) => selectedIds[element.id]);
  if (selected.length !== 1) {
    return null;
  }
  return isMathElement(selected[0]) ? selected[0] : null;
};
