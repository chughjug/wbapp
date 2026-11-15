/**
 * Fuzzy select — duplicate into the scene.
 *
 * Inserts the rasterized selection back into the Excalidraw scene as a new
 * `image` element, offset from the original so it is visibly a copy.
 *
 * ## Getting `BinaryFiles` right
 *
 * An image element only stores a `fileId`; the pixels live in the editor's
 * separate `BinaryFiles` map and are persisted by
 * `excalidraw-app/data/FileManager.ts` (which keys everything off
 * `BinaryFileData.id`, compresses `dataURL`, and carries `mimeType`,
 * `created` and `lastRetrieved` through to storage). An element whose
 * `fileId` has no matching `BinaryFileData` renders as a broken placeholder
 * and *vanishes on reload*, because nothing was ever saved for it. So:
 *
 *  - the file id is the SHA-1 of the PNG bytes, produced by the editor's own
 *    `generateIdFromFile` — the same hashing the editor uses when you drop an
 *    image in, which also means duplicating the identical selection twice
 *    reuses one file instead of storing it twice
 *  - `created`/`lastRetrieved` are set, as `FileManager.saveFiles` expects
 *  - the element's `status` is `"saved"`, because the bytes are present in
 *    the scene's files map from the moment it is inserted
 *  - `addFiles()` is called *after* `updateScene()`, so that the editor's
 *    `addNewImagesToImageCache()` pass (which walks the current scene) sees
 *    the new element and decodes its bitmap straight away
 */

import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { newImageElement } from "@excalidraw/element";
import { generateIdFromFile } from "@excalidraw/excalidraw/data/blob";

import type {
  ExcalidrawImageElement,
  FileId,
  NonDeleted,
} from "@excalidraw/element/types";
import type {
  BinaryFileData,
  DataURL,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";

import type { RasterizedSelection } from "./rasterize";

/** Default scene-space offset of the duplicate from the original. */
export const DEFAULT_DUPLICATE_OFFSET = { x: 24, y: 24 };

export interface DuplicateSelectionOptions {
  excalidrawAPI: ExcalidrawImperativeAPI;
  raster: RasterizedSelection;
  /**
   * Scene-space offset applied to the duplicate. Defaults to
   * {@link DEFAULT_DUPLICATE_OFFSET}.
   */
  offset?: { x: number; y: number };
  /**
   * Place the duplicate at this scene position (top-left) instead of
   * `raster.sceneRect` + `offset`.
   */
  position?: { x: number; y: number } | null;
  /** Select the new element after inserting it. @default true */
  select?: boolean;
  /** File name recorded on the generated `File`. @default "selection.png" */
  fileName?: string;
}

export interface DuplicateSelectionResult {
  element: NonDeleted<ExcalidrawImageElement>;
  file: BinaryFileData;
}

export class FuzzySelectDuplicateError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "FuzzySelectDuplicateError";
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

/**
 * Builds a valid {@link BinaryFileData} for a PNG blob, with a content-hashed
 * id. Exported separately so callers (and tests) can register the file
 * without inserting an element.
 */
export const createBinaryFileDataFromPng = async (
  blob: Blob,
  dataURL: string,
  fileName = "selection.png",
): Promise<BinaryFileData> => {
  const file = new File([blob], fileName, { type: "image/png" });
  const id = await generateIdFromFile(file);
  const now = Date.now();

  return {
    id: id as FileId,
    mimeType: "image/png",
    dataURL: dataURL as DataURL,
    created: now,
    lastRetrieved: now,
  };
};

/**
 * Inserts the rasterized selection into the scene as a new image element.
 *
 * @throws {FuzzySelectDuplicateError} when the editor API is gone.
 */
export const duplicateRasterIntoScene = async ({
  excalidrawAPI,
  raster,
  offset = DEFAULT_DUPLICATE_OFFSET,
  position = null,
  select = true,
  fileName = "selection.png",
}: DuplicateSelectionOptions): Promise<DuplicateSelectionResult> => {
  if (!excalidrawAPI || excalidrawAPI.isDestroyed) {
    throw new FuzzySelectDuplicateError(
      "The editor is no longer available, so the selection couldn't be duplicated.",
    );
  }

  const file = await createBinaryFileDataFromPng(
    raster.blob,
    raster.dataURL,
    fileName,
  );

  const { sceneRect } = raster;

  const element = newImageElement({
    type: "image",
    fileId: file.id,
    // the bytes are in the scene's files map as of this insert
    status: "saved",
    x: position ? position.x : sceneRect.x + offset.x,
    y: position ? position.y : sceneRect.y + offset.y,
    // natural scene size, independent of the raster's pixel scale
    width: sceneRect.width,
    height: sceneRect.height,
    scale: [1, 1],
    // a raster carries its own colours; no stroke/fill of its own
    strokeColor: "transparent",
    backgroundColor: "transparent",
    // keep it a free-floating element: the student moves it where they want
    frameId: null,
    locked: false,
  });

  try {
    excalidrawAPI.updateScene({
      elements: [...excalidrawAPI.getSceneElements(), element],
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });

    // AFTER updateScene: addFiles() kicks off the editor's image-cache pass,
    // which only looks at elements already in the scene
    excalidrawAPI.addFiles([file]);

    if (select) {
      excalidrawAPI.selection.select(element.id);
    }
  } catch (error) {
    throw new FuzzySelectDuplicateError(
      `The duplicate couldn't be added to the page: ${
        error instanceof Error ? error.message : String(error)
      }`,
      error,
    );
  }

  return { element, file };
};
