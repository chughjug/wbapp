/**
 * Backup / restore round-trip tests.
 *
 * This path had no tests at all, and it is the one the user reaches for when
 * something has already gone wrong: it is the escape hatch from Safari's
 * 7-day cap on script-writable storage, and from losing a term of notes. A
 * restore that silently drops a document, or an export that loses the ink
 * inside one, is the worst failure this app has.
 *
 * Like `sync/engine.test.ts`, these run against the REAL local library
 * (`goodnotes/library`, on `fake-indexeddb`) rather than a mock, so the
 * assertions are about what actually lands in IndexedDB.
 */

import { beforeEach, describe, expect, it } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import {
  createDoc,
  deleteDoc,
  getScene,
  listDocs,
  saveScene,
} from "../library";

import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  backupFileName,
  exportBackup,
  importBackup,
  validateBundle,
} from "./backup";

import type { DocScene } from "../types";

const elementOf = (id: string): ExcalidrawElement =>
  ({
    id,
    type: "freedraw",
    x: 10,
    y: 20,
    width: 30,
    height: 40,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: 1,
    version: 3,
    versionNonce: 7,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
    points: [
      [0, 0],
      [5, 5],
    ],
    pressures: [],
    simulatePressure: true,
  } as unknown as ExcalidrawElement);

const sceneOf = (ids: string[]): DocScene => ({
  elements: ids.map(elementOf),
  appState: { viewBackgroundColor: "#ffffff" },
  files: {},
});

const wipeLocal = async () => {
  for (const doc of await listDocs()) {
    await deleteDoc(doc.id);
  }
};

/** Export, then parse the blob back into a plain bundle object. */
const roundTripBundle = async () => {
  const result = await exportBackup();
  return {
    result,
    bundle: JSON.parse(await result.blob.text()) as any,
  };
};

describe("backup", () => {
  beforeEach(async () => {
    await wipeLocal();
  });

  it("round-trips every document and its ink through export and import", async () => {
    const a = await createDoc({ title: "Lecture 1" });
    const b = await createDoc({ title: "Lecture 2" });
    const c = await createDoc({ title: "Empty one" });
    await saveScene(a.id, sceneOf(["a1", "a2", "a3"]));
    await saveScene(b.id, sceneOf(["b1"]));

    const before = await listDocs();
    const sceneABefore = await getScene(a.id);

    const { result, bundle } = await roundTripBundle();
    expect(result.documentCount).toBe(3);
    expect(result.bytes).toBeGreaterThan(0);
    expect(bundle.format).toBe(BACKUP_FORMAT);
    expect(bundle.documents).toHaveLength(3);

    // lose everything, as a wiped browser would
    await wipeLocal();
    expect(await listDocs()).toHaveLength(0);

    const restored = await importBackup(bundle, { mode: "replace" });
    expect(restored.documentsRestored).toBe(3);
    // only two of the three ever had a scene saved; the empty one has none
    expect(restored.scenesRestored).toBe(2);
    expect(restored.warnings).toEqual([]);

    const after = await listDocs();
    expect(after).toHaveLength(3);
    // same ids and titles, regardless of order
    expect(new Set(after.map((d) => d.id))).toEqual(
      new Set(before.map((d) => d.id)),
    );
    expect(after.find((d) => d.id === a.id)?.title).toBe("Lecture 1");
    expect(after.find((d) => d.id === c.id)?.title).toBe("Empty one");

    // the ink survives element for element, ids and all
    const sceneAAfter = await getScene(a.id);
    expect(sceneAAfter?.elements.map((e) => e.id)).toEqual(["a1", "a2", "a3"]);
    expect(sceneAAfter).toEqual(sceneABefore);
    expect((await getScene(b.id))?.elements).toHaveLength(1);
  });

  it("restores a document whose scene was never saved", async () => {
    const doc = await createDoc({ title: "No ink yet" });
    const { bundle } = await roundTripBundle();
    await wipeLocal();

    const restored = await importBackup(bundle, { mode: "replace" });
    expect(restored.documentsRestored).toBe(1);
    expect((await listDocs())[0].title).toBe("No ink yet");
    expect(doc.id).toBe((await listDocs())[0].id);
  });

  it("merge keeps documents that are not in the bundle; replace removes them", async () => {
    const kept = await createDoc({ title: "Already here" });
    await saveScene(kept.id, sceneOf(["k1"]));
    const { bundle } = await roundTripBundle();

    // a second document created after the backup was taken
    await wipeLocal();
    const newer = await createDoc({ title: "Made later" });
    await saveScene(newer.id, sceneOf(["n1"]));

    await importBackup(JSON.parse(JSON.stringify(bundle)), { mode: "merge" });
    let titles = (await listDocs()).map((d) => d.title).sort();
    expect(titles).toEqual(["Already here", "Made later"]);

    await importBackup(JSON.parse(JSON.stringify(bundle)), {
      mode: "replace",
    });
    titles = (await listDocs()).map((d) => d.title).sort();
    expect(titles).toEqual(["Already here"]);
  });

  it("skips a damaged document and still restores the rest", async () => {
    await createDoc({ title: "Good 1" });
    await createDoc({ title: "Good 2" });
    const { bundle } = await roundTripBundle();
    // corrupt one entry the way a truncated or hand-edited file would
    bundle.documents.splice(1, 0, { meta: null, scene: null });
    bundle.documents.push({ notAMeta: true });

    await wipeLocal();
    const restored = await importBackup(bundle, { mode: "replace" });

    expect(restored.documentsRestored).toBe(2);
    expect(restored.warnings).toHaveLength(2);
    expect((await listDocs()).map((d) => d.title).sort()).toEqual([
      "Good 1",
      "Good 2",
    ]);
  });

  describe("validateBundle", () => {
    const good = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      documents: [],
    };

    it("accepts a well-formed bundle", () => {
      expect(() => validateBundle(good)).not.toThrow();
    });

    it.each([
      ["a string", "nope"],
      ["null", null],
      ["an array", []],
    ])("rejects %s", (_label, value) => {
      expect(() => validateBundle(value)).toThrow(/not a notebook backup/i);
    });

    it("rejects a file without the backup marker", () => {
      expect(() =>
        validateBundle({ ...good, format: "something-else" }),
      ).toThrow(/backup marker/i);
    });

    it("rejects a bundle from a newer app rather than half-reading it", () => {
      expect(() =>
        validateBundle({ ...good, version: BACKUP_VERSION + 1 }),
      ).toThrow(/newer version/i);
    });

    it("rejects a bundle with no document list", () => {
      const { documents: _omitted, ...withoutDocuments } = good;
      expect(() => validateBundle(withoutDocuments)).toThrow(/damaged/i);
    });
  });

  it("names the file after the day it was taken", () => {
    expect(backupFileName(new Date("2026-03-07T12:00:00Z"))).toContain(
      "2026-03-07",
    );
  });
});
