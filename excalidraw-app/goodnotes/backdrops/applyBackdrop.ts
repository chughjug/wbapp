/**
 * Applying / removing backdrops on a real Excalidraw image element.
 *
 * ## Strategy: raster compositing (option "a")
 *
 * The backdrop is **baked into a new PNG** (backdrop panel + the original
 * pixels drawn 1:1 on top) and the image element is re-pointed at that new
 * file. The alternative — sibling rectangle elements behind the image —
 * cannot express gradients, drop shadows or a polaroid frame at all
 * (Excalidraw elements have no shadow and no gradient fill), and needs
 * continuous move/resize syncing. Baking gets full visual fidelity, survives
 * export and reload with zero extra machinery, and is what the editor itself
 * already understands.
 *
 * **Trade-off accepted:** the operation is destructive at the raster level, so
 * reversibility has to be engineered explicitly (see below), and the backdrop
 * is resolution-baked — zooming far past 100% shows the backdrop at the
 * image's own resolution rather than re-rendering crisply.
 *
 * ## Reversibility
 *
 * `element.customData.goodnotes.backdrop` records the preset, its parameters,
 * the original `fileId`/mime type and the exact rectangle (in baked-raster
 * pixels) where the untouched original pixels were drawn. Reset therefore has
 * two routes:
 *
 *  1. the original file is still in the scene's `BinaryFiles` → re-point the
 *     element at it (perfect, keeps SVG/GIF originals intact);
 *  2. it is not (Excalidraw prunes files that no element references — see
 *     `filterOutDeletedFiles` in `packages/excalidraw/data/json.ts` and
 *     `LocalFileManager.clearObsoleteFiles`) → **crop the baked PNG back** to
 *     the recorded rectangle. Because the original is drawn unscaled into a
 *     lossless PNG, the crop is pixel-identical to the original raster.
 *
 * Route 2 is why reset still works after a save/reload round-trip.
 */

import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { newElementWith } from "@excalidraw/element";

import {
  computeBackdropGeometry,
  getPresetParams,
  isNoopBackdrop,
  normalizeBackdropParams,
  renderBackdrop,
} from "./backdrops";

import type {
  BackdropParams,
  BackdropPresetId,
  BackdropTheme,
} from "./backdrops";
import type {
  ExcalidrawElement,
  ExcalidrawImageElement,
  FileId,
} from "@excalidraw/element/types";
import type {
  BinaryFileData,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";

/** Namespace shared by every GoodNotes feature on `element.customData`. */
export const GOODNOTES_CUSTOM_DATA_NAMESPACE = "goodnotes";
/** Our key inside that namespace: `customData.goodnotes.backdrop`. */
export const BACKDROP_CUSTOM_DATA_KEY = "backdrop";

export const BACKDROP_STATE_VERSION = 1;

/** Hard cap on the baked raster's longest side (memory / localStorage guard). */
export const MAX_BAKED_RASTER_SIZE = 4096;

/** What we persist on the image element to keep the bake reversible. */
export interface BackdropState {
  version: number;
  presetId: BackdropPresetId;
  params: BackdropParams;
  /** Theme the preset defaults were taken from, for UI round-tripping. */
  theme: BackdropTheme;
  original: {
    fileId: string;
    mimeType: string;
    /** Natural size of the original raster, px. */
    width: number;
    height: number;
  };
  /** Baked raster size, px. */
  raster: { width: number; height: number };
  /** Where the original pixels sit inside the baked raster, px. */
  inner: { x: number; y: number; width: number; height: number };
}

type CustomDataRecord = Record<string, unknown>;

/** Reads our state without assuming any other key exists. */
export const getBackdropState = (
  element: ExcalidrawElement | null | undefined,
): BackdropState | null => {
  const ns = (element?.customData as CustomDataRecord | undefined)?.[
    GOODNOTES_CUSTOM_DATA_NAMESPACE
  ] as CustomDataRecord | undefined;
  const state = ns?.[BACKDROP_CUSTOM_DATA_KEY] as BackdropState | undefined;
  return state && typeof state === "object" && state.original
    ? state
    : null;
};

export const hasBackdrop = (
  element: ExcalidrawElement | null | undefined,
): boolean => getBackdropState(element) !== null;

/**
 * Merges `backdrop` into `customData.goodnotes` **without clobbering** other
 * GoodNotes keys (the pages module keeps `customData.goodnotes.page`, the pens
 * module its own marker). Passing `null` removes only our key.
 */
const mergeCustomData = (
  element: ExcalidrawElement,
  state: BackdropState | null,
): CustomDataRecord | undefined => {
  const existing = (element.customData as CustomDataRecord | undefined) ?? {};
  const existingNs =
    (existing[GOODNOTES_CUSTOM_DATA_NAMESPACE] as CustomDataRecord | undefined) ??
    {};
  const nextNs: CustomDataRecord = { ...existingNs };
  if (state) {
    nextNs[BACKDROP_CUSTOM_DATA_KEY] = state;
  } else {
    delete nextNs[BACKDROP_CUSTOM_DATA_KEY];
  }
  const next: CustomDataRecord = { ...existing };
  if (Object.keys(nextNs).length > 0) {
    next[GOODNOTES_CUSTOM_DATA_NAMESPACE] = nextNs;
  } else {
    delete next[GOODNOTES_CUSTOM_DATA_NAMESPACE];
  }
  return Object.keys(next).length > 0 ? next : undefined;
};

export const isBackdropTarget = (
  element: ExcalidrawElement | null | undefined,
): element is ExcalidrawImageElement =>
  !!element && element.type === "image" && !element.isDeleted;

/* -------------------------------------------------------------------------- */
/* raster helpers                                                             */
/* -------------------------------------------------------------------------- */

export const loadImageFromDataURL = (
  dataURL: string,
): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not decode image data"));
    image.crossOrigin = "anonymous";
    image.src = dataURL;
  });

const bytesToHex = (bytes: Uint8Array) =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const dataURLToBytes = (dataURL: string): Uint8Array => {
  const base64 = dataURL.slice(dataURL.indexOf(",") + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

/**
 * Content-addressed id, matching the editor's own `generateIdFromFile`
 * (SHA-1 hex of the file bytes), so identical bakes dedupe.
 */
export const fileIdFromDataURL = async (dataURL: string): Promise<FileId> => {
  const bytes = dataURLToBytes(dataURL);
  try {
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    const digest = await window.crypto.subtle.digest("SHA-1", buffer);
    return bytesToHex(new Uint8Array(digest)) as FileId;
  } catch {
    return `${Date.now().toString(16)}${Math.random()
      .toString(16)
      .slice(2)}`.padEnd(40, "0").slice(0, 40) as FileId;
  }
};

/** A `BinaryFileData` shaped exactly like the ones the editor inserts. */
export const makeBinaryFileData = async (
  dataURL: string,
  mimeType = "image/png",
): Promise<BinaryFileData> => {
  const id = await fileIdFromDataURL(dataURL);
  const now = Date.now();
  return {
    id,
    mimeType: mimeType as BinaryFileData["mimeType"],
    dataURL: dataURL as BinaryFileData["dataURL"],
    created: now,
    lastRetrieved: now,
  };
};

const createCanvas = (width: number, height: number) => {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not get a 2D canvas context");
  }
  return { canvas, ctx };
};

/* -------------------------------------------------------------------------- */
/* geometry                                                                   */
/* -------------------------------------------------------------------------- */

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Re-places an image element so that `localRect` (scene units, relative to the
 * element's *unrotated* top-left) becomes the new element box, keeping the
 * visual position stable even when the element is rotated.
 */
const placeRect = (element: ExcalidrawImageElement, localRect: Rect) => {
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  const targetCx = element.x + localRect.x + localRect.width / 2;
  const targetCy = element.y + localRect.y + localRect.height / 2;
  const dx = targetCx - cx;
  const dy = targetCy - cy;
  const cos = Math.cos(element.angle);
  const sin = Math.sin(element.angle);
  const rx = dx * cos - dy * sin;
  const ry = dx * sin + dy * cos;
  return {
    x: cx + rx - localRect.width / 2,
    y: cy + ry - localRect.height / 2,
    width: localRect.width,
    height: localRect.height,
  };
};

/* -------------------------------------------------------------------------- */
/* recovering the original                                                     */
/* -------------------------------------------------------------------------- */

export interface ResolvedOriginal {
  fileId: FileId;
  mimeType: string;
  dataURL: string;
  image: HTMLImageElement;
  /** Element box that shows exactly the original pixels. */
  box: Rect;
  /** New file that had to be created (crop recovery); must be registered. */
  createdFile: BinaryFileData | null;
}

/**
 * Returns the element's *original* (backdrop-free) raster and the element box
 * that would display it, undoing an existing bake if there is one.
 */
export const resolveOriginal = async (
  api: ExcalidrawImperativeAPI,
  element: ExcalidrawImageElement,
): Promise<ResolvedOriginal> => {
  const files = api.getFiles();
  const state = getBackdropState(element);

  if (!state) {
    const file = element.fileId ? files[element.fileId] : undefined;
    if (!file?.dataURL) {
      throw new Error("The image's file data is not loaded yet.");
    }
    const image = await loadImageFromDataURL(file.dataURL);
    return {
      fileId: element.fileId as FileId,
      mimeType: file.mimeType,
      dataURL: file.dataURL,
      image,
      box: {
        x: 0,
        y: 0,
        width: element.width,
        height: element.height,
      },
      createdFile: null,
    };
  }

  const sx = element.width / state.raster.width;
  const sy = element.height / state.raster.height;
  const box: Rect = {
    x: state.inner.x * sx,
    y: state.inner.y * sy,
    width: state.inner.width * sx,
    height: state.inner.height * sy,
  };

  // route 1: the original file is still around
  const originalFile = files[state.original.fileId as FileId];
  if (originalFile?.dataURL) {
    return {
      fileId: state.original.fileId as FileId,
      mimeType: originalFile.mimeType,
      dataURL: originalFile.dataURL,
      image: await loadImageFromDataURL(originalFile.dataURL),
      box,
      createdFile: null,
    };
  }

  // route 2: crop the baked raster back to the recorded inner rectangle
  const bakedFile = element.fileId ? files[element.fileId] : undefined;
  if (!bakedFile?.dataURL) {
    throw new Error("The image's file data is not loaded yet.");
  }
  const baked = await loadImageFromDataURL(bakedFile.dataURL);
  const { canvas, ctx } = createCanvas(state.inner.width, state.inner.height);
  ctx.drawImage(
    baked,
    state.inner.x,
    state.inner.y,
    state.inner.width,
    state.inner.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  const dataURL = canvas.toDataURL("image/png");
  const createdFile = await makeBinaryFileData(dataURL, "image/png");
  return {
    fileId: createdFile.id,
    mimeType: createdFile.mimeType,
    dataURL,
    image: await loadImageFromDataURL(dataURL),
    box,
    createdFile,
  };
};

/* -------------------------------------------------------------------------- */
/* public operations                                                           */
/* -------------------------------------------------------------------------- */

const findImageElement = (
  api: ExcalidrawImperativeAPI,
  elementId: string,
): ExcalidrawImageElement => {
  const element = api
    .getSceneElements()
    .find((el) => el.id === elementId && isBackdropTarget(el));
  if (!element) {
    throw new Error(`No image element with id "${elementId}" in the scene.`);
  }
  return element as ExcalidrawImageElement;
};

const commit = (
  api: ExcalidrawImperativeAPI,
  elementId: string,
  mutate: (element: ExcalidrawImageElement) => Partial<ExcalidrawImageElement>,
) => {
  const next = api.getSceneElements().map((el) =>
    el.id === elementId && isBackdropTarget(el)
      ? newElementWith(el, mutate(el as ExcalidrawImageElement) as never)
      : el,
  );
  api.updateScene({
    elements: next,
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
};

export interface ApplyBackdropOptions {
  excalidrawAPI: ExcalidrawImperativeAPI;
  /** Id of the image element to decorate. */
  elementId: string;
  presetId: BackdropPresetId;
  /** Overrides on top of the preset's theme defaults. */
  params?: Partial<BackdropParams>;
  theme?: BackdropTheme;
}

export interface ApplyBackdropResult {
  /** `null` when the backdrop was a no-op and the original was restored. */
  fileId: FileId | null;
  raster: { width: number; height: number } | null;
}

/**
 * Bakes `presetId` + `params` onto the image element.
 *
 * Idempotent and non-compounding: any existing backdrop is undone first, so
 * switching presets never stacks mattes.
 */
export const applyBackdrop = async ({
  excalidrawAPI: api,
  elementId,
  presetId,
  params: overrides,
  theme = "light",
}: ApplyBackdropOptions): Promise<ApplyBackdropResult> => {
  const element = findImageElement(api, elementId);
  const params = normalizeBackdropParams({
    ...getPresetParams(presetId, theme),
    ...overrides,
  });

  const original = await resolveOriginal(api, element);

  if (presetId === "none" || isNoopBackdrop(params)) {
    await removeBackdrop({ excalidrawAPI: api, elementId });
    return { fileId: null, raster: null };
  }

  const naturalWidth = original.image.naturalWidth || original.image.width;
  const naturalHeight = original.image.naturalHeight || original.image.height;
  if (!naturalWidth || !naturalHeight) {
    throw new Error("The source image has no intrinsic size.");
  }

  const geometry = computeBackdropGeometry(naturalWidth, naturalHeight, params);
  const scale = Math.min(
    1,
    MAX_BAKED_RASTER_SIZE / Math.max(geometry.canvasWidth, geometry.canvasHeight),
  );

  const { canvas, ctx } = createCanvas(
    geometry.canvasWidth * scale,
    geometry.canvasHeight * scale,
  );
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  renderBackdrop(ctx, {
    image: original.image,
    imageWidth: naturalWidth,
    imageHeight: naturalHeight,
    params,
    geometry,
  });
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  const dataURL = canvas.toDataURL("image/png");
  const file = await makeBinaryFileData(dataURL, "image/png");

  // register BOTH the new raster and (when it had to be re-created) the
  // recovered original, before any element points at them
  const toAdd: BinaryFileData[] = [file];
  if (original.createdFile) {
    toAdd.push(original.createdFile);
  }
  api.addFiles(toAdd);

  const state: BackdropState = {
    version: BACKDROP_STATE_VERSION,
    presetId,
    params,
    theme,
    original: {
      fileId: original.fileId,
      mimeType: original.mimeType,
      width: naturalWidth,
      height: naturalHeight,
    },
    raster: { width: canvas.width, height: canvas.height },
    inner: {
      x: Math.round(geometry.imageX * scale),
      y: Math.round(geometry.imageY * scale),
      width: Math.round(geometry.imageWidth * scale),
      height: Math.round(geometry.imageHeight * scale),
    },
  };

  commit(api, elementId, (el) => {
    // scene units per natural pixel of the ORIGINAL raster
    const sx = original.box.width / naturalWidth;
    const sy = original.box.height / naturalHeight;
    const box = placeRect(el, {
      x: original.box.x - geometry.imageX * sx,
      y: original.box.y - geometry.imageY * sy,
      width: geometry.canvasWidth * sx,
      height: geometry.canvasHeight * sy,
    });
    return {
      ...box,
      fileId: file.id,
      status: "saved",
      customData: mergeCustomData(el, state),
    };
  });

  return { fileId: file.id, raster: state.raster };
};

export interface RemoveBackdropOptions {
  excalidrawAPI: ExcalidrawImperativeAPI;
  elementId: string;
}

/** Reset-to-original: undoes the bake and drops our `customData` key. */
export const removeBackdrop = async ({
  excalidrawAPI: api,
  elementId,
}: RemoveBackdropOptions): Promise<void> => {
  const element = findImageElement(api, elementId);
  if (!getBackdropState(element)) {
    return;
  }
  const original = await resolveOriginal(api, element);
  if (original.createdFile) {
    api.addFiles([original.createdFile]);
  }
  commit(api, elementId, (el) => ({
    ...placeRect(el, original.box),
    fileId: original.fileId,
    status: "saved",
    customData: mergeCustomData(el, null),
  }));
};
