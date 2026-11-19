import { createStore, get, set } from "idb-keyval";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createDoc,
  deleteDoc,
  getScene,
  listDocs,
  noteSceneBaseline,
  saveScene,
  subscribeSceneMerged,
} from "./index";

import type { DocMeta, DocScene } from "../types";

// Handles onto the very same databases the store uses (see the layout in
// `store.ts`). A second tab is a second JS realm with its own module state,
// which `saveScene` from this realm cannot stand in for — it would update
// our own watermark and hide the conflict. Writing through these is what a
// foreign tab actually does.
const foreignMetaStore = createStore("goodnotes", "docs");
const foreignSceneStore = createStore("goodnotes-scenes", "scenes");

/** A write by "the other tab": scene replaced wholesale, updatedAt bumped. */
const otherTabSaves = async (id: string, scene: DocScene): Promise<void> => {
  await set(id, scene, foreignSceneStore);
  const meta = (await get(id, foreignMetaStore)) as DocMeta;
  await set(id, { ...meta, updatedAt: meta.updatedAt + 1 }, foreignMetaStore);
};

/**
 * The same notebook open in two tabs.
 *
 * Saving is last-write-wins over the whole scene, so before the watermark
 * each tab's save overwrote the other's strokes outright and said nothing.
 * These tests drive two "tabs" through one store: each `noteSceneBaseline`
 * call stands for a tab opening the document, and each `saveScene` for that
 * tab saving what it has in memory.
 */

const stroke = (id: string, version = 1, versionNonce = 1): any => ({
  id,
  type: "freedraw",
  version,
  versionNonce,
  index: `a${id}`,
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  isDeleted: false,
  points: [
    [0, 0],
    [10, 10],
  ],
});

const sceneOf = (...elements: any[]): DocScene => ({
  elements,
  appState: {},
  files: {},
});

const idsIn = (scene: DocScene | null) =>
  (scene?.elements ?? []).map((element) => element.id).sort();

describe("two tabs editing one notebook", () => {
  beforeEach(async () => {
    for (const doc of await listDocs()) {
      await deleteDoc(doc.id);
    }
  });

  it("keeps both tabs' strokes instead of letting the last save win", async () => {
    const doc = await createDoc({ title: "Lecture 4" });

    // tab A opens and writes one stroke
    await noteSceneBaseline(doc.id);
    await saveScene(doc.id, sceneOf(stroke("a1")));

    // tab B opened at the same moment A did, so its baseline is older; it
    // saves the stroke it drew on top of what it had in memory
    const bBaseline = (await getScene(doc.id))!;
    expect(idsIn(bBaseline)).toEqual(["a1"]);
    await otherTabSaves(doc.id, sceneOf(stroke("a1"), stroke("b1")));

    // now tab A saves again, still unaware of b1 — this is the write that
    // used to wipe it out
    await saveScene(doc.id, sceneOf(stroke("a1"), stroke("a2")));

    expect(idsIn(await getScene(doc.id))).toEqual(["a1", "a2", "b1"]);
  });

  it("tells the host when a save had to merge, so the canvas can catch up", async () => {
    const doc = await createDoc({ title: "Lecture 5" });
    const merges: string[][] = [];
    const stop = subscribeSceneMerged((_id, scene) =>
      merges.push(idsIn(scene)),
    );

    await noteSceneBaseline(doc.id);
    await saveScene(doc.id, sceneOf(stroke("a1")));
    // another tab lands a stroke underneath us
    await otherTabSaves(doc.id, sceneOf(stroke("a1"), stroke("b1")));
    expect(merges).toEqual([]);

    await saveScene(doc.id, sceneOf(stroke("a1"), stroke("a2")));
    expect(merges).toEqual([["a1", "a2", "b1"]]);
    stop();
  });

  it("does not merge when this tab is the only writer", async () => {
    const doc = await createDoc({ title: "Alone" });
    const merges: string[][] = [];
    const stop = subscribeSceneMerged((_id, scene) =>
      merges.push(idsIn(scene)),
    );

    await noteSceneBaseline(doc.id);
    await saveScene(doc.id, sceneOf(stroke("a1")));
    await saveScene(doc.id, sceneOf(stroke("a1"), stroke("a2")));
    await saveScene(doc.id, sceneOf(stroke("a1"), stroke("a2"), stroke("a3")));

    expect(merges).toEqual([]);
    expect(idsIn(await getScene(doc.id))).toEqual(["a1", "a2", "a3"]);
    stop();
  });

  it("lets this tab's newer edit of a shared element win", async () => {
    const doc = await createDoc({ title: "Same stroke" });

    await noteSceneBaseline(doc.id);
    await saveScene(doc.id, sceneOf(stroke("shared", 1)));
    // other tab moves it to version 2
    await otherTabSaves(doc.id, sceneOf({ ...stroke("shared", 2), x: 99 }));
    // this tab has edited it further, to version 3
    await saveScene(doc.id, sceneOf({ ...stroke("shared", 3), x: 42 }));

    const saved = (await getScene(doc.id))!.elements as any[];
    expect(saved).toHaveLength(1);
    expect(saved[0].version).toBe(3);
    expect(saved[0].x).toBe(42);
  });

  it("takes the other tab's edit when it is the newer one", async () => {
    const doc = await createDoc({ title: "Their stroke" });

    await noteSceneBaseline(doc.id);
    await saveScene(doc.id, sceneOf(stroke("shared", 1)));
    await otherTabSaves(doc.id, sceneOf({ ...stroke("shared", 7), x: 99 }));
    // this tab's copy is older than what landed underneath it
    await saveScene(doc.id, sceneOf({ ...stroke("shared", 2), x: 42 }));

    const saved = (await getScene(doc.id))!.elements as any[];
    expect(saved[0].version).toBe(7);
    expect(saved[0].x).toBe(99);
  });

  it("does not resurrect strokes this tab deleted on its own", async () => {
    const doc = await createDoc({ title: "Erased" });

    await noteSceneBaseline(doc.id);
    await saveScene(doc.id, sceneOf(stroke("a1"), stroke("a2")));
    // no other writer in between, so the erase stands
    await saveScene(doc.id, sceneOf(stroke("a1")));

    expect(idsIn(await getScene(doc.id))).toEqual(["a1"]);
  });

  it("carries over the other tab's files so merged images are not broken", async () => {
    const doc = await createDoc({ title: "Pictures" });

    await noteSceneBaseline(doc.id);
    await saveScene(doc.id, {
      ...sceneOf(stroke("a1")),
      files: { mine: 1 } as any,
    });
    await otherTabSaves(doc.id, {
      ...sceneOf(stroke("a1"), stroke("b1")),
      files: { theirs: 2 } as any,
    });
    await saveScene(doc.id, {
      ...sceneOf(stroke("a1"), stroke("a2")),
      files: { mine: 1 } as any,
    });

    const files = (await getScene(doc.id))!.files as any;
    expect(Object.keys(files).sort()).toEqual(["mine", "theirs"]);
  });

  it("ignores a document this tab never opened for editing", async () => {
    const doc = await createDoc({ title: "Imported" });
    // no noteSceneBaseline: a restore or import writes without being a tab
    await saveScene(doc.id, sceneOf(stroke("a1")));
    await otherTabSaves(doc.id, sceneOf(stroke("x1")));
    await saveScene(doc.id, sceneOf(stroke("b1")));

    // last write simply wins, as before
    expect(idsIn(await getScene(doc.id))).toEqual(["b1"]);
  });
});
