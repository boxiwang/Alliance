import { describe, expect, it } from "vitest";
import defaults from "../../docs/numbers.json";
import { shieldActive } from "./shield";

const n = structuredClone(defaults) as any;
const now = 1_800_000_000_000;

describe("shield rule", () => {
  it("shields a Core below the protection level until it attacks", () => {
    expect(shieldActive({ keepLevel: 5 }, now, n)).toBe(true);
    expect(shieldActive({ keepLevel: 5, hasAttacked: true }, now, n)).toBe(false);
    expect(shieldActive({ keepLevel: 12 }, now, n)).toBe(false);
  });

  it("a shield item protects any Core, including one that attacked before it was raised", () => {
    expect(shieldActive({ keepLevel: 12, shieldUntil: now + 60_000 }, now, n)).toBe(true);
    expect(shieldActive({ keepLevel: 12, hasAttacked: true, shieldUntil: now + 60_000 }, now, n)).toBe(true);
    expect(shieldActive({ keepLevel: 12, shieldUntil: now - 1 }, now, n)).toBe(false);
  });
});
