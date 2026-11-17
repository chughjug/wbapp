import { afterEach, describe, expect, it } from "vitest";

import {
  appendSnapshot,
  listSnapshots,
  openCrdtDoc,
  readRole,
  setRole,
} from "./docStore";

const handles: Array<ReturnType<typeof openCrdtDoc>> = [];

afterEach(() => {
  while (handles.length) {
    handles.pop()?.destroy();
  }
});

describe("crdt docStore", () => {
  it("defaults role to owner and stores snapshots newest-first", async () => {
    const handle = openCrdtDoc(`test-${Date.now()}`);
    handles.push(handle);
    await handle.whenSynced;

    expect(readRole(handle)).toBe("owner");
    setRole(handle, "editor");
    expect(readRole(handle)).toBe("editor");

    appendSnapshot(handle, { label: "first", payload: "{\"a\":1}" });
    appendSnapshot(handle, { label: "second", payload: "{\"a\":2}" });

    const snaps = listSnapshots(handle);
    expect(snaps).toHaveLength(2);
    expect(snaps[0].label).toBe("second");
    expect(snaps[1].label).toBe("first");
  });

  it("caps retained history", async () => {
    const handle = openCrdtDoc(`test-cap-${Date.now()}`);
    handles.push(handle);
    await handle.whenSynced;

    for (let i = 0; i < 5; i++) {
      appendSnapshot(handle, {
        label: `v${i}`,
        payload: String(i),
        keep: 3,
      });
    }

    expect(listSnapshots(handle)).toHaveLength(3);
    expect(listSnapshots(handle).map((s) => s.label)).toEqual([
      "v4",
      "v3",
      "v2",
    ]);
  });
});
