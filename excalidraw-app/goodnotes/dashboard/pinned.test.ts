import { describe, expect, it } from "vitest";

import { isFavourite } from "../library/filters";

import { MAX_PINNED_SHOWN, orderPinned } from "./PinnedStrip";

import type { DocMeta } from "../types";

const HOUR = 60 * 60 * 1000;

const doc = (props: Partial<DocMeta> & { id: string }): DocMeta =>
  ({
    title: props.id,
    course: null,
    dueDate: null,
    tags: [],
    createdAt: 0,
    updatedAt: 0,
    lastOpenedAt: null,
    thumbnail: null,
    pageCount: 1,
    defaultTemplate: "blank",
    defaultPageSize: "a4",
    ...props,
  } as DocMeta);

describe("the pinned row", () => {
  it("puts the most recently opened first", () => {
    const docs = [
      doc({ id: "old", lastOpenedAt: 1 * HOUR }),
      doc({ id: "newest", lastOpenedAt: 9 * HOUR }),
      doc({ id: "middle", lastOpenedAt: 5 * HOUR }),
    ];
    expect(orderPinned(docs).map((d) => d.id)).toEqual([
      "newest",
      "middle",
      "old",
    ]);
  });

  it("falls back to last edited for a notebook never opened since starring", () => {
    const docs = [
      doc({ id: "opened", lastOpenedAt: 2 * HOUR, updatedAt: 2 * HOUR }),
      doc({ id: "never-opened", lastOpenedAt: null, updatedAt: 7 * HOUR }),
    ];
    expect(orderPinned(docs).map((d) => d.id)).toEqual([
      "never-opened",
      "opened",
    ]);
  });

  it("caps the row so it stays a glance rather than a list", () => {
    const docs = Array.from({ length: 20 }, (_, index) =>
      doc({ id: `d${index}`, lastOpenedAt: index * HOUR }),
    );
    expect(orderPinned(docs)).toHaveLength(MAX_PINNED_SHOWN);
    // and it is the most recent ones that survive the cap
    expect(orderPinned(docs)[0].id).toBe("d19");
  });

  it("does not mutate the array it is given", () => {
    const docs = [
      doc({ id: "a", lastOpenedAt: 1 }),
      doc({ id: "b", lastOpenedAt: 9 }),
    ];
    orderPinned(docs);
    expect(docs.map((d) => d.id)).toEqual(["a", "b"]);
  });

  it("is driven by the same favourite tag the shelf's star uses", () => {
    // the row must not invent a second notion of "pinned"; a notebook
    // starred on a card has to show up here and nowhere else
    const starred = doc({ id: "s", tags: ["favourite", "exam"] });
    const plain = doc({ id: "p", tags: ["exam"] });

    expect(isFavourite(starred)).toBe(true);
    expect(isFavourite(plain)).toBe(false);
    expect(orderPinned([starred, plain].filter(isFavourite))).toHaveLength(1);
  });

  it("handles an empty list", () => {
    expect(orderPinned([])).toEqual([]);
  });
});
