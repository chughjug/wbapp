/**
 * Session wrapper around `ink-stroke-modeler-ts` (Google Ink Stroke Modeler
 * port) for a single in-progress freedraw stroke.
 *
 * The modeler turns noisy digitizer samples into physics-smoothed tip
 * positions and can also emit a short prediction used for wet-ink lag masking.
 * It is optional — when the preference is off, App.tsx keeps the raw coalesced
 * samples and only uses browser `getPredictedEvents()` for the wet tail.
 *
 * Coordinates are scene units (same convention as the upstream TS demo);
 * time is seconds (`PointerEvent.timeStamp / 1000`).
 */

import {
  EventType,
  StrokeModeler,
  defaultStrokeModelParams,
  type Input,
  type Result,
} from "ink-stroke-modeler-ts";

export type ModeledSample = {
  x: number;
  y: number;
  pressure: number;
  time: number;
};

export class StrokeModelerSession {
  private readonly modeler = new StrokeModeler();
  private readonly modeledBuffer: Result[] = [];
  private readonly predictionBuffer: Result[] = [];
  private started = false;
  private failed = false;

  constructor() {
    const status = this.modeler.reset(defaultStrokeModelParams());
    if (!status.ok) {
      this.failed = true;
    }
  }

  get isActive() {
    return this.started && !this.failed;
  }

  get isFailed() {
    return this.failed;
  }

  /** Feed pointerdown. Returns the modeled tip sample(s) for the start. */
  down(sample: ModeledSample): ModeledSample[] {
    return this.push(EventType.Down, sample);
  }

  /** Feed pointermove sample(s). */
  move(sample: ModeledSample): ModeledSample[] {
    if (!this.started) {
      return this.down(sample);
    }
    return this.push(EventType.Move, sample);
  }

  /** Feed pointerup. */
  up(sample: ModeledSample): ModeledSample[] {
    if (!this.started) {
      return [];
    }
    return this.push(EventType.Up, sample);
  }

  /**
   * Predicted tip positions for the wet-ink overlay. Empty when prediction is
   * unavailable (no stroke in progress, disabled predictor, etc.).
   */
  predict(): ModeledSample[] {
    if (!this.started || this.failed) {
      return [];
    }
    this.predictionBuffer.length = 0;
    const status = this.modeler.predict(this.predictionBuffer);
    if (!status.ok) {
      return [];
    }
    return this.predictionBuffer.map(resultToSample);
  }

  private push(eventType: EventType, sample: ModeledSample): ModeledSample[] {
    if (this.failed) {
      return [];
    }

    const input: Input = {
      eventType,
      position: { x: sample.x, y: sample.y },
      time: sample.time,
      pressure: sample.pressure,
    };

    this.modeledBuffer.length = 0;
    const status = this.modeler.update(input, this.modeledBuffer);
    if (!status.ok) {
      this.failed = true;
      return [];
    }

    if (eventType === EventType.Down) {
      this.started = true;
    }
    if (eventType === EventType.Up) {
      this.started = false;
    }

    return this.modeledBuffer.map(resultToSample);
  }
}

const resultToSample = (result: Result): ModeledSample => ({
  x: result.position.x,
  y: result.position.y,
  pressure:
    Number.isFinite(result.pressure) && result.pressure >= 0
      ? result.pressure
      : 0.5,
  time: result.time,
});
