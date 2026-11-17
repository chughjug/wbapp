import { describe, expect, it } from "vitest";

import {
  ensureFirstPage,
  getPageCount,
  getPageSizeName,
  getPageTemplate,
  getPages,
  isLandscapePage,
} from "./pageModel";

describe("ensureFirstPage", () => {
  it("is a no-op when a page already exists", () => {
    const seeded = ensureFirstPage([], {
      size: "LETTER",
      template: "lined",
    });
    expect(getPageCount(seeded)).toBe(1);
    expect(ensureFirstPage(seeded)).toBe(seeded);
  });

  it("honours size, template and landscape for page 1", () => {
    const elements = ensureFirstPage([], {
      size: "LEGAL",
      template: "grid",
      landscape: true,
    });
    expect(getPageCount(elements)).toBe(1);
    const [page] = getPages(elements);
    expect(getPageTemplate(page.frame)).toBe("grid");
    expect(getPageSizeName(page.frame)).toBe("LEGAL");
    expect(isLandscapePage(page.frame)).toBe(true);
    expect(page.frame.width).toBeGreaterThan(page.frame.height);
  });
});
