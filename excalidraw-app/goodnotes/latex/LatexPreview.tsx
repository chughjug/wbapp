/**
 * The typeset side, rendered by LaTeX.js.
 *
 * LaTeX.js (MIT, michael-brade) is a real LaTeX→HTML5 translator: it
 * ships the Computer Modern Unicode web fonts, implements the `article`
 * class's actual metrics — 1.5em `\parindent`, no inter-paragraph space,
 * LaTeX's 3.5ex/2.3ex section spacing, justified text with hyphenation —
 * and bundles KaTeX for the maths. It replaced a hand-written
 * approximation of all of that, because the typography is the whole
 * point and an approximation of LaTeX's typography is just a web page.
 *
 * ## Keeping the last good render
 *
 * LaTeX.js's parser is strict and throws a `SyntaxError` carrying a line
 * and column. A document being typed is invalid most of the time — the
 * moment after `\begin{itemize}` there is no `\end{itemize}` yet — so
 * rendering only on success would blank the preview on nearly every
 * keystroke. The last good output stays on screen with the error above
 * it, which is what Overleaf does and for the same reason.
 *
 * ## Why the fragment is adopted rather than set as HTML
 *
 * `generator.domFragment()` returns real nodes, appended to a container
 * whose children React does not own. So React never reconciles a tree it
 * did not build, and no HTML string is ever handed to
 * `dangerouslySetInnerHTML`.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";

import { findUnsupported, prepareSource } from "./prepare";

import "./LatexPreview.scss";

export interface LatexPreviewProps {
  source: string;
  /** Named in the error line so the engine is never ambiguous. */
  engineLabel: string;
}

interface RenderError {
  message: string;
  line: number | null;
  column: number | null;
}

/** LaTeX.js is heavy; load it with the first render, not with the module. */
const loadLatexJs = () => import("latex.js");

const describeError = (error: unknown): RenderError => {
  const anyError = error as {
    message?: string;
    location?: { start?: { line?: number; column?: number } };
  };
  return {
    message: anyError?.message ?? "This document could not be typeset.",
    line: anyError?.location?.start?.line ?? null,
    column: anyError?.location?.start?.column ?? null,
  };
};

export const LatexPreview: React.FC<LatexPreviewProps> = ({
  source,
  engineLabel,
}) => {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<RenderError | null>(null);
  const [everRendered, setEverRendered] = useState(false);
  const [loading, setLoading] = useState(true);

  const prepared = useMemo(() => prepareSource(source), [source]);
  const unsupported = useMemo(() => findUnsupported(source), [source]);

  useEffect(() => {
    let cancelled = false;

    void loadLatexJs()
      .then(({ parse, HtmlGenerator }) => {
        if (cancelled) {
          return;
        }
        setLoading(false);
        const host = sheetRef.current;
        if (!host) {
          return;
        }
        try {
          const generator = new HtmlGenerator({
            // LaTeX.js's hyphenator loads a pattern table and costs real
            // time on every keystroke; CSS `hyphens: auto` does the job
            // for a preview.
            hyphenate: false,
          });
          // LaTeX.js implements base `article`, not amsmath; the shim
          // rewrites equation/align into the display maths it accepts.
          parse(prepared.text, { generator });
          host.replaceChildren(generator.domFragment());
          setError(null);
          setEverRendered(true);
        } catch (caught) {
          // Keep what is on screen — see the module header on why the
          // document is invalid most of the time while it is being typed.
          setError(describeError(caught));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoading(false);
          setError({
            message:
              "The typesetter could not be loaded — you may be offline. Reconnect, then reload the page.",
            line: null,
            column: null,
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [prepared]);

  return (
    <div className="gn-tex__preview">
      {error && (
        <p className="gn-tex__error" role="status">
          <strong>{engineLabel}:</strong> {error.message}
          {error.line !== null && (
            <span className="gn-tex__errorat">
              {" "}
              line {error.line}
              {error.column !== null ? `, column ${error.column}` : ""}
            </span>
          )}
          {everRendered && (
            <span className="gn-tex__errorhint">
              {" "}
              Showing the last version that typeset.
            </span>
          )}
        </p>
      )}

      {loading && !everRendered && (
        <p className="gn-tex__note">Loading the typesetter…</p>
      )}

      {/*
        LaTeX.js owns the children of this node — see the module header.

        The `page` class is load-bearing, not decoration. LaTeX.js's
        stylesheet keys its typographic root off `html, .page`, but that
        wrapper is only emitted by `htmlDocument()`; `domFragment()`
        returns a bare `div.body`. Without it the sheet inherited the
        app's UI font and `--parindent` never reached a paragraph —
        Computer Modern and the 1.5em indent simply never applied.
      */}
      <div className="gn-tex__sheet page latex-js" ref={sheetRef} />

      {unsupported.length > 0 && (
        <p className="gn-tex__note">
          {engineLabel} does not implement {unsupported.join(", ")}, so those
          parts will not appear. Everything else still typesets.
        </p>
      )}
    </div>
  );
};
