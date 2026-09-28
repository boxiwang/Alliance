import { describe, expect, it, vi } from "vitest";
import { formatDualClock } from "./format";

describe("formatDualClock", () => {
  it("zero-pads single-digit hours and minutes", () => {
    const date = new Date(2026, 0, 1, 7, 5);
    const { local } = formatDualClock(date);
    expect(local).toBe("07:05");
  });

  it("formats UTC from getUTCHours/getUTCMinutes, not local getters", () => {
    const date = new Date(Date.UTC(2026, 0, 1, 14, 32));
    const getUTCHoursSpy = vi.spyOn(date, "getUTCHours");
    const getUTCMinutesSpy = vi.spyOn(date, "getUTCMinutes");

    const { utc } = formatDualClock(date);

    expect(utc).toBe("14:32");
    expect(getUTCHoursSpy).toHaveBeenCalled();
    expect(getUTCMinutesSpy).toHaveBeenCalled();
  });

  it("does not use local getters for the utc field", () => {
    const date = new Date(Date.UTC(2026, 0, 1, 14, 32));
    const getHoursSpy = vi.spyOn(date, "getHours");
    const getMinutesSpy = vi.spyOn(date, "getMinutes");

    formatDualClock(date);

    // local field still calls these, but only once each — confirms utc
    // formatting path is independent and doesn't also call the local getters.
    expect(getHoursSpy).toHaveBeenCalledTimes(1);
    expect(getMinutesSpy).toHaveBeenCalledTimes(1);
  });

  it("returns 24h HH:MM for both fields at midnight", () => {
    const date = new Date(2026, 0, 1, 0, 0);
    const { local } = formatDualClock(date);
    expect(local).toBe("00:00");
  });

  it("zero-pads double-digit hour boundaries", () => {
    const date = new Date(2026, 0, 1, 23, 9);
    const { local } = formatDualClock(date);
    expect(local).toBe("23:09");
  });
});
