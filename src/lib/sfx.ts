// Tiny sound-effects helper. Gated by the account's "Combat audio" (soundEnabled)
// setting at the call site. A fresh Audio per play so rapid triggers overlap.

export const SFX_CHAT_SEND = "/audio/chat-send.mp3";
export const SFX_STARMAP_SELECT = "/audio/starmap-select.mp3";
export const SFX_BUILDING_SELECT = "/audio/building-select.mp3";

// Chat-send effect plays at 50% (per design) of full volume. Every SFX is then
// scaled by the account's sfxVolume at the call site.
export const SFX_CHAT_SEND_VOLUME = 0.5;

export function playSfx(src: string, volume = 1): void {
  try {
    const audio = new Audio(src);
    audio.volume = Math.max(0, Math.min(1, volume));
    void audio.play().catch(() => {});
  } catch {}
}
