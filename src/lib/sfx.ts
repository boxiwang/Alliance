// Tiny sound-effects helper. Gated by the account's "Combat audio" (soundEnabled)
// setting at the call site. A fresh Audio per play so rapid triggers overlap.

export const SFX_CHAT_SEND = "/audio/chat-send.mp3";
export const SFX_STARMAP_SELECT = "/audio/starmap-select.mp3";
export const SFX_BUILDING_SELECT = "/audio/building-select.mp3";
export const SFX_TAB_SWITCH = "/audio/tab-switch.mp3";
export const SFX_CHANNEL_SWITCH = "/audio/channel-switch.mp3";
export const SFX_SUBTAB_SWITCH = "/audio/subtab-switch.mp3";

// Per-cue base levels. These are loudness-matched, not uniform: the source
// clips differ by up to ~16 dB RMS, so a flat 0.5 made tab-switch far louder
// than the selects. Each level = targetRMS(0.02) / clipRMS, so every cue lands
// at roughly the same perceived volume before the account's sfxVolume scales it.
export const SFX_CHAT_SEND_VOLUME = 0.55;        // clip RMS -28.7 dB
export const SFX_STARMAP_SELECT_VOLUME = 0.73;   // clip RMS -31.2 dB
export const SFX_BUILDING_SELECT_VOLUME = 0.33;  // clip RMS -24.5 dB
export const SFX_TAB_SWITCH_VOLUME = 0.37;       // clip RMS -25.3 dB
export const SFX_CHANNEL_SWITCH_VOLUME = 0.19;   // clip RMS -19.3 dB
export const SFX_SUBTAB_SWITCH_VOLUME = 0.42;    // clip RMS -26.5 dB

export function playSfx(src: string, volume = 1): void {
  try {
    const audio = new Audio(src);
    audio.volume = Math.max(0, Math.min(1, volume));
    void audio.play().catch(() => {});
  } catch {}
}
