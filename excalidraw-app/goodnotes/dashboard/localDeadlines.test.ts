import { describe, expect, it } from "vitest";

import {
  buildLocalDeadlines,
  UP_NEXT_LIMIT,
  UP_NEXT_OVERDUE_MS,
  UP_NEXT_WINDOW_MS,
} from "./localDeadlines";

import type { DocMeta } from "../types";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-03-10T09:00:00Z").getTime();

const doc = (over: Partial<DocMeta> & { id: string }): DocMeta => ({
  title: over.id,
  course: null,
  dueDate: null,
  tags: [],
  createdAt: NOW,
  updatedAt: NOW,
  lastOpenedAt: null,
  thumbnail: null,
  pageCount: 1,
  defaultTemplate: "blank",
  defaultPageSize: "LETTER",
  ...over,
});

describe("buildLocalDeadlines", () => {
  it("is empty when nothing has a due date", () => {
    expect(buildLocalDeadlines([doc({ id: "a" })], NOW)).toEqual([]);
  });

  it("orders by due date, soonest first", () => {
    const items = buildLocalDeadlines(
      [
        doc({ id: "late", dueDate: NOW + 5 * DAY }),
        doc({ id: "soon", dueDate: NOW + 1 * DAY }),
        doc({ id: "mid", dueDate: NOW + 3 * DAY }),
      ],
      NOW,
    );
    expect(items.map((it) => it.doc.id)).toEqual(["soon", "mid", "late"]);
  });

  it("keeps recent overdue work in front of you", () => {
    const items = buildLocalDeadlines(
      [doc({ id: "missed", dueDate: NOW - 2 * DAY })],
      NOW,
    );
    expect(items).toHaveLength(1);
    expect(items[0].urgency).toBe("overdue");
  });

  it("drops what is too far ahead or too long gone", () => {
    const items = buildLocalDeadlines(
      [
        doc({ id: "next-term", dueDate: NOW + UP_NEXT_WINDOW_MS + DAY }),
        doc({ id: "last-term", dueDate: NOW - UP_NEXT_OVERDUE_MS - DAY }),
        doc({ id: "keep", dueDate: NOW + DAY }),
      ],
      NOW,
    );
    expect(items.map((it) => it.doc.id)).toEqual(["keep"]);
  });

  it("includes the edges of the window", () => {
    const items = buildLocalDeadlines(
      [
        doc({ id: "edge-future", dueDate: NOW + UP_NEXT_WINDOW_MS }),
        doc({ id: "edge-past", dueDate: NOW - UP_NEXT_OVERDUE_MS }),
      ],
      NOW,
    );
    expect(items).toHaveLength(2);
  });

  // archiving is how a student says "done with this"; a finished course's
  // deadlines must not crowd out this week's
  it("ignores archived notebooks", () => {
    const items = buildLocalDeadlines(
      [
        doc({ id: "archived", dueDate: NOW + DAY, tags: ["archived"] }),
        doc({ id: "live", dueDate: NOW + 2 * DAY }),
      ],
      NOW,
    );
    expect(items.map((it) => it.doc.id)).toEqual(["live"]);
  });

  it("caps the list", () => {
    const docs = Array.from({ length: 10 }, (_, i) =>
      doc({ id: `d${i}`, dueDate: NOW + (i + 1) * 60_000 }),
    );
    expect(buildLocalDeadlines(docs, NOW)).toHaveLength(UP_NEXT_LIMIT);
    expect(buildLocalDeadlines(docs, NOW, 2)).toHaveLength(2);
    expect(buildLocalDeadlines(docs, NOW, 0)).toHaveLength(0);
  });

  it("reports the urgency the cards use", () => {
    const items = buildLocalDeadlines(
      [
        doc({ id: "overdue", dueDate: NOW - DAY }),
        doc({ id: "soon", dueDate: NOW + 60_000 }),
        doc({ id: "upcoming", dueDate: NOW + 10 * DAY }),
      ],
      NOW,
    );
    expect(items.map((it) => it.urgency)).toEqual([
      "overdue",
      "soon",
      "upcoming",
    ]);
  });
});
