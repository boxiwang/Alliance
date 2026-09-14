// Sound-effects helper. Gated by the account's "Combat audio" (soundEnabled)
// setting at the call site. Small preloaded pools preserve the user's first
// post-refresh gesture instead of waiting for a newly-created element to load.

export const SFX_CHAT_SEND = "/audio/chat-send.mp3";
export const SFX_STARMAP_SELECT = "/audio/starmap-select.mp3";
export const SFX_BUILDING_SELECT = "/audio/building-select.mp3";
export const SFX_TAB_SWITCH = "/audio/tab-switch.mp3";
export const SFX_CHANNEL_SWITCH = "/audio/channel-switch.mp3";
export const SFX_SUBTAB_SWITCH = "/audio/subtab-switch.mp3";
export const SFX_LOGIN_HOVER = "/audio/login-hover.wav";

// Per-cue base levels. These are loudness-matched, not uniform: the source
// clips differ by up to ~16 dB RMS, so a flat 0.5 made tab-switch far louder
// than the selects. Each level = targetRMS(0.02) / clipRMS, so every cue lands
// at roughly the same perceived volume before the account's sfxVolume scales it.
export const SFX_CHAT_SEND_VOLUME = 0.55;        // clip RMS -28.7 dB
export const SFX_STARMAP_SELECT_VOLUME = 0.73;   // clip RMS -31.2 dB
export const SFX_BUILDING_SELECT_VOLUME = 0.33;  // clip RMS -24.5 dB
export const SFX_TAB_SWITCH_VOLUME = 0.25;       // clip RMS -21.9 dB
export const SFX_CHANNEL_SWITCH_VOLUME = 0.19;   // clip RMS -19.3 dB
export const SFX_SUBTAB_SWITCH_VOLUME = 0.42;    // clip RMS -26.5 dB
// Supplied hover clip was RMS -39.8 dB; the shipped WAV is source-normalized
// by +5.8 dB to the shared -34 dB target, so its base level stays at 1.
export const SFX_LOGIN_HOVER_VOLUME = 1;

const SFX_POOL_SIZE = 3;
const pools = new Map<string, HTMLAudioElement[]>();

function createPlayer(src: string): HTMLAudioElement {
  const audio = new Audio(src);
  audio.preload = "auto";
  return audio;
}

function poolFor(src: string): HTMLAudioElement[] {
  let pool = pools.get(src);
  if (!pool) {
    pool = [createPlayer(src)];
    pools.set(src, pool);
  }
  return pool;
}

export function preloadSfx(sources: string[]): void {
  if (typeof Audio === "undefined") return;
  for (const src of sources) {
    try {
      const pool = poolFor(src);
      while (pool.length < SFX_POOL_SIZE) pool.push(createPlayer(src));
      for (const audio of pool) audio.load();
    } catch {}
  }
}

export function playSfx(src: string, volume = 1): void {
  try {
    const pool = poolFor(src);
    let audio = pool.find((candidate) => candidate.paused || candidate.ended);
    if (!audio) {
      audio = createPlayer(src);
      if (pool.length < SFX_POOL_SIZE) pool.push(audio);
    }
    audio.currentTime = 0;
    audio.volume = Math.max(0, Math.min(1, volume));
    void audio.play().catch(() => {});
  } catch {}
}
