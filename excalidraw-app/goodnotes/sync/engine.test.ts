/**
 * Engine tests.
 *
 * These run against the REAL local library (`goodnotes/library`, on
 * `fake-indexeddb`) and a fake server that enforces the same version guard
 * Postgres does. The second device is simulated by writing to that server
 * exactly as its engine would have — which is all a second device is, from
 * this device's point of view.
 */

import { beforeEach, describe, expect, it } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import {
  createDoc,
  deleteDoc,
  getScene,
  listDocs,
  saveScene,
  updateDocMeta,
} from "../library";

import { CONFLICT_TAG, countPending, syncAll } from "./engine";
import { clearStates, loadStates } from "./state";
import { createFakeBackend } from "./testing/fakeBackend";

import type { DocScene } from "../types";
import type { FakeServer } from "./testing/fakeBackend";

/** A stand-in for one ink stroke: only the fields the hash reads matter. */
const stroke = (id: string, version = 1): ExcalidrawElement =>
  ({
    id,
    type: "freedraw",
    version,
    versionNonce: version * 7919,
    isDeleted: false,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
  } as unknown as ExcalidrawElement);

const sceneOf = (ids: string[], files: DocScene["files"] = {}): DocScene => ({
  elements: ids.map((id) => stroke(id)),
  appState: {},
  files,
});

const strokeIds = (scene: DocScene | null) =>
  (scene?.elements ?? []).map((element) => element.id).sort();

const run = (backend: FakeServer, activeDocId: string | null = null) =>
  syncAll({ backend, device: "Laptop", activeDocId });

const wipeLocal = async () => {
  for (const doc of await listDocs()) {
    await deleteDoc(doc.id);
  }
  await clearStates();
};

describe("sync engine", () => {
  let server: FakeServer;

  beforeEach(async () => {
    await wipeLocal();
    server = createFakeBackend();
  });

  it("pushes a new document, then does nothing on a clean pass", async () => {
    const doc = await createDoc({ title: "Lecture 4" });
    await saveScene(doc.id, sceneOf(["a"]));

    const first = await run(server);
    expect(first.pushed).toEqual([doc.id]);
    expect(server.rows.get(doc.id)?.version).toBe(1);
    expect(server.rows.get(doc.id)?.title).toBe("Lecture 4");
    expect(server.counts.putScene).toBe(1);

    const second = await run(server);
    expect(second).toMatchObject({ pushed: [], pulled: [], conflicts: [] });
    // the fast path must not even read the scene back out
    expect(server.counts.putScene).toBe(1);
  });

  it("pulls a document this device has never seen", async () => {
    // device B creates a notebook
    const other = createFakeBackend();
    const docB = await createDoc({ title: "From the iPad" });
    await saveScene(docB.id, sceneOf(["ipad-1"]));
    await syncAll({ backend: server, device: "iPad" });
    void other;

    // this device forgets everything local, keeping only the server
    await wipeLocal();
    expect(await listDocs()).toHaveLength(0);

    const report = await run(server);
    expect(report.pulled).toEqual([docB.id]);

    const docs = await listDocs();
    expect(docs.map((it) => it.title)).toEqual(["From the iPad"]);
    expect(strokeIds(await getScene(docB.id))).toEqual(["ipad-1"]);
  });

  it("round-trips binary files through the file store, not the row", async () => {
    const doc = await createDoc({ title: "Scanned notes" });
    const file = {
      id: "file-1",
      mimeType: "image/png",
      dataURL: "data:image/png;base64,AAAA",
      created: 1,
    } as unknown as DocScene["files"][string];
    await saveScene(doc.id, sceneOf(["a"], { "file-1": file }));

    await run(server);
    expect(server.counts.putFile).toBe(1);
    expect(server.files.has("file-1")).toBe(true);
    // the scene blob references the file, it does not contain it
    const payload = [...server.scenes.values()][0];
    expect(payload.fileIds).toEqual(["file-1"]);
    expect(JSON.stringify(payload)).not.toContain("base64,AAAA");

    await wipeLocal();
    await run(server);
    const restored = await getScene(doc.id);
    expect(restored?.files["file-1"]?.dataURL).toBe(
      "data:image/png;base64,AAAA",
    );
  });

  it("forks a conflict copy and keeps BOTH sets of ink", async () => {
    // 1. both devices agree on version 1, which holds stroke "shared"
    const doc = await createDoc({ title: "Lecture 4" });
    await saveScene(doc.id, sceneOf(["shared"]));
    await run(server);
    expect(server.rows.get(doc.id)?.version).toBe(1);

    // 2. the iPad adds a stroke and pushes version 2 (it has the same base)
    const base = server.rows.get(doc.id)!;
    server.scenes.set(base.scenePath!, {
      v: 1,
      elements: [stroke("shared"), stroke("ipad-only")],
      appState: {},
      fileIds: [],
    });
    server.rows.set(doc.id, {
      ...base,
      version: 2,
      device: "iPad",
      contentHash: "ipad-hash",
    });

    // 3. meanwhile this device draws something else, offline
    await saveScene(doc.id, sceneOf(["shared", "laptop-only"]));

    // 4. the pass that has to choose
    const report = await run(server);

    expect(report.conflicts).toHaveLength(1);
    const conflict = report.conflicts[0];
    expect(conflict.docId).toBe(doc.id);
    expect(conflict.fromDevice).toBe("iPad");
    expect(conflict.copyTitle).toBe("Lecture 4 (conflict from iPad)");

    // the document the user was working in is untouched...
    expect(strokeIds(await getScene(doc.id))).toEqual([
      "laptop-only",
      "shared",
    ]);

    // ...and the iPad's version is sitting next to it, in full
    const docs = await listDocs();
    const copy = docs.find((it) => it.id === conflict.copyId)!;
    expect(copy.title).toBe("Lecture 4 (conflict from iPad)");
    expect(copy.tags).toContain(CONFLICT_TAG);
    expect(strokeIds(await getScene(copy.id))).toEqual(["ipad-only", "shared"]);

    // both halves exist on the server too, so the iPad gets them back
    expect(server.rows.get(doc.id)?.version).toBe(3);
    expect(server.rows.get(copy.id)).toBeTruthy();
    const copyPayload = server.scenes.get(
      server.rows.get(copy.id)!.scenePath!,
    )!;
    expect(copyPayload.elements.map((it) => it.id).sort()).toEqual([
      "ipad-only",
      "shared",
    ]);

    // and a following pass is quiet: the fork actually resolved it
    const after = await run(server);
    expect(after.conflicts).toEqual([]);
    expect(after.pushed).toEqual([]);
    expect(after.pulled).toEqual([]);
  });

  it("defers a remote update to the document that is open in the editor", async () => {
    const doc = await createDoc({ title: "Open right now" });
    await saveScene(doc.id, sceneOf(["a"]));
    await run(server);

    const base = server.rows.get(doc.id)!;
    server.scenes.set(base.scenePath!, {
      v: 1,
      elements: [stroke("a"), stroke("b")],
      appState: {},
      fileIds: [],
    });
    server.rows.set(doc.id, { ...base, version: 2, contentHash: "other" });

    const deferredPass = await run(server, doc.id);
    expect(deferredPass.deferred).toEqual([doc.id]);
    expect(strokeIds(await getScene(doc.id))).toEqual(["a"]);

    // close the document and the next pass applies it
    const applied = await run(server, null);
    expect(applied.pulled).toEqual([doc.id]);
    expect(strokeIds(await getScene(doc.id))).toEqual(["a", "b"]);
  });

  it("propagates a local delete as a tombstone", async () => {
    const doc = await createDoc({ title: "Doomed" });
    await saveScene(doc.id, sceneOf(["a"]));
    const keeper = await createDoc({ title: "Keeper" });
    await saveScene(keeper.id, sceneOf(["k"]));
    await run(server);

    await deleteDoc(doc.id);
    const pass = await run(server);
    expect(pass.deletedRemotely).toEqual([doc.id]);
    expect(server.rows.get(doc.id)?.deletedAt).toBeTruthy();
    // the other notebook is untouched
    expect(server.rows.get(keeper.id)?.deletedAt).toBeNull();
  });

  it("applies another device's delete locally when there is no unsynced work", async () => {
    const doc = await createDoc({ title: "Deleted on the iPad" });
    await saveScene(doc.id, sceneOf(["a"]));
    await run(server);

    const row = server.rows.get(doc.id)!;
    server.rows.set(doc.id, {
      ...row,
      version: row.version + 1,
      deletedAt: Date.now(),
      scenePath: null,
      device: "iPad",
    });

    const report = await run(server);
    expect(report.deletedLocally).toEqual([doc.id]);
    expect((await listDocs()).map((it) => it.id)).not.toContain(doc.id);
  });

  it("resurrects rather than deletes when the local copy has unsynced work", async () => {
    const doc = await createDoc({ title: "Still editing" });
    await saveScene(doc.id, sceneOf(["a"]));
    await run(server);

    // another device deletes it...
    const row = server.rows.get(doc.id)!;
    server.rows.set(doc.id, {
      ...row,
      version: row.version + 1,
      deletedAt: Date.now(),
      scenePath: null,
    });
    // ...while this one is still drawing
    await saveScene(doc.id, sceneOf(["a", "b"]));

    const report = await run(server);
    expect(report.pushed).toEqual([doc.id]);
    expect(report.deletedLocally).toEqual([]);
    expect(server.rows.get(doc.id)?.deletedAt).toBeNull();
    expect(strokeIds(await getScene(doc.id))).toEqual(["a", "b"]);
  });

  it("refuses to tombstone the whole library when local storage is wiped", async () => {
    const a = await createDoc({ title: "A" });
    await saveScene(a.id, sceneOf(["a"]));
    const b = await createDoc({ title: "B" });
    await saveScene(b.id, sceneOf(["b"]));
    await run(server);

    // Safari evicts the docs database but leaves the watermarks behind
    await deleteDoc(a.id);
    await deleteDoc(b.id);
    expect((await loadStates()).size).toBe(2);

    const report = await run(server);
    expect(report.deletedRemotely).toEqual([]);
    expect(report.pulled.sort()).toEqual([a.id, b.id].sort());
    expect(server.rows.get(a.id)?.deletedAt).toBeNull();
    expect((await listDocs()).map((it) => it.title).sort()).toEqual(["A", "B"]);
  });

  it("survives the network dying mid-pass without touching local data", async () => {
    const doc = await createDoc({ title: "Offline" });
    await saveScene(doc.id, sceneOf(["a"]));

    server.failNext(1);
    await expect(run(server)).rejects.toThrow();

    // local data is exactly as it was, and the document is still pending
    expect(strokeIds(await getScene(doc.id))).toEqual(["a"]);
    expect(await countPending()).toBe(1);

    const report = await run(server);
    expect(report.pushed).toEqual([doc.id]);
    expect(await countPending()).toBe(0);
  });

  it("syncs a metadata-only change (rename, due date, tags)", async () => {
    const doc = await createDoc({ title: "Untitled notebook" });
    await saveScene(doc.id, sceneOf(["a"]));
    await run(server);

    await updateDocMeta(doc.id, {
      title: "Organic chemistry",
      course: "CHEM 210",
      tags: ["exam"],
    });
    const report = await run(server);
    expect(report.pushed).toEqual([doc.id]);
    const row = server.rows.get(doc.id)!;
    expect(row.title).toBe("Organic chemistry");
    expect(row.course).toBe("CHEM 210");
    expect(row.tags).toEqual(["exam"]);
    expect(row.version).toBe(2);
  });

  it("counts pending documents without reading scenes", async () => {
    const doc = await createDoc({ title: "One" });
    await saveScene(doc.id, sceneOf(["a"]));
    expect(await countPending()).toBe(1);
    await run(server);
    expect(await countPending()).toBe(0);
    await saveScene(doc.id, sceneOf(["a", "b"]));
    expect(await countPending()).toBe(1);
  });
});
