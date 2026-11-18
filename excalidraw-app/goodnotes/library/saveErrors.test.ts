/**
 * A scene write that fails must not disappear.
 *
 * `saveSceneDebounced` fires from a timer and `flushSceneSaves` is called
 * for its side effect, so neither has a caller left to reject to. Both used
 * to drop the rejection (`void saveScene(...)`), so a write that failed —
 * the quota exhausted, or Safari evicting the database — lost the strokes
 * while the app went on looking like it was saving.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createDoc,
  deleteDoc,
  flushSceneSaves,
  getScene,
  listDocs,
  saveSceneDebounced,
  subscribeSaveError,
} from "./index";

import type { DocScene } from "../types";

// `vi.hoisted` and `vi.mock` are both lifted above the imports by vitest,
// so they are written here, after them, to keep `import/first` happy.
const hooks = vi.hoisted(() => ({ failKeys: new Set<string>() }));

vi.mock("idb-keyval", async (importOriginal) => {
  const actual = await importOriginal<typeof import("idb-keyval")>();
  return {
    ...actual,
    set: (key: any, value: any, store: any) =>
      hooks.failKeys.has(String(key))
        ? Promise.reject(new DOMException("quota", "QuotaExceededError"))
        : actual.set(key, value, store),
  };
});

const scene: DocScene = { elements: [], appState: {}, files: {} };

describe("scene save failures", () => {
  beforeEach(async () => {
    hooks.failKeys.clear();
    for (const doc of await listDocs()) {
      await deleteDoc(doc.id);
    }
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("reports a failed flush instead of rejecting into nowhere", async () => {
    const doc = await createDoc({ title: "Doomed" });
    const seen: string[] = [];
    const stop = subscribeSaveError((docId) => seen.push(docId));
    hooks.failKeys.add(doc.id);

    saveSceneDebounced(doc.id, scene, 0);
    // must RESOLVE, not reject — every call site ignores the result, so a
    // rejection here would be an unhandled one
    await expect(flushSceneSaves()).resolves.toBeUndefined();

    expect(seen).toEqual([doc.id]);
    stop();
  });

  it("reports a failed debounced write once its timer fires", async () => {
    const doc = await createDoc({ title: "Also doomed" });
    const seen: string[] = [];
    const stop = subscribeSaveError((docId) => seen.push(docId));
    hooks.failKeys.add(doc.id);

    saveSceneDebounced(doc.id, scene, 1);
    await vi.waitFor(() => expect(seen).toEqual([doc.id]));
    stop();
  });

  it("still writes the other documents when one of them fails", async () => {
    const ok = await createDoc({ title: "Fine" });
    const bad = await createDoc({ title: "Broken" });
    const seen: string[] = [];
    const stop = subscribeSaveError((docId) => seen.push(docId));
    hooks.failKeys.add(bad.id);

    saveSceneDebounced(ok.id, { ...scene, appState: { kept: true } as any }, 0);
    saveSceneDebounced(bad.id, scene, 0);
    await flushSceneSaves();

    expect(seen).toEqual([bad.id]);
    // the healthy document really did land, it was not abandoned with it
    expect(await getScene(ok.id)).not.toBeNull();
    stop();
  });

  it("unsubscribing stops the reports", async () => {
    const doc = await createDoc({ title: "Quiet" });
    const seen: string[] = [];
    subscribeSaveError((docId) => seen.push(docId))();
    hooks.failKeys.add(doc.id);

    saveSceneDebounced(doc.id, scene, 0);
    await flushSceneSaves();

    expect(seen).toEqual([]);
  });
});
