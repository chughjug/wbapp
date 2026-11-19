import { clear, createStore } from "idb-keyval";
import { beforeEach, describe, expect, it } from "vitest";

import { createDoc, getScene, saveScene } from "../library/store";

import { getLatexSource, isLatexDoc, saveLatexSource } from "./store";

const metaStore = createStore("goodnotes", "docs");
const sceneStore = createStore("goodnotes-scenes", "scenes");
const latexStore = createStore("goodnotes-latex", "sources");

describe("a LaTeX document travels with the rest", () => {
  beforeEach(async () => {
    await clear(metaStore);
    await clear(sceneStore);
    await clear(latexStore);
  });

  it("mirrors the source into the scene, so sync and history see it", async () => {
    // Everything that leaves the device — cross-device sync, snapshots,
    // the backup export — operates on a document's scene and knows
    // nothing about the LaTeX database. Without the mirror a `.tex`
    // file would be a second-class document on all three.
    const doc = await createDoc({ title: "Problem set" });
    await saveLatexSource(doc.id, "\\section{One}");

    const scene = await getScene(doc.id);
    expect((scene?.appState as Record<string, unknown>).goodnotesLatex).toBe(
      "\\section{One}",
    );
  });

  it("adopts a source that arrived from another device", async () => {
    // The second device has the scene (synced) but no row in its own
    // LaTeX database. Opening the document must still show the source.
    const doc = await createDoc({ title: "From the iPad" });
    await saveScene(doc.id, {
      elements: [],
      appState: { goodnotesLatex: "\\section{Written elsewhere}" } as never,
      files: {},
    });
    await clear(latexStore);

    const loaded = await getLatexSource(doc.id);
    expect(loaded?.text).toBe("\\section{Written elsewhere}");

    // and it is now local, so the next read does not go via the scene
    const local = await getLatexSource(doc.id);
    expect(local?.text).toBe("\\section{Written elsewhere}");
  });

  it("routes a synced document to the LaTeX editor on its first open", async () => {
    const doc = await createDoc({ title: "From the iPad" });
    await saveScene(doc.id, {
      elements: [],
      appState: { goodnotesLatex: "x" } as never,
      files: {},
    });
    await clear(latexStore);

    // guessing wrong here mounts the notebook editor over a LaTeX
    // document and autosaves an empty scene across it
    expect(await isLatexDoc(doc.id)).toBe(true);
  });

  it("does not mistake an ordinary notebook for a LaTeX one", async () => {
    const doc = await createDoc({ title: "Lecture 4" });
    await saveScene(doc.id, {
      elements: [],
      appState: { viewBackgroundColor: "transparent" },
      files: {},
    });
    expect(await isLatexDoc(doc.id)).toBe(false);
    expect(await getLatexSource(doc.id)).toBeNull();
  });

  it("keeps the keystrokes locally even when the mirror write fails", async () => {
    // The local store is the fast path the editor reads; a failure to
    // mirror must never cost the user what they just typed.
    const doc = await createDoc({ title: "Problem set" });
    await saveLatexSource(doc.id, "first");
    await saveLatexSource(doc.id, "second");

    expect((await getLatexSource(doc.id))?.text).toBe("second");
  });
});
