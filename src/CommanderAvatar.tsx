import { avatarImageUrl } from "./lib/backend";

/**
 * A commander's portrait: the uploaded image ("u<version>" avatar token) or the chosen sigil.
 * Used everywhere a commander is shown (nav, Star Map card, relayed card, Profile), so every
 * player sees the same face.
 */
export default function CommanderAvatar({ playerId, avatar, className = "", previewSrc }: {
  playerId: string | null | undefined; avatar: string | null | undefined; className?: string;
  /** Local image shown instead (a cropped photo not saved yet). */
  previewSrc?: string | null;
}) {
  const url = previewSrc || avatarImageUrl(playerId, avatar);
  if (url) return <span className={`command-sigil command-sigil-photo ${className}`}><img src={url} alt="" loading="lazy" decoding="async" draggable={false} /></span>;
  const sigil = /^[a-z0-9-]{1,24}$/.test(String(avatar || "")) ? avatar : "genesis";
  return <span className={`command-sigil command-sigil-${sigil} ${className}`}><i /></span>;
}
