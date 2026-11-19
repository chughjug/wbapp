/**
 * The "Insert an equation" dialog — LaTeX in, typeset maths on the page,
 * with a live preview of exactly what will be inserted.
 *
 * Accessibility contract, same as the graph dialog's and equally
 * load-bearing: `role="dialog" aria-modal` labelled by its title and
 * described by its intro; focus moves in on mount, is trapped with
 * Tab/Shift+Tab and restored on close; Escape closes; the error is in a
 * `role="alert"` region AND tied to the field with `aria-describedby` +
 * `aria-invalid`; the preview is `role="img"` carrying the same
 * `aria-label` the inserted element gets.
 *
 * The preview is the real typeset SVG, not an approximation of it — the
 * same string that becomes the file — so what the student checks is what
 * lands on the page.
 */

import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import type { ExcalidrawImageElement } from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { insertMathIntoScene, updateMathElement } from "./insertMath";
import { MathRenderError, renderMathToSvg } from "./renderMath";
import {
  createMathSpec,
  DEFAULT_MATH_FONT_SIZE,
  describeMath,
  hasMathSource,
  MAX_MATH_FONT_SIZE,
  MAX_TEX_LENGTH,
  MIN_MATH_FONT_SIZE,
} from "./spec";

import "./MathDialog.scss";

import type { InsertMathResult } from "./insertMath";
import type { MathSpec } from "./spec";

export interface MathDialogProps {
  excalidrawAPI: ExcalidrawImperativeAPI;
  /** Escape, backdrop click, Cancel, or a successful insert. */
  onClose: () => void;
  /** Fired after the equation lands in (or is updated in) the scene. */
  onInserted?: (result: InsertMathResult) => void;
  /** Seed the form. */
  initialSpec?: MathSpec;
  /** Edit an existing equation in place instead of inserting a new one. */
  editElement?: ExcalidrawImageElement | null;
  theme?: "light" | "dark";
  /** Preview debounce in ms. Default 200. */
  debounceMs?: number;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Starters, not a reference. Four shapes a student actually reaches for,
 * each one a different piece of syntax (fraction, limits, matrix,
 * alignment) so inserting one teaches the next.
 */
const EXAMPLES: { label: string; tex: string }[] = [
  { label: "Fraction", tex: "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}" },
  {
    label: "Integral",
    tex: "\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}",
  },
  { label: "Matrix", tex: "\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}" },
  {
    label: "Aligned",
    tex: "\\begin{aligned} 2x + y &= 7 \\\\ x - y &= 2 \\end{aligned}",
  },
];

export const MathDialog: React.FC<MathDialogProps> = ({
  excalidrawAPI,
  onClose,
  onInserted,
  initialSpec,
  editElement,
  theme,
  debounceMs = 200,
}) => {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const texFieldRef = useRef<HTMLTextAreaElement | null>(null);
  const restoreFocusRef = useRef<Element | null>(null);
  const unmountedRef = useRef(false);

  const titleId = useId();
  const descriptionId = useId();
  const texFieldId = useId();
  const errorId = useId();

  const [tex, setTex] = useState(initialSpec?.tex ?? "");
  const [display, setDisplay] = useState(initialSpec?.display ?? true);
  const [fontSize, setFontSize] = useState(
    initialSpec?.fontSize ?? DEFAULT_MATH_FONT_SIZE,
  );
  const [preview, setPreview] = useState<{
    svg: string;
    width: number;
    height: number;
    alt: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [insertError, setInsertError] = useState<string | null>(null);

  const editorTheme =
    theme ??
    ((excalidrawAPI.getAppState?.().theme as "light" | "dark") || "light");

  const spec = useMemo<MathSpec>(
    () => createMathSpec(tex, { display, fontSize }),
    [tex, display, fontSize],
  );

  /* ---- live preview ------------------------------------------------------ */
  useEffect(() => {
    if (!hasMathSource(spec)) {
      setPreview(null);
      setError(null);
      setPending(false);
      return;
    }
    setPending(true);
    let cancelled = false;
    const timer = window.setTimeout(() => {
      renderMathToSvg(spec)
        .then((render) => {
          if (cancelled) {
            return;
          }
          setPreview(render);
          setError(null);
        })
        .catch((caught) => {
          if (cancelled) {
            return;
          }
          // Keep the last good preview on screen. Mid-edit, every
          // half-finished formula is briefly invalid, and blanking the
          // panel on each keystroke makes the dialog flicker.
          setError(
            caught instanceof MathRenderError
              ? caught.message
              : "That is not something the typesetter understands.",
          );
        })
        .finally(() => {
          if (!cancelled) {
            setPending(false);
          }
        });
    }, debounceMs);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [spec, debounceMs]);

  /* ---- focus ------------------------------------------------------------- */
  useEffect(() => {
    restoreFocusRef.current = document.activeElement;
    const frame = window.requestAnimationFrame(() => {
      texFieldRef.current?.focus();
      texFieldRef.current?.select();
    });
    return () => {
      unmountedRef.current = true;
      window.cancelAnimationFrame(frame);
      const toRestore = restoreFocusRef.current;
      if (toRestore instanceof HTMLElement && document.contains(toRestore)) {
        toRestore.focus();
      }
    };
  }, []);

  const submit = useCallback(async () => {
    if (busy || !hasMathSource(spec)) {
      return;
    }
    setBusy(true);
    setInsertError(null);
    try {
      const result = editElement
        ? await updateMathElement(excalidrawAPI, editElement, spec)
        : await insertMathIntoScene(excalidrawAPI, spec);
      onInserted?.(result);
      onClose();
    } catch (caught) {
      if (!unmountedRef.current) {
        setInsertError(
          caught instanceof Error
            ? caught.message
            : "The equation could not be added to the page.",
        );
      }
    } finally {
      if (!unmountedRef.current) {
        setBusy(false);
      }
    }
  }, [busy, editElement, excalidrawAPI, onClose, onInserted, spec]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        event.preventDefault();
        onClose();
        return;
      }
      // Enter inserts a newline in the source (aligned environments need
      // it), so the keyboard shortcut for "done" is the usual modifier one.
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        void submit();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const root = dialogRef.current;
      if (!root) {
        return;
      }
      const focusable = [
        ...root.querySelectorAll<HTMLElement>(FOCUSABLE),
      ].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (focusable.length === 0) {
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose, submit],
  );

  const alt = preview?.alt ?? describeMath(spec);
  const canSubmit = hasMathSource(spec) && !busy && preview !== null && !error;

  const body = (
    <div
      className={`excalidraw gn-math-backdrop theme--${editorTheme}`}
      data-theme={editorTheme}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="gn-math-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        ref={dialogRef}
        onKeyDown={onKeyDown}
      >
        <div className="gn-math-dialog__header">
          <h2 className="gn-math-dialog__title" id={titleId}>
            {editElement ? "Edit equation" : "Insert an equation"}
          </h2>
          <button
            type="button"
            className="gn-math-dialog__close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <p className="gn-math-dialog__intro" id={descriptionId}>
          Write it in LaTeX. The preview is the picture that will be placed on
          the page, and you can reopen it later to correct it.
        </p>

        <div className="gn-math-dialog__body">
          <div className="gn-math-dialog__form">
            <div className="gn-math-field">
              <label htmlFor={texFieldId}>Equation (LaTeX)</label>
              <textarea
                id={texFieldId}
                ref={texFieldRef}
                className="gn-math-source"
                value={tex}
                rows={5}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                maxLength={MAX_TEX_LENGTH}
                placeholder="e.g. \frac{d}{dx}\sin x = \cos x"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                onChange={(event) => setTex(event.target.value)}
              />
            </div>

            <div className="gn-math-examples">
              <span className="gn-math-examples__label">Start from:</span>
              {EXAMPLES.map((example) => (
                <button
                  key={example.label}
                  type="button"
                  className="gn-math-chip"
                  onClick={() => {
                    setTex(example.tex);
                    texFieldRef.current?.focus();
                  }}
                >
                  {example.label}
                </button>
              ))}
            </div>

            <div className="gn-math-row">
              <div className="gn-math-field">
                <label htmlFor={`${texFieldId}-size`}>Size</label>
                <input
                  id={`${texFieldId}-size`}
                  type="number"
                  min={MIN_MATH_FONT_SIZE}
                  max={MAX_MATH_FONT_SIZE}
                  step={2}
                  value={fontSize}
                  onChange={(event) =>
                    setFontSize(Number(event.target.value) || fontSize)
                  }
                />
              </div>
              <label className="gn-math-check">
                <input
                  type="checkbox"
                  checked={display}
                  onChange={(event) => setDisplay(event.target.checked)}
                />
                <span>
                  Display style
                  <span className="gn-math-hint">
                    full-size integrals and stacked limits
                  </span>
                </span>
              </label>
            </div>

            <p className="gn-math-error" role="alert" id={errorId}>
              {error ?? ""}
            </p>
            {insertError && (
              <p className="gn-math-error gn-math-error--summary" role="alert">
                {insertError}
              </p>
            )}
          </div>

          <div className="gn-math-preview">
            <h3 className="gn-math-preview__heading">Preview</h3>
            <div
              className="gn-math-preview__stage"
              role="img"
              aria-label={alt}
              data-stale={error ? "true" : undefined}
              // The SVG comes from our own typesetter, from source the user
              // typed, and is the exact string that becomes the file. There
              // is no path here for third-party markup to arrive.
              dangerouslySetInnerHTML={
                preview ? { __html: preview.svg } : undefined
              }
            >
              {preview ? undefined : (
                <span className="gn-math-preview__empty">
                  {pending ? "Typesetting…" : "Nothing to show yet"}
                </span>
              )}
            </div>
            {preview && (
              <p className="gn-math-preview__size">
                {preview.width} × {preview.height} px
              </p>
            )}
          </div>
        </div>

        <div className="gn-math-dialog__footer">
          <button type="button" className="gn-math-button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="gn-math-button gn-math-button--primary"
            onClick={() => void submit()}
            disabled={!canSubmit}
          >
            {busy
              ? "Working…"
              : editElement
              ? "Update equation"
              : "Insert equation"}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(body, document.body);
};
