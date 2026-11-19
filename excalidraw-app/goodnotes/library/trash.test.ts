import { beforeEach, describe, expect, it } from "vitest";
import { createStore, clear } from "idb-keyval";

import {
  createDoc,
  deleteDoc,
  getDoc,
  getScene,
  listDocs,
  purgeExpiredTrash,
  restoreDoc,
  restoreManyDocs,
  saveScene,
  trashDoc,
  trashManyDocs,
} from "./store";
import {
  daysLeftInTrash,
  isInView,
  isTrashed,
  TRASH_RETENTION_MS,
  trashExpiresAt,
} from "./filters";

import type { DocMeta } from "../types";

const metaStore = createStore("goodnotes", "docs");
const sceneStore = createStore("goodnotes-scenes", "scenes");

const DAY = 24 * 60 * 60 * 1000;

const scene = () => ({
  elements: [
    {
      id: "t1",
      type: "text",
      text: "eigenvalue",
      isDeleted: false,
      frameId: null,
      version: 1,
    } as any,
  ],
  appState: {},
  files: {},
});

describe("the trash", () => {
  beforeEach(async () => {
    await clear(metaStore);
    await clear(sceneStore);
  });

  it("keeps the scene when a document is deleted", async () => {
    const doc = await createDoc({ title: "Linear algebra" });
    await saveScene(doc.id, scene());

    await trashDoc(doc.id);

    const stored = await getDoc(doc.id);
    expect(isTrashed(stored!)).toBe(true);
    // the whole point: nothing is destroyed
    expect((await getScene(doc.id))?.elements).toHaveLength(1);
  });

  it("puts it back exactly as it was", async () => {
    const doc = await createDoc({ title: "Thermo", course: "PHYS 210" });
    await saveScene(doc.id, scene());
    await trashDoc(doc.id);

    const restored = await restoreDoc(doc.id);

    expect(restored && isTrashed(restored)).toBe(false);
    expect(restored?.title).toBe("Thermo");
    expect(restored?.course).toBe("PHYS 210");
    expect((await getScene(doc.id))?.elements).toHaveLength(1);
  });

  it("does not change updatedAt, so a restore lands where it belongs", async () => {
    const doc = await createDoc({ title: "A" });
    const before = (await getDoc(doc.id))!.updatedAt;
    await trashDoc(doc.id);
    await restoreDoc(doc.id);
    expect((await getDoc(doc.id))!.updatedAt).toBe(before);
  });

  it("is idempotent, and never re-stamps an already-trashed document", async () => {
    const doc = await createDoc({ title: "A" });
    await trashDoc(doc.id, 1000);
    await trashDoc(doc.id, 9999);
    expect((await getDoc(doc.id))!.deletedAt).toBe(1000);
  });

  it("restoring something that is not trashed does nothing", async () => {
    const doc = await createDoc({ title: "A" });
    const same = await restoreDoc(doc.id);
    expect(same?.id).toBe(doc.id);
    expect(isTrashed(same!)).toBe(false);
  });

  it("hides a trashed document from every view except the trash", async () => {
    const doc = { ...(await createDoc({ title: "A" })), deletedAt: 1 };
    const now = Date.now();
    for (const filter of [
      { kind: "all" },
      { kind: "recent" },
      { kind: "favourites" },
      { kind: "archived" },
      { kind: "due-week" },
    ] as const) {
      expect(isInView(doc as DocMeta, filter, now)).toBe(false);
    }
    expect(isInView(doc as DocMeta, { kind: "trash" }, now)).toBe(true);
  });

  it("shows only trashed documents in the trash", async () => {
    const live = await createDoc({ title: "live" });
    expect(isInView(live, { kind: "trash" }, Date.now())).toBe(false);
  });

  it("purges only what is past the retention window", async () => {
    const old = await createDoc({ title: "old" });
    const fresh = await createDoc({ title: "fresh" });
    const live = await createDoc({ title: "live" });
    const now = Date.now();
    await trashDoc(old.id, now - 31 * DAY);
    await trashDoc(fresh.id, now - 2 * DAY);

    const purged = await purgeExpiredTrash(now - TRASH_RETENTION_MS);

    expect(purged).toEqual([old.id]);
    const ids = (await listDocs()).map((doc) => doc.id).sort();
    expect(ids).toEqual([fresh.id, live.id].sort());
    // and the purge really took the payload with it
    expect(await getScene(old.id)).toBeNull();
  });

  it("purges nothing when the trash is empty", async () => {
    await createDoc({ title: "live" });
    expect(await purgeExpiredTrash(Date.now())).toEqual([]);
  });

  it("counts the days left honestly", () => {
    const now = Date.now();
    const doc = { deletedAt: now } as DocMeta;
    expect(trashExpiresAt(doc)).toBe(now + TRASH_RETENTION_MS);
    expect(daysLeftInTrash(doc, now)).toBe(30);
    expect(
      daysLeftInTrash({ deletedAt: now - 29.5 * DAY } as DocMeta, now),
    ).toBe(1);
    // an expired one reads 0, never a negative number
    expect(daysLeftInTrash({ deletedAt: now - 60 * DAY } as DocMeta, now)).toBe(
      0,
    );
    expect(daysLeftInTrash({} as DocMeta, now)).toBe(0);
  });

  it("moves and restores in bulk, skipping what is already there", async () => {
    const a = await createDoc({ title: "a" });
    const b = await createDoc({ title: "b" });
    await trashDoc(a.id);

    expect(await trashManyDocs([a.id, b.id])).toBe(1);
    expect(await restoreManyDocs([a.id, b.id])).toBe(2);
    expect((await listDocs()).every((doc) => !isTrashed(doc))).toBe(true);
  });

  it("still has a hard delete, for the purge and for emptying the trash", async () => {
    const doc = await createDoc({ title: "a" });
    await saveScene(doc.id, scene());
    await deleteDoc(doc.id);
    expect(await getDoc(doc.id)).toBeNull();
    expect(await getScene(doc.id)).toBeNull();
  });
});
