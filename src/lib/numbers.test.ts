import { describe, expect, it } from "vitest";
import defaults from "../../docs/numbers.json";
import { simulateProgression } from "./simulator";
import { validateNumbers } from "./validation";

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

describe("numbers configuration", () => {
  it("passes structural and progression validation", () => {
    expect(validateNumbers(defaults)).toEqual([]);
  });

  it("detects missing level rows and prerequisite errors", () => {
    const numbers: any = clone(defaults);
    delete numbers.buildings["building.keep"].levels["10"];
    numbers.townhallPrerequisites.perLevel["8"] = ["building.unknown"];

    const issues = validateNumbers(numbers);
    expect(issues.some((issue) => issue.path === "buildings.building.keep.levels.10")).toBe(true);
    expect(issues.some((issue) => issue.path === "townhallPrerequisites.perLevel.8")).toBe(true);
  });

  it("detects Warehouse capacity deadlocks", () => {
    const numbers: any = clone(defaults);
    const priorCapacity = numbers.buildings["building.storage"].levels["4"].capacityPerResource;
    numbers.buildings["building.storage"].levels["5"].cost["res.cash"] = priorCapacity + 1;

    const issues = validateNumbers(numbers);
    expect(issues.some((issue) => issue.path === "buildings.building.storage.levels.5.cost.res.cash")).toBe(true);
  });

  it("keeps the default F2P profile inside both pacing targets", () => {
    const profile = { sessionsPerDay: 3, queueUptime: 0.85 };
    const level10 = simulateProgression(defaults, { ...profile, targetLevel: 10 });
    const level30 = simulateProgression(defaults, { ...profile, targetLevel: 30 });

    expect(level10.deadlock).toBeUndefined();
    expect(level10.totalDays).toBeGreaterThanOrEqual(2);
    expect(level10.totalDays).toBeLessThanOrEqual(3.1);
    expect(level30.deadlock).toBeUndefined();
    expect(level30.totalDays).toBeGreaterThanOrEqual(120);
    expect(level30.totalDays).toBeLessThanOrEqual(150);
  });
});
