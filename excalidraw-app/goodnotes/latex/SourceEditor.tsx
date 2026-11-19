/**
 * The source pane: CodeMirror 6 with TeX highlighting.
 *
 * CodeMirror 6 is what Overleaf itself moved to, and it is MIT. Hand-wired
 * here rather than through `@uiw/react-codemirror`: the wrapper pins its
 * own `@codemirror/*` copies, and two instances of `@codemirror/state` in
 * one bundle is the classic CM6 runtime failure. A `useEffect` and an
 * `EditorView` is all this needs.
 *
 * Highlighting comes from `@codemirror/legacy-modes`' `stex` mode, which
 * is MIT. The obvious alternative, `codemirror-lang-latex`, **relicensed
 * to AGPL-3.0 at 0.5.0** — its grammar derives from Overleaf's, which is
 * AGPL — so it is disqualified for this MIT fork. `stex` is a stream
 * parser, so there is no syntax tree: colouring yes, structural folding
 * no. That is the trade this licence constraint forces.
 *
 * CM6 needs no stylesheet import and no web worker; it injects its own
 * styles. Importing a CSS file for it is a common wrong step.
 */

import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  StreamLanguage,
  bracketMatching,
  defaultHighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { Compartment, EditorState } from "@codemirror/state";
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import React, { useEffect, useRef } from "react";

import "./SourceEditor.scss";

export interface SourceEditorProps {
  value: string;
  onChange: (next: string) => void;
  /** Dark mode swaps the theme compartment rather than remounting. */
  dark?: boolean;
}

/** Light theme. Deliberately quiet — the preview is the colourful half. */
const lightTheme = EditorView.theme(
  {
    "&": { height: "100%", fontSize: "13.5px" },
    ".cm-scroller": {
      fontFamily:
        '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
      lineHeight: "1.6",
    },
    ".cm-gutters": {
      backgroundColor: "#fafafa",
      color: "#9a9aa2",
      border: "none",
    },
    ".cm-activeLineGutter": { backgroundColor: "#f0efff", color: "#5b5bd6" },
    ".cm-activeLine": { backgroundColor: "#f7f7ff" },
    ".cm-content": { caretColor: "#5b5bd6" },
  },
  { dark: false },
);

const darkTheme = EditorView.theme(
  {
    "&": { height: "100%", fontSize: "13.5px" },
    ".cm-scroller": {
      fontFamily:
        '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
      lineHeight: "1.6",
    },
    "&, .cm-content": { backgroundColor: "#1e1e24", color: "#e3e3e8" },
    ".cm-gutters": {
      backgroundColor: "#232329",
      color: "#6c6c7a",
      border: "none",
    },
    ".cm-activeLineGutter": { backgroundColor: "#2e2d39", color: "#a8a5ff" },
    ".cm-activeLine": { backgroundColor: "#26262e" },
    ".cm-content": { caretColor: "#a8a5ff" },
    ".cm-cursor": { borderLeftColor: "#a8a5ff" },
  },
  { dark: true },
);

export const SourceEditor: React.FC<SourceEditorProps> = ({
  value,
  onChange,
  dark,
}) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const themeRef = useRef(new Compartment());
  // read through a ref so changing the handler never rebuilds the editor
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          bracketMatching(),
          history(),
          StreamLanguage.define(stex),
          // A language alone colours nothing: CM6 needs a highlight style
          // bound to the tags the parser emits. Without this the source
          // rendered as undifferentiated black text.
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          EditorView.lineWrapping,
          keymap.of([...defaultKeymap, ...historyKeymap]),
          themeRef.current.of(dark ? darkTheme : lightTheme),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // built once: `value` below is reconciled, not re-created
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Adopt a value that changed underneath us — the document finished
   * loading, or another device's copy arrived. Guarded on inequality, or
   * every keystroke would dispatch a full-document replacement and throw
   * the cursor to the end.
   */
  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) {
      return;
    }
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
    });
  }, [value]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: themeRef.current.reconfigure(dark ? darkTheme : lightTheme),
    });
  }, [dark]);

  return <div className="gn-tex__cm" ref={hostRef} />;
};
