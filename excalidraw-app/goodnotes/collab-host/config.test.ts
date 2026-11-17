import { describe, expect, it } from "vitest";

import { formatClassroomRoomCode, makeClassroomRoomCode } from "./config";

describe("classroom room codes", () => {
  it("generates uppercase alphanumeric codes", () => {
    const code = makeClassroomRoomCode(5);
    expect(code).toMatch(/^[0-9A-Z]{5}$/);
  });

  it("formats with a readable hyphen", () => {
    expect(formatClassroomRoomCode("ABCD12")).toBe("ABCD-12");
    expect(formatClassroomRoomCode("ab-cd")).toBe("ABCD");
  });
});
