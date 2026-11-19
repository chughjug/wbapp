import { describe, expect, it } from "vitest";

import { daysUntilDue, formatDueDate, getDueUrgency } from "./format";

const HOUR = 60 * 60 * 1000;

/** Midday, so adding hours does not cross a day boundary by accident. */
const noon = new Date("2026-03-10T12:00:00").getTime();

describe("the due-date colour and the due-date wording agree", () => {
  it("does not colour two notebooks differently while saying the same thing", () => {
    // The bug: urgency used a rolling 48-hour window while the label
    // rounded to calendar days, so 47h and 49h both read "Due in 2 days"
    // — one amber, one green, with nothing on screen to explain it.
    const at47h = noon + 47 * HOUR;
    const at49h = noon + 49 * HOUR;

    expect(formatDueDate(at47h, noon)).toBe(formatDueDate(at49h, noon));
    expect(getDueUrgency(at47h, noon)).toBe(getDueUrgency(at49h, noon));
  });

  it("calls today and tomorrow soon, and the day after upcoming", () => {
    const today = noon + 2 * HOUR;
    const tomorrow = noon + 26 * HOUR;
    const dayAfter = noon + 50 * HOUR;

    expect(formatDueDate(today, noon)).toBe("Due today");
    expect(getDueUrgency(today, noon)).toBe("soon");

    expect(formatDueDate(tomorrow, noon)).toBe("Due tomorrow");
    expect(getDueUrgency(tomorrow, noon)).toBe("soon");

    expect(formatDueDate(dayAfter, noon)).toBe("Due in 2 days");
    expect(getDueUrgency(dayAfter, noon)).toBe("upcoming");
  });

  it("still calls a past date overdue, to the minute", () => {
    // overdue is the one state that should NOT wait for a day boundary:
    // a deadline an hour gone is missed, not "due today"
    expect(getDueUrgency(noon - 1 * HOUR, noon)).toBe("overdue");
    expect(getDueUrgency(noon - 1, noon)).toBe("overdue");
  });

  it("has no urgency without a date", () => {
    expect(getDueUrgency(null, noon)).toBe("none");
    expect(formatDueDate(null, noon)).toBe("No due date");
  });

  it("counts calendar days, not elapsed hours", () => {
    // 23:00 today to 01:00 tomorrow is two hours but one day
    const lateTonight = new Date("2026-03-10T23:00:00").getTime();
    const earlyTomorrow = new Date("2026-03-11T01:00:00").getTime();
    expect(daysUntilDue(earlyTomorrow, lateTonight)).toBe(1);
  });
});
