/**
 * <PaperPicker /> — choose a paper template.
 *
 * Each option shows a live mini-preview drawn with the *same* template
 * functions the background layer uses (`renderPaper`), so previews can never
 * drift from the real output.
 *
 * Accessibility: the options form a real radiogroup (roving tabindex, arrow
 * keys, Home/End), each with an accessible name and a visible focus ring.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { PAPER_TEMPLATE_LIST, renderPaper } from "./templates";

import "./PaperPicker.scss";

import type { ReactNode } from "react";

import type { PaperTheme } from "./templates";
import type { PaperTemplateId } from "../types";

/** Scene size the preview renders, then scales down to the swatch box. */
const PREVIEW_SCENE_WIDTH = 408;
const PREVIEW_SCENE_HEIGHT = 528;

export interface PaperPreviewProps {
  template: PaperTemplateId;
  theme: PaperTheme;
  /** Swatch size in CSS px. */
  width?: number;
  height?: number;
  className?: string;
}

/** A standalone mini-preview of one template. */
export const PaperPreview = ({
  template,
  theme,
  width = 56,
  height = 72,
  className,
}: PaperPreviewProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // fit the (virtual) page into the swatch
    const scale = Math.min(
      width / PREVIEW_SCENE_WIDTH,
      height / PREVIEW_SCENE_HEIGHT,
    );
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.translate(
      (width - PREVIEW_SCENE_WIDTH * scale) / 2,
      (height - PREVIEW_SCENE_HEIGHT * scale) / 2,
    );
    ctx.scale(scale, scale);
    renderPaper(ctx, template, PREVIEW_SCENE_WIDTH, PREVIEW_SCENE_HEIGHT, {
      theme,
    });
  }, [template, theme, width, height]);

  return (
    <canvas
      ref={canvasRef}
      className={`goodnotes-paper-preview${className ? ` ${className}` : ""}`}
      aria-hidden="true"
    />
  );
};

/**
 * One option in the picker. Defaults to the six built-in paper templates;
 * a host can append its own (the new-page flow adds an `"image"` option this
 * way, so the radiogroup stays ONE group with real radio semantics).
 */
export interface PaperPickerOption<Id extends string = PaperTemplateId> {
  id: Id;
  label: string;
  /** Accessible name; defaults to `label`. */
  ariaLabel?: string;
  /** Custom swatch. Defaults to a live `PaperPreview` of `id`. */
  preview?: ReactNode;
}

export interface PaperPickerProps<Id extends string = PaperTemplateId> {
  value: Id;
  onChange: (template: Id) => void;
  theme: PaperTheme;
  /**
   * Options to show. Defaults to every built-in paper template. Generic in
   * the id type, so `<PaperPicker<"blank" | "image"> …>` type-checks.
   */
  options?: readonly PaperPickerOption<Id>[];
  /** Accessible name for the group. */
  label?: string;
  /** Hide the visible group heading (the name is still exposed to AT). */
  hideLabel?: boolean;
  disabled?: boolean;
  className?: string;
  /** Distinguishes multiple pickers on one page (for the label's id). */
  idPrefix?: string;
}

const DEFAULT_OPTIONS: readonly PaperPickerOption<PaperTemplateId>[] =
  PAPER_TEMPLATE_LIST.map((template) => ({
    id: template.id,
    label: template.label,
  }));

export const PaperPicker = <Id extends string = PaperTemplateId>({
  value,
  onChange,
  theme,
  options,
  label = "Paper template",
  hideLabel = false,
  disabled = false,
  className,
  idPrefix = "goodnotes-paper-picker",
}: PaperPickerProps<Id>) => {
  const items = (options ??
    (DEFAULT_OPTIONS as readonly PaperPickerOption<Id>[])) as readonly PaperPickerOption<Id>[];
  const [focusedId, setFocusedId] = useState<Id>(value);
  const refs = useRef(new Map<Id, HTMLButtonElement>());

  useEffect(() => {
    setFocusedId(value);
  }, [value]);

  const select = useCallback(
    (id: Id, moveFocus: boolean) => {
      setFocusedId(id);
      if (moveFocus) {
        refs.current.get(id)?.focus();
      }
      if (id !== value) {
        onChange(id);
      }
    },
    [onChange, value],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, id: Id) => {
      const list = items;
      const index = list.findIndex((template) => template.id === id);
      let next = -1;

      switch (event.key) {
        case "ArrowRight":
        case "ArrowDown":
          next = (index + 1) % list.length;
          break;
        case "ArrowLeft":
        case "ArrowUp":
          next = (index - 1 + list.length) % list.length;
          break;
        case "Home":
          next = 0;
          break;
        case "End":
          next = list.length - 1;
          break;
        case " ":
        case "Enter":
          event.preventDefault();
          select(id, false);
          return;
        default:
          return;
      }

      event.preventDefault();
      select(list[next].id, true);
    },
    [items, select],
  );

  const groupId = `${idPrefix}-label`;

  return (
    <div
      className={`goodnotes-paper-picker${className ? ` ${className}` : ""}`}
      data-theme={theme}
    >
      <div
        className={`goodnotes-paper-picker__label${
          hideLabel ? " goodnotes-paper-picker__label--hidden" : ""
        }`}
        id={groupId}
      >
        {label}
      </div>
      <div
        className="goodnotes-paper-picker__options"
        role="radiogroup"
        aria-labelledby={groupId}
      >
        {items.map((template) => {
          const checked = template.id === value;
          return (
            <button
              key={template.id}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={template.ariaLabel ?? template.label}
              disabled={disabled}
              tabIndex={template.id === focusedId ? 0 : -1}
              className={`goodnotes-paper-picker__option${
                checked ? " goodnotes-paper-picker__option--selected" : ""
              }`}
              ref={(node) => {
                if (node) {
                  refs.current.set(template.id, node);
                } else {
                  refs.current.delete(template.id);
                }
              }}
              onClick={() => select(template.id, false)}
              onKeyDown={(event) => onKeyDown(event, template.id)}
            >
              {template.preview ?? (
                <PaperPreview
                  template={template.id as unknown as PaperTemplateId}
                  theme={theme}
                />
              )}
              <span className="goodnotes-paper-picker__option-label">
                {template.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default PaperPicker;
