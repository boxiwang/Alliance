import { describe, expect, it } from "vitest";
import { shouldSubmitTextEntry } from "./ime";

describe("IME-aware chat submission", () => {
  it("submits a normal Enter key", () => {
    expect(shouldSubmitTextEntry({ key: "Enter", isComposing: false, keyCode: 13 })).toBe(true);
  });

  it("lets Enter confirm an active composition without sending", () => {
    expect(shouldSubmitTextEntry({ key: "Enter", isComposing: true, keyCode: 13 })).toBe(false);
    expect(shouldSubmitTextEntry({ key: "Enter", isComposing: false, keyCode: 13 }, true)).toBe(false);
  });

  it("handles the legacy IME key code used by Safari and older Chromium", () => {
    expect(shouldSubmitTextEntry({ key: "Enter", isComposing: false, keyCode: 229 })).toBe(false);
  });

  it("does not submit other keys", () => {
    expect(shouldSubmitTextEntry({ key: "Process", isComposing: false, keyCode: 13 })).toBe(false);
  });
});
