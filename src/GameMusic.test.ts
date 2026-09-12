import { describe, expect, it } from "vitest";
import { GAME_MUSIC_MAX_VOLUME, gameMusicOutputVolume } from "./GameMusic";

describe("game music mix", () => {
  it("caps the loudest player setting at half the previous mix", () => {
    expect(GAME_MUSIC_MAX_VOLUME).toBe(.04);
    expect(gameMusicOutputVolume(1)).toBe(.04);
  });

  it("clamps malformed player settings", () => {
    expect(gameMusicOutputVolume(-1)).toBe(0);
    expect(gameMusicOutputVolume(2)).toBe(.04);
  });
});
