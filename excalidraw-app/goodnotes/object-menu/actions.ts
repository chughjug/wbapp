/**
 * GoodNotes object menu — the actions the bar can actually perform.
 *
 * Every function here drives `ExcalidrawImperativeAPI` directly; nothing
 * reaches into the editor's private action manager (which is not exposed to
 * hosts). Two rules make these mutations behave like the editor's own:
 *
 *  1. **`newElementWith`** is used for every element change. It bumps
 *     `version`, `versionNonce` and `updated` — the bookkeeping the scene
 *     diff, collaboration sync and local persistence key off. A hand-rolled
 *     `{ ...element, strokeColor }` spread renders once and is then silently
 *     dropped by the next reconciliation, which is the classic way for these
 *     edits to "work" in the canvas and never survive a reload.
 *  2. **`captureUpdate: CaptureUpdateAction.IMMEDIATELY`** on every
 *     `updateScene`, so each menu action is a single Ctrl+Z step.
 *
 * Reused from siblings (not re-implemented): the duplicate/clipboard
 * machinery of `goodnotes/fuzzy-select` is raster-based (it copies a lasso
 * region as a PNG), so element duplication here goes through the editor's
 * own `duplicateElements`, which is what `actionDuplicateSelection` uses.
 * `goodnotes/backdrops` supplies the `BinaryFileData` helpers used by
 * "Replace".
 */

import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import {
  arrayToMap,
  DEFAULT_ELEMENT_BACKGROUND_PICKS,
  DEFAULT_ELEMENT_STROKE_PICKS,
  DEFAULT_GRID_SIZE,
  FONT_SIZES,
  FREEDRAW_STROKE_WIDTH,
  getFontString,
  randomId,
  STROKE_WIDTH,
} from "@excalidraw/common";
import {
  convertToShape,
  duplicateElements,
  getBoundTextElementId,
  getCommonBounds,
  getSelectedElements,
  isTextElement,
  measureText,
  newElementWith,
  recognizeShape,
  syncMovedIndices,
} from "@excalidraw/element";
import { pointFrom } from "@excalidraw/math";

import {
  BACKDROP_CUSTOM_DATA_KEY,
  GOODNOTES_CUSTOM_DATA_NAMESPACE,
  fileIdFromDataURL,
  loadImageFromDataURL,
  makeBinaryFileData,
} from "../backdrops";

import type { GlobalPoint } from "@excalidraw/math";
import type {
  ExcalidrawElement,
  ExcalidrawFreeDrawElement,
  ExcalidrawImageElement,
  ExcalidrawTextElement,
  FileId,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

/* -------------------------------------------------------------------------- */
/* option sets shown in the bar                                                */
/* -------------------------------------------------------------------------- */

/**
 * Ink widths, in the freedraw scale (half the generic one — see
 * `FREEDRAW_STROKE_WIDTH` in `@excalidraw/common`), so "Medium" here is the
 * same stroke the pen toolbar calls medium.
 */
export const INK_WIDTHS: readonly { label: string; value: number }[] = [
  { label: "Thin", value: FREEDRAW_STROKE_WIDTH.thin },
  { label: "Medium", value: FREEDRAW_STROKE_WIDTH.medium },
  { label: "Bold", value: FREEDRAW_STROKE_WIDTH.bold },
];

/** Outline widths for shapes and text, in the generic scale. */
export const SHAPE_STROKE_WIDTHS: readonly { label: string; value: number }[] =
  [
    { label: "Thin", value: STROKE_WIDTH.thin },
    { label: "Medium", value: STROKE_WIDTH.medium },
    { label: "Bold", value: STROKE_WIDTH.bold },
  ];

/** The editor's four named text sizes. */
export const FONT_SIZE_OPTIONS: readonly {
  label: string;
  title: string;
  value: number;
}[] = [
  { label: "S", title: "Small", value: FONT_SIZES.sm },
  { label: "M", title: "Medium", value: FONT_SIZES.md },
  { label: "L", title: "Large", value: FONT_SIZES.lg },
  { label: "XL", title: "Extra large", value: FONT_SIZES.xl },
];

/** The editor's own quick-pick stroke colours, plus their names for a11y. */
export const STROKE_COLOR_PICKS: readonly { label: string; value: string }[] = [
  { label: "Black", value: DEFAULT_ELEMENT_STROKE_PICKS[0] },
  { label: "Red", value: DEFAULT_ELEMENT_STROKE_PICKS[1] },
  { label: "Green", value: DEFAULT_ELEMENT_STROKE_PICKS[2] },
  { label: "Blue", value: DEFAULT_ELEMENT_STROKE_PICKS[3] },
  { label: "Yellow", value: DEFAULT_ELEMENT_STROKE_PICKS[4] },
];

/** The editor's own quick-pick fills (the first one is "no fill"). */
export const FILL_COLOR_PICKS: readonly { label: string; value: string }[] = [
  { label: "No fill", value: DEFAULT_ELEMENT_BACKGROUND_PICKS[0] },
  { label: "Red", value: DEFAULT_ELEMENT_BACKGROUND_PICKS[1] },
  { label: "Green", value: DEFAULT_ELEMENT_BACKGROUND_PICKS[2] },
  { label: "Blue", value: DEFAULT_ELEMENT_BACKGROUND_PICKS[3] },
  { label: "Yellow", value: DEFAULT_ELEMENT_BACKGROUND_PICKS[4] },
];

/* -------------------------------------------------------------------------- */
/* shared helpers                                                              */
/* -------------------------------------------------------------------------- */

const commit = (
  excalidrawAPI: ExcalidrawImperativeAPI,
  elements: readonly ExcalidrawElement[],
) => {
  excalidrawAPI.updateScene({
    elements,
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
};

/**
 * Applies `update` to every element whose id is in `ids`, leaving the rest
 * of the array untouched (and identical by reference).
 */
const mapSelected = <T extends ExcalidrawElement>(
  elements: readonly ExcalidrawElement[],
  ids: ReadonlySet<string>,
  update: (element: T) => Partial<T> | null,
): readonly ExcalidrawElement[] =>
  elements.map((element) => {
    if (!ids.has(element.id)) {
      return element;
    }
    const changes = update(element as T);
    return changes ? newElementWith(element as T, changes) : element;
  });

const selectedIdSet = (
  excalidrawAPI: ExcalidrawImperativeAPI,
): Set<string> => {
  const appState = excalidrawAPI.getAppState();
  return new Set(
    getSelectedElements(excalidrawAPI.getSceneElements(), appState, {
      includeBoundTextElement: false,
    }).map((element) => element.id),
  );
};

/* -------------------------------------------------------------------------- */
/* duplicate / delete / group                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Duplicates the current selection, offset by half a grid step, and selects
 * the copies — the behaviour of the editor's own Ctrl+D, via the same
 * `duplicateElements("in-place")` helper (groups, bound labels and frame
 * children are carried along, seeds randomized, z-order preserved).
 *
 * @returns the ids of the new elements, or `[]` if nothing was selected.
 */
export const duplicateSelection = (
  excalidrawAPI: ExcalidrawImperativeAPI,
): string[] => {
  const elements = excalidrawAPI.getSceneElementsIncludingDeleted();
  const appState = excalidrawAPI.getAppState();
  const selected = getSelectedElements(
    excalidrawAPI.getSceneElements(),
    appState,
    { includeBoundTextElement: true, includeElementsInFrames: true },
  );

  if (!selected.length) {
    return [];
  }

  const { duplicatedElements, elementsWithDuplicates } = duplicateElements({
    type: "in-place",
    elements,
    idsOfElementsToDuplicate: arrayToMap(selected),
    appState: {
      editingGroupId: appState.editingGroupId,
      selectedGroupIds: appState.selectedGroupIds,
    },
    randomizeSeed: true,
    overrides: ({ origElement, origIdToDuplicateId }) => ({
      x: origElement.x + DEFAULT_GRID_SIZE / 2,
      y: origElement.y + DEFAULT_GRID_SIZE / 2,
      frameId:
        (origElement.frameId && origIdToDuplicateId.get(origElement.frameId)) ??
        origElement.frameId,
    }),
  });

  commit(
    excalidrawAPI,
    syncMovedIndices(elementsWithDuplicates, arrayToMap(duplicatedElements)),
  );

  const ids = duplicatedElements.map((element) => element.id);
  excalidrawAPI.selection.select(ids);
  return ids;
};

/**
 * Soft-deletes the selection (`isDeleted: true`, as the editor does — a hard
 * removal would break undo and collaboration reconciliation) together with
 * any bound text labels, and clears the selection.
 *
 * Not handled: deleting a frame does not delete its children (they are
 * orphaned into the canvas, which is also what dragging them out does).
 *
 * @returns the number of elements marked deleted.
 */
export const deleteSelection = (
  excalidrawAPI: ExcalidrawImperativeAPI,
): number => {
  const appState = excalidrawAPI.getAppState();
  const selected = getSelectedElements(
    excalidrawAPI.getSceneElements(),
    appState,
    { includeBoundTextElement: true, includeElementsInFrames: true },
  );

  if (!selected.length) {
    return 0;
  }

  const ids = new Set(selected.map((element) => element.id));
  for (const element of selected) {
    const boundTextId = getBoundTextElementId(element);
    if (boundTextId) {
      ids.add(boundTextId);
    }
  }

  const next = excalidrawAPI
    .getSceneElementsIncludingDeleted()
    .map((element) =>
      ids.has(element.id) && !element.isDeleted
        ? newElementWith(element, { isDeleted: true })
        : element,
    );

  commit(excalidrawAPI, next);
  excalidrawAPI.selection.clear();
  return ids.size;
};

/**
 * Whether ≥ 2 elements are selected and they are not already exactly one
 * group — the editor's own enablement rule for Ctrl+G.
 */
export const canGroupSelection = (
  elements: readonly NonDeletedExcalidrawElement[],
): boolean => {
  if (elements.length < 2) {
    return false;
  }
  const shared = elements[0].groupIds;
  return !shared.some((groupId) =>
    elements.every((element) => element.groupIds.includes(groupId)),
  );
};

/**
 * Puts the selection into a new group (mirrors `actionGroup`: a fresh
 * `groupId` appended to each element's `groupIds`, then the group selected).
 *
 * @returns the new group id, or `null` when grouping was not applicable.
 */
export const groupSelection = (
  excalidrawAPI: ExcalidrawImperativeAPI,
): string | null => {
  const appState = excalidrawAPI.getAppState();
  const selected = getSelectedElements(
    excalidrawAPI.getSceneElements(),
    appState,
    { includeBoundTextElement: true },
  );

  if (!canGroupSelection(selected)) {
    return null;
  }

  const groupId = randomId();
  const ids = new Set(selected.map((element) => element.id));

  const next = excalidrawAPI
    .getSceneElementsIncludingDeleted()
    .map((element) =>
      ids.has(element.id)
        ? newElementWith(element, {
            groupIds: [...element.groupIds, groupId],
          })
        : element,
    );

  commit(excalidrawAPI, next);
  excalidrawAPI.selection.select(Array.from(ids));
  return groupId;
};

/* -------------------------------------------------------------------------- */
/* style                                                                       */
/* -------------------------------------------------------------------------- */

/** Stroke (ink / text / outline) colour of every selected element. */
export const setStrokeColor = (
  excalidrawAPI: ExcalidrawImperativeAPI,
  color: string,
): void => {
  const ids = selectedIdSet(excalidrawAPI);
  commit(
    excalidrawAPI,
    mapSelected(excalidrawAPI.getSceneElementsIncludingDeleted(), ids, () => ({
      strokeColor: color,
    })),
  );
  excalidrawAPI.updateScene({
    appState: { currentItemStrokeColor: color },
    captureUpdate: CaptureUpdateAction.EVENTUALLY,
  });
};

/** Fill (background) colour of every selected element. */
export const setBackgroundColor = (
  excalidrawAPI: ExcalidrawImperativeAPI,
  color: string,
): void => {
  const ids = selectedIdSet(excalidrawAPI);
  commit(
    excalidrawAPI,
    mapSelected(excalidrawAPI.getSceneElementsIncludingDeleted(), ids, () => ({
      backgroundColor: color,
    })),
  );
  excalidrawAPI.updateScene({
    appState: { currentItemBackgroundColor: color },
    captureUpdate: CaptureUpdateAction.EVENTUALLY,
  });
};

/**
 * Stroke width of every selected element, in scene units. Freedraw uses a
 * halved scale (see `FREEDRAW_STROKE_WIDTH`), so pass the value from
 * {@link INK_WIDTHS} rather than a raw pixel count.
 */
export const setStrokeWidth = (
  excalidrawAPI: ExcalidrawImperativeAPI,
  strokeWidth: number,
): void => {
  const ids = selectedIdSet(excalidrawAPI);
  commit(
    excalidrawAPI,
    mapSelected(excalidrawAPI.getSceneElementsIncludingDeleted(), ids, () => ({
      strokeWidth,
    })),
  );
};

/**
 * Font size of the selected text elements, re-measuring the text so the
 * element's box matches its new metrics (skipping it leaves the selection
 * outline and hit area at the old size).
 *
 * Only standalone text is changed: a label bound to a container
 * (`containerId !== null`) needs the editor's own container re-layout, which
 * is not reachable through the public API.
 *
 * @returns how many text elements were resized.
 */
export const setFontSize = (
  excalidrawAPI: ExcalidrawImperativeAPI,
  fontSize: number,
): number => {
  const ids = selectedIdSet(excalidrawAPI);
  let changed = 0;

  const next = excalidrawAPI
    .getSceneElementsIncludingDeleted()
    .map((element) => {
      if (
        !ids.has(element.id) ||
        !isTextElement(element) ||
        element.containerId
      ) {
        return element;
      }
      const text = element as ExcalidrawTextElement;
      const metrics = measureText(
        text.text,
        getFontString({ fontSize, fontFamily: text.fontFamily }),
        text.lineHeight,
      );
      changed += 1;
      return newElementWith(text, {
        fontSize,
        width: metrics.width,
        height: metrics.height,
      });
    });

  if (changed) {
    commit(excalidrawAPI, next);
    excalidrawAPI.updateScene({
      appState: { currentItemFontSize: fontSize },
      captureUpdate: CaptureUpdateAction.EVENTUALLY,
    });
  }
  return changed;
};

/* -------------------------------------------------------------------------- */
/* image: crop / replace                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Enters the editor's native crop mode for an image element, exactly as the
 * `cropEditor` action does (`croppingElementId` is a public `AppState`
 * field, so this needs no internals). The crop handles, the Escape/Enter
 * handling and the commit are all the editor's.
 */
export const startCropping = (
  excalidrawAPI: ExcalidrawImperativeAPI,
  elementId: string,
): void => {
  excalidrawAPI.updateScene({
    appState: { croppingElementId: elementId, isCropping: false },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
};

/** Reads a user-picked file as a data URL. */
const readFileAsDataURL = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read the chosen file"));
    reader.readAsDataURL(file);
  });

/**
 * Opens a file picker and swaps the pixels of an image element for the
 * chosen file, keeping its position and width and re-deriving its height
 * from the new aspect ratio.
 *
 * The new bytes are registered as a `BinaryFileData` with a content-hashed
 * (SHA-1) id through `addFiles`, the same shape the editor produces when an
 * image is dropped in, so the replacement survives a reload. Any crop and
 * any baked `goodnotes.backdrop` state are cleared, since both describe the
 * *old* pixels.
 *
 * @returns the new file id, or `null` if the user cancelled.
 */
export const replaceImage = async (
  excalidrawAPI: ExcalidrawImperativeAPI,
  element: ExcalidrawImageElement,
  file?: File,
): Promise<FileId | null> => {
  const chosen = file ?? (await pickImageFile());
  if (!chosen) {
    return null;
  }

  const dataURL = await readFileAsDataURL(chosen);
  const image = await loadImageFromDataURL(dataURL);
  const binary = await makeBinaryFileData(
    dataURL,
    chosen.type || "image/png",
  );
  const fileId = await fileIdFromDataURL(dataURL);

  const ratio =
    image.naturalWidth > 0 ? image.naturalHeight / image.naturalWidth : 1;

  const customData = element.customData
    ? { ...(element.customData as Record<string, unknown>) }
    : undefined;
  if (customData && customData[GOODNOTES_CUSTOM_DATA_NAMESPACE]) {
    const namespace = {
      ...(customData[GOODNOTES_CUSTOM_DATA_NAMESPACE] as Record<
        string,
        unknown
      >),
    };
    delete namespace[BACKDROP_CUSTOM_DATA_KEY];
    customData[GOODNOTES_CUSTOM_DATA_NAMESPACE] = namespace;
  }

  const next = excalidrawAPI
    .getSceneElementsIncludingDeleted()
    .map((candidate) =>
      candidate.id === element.id
        ? newElementWith(candidate as ExcalidrawImageElement, {
            fileId,
            status: "saved",
            crop: null,
            height: element.width * ratio,
            ...(customData ? { customData } : {}),
          })
        : candidate,
    );

  commit(excalidrawAPI, next);
  excalidrawAPI.addFiles([{ ...binary, id: fileId }]);
  return fileId;
};

/** Shows the OS image picker. Resolves `null` when dismissed. */
const pickImageFile = (): Promise<File | null> =>
  new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.style.display = "none";
    let settled = false;
    const finish = (value: File | null) => {
      if (settled) {
        return;
      }
      settled = true;
      input.remove();
      resolve(value);
    };
    input.addEventListener("change", () => finish(input.files?.[0] ?? null));
    // Chrome fires `cancel` on dismissal; elsewhere the promise simply never
    // settles, which is harmless (nothing awaits it but the click handler).
    input.addEventListener("cancel", () => finish(null));
    document.body.appendChild(input);
    input.click();
  });

/* -------------------------------------------------------------------------- */
/* ink: convert to shape                                                       */
/* -------------------------------------------------------------------------- */

const toGlobalPoints = (element: ExcalidrawFreeDrawElement): GlobalPoint[] =>
  element.points.map(([x, y]) =>
    pointFrom<GlobalPoint>(element.x + x, element.y + y),
  );

/**
 * Whether the editor's own shape recognizer finds a rectangle / ellipse /
 * diamond / line / arrow in this stroke. The "Convert to shape" item is
 * shown **only** when this is true — a recognizer that answers "freedraw"
 * would make the button a no-op.
 */
export const canConvertToShape = (
  element: ExcalidrawElement,
  zoom = 1,
): boolean => {
  if (element.type !== "freedraw") {
    return false;
  }
  const stroke = element as ExcalidrawFreeDrawElement;
  if (stroke.points.length < 3) {
    return false;
  }
  try {
    return recognizeShape(toGlobalPoints(stroke), null, zoom).type !==
      "freedraw";
  } catch {
    return false;
  }
};

/**
 * Replaces a freedraw stroke with the shape the editor's recognizer sees in
 * it, in place in the z-order, keeping the stroke's colour, opacity and
 * stroke width. The new element is selected afterwards.
 *
 * @returns the new element's id, or `null` when nothing was recognized.
 */
export const convertInkToShape = (
  excalidrawAPI: ExcalidrawImperativeAPI,
  element: ExcalidrawFreeDrawElement,
): string | null => {
  const appState = excalidrawAPI.getAppState();
  const elements = excalidrawAPI.getSceneElementsIncludingDeleted();
  const elementsMap = arrayToMap(elements);

  const shape = convertToShape(
    toGlobalPoints(element),
    appState,
    elementsMap,
    null,
  );

  if (!shape) {
    return null;
  }

  const styled = newElementWith(shape, {
    strokeColor: element.strokeColor,
    opacity: element.opacity,
    strokeWidth: Math.max(element.strokeWidth * 2, 1),
    groupIds: element.groupIds,
    frameId: element.frameId,
  });

  const next = elements.flatMap((candidate) =>
    candidate.id === element.id
      ? [newElementWith(candidate, { isDeleted: true }), styled]
      : [candidate],
  );

  commit(excalidrawAPI, next);
  excalidrawAPI.selection.select([styled.id]);
  return styled.id;
};

/* -------------------------------------------------------------------------- */
/* misc                                                                        */
/* -------------------------------------------------------------------------- */

/** Scene-coordinate bounding box of the given elements. */
export const boundsOf = (elements: readonly NonDeletedExcalidrawElement[]) =>
  getCommonBounds(elements);
