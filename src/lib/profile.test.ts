import { describe, expect, it } from "vitest";
import { canRenameForFree, normalizeUsername, usernameLength } from "./profile";

describe("profile identity rules", () => {
  it("normalizes multilingual usernames without forcing ASCII", () => {
    expect(normalizeUsername("  Ａｌｌｉａｎｃｅ指挥官  ")).toBe("Alliance指挥官");
    expect(usernameLength("星际指挥官")).toBe(5);
  });

  it("only the first rename (after the system-issued name) is free", () => {
    expect(canRenameForFree({ renamedOnce: false })).toBe(true);
    expect(canRenameForFree({ renamedOnce: true })).toBe(false);
    expect(canRenameForFree({ renamedOnce: false, lastRenamedAt: "2026-08-01T00:00:00.000Z" })).toBe(false);
  });
});
