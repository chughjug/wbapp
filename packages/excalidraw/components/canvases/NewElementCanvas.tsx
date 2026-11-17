import { useEffect, useRef } from "react";

import type { NonDeletedSceneElementsMap } from "@excalidraw/element/types";

import { isRenderThrottlingEnabled } from "../../reactUtils";
import { renderNewElementScene } from "../../renderer/renderNewElementScene";

import type {
  RenderableElementsMap,
  StaticCanvasRenderConfig,
  WetInkTail,
} from "../../scene/types";
import type { AppState } from "../../types";
import type { RoughCanvas } from "roughjs/bin/canvas";

interface NewElementCanvasProps {
  appState: AppState;
  newElement: NonNullable<AppState["newElement"]>;
  elementsMap: RenderableElementsMap;
  allElementsMap: NonDeletedSceneElementsMap;
  scale: number;
  rc: RoughCanvas;
  renderConfig: StaticCanvasRenderConfig;
  /** CSS opacity of the whole canvas — a translucent preview of a finished element */
  opacity?: number;
  /**
   * Predicted freedraw tip samples for wet-ink lag masking. Never committed
   * to the element — render-only.
   */
  wetInkTail?: WetInkTail | null;
}

const NewElementCanvas = (props: NewElementCanvasProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    // Request a desynchronized overlay context once. Subsequent getContext
    // calls (bootstrapCanvas) reuse it; this lets supported UAs present the
    // wet stroke with lower compositor latency.
    if (!canvas.dataset.desyncInit) {
      canvas.getContext("2d", { desynchronized: true, alpha: true });
      canvas.dataset.desyncInit = "1";
    }

    renderNewElementScene(
      {
        canvas,
        scale: props.scale,
        newElement: props.newElement,
        elementsMap: props.elementsMap,
        allElementsMap: props.allElementsMap,
        rc: props.rc,
        renderConfig: props.renderConfig,
        appState: props.appState,
        wetInkTail: props.wetInkTail,
      },
      isRenderThrottlingEnabled(),
    );
  });

  return (
    <canvas
      className="excalidraw__canvas"
      style={{
        width: props.appState.width,
        height: props.appState.height,
        opacity: props.opacity,
      }}
      width={props.appState.width * props.scale}
      height={props.appState.height * props.scale}
      ref={canvasRef}
    />
  );
};

export default NewElementCanvas;
