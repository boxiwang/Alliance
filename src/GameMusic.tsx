import { useEffect, useRef, useState } from "react";
import { loadPlayerAccount, PLAYER_ACCOUNT_CHANGED_EVENT } from "./lib/player-account";

const GAME_MUSIC_SRC = "/audio/celestial-drift.mp3";
// Even at a player's 100% setting, the score sits beneath alerts and comms.
// 0.04 is half of the previous shipped 0.08 ceiling.
export const GAME_MUSIC_MAX_VOLUME = 0.04;
const GAME_MUSIC_START_EVENT = "ruglands:game-music-start";
const GAME_MUSIC_POS_KEY = "ruglands:game-music-pos";

export function gameMusicOutputVolume(playerVolume: number): number {
  return Math.max(0, Math.min(1, Number(playerVolume) || 0)) * GAME_MUSIC_MAX_VOLUME;
}

export function requestGameMusicStart(): void {
  try { window.dispatchEvent(new Event(GAME_MUSIC_START_EVENT)); } catch {}
}

export default function GameMusic({ address, active }: { address: string; active: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [settings, setSettings] = useState(() => {
    const account = address ? loadPlayerAccount(address) : null;
    return { enabled: account?.musicEnabled ?? true, volume: account?.musicVolume ?? 1 };
  });

  useEffect(() => {
    const account = address ? loadPlayerAccount(address) : null;
    setSettings({ enabled: account?.musicEnabled ?? true, volume: account?.musicVolume ?? 1 });
  }, [address]);

  useEffect(() => {
    const refresh = () => {
      const account = address ? loadPlayerAccount(address) : null;
      const next = { enabled: account?.musicEnabled ?? true, volume: account?.musicVolume ?? 1 };
      setSettings(next);
      const audio = audioRef.current;
      if (!audio) return;
      audio.volume = gameMusicOutputVolume(next.volume);
      if (!active || !next.enabled) audio.pause();
      else {
        void audio.play().catch(() => {});
      }
    };
    window.addEventListener(PLAYER_ACCOUNT_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(PLAYER_ACCOUNT_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [active, address]);

  useEffect(() => {
    const beginFromEntry = () => {
      const audio = audioRef.current;
      if (!audio || !settings.enabled) return;
      audio.volume = gameMusicOutputVolume(settings.volume);
      void audio.play().catch(() => {});
    };
    window.addEventListener(GAME_MUSIC_START_EVENT, beginFromEntry);
    return () => window.removeEventListener(GAME_MUSIC_START_EVENT, beginFromEntry);
  }, [settings]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const restore = () => {
      const saved = Number(sessionStorage.getItem(GAME_MUSIC_POS_KEY));
      if (Number.isFinite(saved) && saved > 0 && (!audio.duration || saved < audio.duration)) audio.currentTime = saved;
    };
    const persist = () => {
      if (Number.isFinite(audio.currentTime) && audio.currentTime > 0) sessionStorage.setItem(GAME_MUSIC_POS_KEY, String(audio.currentTime));
    };
    if (audio.readyState >= 1) restore();
    else audio.addEventListener("loadedmetadata", restore, { once: true });
    const timer = window.setInterval(persist, 1000);
    window.addEventListener("pagehide", persist);
    return () => {
      persist();
      window.clearInterval(timer);
      window.removeEventListener("pagehide", persist);
      audio.removeEventListener("loadedmetadata", restore);
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = gameMusicOutputVolume(settings.volume);
    if (!active || !settings.enabled) {
      audio.pause();
      return;
    }

    const begin = () => { void audio.play().catch(() => {}); };
    begin();
    // Direct-link dev sessions can arrive without a browser-approved gesture.
    // The first click/key then unlocks the same continuous soundtrack.
    window.addEventListener("pointerdown", begin, { passive: true });
    window.addEventListener("keydown", begin);
    return () => {
      window.removeEventListener("pointerdown", begin);
      window.removeEventListener("keydown", begin);
    };
  }, [active, settings]);

  return <audio ref={audioRef} src={GAME_MUSIC_SRC} loop preload="auto" aria-hidden="true" />;
}
