/**
 * Where `.tex` sources live.
 *
 *   db "goodnotes-latex" / store "sources" -> LatexSource, keyed by doc id
 *
 * A LaTeX document is a row in the same library as every notebook — it
 * gets a `DocMeta`, so it appears on the shelf, carries a course and a
 * due date, can be favourited, trashed and restored, and syncs with the
 * rest. Only the *body* differs: a notebook's body is a scene of
 * elements, a LaTeX document's body is a string.
 *
 * That is why the source is stored here rather than squeezed into
 * `DocScene`: a scene is an element array and a files map, and pretending
 * a 40 KB string is one would mean every consumer of a scene — the paper
 * layer, the export pipeline, the outline, search — having to special-case
 * it. A separate store with the same key is simpler and keeps the
 * notebook path untouched.
 *
 * ## …and a copy in the scene, for everything built on scenes
 *
 * Writing it *only* here would have made a LaTeX document a second-class
 * one: cross-device sync, version history and the backup export all
 * operate on a document's scene, and none of them knows this database
 * exists. So each save also writes the source into the scene's
 * `appState.goodnotesLatex`.
 *
 * That is cheap — `sanitizeAppState` passes unknown keys through, so
 * nothing in the library needed changing — and it buys the whole set at
 * once: a `.tex` file now syncs between devices through the existing
 * engine, gets a snapshot in Earlier versions on the same schedule as
 * ink, and travels in a backup. The local database stays the fast path
 * the editor reads on every keystroke; the scene copy is what leaves the
 * device.
 */

import { createStore, del, get, keys, set } from "idb-keyval";

import { getScene, saveScene } from "../library/store";

const sourceStore = createStore("goodnotes-latex", "sources");

export interface LatexSource {
  docId: string;
  /** The `.tex` source. */
  text: string;
  /** Engine the writer last chose; `"lite"` unless one was installed. */
  engineId: string;
  updatedAt: number;
}

/** What a new LaTeX document starts as. */
export const STARTER_SOURCE = `\\documentclass{article}
\\usepackage{amsmath}

\\title{Problem set}
\\author{}
\\date{}

\\begin{document}
\\maketitle

\\section{Question 1}

State the problem here. Maths goes inline like $e^{i\\pi} + 1 = 0$, or on
its own line:

\\begin{equation}
  \\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}
\\end{equation}

\\begin{itemize}
  \\item A point worth making.
  \\item Another one.
\\end{itemize}

\\section{Question 2}

Write the next answer here.

\\end{document}
`;

export const getLatexSource = async (
  docId: string,
): Promise<LatexSource | null> => {
  const local = (await get(docId, sourceStore)) as LatexSource | undefined;
  if (local) {
    return local;
  }

  /**
   * Nothing locally: this may be a document that arrived from another
   * device, where the source rode in on the scene. Adopt it into the
   * local store so the next read is the fast path again.
   */
  try {
    const scene = await getScene(docId);
    const carried = (scene?.appState as Record<string, unknown> | undefined)
      ?.goodnotesLatex;
    if (typeof carried === "string") {
      const adopted: LatexSource = {
        docId,
        text: carried,
        engineId: "lite",
        updatedAt: Date.now(),
      };
      await set(docId, adopted, sourceStore);
      return adopted;
    }
  } catch {
    // a scene we cannot read is not a reason to fail opening the editor
  }
  return null;
};

export const saveLatexSource = async (
  docId: string,
  text: string,
  engineId = "lite",
): Promise<LatexSource> => {
  const record: LatexSource = {
    docId,
    text,
    engineId,
    updatedAt: Date.now(),
  };
  await set(docId, record, sourceStore);

  // The copy that leaves the device. Failing this must not lose the
  // keystrokes already safely in the local store above.
  try {
    await saveScene(docId, {
      elements: [],
      appState: { goodnotesLatex: text } as never,
      files: {},
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("goodnotes/latex: could not mirror source to scene", error);
  }

  return record;
};

export const forgetLatexSource = async (docId: string): Promise<void> => {
  await del(docId, sourceStore);
};

/**
 * Is this document a LaTeX one? Used to route the shelf's open action.
 *
 * Checks the scene too, so a document synced from another device opens
 * in the LaTeX editor on its first open here rather than mounting the
 * notebook editor over it.
 */
export const isLatexDoc = async (docId: string): Promise<boolean> => {
  if ((await get(docId, sourceStore)) !== undefined) {
    return true;
  }
  try {
    const scene = await getScene(docId);
    return (
      typeof (scene?.appState as Record<string, unknown> | undefined)
        ?.goodnotesLatex === "string"
    );
  } catch {
    return false;
  }
};

/** Every LaTeX document id, for the backup/export path. */
export const listLatexDocIds = async (): Promise<string[]> =>
  (await keys(sourceStore)).filter((k): k is string => typeof k === "string");

/* -------------------------------------------------------------------------
 * Debounced saving, mirroring `library/store`'s scene path.
 *
 * Typing is a hot path and a `.tex` file is a single string, so a write
 * per keystroke would rewrite the whole document every few milliseconds.
 * ---------------------------------------------------------------------- */

const pending = new Map<
  string,
  { timer: ReturnType<typeof setTimeout>; text: string; engineId: string }
>();

export const LATEX_SAVE_DEBOUNCE_MS = 600;

export const saveLatexSourceDebounced = (
  docId: string,
  text: string,
  engineId = "lite",
  wait: number = LATEX_SAVE_DEBOUNCE_MS,
): void => {
  const queued = pending.get(docId);
  if (queued) {
    clearTimeout(queued.timer);
  }
  const timer = setTimeout(() => {
    const entry = pending.get(docId);
    pending.delete(docId);
    if (entry) {
      void saveLatexSource(docId, entry.text, entry.engineId).catch(
        // eslint-disable-next-line no-console
        (error) => console.error("goodnotes/latex: could not save", error),
      );
    }
  }, wait);
  pending.set(docId, { timer, text, engineId });
};

/** Write out anything still queued. Call before navigating away. */
export const flushLatexSaves = async (): Promise<void> => {
  const queued = [...pending.entries()];
  pending.clear();
  await Promise.all(
    queued.map(([docId, entry]) => {
      clearTimeout(entry.timer);
      return saveLatexSource(docId, entry.text, entry.engineId).catch(
        () => undefined,
      );
    }),
  );
};
