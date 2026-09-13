import { describe, expect, it } from "vitest";
import { topFactions } from "./factions";

describe("faction token identity", () => {
  it("does not invent alliance names for ticker-only leaderboard seeds", () => {
    const rows = topFactions(new Set(), new Map());
    expect(rows.every((row) => row.name === null)).toBe(true);
  });

  it("uses the token name exactly as returned by wallet metadata", () => {
    const rows = topFactions(
      new Set(["FRONG"]),
      new Map(),
      new Map([["FRONG", "Frog on Robinhood"]]),
    );
    expect(rows.find((row) => row.symbol === "FRONG")?.name).toBe("Frog on Robinhood");
  });
});
