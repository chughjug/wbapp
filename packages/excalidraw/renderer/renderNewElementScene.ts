import { throttleRAF } from "@excalidraw/common";

import {
  getTargetFrame,
  isInvisiblySmallElement,
  renderElement,
  shouldApplyFrameClip,
} from "@excalidraw/element";

import type {
  ExcalidrawFreeDrawElement,
  NonDeleted,
} from "@excalidraw/element/types";
import type { LocalPoint } from "@excalidraw/math";

import {
  bootstrapCanvas,
  getNormalizedCanvasDimensions,
  snapScrollToDevicePixels,
} from "./helpers";

import { frameClip } from "./staticScene";

import type { NewElementSceneRenderConfig, WetInkTail } from "../scene/types";

/**
 * Build a render-only copy of an in-progress freedraw with the wet-ink
 * prediction appended. The real element is left untouched so phantom points
 * never reach autosave / collab / history.
 */
const withWetInkTail = (
  element: NonDeleted<ExcalidrawFreeDrawElement>,
  wetInkTail: WetInkTail | null | undefined,
): NonDeleted<ExcalidrawFreeDrawElement> => {
  if (!wetInkTail?.points.length) {
    return element;
  }

  const points = [
    ...element.points,
    ...(wetInkTail.points as LocalPoint[]),
  ] as ExcalidrawFreeDrawElement["points"];

  const pressures = element.simulatePressure
    ? []
    : [...element.pressures, ...wetInkTail.pressures];

  // fresh object so ShapeCache (WeakMap) never poisons the live element
  return {
    ...element,
    points,
    pressures,
    isDeleted: false,
  };
};

const _renderNewElementScene = ({
  canvas,
  rc,
  newElement,
  elementsMap,
  allElementsMap,
  scale,
  appState: unsnappedAppState,
  renderConfig,
  wetInkTail,
}: NewElementSceneRenderConfig) => {
  if (canvas) {
    // the same whole-device-pixel scroll the static scene draws at
    const appState = snapScrollToDevicePixels(unsnappedAppState, scale);
    const [normalizedWidth, normalizedHeight] = getNormalizedCanvasDimensions(
      canvas,
      scale,
    );

    const context = bootstrapCanvas({
      canvas,
      scale,
      normalizedWidth,
      normalizedHeight,
    });

    context.save();

    // Apply zoom
    context.scale(appState.zoom.value, appState.zoom.value);

    if (newElement && newElement.type !== "selection") {
      // e.g. when creating arrows and we're still below the arrow drag distance
      // threshold
      // (for now we skip render only with elements while we're creating to be
      // safe)
      if (isInvisiblySmallElement(newElement)) {
        return;
      }

      const frameId = newElement.frameId || appState.frameToHighlight?.id;

      if (
        frameId &&
        appState.frameRendering.enabled &&
        appState.frameRendering.clip
      ) {
        const frame = getTargetFrame(newElement, elementsMap, appState);

        if (
          frame &&
          shouldApplyFrameClip(newElement, frame, appState, elementsMap)
        ) {
          frameClip(frame, context, renderConfig, appState);
        }
      }

      const renderTargetElement =
        newElement.type === "freedraw"
          ? withWetInkTail(
              newElement as NonDeleted<ExcalidrawFreeDrawElement>,
              wetInkTail,
            )
          : newElement;

      renderElement(
        renderTargetElement,
        elementsMap,
        allElementsMap,
        rc,
        context,
        renderConfig,
        appState,
      );
    } else {
      context.clearRect(0, 0, normalizedWidth, normalizedHeight);
    }

    context.restore();
  }
};

export const renderNewElementSceneThrottled = throttleRAF(
  (config: NewElementSceneRenderConfig) => {
    _renderNewElementScene(config);
  },
);

export const renderNewElementScene = (
  renderConfig: NewElementSceneRenderConfig,
  throttle?: boolean,
) => {
  if (throttle) {
    renderNewElementSceneThrottled(renderConfig);
    return;
  }

  _renderNewElementScene(renderConfig);
};
