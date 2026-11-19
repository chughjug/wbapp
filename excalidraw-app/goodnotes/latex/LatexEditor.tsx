/**
 * The LaTeX document editor: source on one side, rendered pages on the
 * other.
 *
 * Deliberately modest about what it is. The footer names the engine, and
 * anything the subset does not implement is listed under the preview
 * rather than silently dropped — a student submitting a problem set needs
 * to know the difference between "this app cannot draw TikZ" and "my
 * figure is missing".
 *
 * Export is the browser's own print pipeline rather than jsPDF. The
 * preview is already laid out as A4 pages with a print stylesheet, every
 * platform including iPad can print to PDF, maths comes through as vector
 * SVG rather than a raster, and it adds nothing to the bundle.
 */

import React, { useCallback, useEffect, useId, useMemo, useState } from "react";

import { getEngine, listEngines } from "./engine";
import { LatexPreview } from "./LatexPreview";
import {
  flushLatexSaves,
  getLatexSource,
  saveLatexSourceDebounced,
  STARTER_SOURCE,
} from "./store";

import "./LatexEditor.scss";

import type { CompileResult } from "./engine";

export interface LatexEditorProps {
  docId: string;
  title: string;
  onClose: () => void;
  onRename?: (title: string) => void;
  theme?: "light" | "dark";
}

/** How long after the last keystroke the preview recompiles. */
const COMPILE_DEBOUNCE_MS = 350;

export const LatexEditor: React.FC<LatexEditorProps> = ({
  docId,
  title,
  onClose,
  onRename,
  theme,
}) => {
  const [source, setSource] = useState<string | null>(null);
  const [engineId, setEngineId] = useState("lite");
  const [result, setResult] = useState<CompileResult | null>(null);
  const [showSource, setShowSource] = useState(true);
  const sourceId = useId();
  const engines = useMemo(() => listEngines(), []);
  const engine = getEngine(engineId);

  /* ---- load -------------------------------------------------------- */
  useEffect(() => {
    let cancelled = false;
    void getLatexSource(docId).then((stored) => {
      if (cancelled) {
        return;
      }
      setSource(stored?.text ?? STARTER_SOURCE);
      setEngineId(stored?.engineId ?? "lite");
    });
    return () => {
      cancelled = true;
    };
  }, [docId]);

  /* ---- compile, debounced ------------------------------------------ */
  useEffect(() => {
    if (source === null) {
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void engine.compile(source).then((next) => {
        if (!cancelled) {
          setResult(next);
        }
      });
    }, COMPILE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [source, engine]);

  /* ---- save --------------------------------------------------------- */
  useEffect(() => {
    if (source === null) {
      return;
    }
    saveLatexSourceDebounced(docId, source, engineId);
  }, [docId, source, engineId]);

  // Unmounting mid-edit must not lose the last few hundred milliseconds
  // of typing; the same contract the notebook editor keeps.
  useEffect(() => () => void flushLatexSaves(), []);

  const onPrint = useCallback(() => {
    // The preview is already A4 pages; the print stylesheet hides the
    // app around it. No new dependency, and vector maths in the PDF.
    window.print();
  }, []);

  const onDownloadSource = useCallback(() => {
    if (source === null) {
      return;
    }
    const blob = new Blob([source], { type: "text/x-tex" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${title.replace(/[^\w\-. ]+/g, "_") || "document"}.tex`;
    link.click();
    URL.revokeObjectURL(url);
  }, [source, title]);

  return (
    <div
      className={`gn-tex excalidraw${theme === "dark" ? " theme--dark" : ""}`}
    >
      <header className="gn-tex__bar">
        <button
          type="button"
          className="gn-tex__back"
          onClick={() => {
            void flushLatexSaves().then(onClose);
          }}
        >
          ‹ All documents
        </button>

        <input
          className="gn-tex__name"
          value={title}
          aria-label="Document name"
          onChange={(event) => onRename?.(event.target.value)}
        />

        <div className="gn-tex__actions">
          <button
            type="button"
            className="gn-tex__toggle"
            aria-pressed={showSource}
            onClick={() => setShowSource((open) => !open)}
          >
            {showSource ? "Hide source" : "Show source"}
          </button>
          {engines.length > 1 && (
            <select
              className="gn-tex__engine"
              aria-label="Typesetting engine"
              value={engineId}
              onChange={(event) => setEngineId(event.target.value)}
            >
              {engines.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          )}
          <button type="button" onClick={onDownloadSource}>
            Download .tex
          </button>
          <button type="button" className="gn-tex__print" onClick={onPrint}>
            Export PDF
          </button>
        </div>
      </header>

      <div className="gn-tex__body">
        {showSource && (
          <div className="gn-tex__sourcepane">
            <label className="gn-tex__srlabel" htmlFor={sourceId}>
              LaTeX source
            </label>
            <textarea
              id={sourceId}
              className="gn-tex__source"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              value={source ?? ""}
              placeholder="Loading…"
              onChange={(event) => setSource(event.target.value)}
            />
          </div>
        )}

        <LatexPreview
          document={result?.document ?? null}
          engineLabel={engine.label}
        />
      </div>

      <footer className="gn-tex__footer">
        <span>{engine.description}</span>
      </footer>
    </div>
  );
};
