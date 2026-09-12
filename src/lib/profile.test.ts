import { describe, expect, it } from "vitest";
import { FREE_RENAME_COOLDOWN_MS, canRenameForFree, nextFreeRenameAt, normalizeUsername, usernameLength } from "./profile";

describe("profile identity rules", () => {
  it("normalizes multilingual usernames without forcing ASCII", () => {
    expect(normalizeUsername("  Ａｌｌｉａｎｃｅ指挥官  ")).toBe("Alliance指挥官");
    expect(usernameLength("星际指挥官")).toBe(5);
  });

  it("opens another free rename thirty days after the last one", () => {
    const lastRenamedAt = "2026-08-01T00:00:00.000Z";
    const readyAt = Date.parse(lastRenamedAt) + FREE_RENAME_COOLDOWN_MS;
    expect(nextFreeRenameAt({ lastRenamedAt })).toBe(readyAt);
    expect(canRenameForFree({ lastRenamedAt }, readyAt - 1)).toBe(false);
    expect(canRenameForFree({ lastRenamedAt }, readyAt)).toBe(true);
    expect(canRenameForFree({}, 0)).toBe(true);
  });
});
