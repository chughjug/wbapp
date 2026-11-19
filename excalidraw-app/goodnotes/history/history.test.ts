import { clear, createStore, set } from "idb-keyval";
import { beforeEach, describe, expect, it } from "vitest";

import { createDoc, deleteDoc, getScene, saveScene } from "../library/store";

import {
  HISTORY_RETENTION_MS,
  shouldSnapshot,
  SNAPSHOT_INTERVAL_MS,
  snapshotsToDrop,
} from "./policy";
import { restoreSnapshot } from "./restore";
import {
  forgetHistory,
  getSnapshot,
  listSnapshots,
  purgeExpiredHistory,
  setSnapshotPinned,
  takeSnapshot,
} from "./store";

import type { DocScene } from "../types";

const metaStore = createStore("goodnotes", "docs");
const sceneStore = createStore("goodnotes-scenes", "scenes");
const historyStore = createStore("goodnotes-history", "versions");

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A scene with one text element, so versions are distinguishable. */
const sceneSaying = (text: string, pages = 1): DocScene => ({
  elements: [
    ...Array.from({ length: pages }, (_, index) => ({
      id: `page-${index + 1}`,
      type: "frame",
      name: `page:${index + 1}`,
      isDeleted: false,
      frameId: null,
      version: 1,
    })),
    {
      id: "t1",
      type: "text",
      text,
      isDeleted: false,
      frameId: "page-1",
      version: 1,
    },
  ] as any,
  appState: {},
  files: {},
});

describe("the snapshot rate limit", () => {
  it("always snapshots a document that has no history", () => {
    expect(shouldSnapshot(null, 1_000)).toBe(true);
  });

  it("refuses a second snapshot inside the interval", () => {
    const at = 10 * HOUR;
    expect(shouldSnapshot(at, at + SNAPSHOT_INTERVAL_MS - 1)).toBe(false);
    expect(shouldSnapshot(at, at + SNAPSHOT_INTERVAL_MS)).toBe(true);
  });
});

describe("thinning", () => {
  const headers = (...ats: number[]) => ats.map((at) => ({ id: `s${at}`, at }));

  it("keeps everything when each snapshot is in its own bucket", () => {
    const now = 100 * DAY;
    // one per hour across the last few hours: the <=1h band keeps one per
    // 5 min, the <=1d band one per hour — so all of these survive
    const list = headers(now - 10 * MINUTE, now - 2 * HOUR, now - 5 * HOUR);
    expect(snapshotsToDrop(list, now)).toEqual([]);
  });

  it("drops all but the newest of a crowded bucket", () => {
    const now = 100 * DAY;
    // four snapshots inside one 5-minute bucket, 30s apart
    const base = Math.floor((now - 2 * MINUTE) / (5 * MINUTE)) * (5 * MINUTE);
    const list = headers(base + 10, base + 40, base + 70, base + 100);
    const dropped = snapshotsToDrop(list, now);
    expect(dropped).toHaveLength(3);
    expect(dropped).not.toContain(`s${base + 100}`);
  });

  it("thins last week to one a day but keeps the hour dense", () => {
    const now = 100 * DAY;
    // Three days back the band is one per 6 hours, so the old trio has to
    // sit inside a single 6-hour bucket to be a fair test of thinning
    // rather than of where the bucket boundaries happen to fall.
    const sixHours = 6 * HOUR;
    const oldBucketStart =
      Math.floor((now - 3 * DAY) / sixHours) * sixHours + 1 * HOUR;
    const list = headers(
      now - 1 * MINUTE,
      now - 7 * MINUTE,
      now - 13 * MINUTE,
      oldBucketStart,
      oldBucketStart + 10 * MINUTE,
      oldBucketStart + 20 * MINUTE,
    );
    const dropped = snapshotsToDrop(list, now);
    // newest of that bucket survives, the two below it go
    expect(dropped).toContain(`s${oldBucketStart}`);
    expect(dropped).toContain(`s${oldBucketStart + 10 * MINUTE}`);
    expect(dropped).not.toContain(`s${oldBucketStart + 20 * MINUTE}`);
    // the recent three are each in their own 5-minute bucket
    expect(dropped).not.toContain(`s${now - 1 * MINUTE}`);
    expect(dropped).not.toContain(`s${now - 7 * MINUTE}`);
    expect(dropped).not.toContain(`s${now - 13 * MINUTE}`);
  });

  it("never drops a pinned snapshot, however crowded", () => {
    const now = 100 * DAY;
    const at = now - 30 * MINUTE;
    const list = [
      { id: "newest", at: now - 1 * MINUTE },
      { id: "pinned", at, pinned: true },
      { id: "sibling", at: at + 10 },
      { id: "ancient", at: now - 10 * 365 * DAY, pinned: true },
    ];
    const dropped = snapshotsToDrop(list, now);
    expect(dropped).not.toContain("pinned");
    expect(dropped).not.toContain("ancient");
    expect(dropped).toContain("sibling");
  });

  it("keeps the newest snapshot even when it has aged out entirely", () => {
    const now = 100 * DAY;
    const list = headers(now - HISTORY_RETENTION_MS - DAY);
    expect(snapshotsToDrop(list, now)).toEqual([]);
  });

  it("lets the newest claim its bucket rather than giving it a free pass", () => {
    const now = 100 * DAY;
    // two snapshots seconds apart: the newest is kept, its neighbour is not
    const list = headers(now - 60_000, now - 50_000);
    expect(snapshotsToDrop(list, now)).toEqual([`s${now - 60_000}`]);
  });
});

describe("version history", () => {
  beforeEach(async () => {
    await clear(metaStore);
    await clear(sceneStore);
    await clear(historyStore);
  });

  it("snapshots a document the first time it is saved", async () => {
    const doc = await createDoc({ title: "Thermo" });
    await saveScene(doc.id, sceneSaying("entropy"));

    const versions = await listSnapshots(doc.id);
    expect(versions).toHaveLength(1);
    expect(versions[0].reason).toBe("auto");
    expect(versions[0].pageCount).toBe(1);
  });

  it("does not snapshot again on every keystroke-driven save", async () => {
    const doc = await createDoc({ title: "Thermo" });
    await saveScene(doc.id, sceneSaying("one"));
    await saveScene(doc.id, sceneSaying("two"));
    await saveScene(doc.id, sceneSaying("three"));

    expect(await listSnapshots(doc.id)).toHaveLength(1);
  });

  it("puts an old scene back, and keeps what it replaced", async () => {
    const doc = await createDoc({ title: "Thermo" });
    await saveScene(doc.id, sceneSaying("the good version"));

    const [original] = await listSnapshots(doc.id);

    // the accident: half the page erased, autosave writes it over
    await saveScene(doc.id, sceneSaying("oops"));
    expect((await getScene(doc.id))!.elements).toContainEqual(
      expect.objectContaining({ text: "oops" }),
    );

    const result = await restoreSnapshot(original.id);

    expect(result).not.toBeNull();
    const now = await getScene(doc.id);
    expect(now!.elements).toContainEqual(
      expect.objectContaining({ text: "the good version" }),
    );
    // and the damage is itself recoverable, so a mis-tap here is not final
    expect(result!.undo).not.toBeNull();
    expect(result!.undo!.reason).toBe("before-restore");
    expect(result!.undo!.pinned).toBe(true);
    expect(result!.undo!.scene.elements).toContainEqual(
      expect.objectContaining({ text: "oops" }),
    );
  });

  it("can undo a restore by restoring the snapshot it left behind", async () => {
    const doc = await createDoc({ title: "Thermo" });
    await saveScene(doc.id, sceneSaying("first"));
    const [original] = await listSnapshots(doc.id);
    await saveScene(doc.id, sceneSaying("second"));

    const result = await restoreSnapshot(original.id);
    await restoreSnapshot(result!.undo!.id);

    expect((await getScene(doc.id))!.elements).toContainEqual(
      expect.objectContaining({ text: "second" }),
    );
  });

  it("returns null for a snapshot that thinning already took", async () => {
    expect(await restoreSnapshot("nobody\u00000000000000000001")).toBeNull();
  });

  it("pins and unpins", async () => {
    const doc = await createDoc({ title: "Thermo" });
    const snapshot = await takeSnapshot(doc.id, sceneSaying("x"), 1000);
    expect(await setSnapshotPinned(snapshot.id, true)).toBe(true);
    expect((await getSnapshot(snapshot.id))!.pinned).toBe(true);
    expect(await setSnapshotPinned(snapshot.id, false)).toBe(true);
    expect((await getSnapshot(snapshot.id))!.pinned).toBe(false);
    expect(await setSnapshotPinned("missing", true)).toBe(false);
  });

  it("forgets the history of a document deleted for real", async () => {
    const doc = await createDoc({ title: "Thermo" });
    await saveScene(doc.id, sceneSaying("private"));
    expect(await listSnapshots(doc.id)).toHaveLength(1);

    await deleteDoc(doc.id);

    expect(await listSnapshots(doc.id)).toHaveLength(0);
  });

  it("keeps one document's history out of another's list", async () => {
    const a = await createDoc({ title: "A" });
    const b = await createDoc({ title: "B" });
    await takeSnapshot(a.id, sceneSaying("a"), 1000);
    await takeSnapshot(b.id, sceneSaying("b"), 2000);

    expect(await listSnapshots(a.id)).toHaveLength(1);
    expect(await forgetHistory(a.id)).toBe(1);
    expect(await listSnapshots(b.id)).toHaveLength(1);
  });

  it("lists newest first", async () => {
    const doc = await createDoc({ title: "Thermo" });
    // spaced wider than one 5-minute bucket, or thinning would collapse
    // them into a single snapshot — which it should, and does
    const base = 1_000 * DAY;
    await takeSnapshot(doc.id, sceneSaying("old"), base);
    await takeSnapshot(doc.id, sceneSaying("mid"), base + 6 * MINUTE);
    await takeSnapshot(doc.id, sceneSaying("new"), base + 12 * MINUTE);

    expect((await listSnapshots(doc.id)).map((s) => s.at)).toEqual([
      base + 12 * MINUTE,
      base + 6 * MINUTE,
      base,
    ]);
  });

  it("purges history past the retention window but strands no document", async () => {
    // Seeded straight into the store rather than through `takeSnapshot`,
    // because `takeSnapshot` thins as it writes. The state this purge is
    // for is a document last saved months ago, whose history has therefore
    // had no thinning pass run over it since: only a library load reaches
    // it, and that is what calls `purgeExpiredHistory`.
    const now = 1_000 * DAY;
    const seed = async (docId: string, at: number) =>
      set(
        `${docId}\u0000${String(at).padStart(16, "0")}`,
        {
          id: `${docId}\u0000${String(at).padStart(16, "0")}`,
          docId,
          at,
          reason: "auto",
          pageCount: 1,
          scene: sceneSaying("x"),
        },
        historyStore,
      );

    await seed("stale", now - 400 * DAY);
    await seed("stale", now - 300 * DAY);
    await seed("stale", now - 2 * DAY);
    // a document with nothing but an ancient snapshot keeps it
    await seed("lonely", now - 900 * DAY);

    const dropped = await purgeExpiredHistory(now);

    expect(dropped).toBe(2);
    expect((await listSnapshots("stale")).map((s) => s.at)).toEqual([
      now - 2 * DAY,
    ]);
    expect(await listSnapshots("lonely")).toHaveLength(1);
  });
});
