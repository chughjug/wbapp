import { describe, expect, it } from "vitest";

import {
  FAVOURITE_TAG,
  isFavourite,
  isPinned,
  PINNED_TAG,
} from "../library/filters";

import { MAX_FAVOURITES_SHOWN, orderFavourites } from "./FavouritesStrip";

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

describe("the favourites row", () => {
  it("puts the most recently opened first", () => {
    const docs = [
      doc({ id: "old", lastOpenedAt: 1 * HOUR }),
      doc({ id: "newest", lastOpenedAt: 9 * HOUR }),
      doc({ id: "middle", lastOpenedAt: 5 * HOUR }),
    ];
    expect(orderFavourites(docs).map((d) => d.id)).toEqual([
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
    expect(orderFavourites(docs).map((d) => d.id)).toEqual([
      "never-opened",
      "opened",
    ]);
  });

  it("caps the row so it stays a glance rather than a list", () => {
    const docs = Array.from({ length: 20 }, (_, index) =>
      doc({ id: `d${index}`, lastOpenedAt: index * HOUR }),
    );
    expect(orderFavourites(docs)).toHaveLength(MAX_FAVOURITES_SHOWN);
    // and it is the most recent ones that survive the cap
    expect(orderFavourites(docs)[0].id).toBe("d19");
  });

  it("does not mutate the array it is given", () => {
    const docs = [
      doc({ id: "a", lastOpenedAt: 1 }),
      doc({ id: "b", lastOpenedAt: 9 }),
    ];
    orderFavourites(docs);
    expect(docs.map((d) => d.id)).toEqual(["a", "b"]);
  });

  it("is driven by the same favourite tag the shelf's star uses", () => {
    // The library also has a separate `pinned` tag ("Pin to the top"),
    // and an earlier draft of this row was headed "Pinned" while reading
    // `favourite` — so the two features collided. This row is Favourites
    // and reads the star; nothing here may read PINNED_TAG.
    const starred = doc({ id: "s", tags: ["favourite", "exam"] });
    const plain = doc({ id: "p", tags: ["exam"] });

    expect(isFavourite(starred)).toBe(true);
    expect(isFavourite(plain)).toBe(false);
    expect(orderFavourites([starred, plain].filter(isFavourite))).toHaveLength(
      1,
    );
  });

  it("handles an empty list", () => {
    expect(orderFavourites([])).toEqual([]);
  });
});

describe("the two 'pin' features stay apart", () => {
  it("a notebook pinned to the top of the shelf is not a favourite", () => {
    // `PINNED_TAG` means "sorts to the top of the shelf" and is what the
    // card menu's "Pin to the top" writes. The dashboard row reads the
    // star instead. Heading these two the same thing was a real bug.
    const pinnedToTop = doc({ id: "p", tags: [PINNED_TAG] });

    expect(isPinned(pinnedToTop)).toBe(true);
    expect(isFavourite(pinnedToTop)).toBe(false);
    expect(orderFavourites([pinnedToTop].filter(isFavourite))).toEqual([]);
  });

  it("and the two tags are different strings", () => {
    expect(PINNED_TAG).not.toBe(FAVOURITE_TAG);
  });
});
