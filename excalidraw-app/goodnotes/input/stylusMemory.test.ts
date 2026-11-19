import { beforeEach, describe, expect, it } from "vitest";

import {
  defaultToolForDevice,
  forgetStylusSeen,
  hasSeenStylus,
  rememberStylusSeen,
  STYLUS_SEEN_KEY,
} from "./stylusMemory";

/** A `Storage` that can be made to fail, for the private-browsing case. */
const makeStorage = (failing = false): Storage => {
  const map = new Map<string, string>();
  const boom = () => {
    throw new DOMException("denied", "SecurityError");
  };
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => (failing ? boom() : map.get(key) ?? null),
    setItem: (key: string, value: string) =>
      failing ? boom() : void map.set(key, value),
    removeItem: (key: string) => (failing ? boom() : void map.delete(key)),
  } as Storage;
};

describe("which tool a document opens with", () => {
  it("opens on selection until a stylus has been seen", () => {
    // a one-finger drag on a phone IS a drawing stroke, so Pen-by-default
    // would draw a line every time someone tried to scroll
    expect(defaultToolForDevice(false)).toBe("selection");
  });

  it("opens ready to write once one has", () => {
    expect(defaultToolForDevice(true)).toBe("freedraw");
  });
});

describe("remembering the stylus", () => {
  let storage: Storage;

  beforeEach(() => {
    storage = makeStorage();
  });

  it("starts out not knowing about one", () => {
    expect(hasSeenStylus(storage)).toBe(false);
  });

  it("remembers one across sessions", () => {
    rememberStylusSeen(storage);
    expect(hasSeenStylus(storage)).toBe(true);
    // a fresh read of the same storage is what the next session does
    expect(storage.getItem(STYLUS_SEEN_KEY)).toBe("1");
  });

  it("is idempotent", () => {
    rememberStylusSeen(storage);
    rememberStylusSeen(storage);
    expect(hasSeenStylus(storage)).toBe(true);
  });

  it("can be forgotten again", () => {
    rememberStylusSeen(storage);
    forgetStylusSeen(storage);
    expect(hasSeenStylus(storage)).toBe(false);
  });

  it("treats a junk value as 'no stylus'", () => {
    storage.setItem(STYLUS_SEEN_KEY, "yes please");
    expect(hasSeenStylus(storage)).toBe(false);
  });

  it("answers 'no' rather than throwing when storage is unavailable", () => {
    // private browsing, or a locked-down embed. Selection is usable with
    // every input; the Pen is not, so false is the safe answer.
    const locked = makeStorage(true);
    expect(() => hasSeenStylus(locked)).not.toThrow();
    expect(hasSeenStylus(locked)).toBe(false);
    expect(() => rememberStylusSeen(locked)).not.toThrow();
    expect(() => forgetStylusSeen(locked)).not.toThrow();
  });

  it("is not unset by anything short of forgetting it", () => {
    // someone who owns a stylus still uses a finger sometimes; flipping
    // the default back on touch would make the tool on open unpredictable
    rememberStylusSeen(storage);
    rememberStylusSeen(storage);
    expect(hasSeenStylus(storage)).toBe(true);
  });
});
