import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import CosmicBackdrop from "./CosmicBackdrop";
import GameNav from "./GameNav";
import MarchSignaturePreview from "./MarchSignaturePreview";
import PlanetOrbitPreview from "./PlanetOrbitPreview";
import StrikeSignaturePreview from "./StrikeSignaturePreview";
import WarpSignaturePreview from "./WarpSignaturePreview";
import CommanderAvatar from "./CommanderAvatar";
import CommanderCardView from "./CommanderCardView";
import NameSignal from "./NameSignal";
import { CursorGlyph } from "./GameCursor";
import { playSfx, SFX_SUBTAB_SWITCH, SFX_SUBTAB_SWITCH_VOLUME } from "./lib/sfx";
import { detectAutoTier, GRAPHICS_TIER_HINT, GRAPHICS_TIER_LABEL, type GraphicsTier } from "./lib/graphics-tier";
import { bioLooksLikeLink, canRenameForFree, commanderIdOf, normalizeUsername, usernameLength, type Profile } from "./lib/profile";
import { loadBackendSession, loadInventory, requestAccountDeletion, updatePlayerName, uploadAvatar } from "./lib/backend";
import { loadAvatarSource } from "./lib/avatar-image";
import AvatarCropper from "./AvatarCropper";
import { isUnlimitedQuantity } from "./lib/mvp-items";
import { activeBuffs, buffTimeLeft } from "./lib/buffs";
import { getN } from "./lib/numbers";
import { capacity, mightBreakdown, prodPerHour, project, totalTroops, worldMarchSlots } from "./lib/game";
import { initGame, loadGame } from "./lib/gamestore";
import { loadLocalWorldSession } from "./lib/world-adapter";
import { energyAt } from "./lib/world-engine";
import {
  CHAT_SIGNALS,
  GAME_CURSORS,
  MARCH_SIGNATURES,
  STRIKE_SIGNATURES,
  WARP_SIGNATURES,
  PLANET_HALOS,
  PLANET_ORBITS,
  PLANET_SKINS,
  TITLE_SEALS,
  type ChatSignalId,
  type GameCursorId,
  type MarchSignatureId,
  type StrikeSignatureId,
  type WarpSignatureId,
  type PlanetHaloId,
  type PlanetOrbitId,
  type PlanetSkinId,
  type TitleId,
  loadCosmeticVault,
  loadPlayerAccount,
  ownsChatSignal,
  ownsGameCursor,
  ownsMarchSignature,
  ownsStrikeSignature,
  ownsWarpSignature,
  ownsPlanetHalo,
  ownsPlanetOrbit,
  ownsPlanetSkin,
  ownsTitleSeal,
  saveCosmeticVault,
  savePlayerAccount,
} from "./lib/player-account";

type ArchiveSection = "dossier" | "vault" | "wallet" | "protocols";
type RelicPreviewKind = "planet" | "halo" | "orbit" | "march" | "warp" | "strike" | "chat" | "title" | "cursor";
/** Relic Vault categories = the Dossier's equip slots, grouped by where they show. */
type RelicCategory = "core" | "halo" | "orbit" | "march" | "warp" | "strike" | "name" | "title" | "cursor";
const RELIC_GROUPS: { label: string; cats: RelicCategory[] }[] = [
  { label: "PLANET", cats: ["core", "halo", "orbit", "warp"] },
  { label: "FLEET", cats: ["march", "strike"] },
  { label: "IDENTITY", cats: ["name", "title", "cursor"] },
];
const RELIC_META: Record<RelicCategory, { label: string; kind: RelicPreviewKind; where: string }> = {
  core: { label: "CORE", kind: "planet", where: "Your planet · seen by everyone on the Star Map" },
  halo: { label: "HALO", kind: "halo", where: "Around your planet · seen by everyone" },
  orbit: { label: "ORBIT", kind: "orbit", where: "Circles your planet · seen by everyone" },
  march: { label: "MARCH", kind: "march", where: "Your fleets' route on the Star Map" },
  warp: { label: "WARP", kind: "warp", where: "How your planet arrives after a warp" },
  strike: { label: "STRIKE", kind: "strike", where: "Plays when your fleets hit a target" },
  name: { label: "NAME", kind: "chat", where: "Your name in comms and on your card" },
  title: { label: "TITLE", kind: "title", where: "Shown under your name" },
  cursor: { label: "CURSOR", kind: "cursor", where: "Your pointer · only you see it" },
};
const categoryOfKind = (kind: RelicPreviewKind): RelicCategory => kind === "planet" ? "core" : kind === "chat" ? "name" : kind;


function initialArchiveSection(): ArchiveSection {
  const requested = new URLSearchParams(window.location.search).get("section") as ArchiveSection | null;
  return requested && ["dossier", "vault", "wallet", "protocols"].includes(requested) ? requested : "dossier";
}

function initialRelicPreviewKind(): RelicPreviewKind {
  const requested = new URLSearchParams(window.location.search).get("preview") as RelicPreviewKind | null;
  return requested && ["planet", "halo", "orbit", "march", "warp", "strike", "chat", "title", "cursor"].includes(requested) ? requested : "planet";
}



function shortWallet(address: string | null): string {
  if (!address) return "NO KEY LINKED";
  return address.length > 14 ? `${address.slice(0, 8)}…${address.slice(-6)}` : address;
}

function ChatSignalPreview({ signal, title, username, faction, reducedMotion }: { signal: ChatSignalId | null; title: string | null; username: string; faction: string | null; reducedMotion: boolean }) {
  return <div className={`relic-chat-preview relic-chat-${signal || "clear-channel"}`}>
    <div className="relic-chat-channel"><span>◇ ALLIANCE SIGNAL</span><i>LIVE</i></div>
    <div className="relic-chat-message"><div className="relic-chat-avatar">{username.slice(0, 1)}</div><div><header><small>[{faction || "SOLO"}]</small><b><NameSignal signal={signal} mode="demo" reducedMotion={reducedMotion}>{username}</NameSignal></b><time>NOW</time></header>{title && <em className="relic-social-title">⌁ {title}</em>}<p>The frontier remembers who crossed it.</p></div></div>
    <div className="relic-chat-message reply"><div className="relic-chat-avatar">N</div><div><header><small>[ORBT]</small><b>NyxValidator</b><time>NOW</time></header><p>Signal received. Opening a direct channel.</p></div></div>
    <small>COMMS IDENTITY // OUTBOUND</small>
  </div>;
}

function CursorPreview({ cursor }: { cursor: GameCursorId }) {
  return <div className={`relic-cursor-preview relic-cursor-${cursor}`}>
    <div className="relic-cursor-grid" />
    <span className="relic-cursor-lock"><i /><i /><i /><i /></span>
    <CursorGlyph cursor={cursor} />
    <small>COMMAND HAND // LIVE CALIBRATION</small>
  </div>;
}

export default function ProfileScreen({
  address, profile, onProfileChange, onAlliance = () => {}, onCity, onWorld, onMessages, onShop = () => {}, onReauth, onAccountDeleted,
}: {
  /** Re-verify the signed-in identity (fresh wallet signature / Google sign-in / guest proof). */
  onReauth?: () => Promise<void>;
  /** Deletion requested: sign out (the account is frozen for its grace period). */
  onAccountDeleted?: (purgeAt: number) => void;
  address: string;
  profile: Profile;
  onProfileChange: (profile: Profile) => void;
  onAlliance?: () => void;
  onCity: () => void;
  onWorld: () => void;
  onMessages: () => void;
  onShop?: () => void;
}) {
  const [section, setSection] = useState<ArchiveSection>(initialArchiveSection);
  const [account, setAccount] = useState(() => loadPlayerAccount(address));
  const [vault, setVault] = useState(() => loadCosmeticVault(address));
  const previewParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const requestedSkin = previewParams.get("skin") as PlanetSkinId | null;
  const requestedHalo = previewParams.get("halo") as PlanetHaloId | null;
  const requestedOrbit = previewParams.get("orbit") as PlanetOrbitId | null;
  const requestedMarch = previewParams.get("signature") as MarchSignatureId | null;
  const requestedStrike = previewParams.get("strike") as StrikeSignatureId | null;
  const requestedChat = previewParams.get("signal") as ChatSignalId | null;
  const requestedTitle = previewParams.get("title") as TitleId | null;
  const requestedCursor = previewParams.get("cursor") as GameCursorId | null;
  const [previewKind, setPreviewKind] = useState<RelicPreviewKind>(initialRelicPreviewKind);
  const [vaultCategory, setVaultCategory] = useState<RelicCategory>(() => categoryOfKind(initialRelicPreviewKind()));
  const [previewSkin, setPreviewSkin] = useState<PlanetSkinId>(() => PLANET_SKINS.some((skin) => skin.id === requestedSkin) ? requestedSkin! : vault.equipped.planetBody);
  const [previewHalo, setPreviewHalo] = useState<PlanetHaloId>(() => PLANET_HALOS.some((halo) => halo.id === requestedHalo) ? requestedHalo! : vault.equipped.halo || PLANET_HALOS[0].id);
  const [previewOrbit, setPreviewOrbit] = useState<PlanetOrbitId>(() => PLANET_ORBITS.some((orbit) => orbit.id === requestedOrbit) ? requestedOrbit! : vault.equipped.orbit || PLANET_ORBITS[0].id);
  const [previewMarch, setPreviewMarch] = useState<MarchSignatureId>(() => MARCH_SIGNATURES.some((signature) => signature.id === requestedMarch) ? requestedMarch! : vault.equipped.marchSignature || MARCH_SIGNATURES[0].id);
  const [previewWarp, setPreviewWarp] = useState<WarpSignatureId>(() => vault.equipped.warpSignature || WARP_SIGNATURES[0].id);
  const [previewStrike, setPreviewStrike] = useState<StrikeSignatureId>(() => STRIKE_SIGNATURES.some((signature) => signature.id === requestedStrike) ? requestedStrike! : vault.equipped.strikeSignature || STRIKE_SIGNATURES[0].id);
  const [previewChat, setPreviewChat] = useState<ChatSignalId>(() => CHAT_SIGNALS.some((signal) => signal.id === requestedChat) ? requestedChat! : vault.equipped.chatSignal || CHAT_SIGNALS[0].id);
  const [previewTitle, setPreviewTitle] = useState<TitleId>(() => TITLE_SEALS.some((title) => title.id === requestedTitle) ? requestedTitle! : vault.equipped.title || TITLE_SEALS[0].id);
  const [previewCursor, setPreviewCursor] = useState<GameCursorId>(() => GAME_CURSORS.some((cursor) => cursor.id === requestedCursor) ? requestedCursor! : vault.equipped.cursor || GAME_CURSORS[0].id);
  const [portraitBusy, setPortraitBusy] = useState(false);
  const [cropSource, setCropSource] = useState<HTMLImageElement | null>(null);
  // Delete account: open flow, identity re-verified, typed Commander ID.
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteVerified, setDeleteVerified] = useState(false);
  const [deleteTyped, setDeleteTyped] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const portraitInput = useRef<HTMLInputElement>(null);
  const [callsign, setCallsign] = useState(profile.name);
  // Rename Signals owned (Warehouse item): rename during the free-rename cooldown.
  const [renameSignals, setRenameSignals] = useState(0);
  useEffect(() => {
    let live = true;
    void loadInventory(address).then((items) => { if (live) setRenameSignals(items.find((entry) => entry.itemId === "identity.rename")?.quantity ?? 0); }).catch(() => {});
    return () => { live = false; };
  }, [address]);
  const [motto, setMotto] = useState(profile.motto || "");
  const [avatarId, setAvatarId] = useState(profile.avatarId || "genesis");
  const [signal, setSignal] = useState("");

  const now = Date.now();
  const game = useMemo(() => project(loadGame(address) || initGame(address), now), [address]);
  const world = useMemo(() => loadLocalWorldSession(address), [address]);
  const player = world?.world.players[world.playerId];
  const city = player ? world?.world.entities[player.cityId] : null;
  const activeFleets = player ? Object.values(world!.world.marches).filter((march) => march.playerId === player.id && !["completed", "failed"].includes(march.state)).length : 0;
  const location = city?.kind === "city"
    ? `SECTOR ${world!.world.stateId.slice(-6).toUpperCase()} · HOME ${Math.round(city.position.x).toString().padStart(3, "0")}:${Math.round(city.position.y).toString().padStart(3, "0")}`
    : "RHCHAIN 4663 · HOME UNCHARTED";
  const selectedSkin = PLANET_SKINS.find((skin) => skin.id === previewSkin) || PLANET_SKINS[0];
  const selectedHalo = PLANET_HALOS.find((halo) => halo.id === previewHalo) || PLANET_HALOS[0];
  const selectedOrbit = PLANET_ORBITS.find((orbit) => orbit.id === previewOrbit) || PLANET_ORBITS[0];
  const selectedMarch = MARCH_SIGNATURES.find((effect) => effect.id === previewMarch) || MARCH_SIGNATURES[0];
  const selectedStrike = STRIKE_SIGNATURES.find((effect) => effect.id === previewStrike) || STRIKE_SIGNATURES[0];
  const selectedWarp = WARP_SIGNATURES.find((effect) => effect.id === previewWarp) || WARP_SIGNATURES[0];
  const selectedChat = CHAT_SIGNALS.find((effect) => effect.id === previewChat) || CHAT_SIGNALS[0];
  const selectedTitle = TITLE_SEALS.find((effect) => effect.id === previewTitle) || TITLE_SEALS[0];
  const selectedCursor = GAME_CURSORS.find((effect) => effect.id === previewCursor) || GAME_CURSORS[0];
  const selectedRelic = previewKind === "planet" ? selectedSkin : previewKind === "halo" ? selectedHalo : previewKind === "orbit" ? selectedOrbit : previewKind === "march" ? selectedMarch : previewKind === "warp" ? selectedWarp : previewKind === "strike" ? selectedStrike : previewKind === "chat" ? selectedChat : previewKind === "title" ? selectedTitle : selectedCursor;
  const selectedRelicTier = "tier" in selectedRelic ? selectedRelic.tier || selectedRelic.rarity : selectedRelic.rarity;
  const selectedRelicType = previewKind === "planet" ? "CORE" : previewKind === "halo" ? "PLANET HALO" : previewKind === "orbit" ? "ORBITAL ARRAY" : previewKind === "march" ? "MARCH SIGNATURE" : previewKind === "warp" ? "WARP ARRIVAL" : previewKind === "strike" ? "STRIKE IMPRINT" : previewKind === "chat" ? "NAME SIGNAL" : previewKind === "title" ? "TITLE SEAL" : "COMMAND CURSOR";
  const selectedRelicTarget = previewKind === "planet" ? "CORE" : previewKind === "halo" ? "HALO" : previewKind === "orbit" ? "ORBIT" : previewKind === "march" ? "FLEETS" : previewKind === "warp" ? "WARPS" : previewKind === "strike" ? "STRIKES" : previewKind === "chat" ? "COMMS" : previewKind === "title" ? "DOSSIER" : "COMMAND HAND";
  const selectedRelicOwned = previewKind === "planet" ? ownsPlanetSkin(vault, previewSkin) : previewKind === "halo" ? ownsPlanetHalo(vault, previewHalo) : previewKind === "orbit" ? ownsPlanetOrbit(vault, previewOrbit) : previewKind === "march" ? ownsMarchSignature(vault, previewMarch) : previewKind === "warp" ? ownsWarpSignature(vault, previewWarp) : previewKind === "strike" ? ownsStrikeSignature(vault, previewStrike) : previewKind === "chat" ? ownsChatSignal(vault, previewChat) : previewKind === "title" ? ownsTitleSeal(vault, previewTitle) : ownsGameCursor(vault, previewCursor);
  const selectedRelicEquipped = previewKind === "planet" ? vault.equipped.planetBody === previewSkin : previewKind === "halo" ? vault.equipped.halo === previewHalo : previewKind === "orbit" ? vault.equipped.orbit === previewOrbit : previewKind === "march" ? vault.equipped.marchSignature === previewMarch : previewKind === "warp" ? (vault.equipped.warpSignature ?? "teleport-beam") === previewWarp : previewKind === "strike" ? vault.equipped.strikeSignature === previewStrike : previewKind === "chat" ? vault.equipped.chatSignal === previewChat : previewKind === "title" ? vault.equipped.title === previewTitle : vault.equipped.cursor === previewCursor;
  const equippedSkin = PLANET_SKINS.find((skin) => skin.id === vault.equipped.planetBody) || PLANET_SKINS[0];
  const equippedHalo = PLANET_HALOS.find((halo) => halo.id === vault.equipped.halo);
  const equippedOrbit = PLANET_ORBITS.find((orbit) => orbit.id === vault.equipped.orbit);
  const equippedMarch = MARCH_SIGNATURES.find((effect) => effect.id === vault.equipped.marchSignature);
  const equippedStrike = STRIKE_SIGNATURES.find((effect) => effect.id === vault.equipped.strikeSignature);
  const equippedWarp = WARP_SIGNATURES.find((effect) => effect.id === (vault.equipped.warpSignature ?? "teleport-beam"));
  const equippedChat = CHAT_SIGNALS.find((effect) => effect.id === vault.equipped.chatSignal);
  const equippedTitle = TITLE_SEALS.find((effect) => effect.id === vault.equipped.title);
  const equippedCursor = GAME_CURSORS.find((effect) => effect.id === vault.equipped.cursor);

  async function copyText(text: string, done: string) {
    try { await navigator.clipboard.writeText(text); flash(done); } catch { flash("COPY FAILED"); }
  }

  async function verifyForDeletion() {
    if (!onReauth) return;
    setDeleteBusy(true);
    try { await onReauth(); setDeleteVerified(true); }
    catch (error) { flash(error instanceof Error && error.message === "different_account" ? "THAT IS A DIFFERENT ACCOUNT" : "VERIFICATION CANCELLED"); }
    finally { setDeleteBusy(false); }
  }

  async function confirmDeletion() {
    setDeleteBusy(true);
    try {
      const result = await requestAccountDeletion(address, deleteTyped);
      onAccountDeleted?.(result.purgeAt);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "";
      if (reason === "reauth_required") setDeleteVerified(false);
      flash(reason === "confirm_mismatch" ? "COMMANDER ID DOES NOT MATCH" : reason === "reauth_required" ? "VERIFY AGAIN — IT HAS BEEN OVER 10 MINUTES" : "DELETION FAILED");
    } finally { setDeleteBusy(false); }
  }

  function flash(message: string) {
    setSignal(message);
    window.setTimeout(() => setSignal((current) => current === message ? "" : current), 2200);
  }

  function commitAccount(next: typeof account, announce = true) {
    setAccount(next);
    savePlayerAccount(next);
    if (announce) flash("PROTOCOL WRITTEN");
  }

  async function saveIdentity() {
    if (bioLooksLikeLink(motto)) {
      flash("NO LINKS OR WALLET ADDRESSES IN INTRODUCTIONS");
      return;
    }
    const nextName = normalizeUsername(callsign);
    const nameChanged = nextName !== normalizeUsername(profile.name);
    if (usernameLength(nextName) < 3 || usernameLength(nextName) > 24) {
      flash("NAME SIGNAL MUST HOLD 3–24 GLYPHS");
      return;
    }
    // Free rename on cooldown: a Rename Signal (Warehouse item) renames now instead.
    const needsSignal = nameChanged && !canRenameForFree(profile);
    if (needsSignal && renameSignals <= 0) {
      flash("RENAME SIGNAL REQUIRED");
      return;
    }
    if (needsSignal && !window.confirm(`Use 1 Rename Signal to change your name to "${nextName}" now?`)) return;
    let serverRename: Awaited<ReturnType<typeof updatePlayerName>> | null = null;
    if (nameChanged) {
      try {
        serverRename = await updatePlayerName(address, nextName, needsSignal);
        if (needsSignal) setRenameSignals((count) => isUnlimitedQuantity(count) ? count : Math.max(0, count - 1));
      } catch (error) {
        const reason = error instanceof Error ? error.message : "";
        flash(reason === "name_taken" ? "NAME ALREADY CLAIMED" : reason === "rename_signal_required" ? "RENAME SIGNAL REQUIRED" : reason === "insufficient_inventory" ? "RENAME SIGNAL REQUIRED" : reason === "invalid_name" ? "USE LETTERS, NUMBERS, . _ OR -" : "NAME CHANGE FAILED");
        return;
      }
    }
    const next: Profile = {
      ...profile,
      name: serverRename?.displayName || nextName,
      motto: motto.trim().slice(0, 72),
      avatarId,
      title: profile.title,
      lastRenamedAt: serverRename?.lastRenamedAt ? new Date(serverRename.lastRenamedAt).toISOString() : nameChanged ? new Date(now).toISOString() : profile.lastRenamedAt,
      renamedOnce: nameChanged ? true : profile.renamedOnce,
    };
    onProfileChange(next);
    flash("DOSSIER SAVED");
  }

  function portraitError(error: unknown) {
    const reason = error instanceof Error ? error.message : "";
    flash(reason === "session_required" ? "SIGN IN TO UPLOAD A PORTRAIT" : reason === "avatar_type" ? "USE A PNG, JPG OR WEBP IMAGE" : reason === "avatar_too_large" ? "IMAGE TOO LARGE" : "PORTRAIT UPLOAD FAILED");
  }

  /** Pick a file → open the crop & zoom step (nothing is uploaded yet). */
  async function pickPortrait(file: File | undefined) {
    if (portraitInput.current) portraitInput.current.value = "";
    if (!file) return;
    try { setCropSource(await loadAvatarSource(file)); } catch (error) { portraitError(error); }
  }

  function closeCropper() {
    if (cropSource) URL.revokeObjectURL(cropSource.src);
    setCropSource(null);
  }

  async function uploadCropped(image: Blob) {
    setPortraitBusy(true);
    try {
      const uploaded = await uploadAvatar(address, image);
      setAvatarId(uploaded.avatar);
      onProfileChange({ ...profile, avatarId: uploaded.avatar, uploadedAvatar: uploaded.avatar, avatarPlayerId: uploaded.playerId });
      closeCropper();
      flash("PORTRAIT UPDATED");
    } catch (error) { portraitError(error); }
    finally { setPortraitBusy(false); }
  }

  /** Switch between the uploaded photo and the sigils; the photo is kept for switching back. */
  function chooseAvatar(value: string) {
    if (value === avatarId) return;
    setAvatarId(value);
    onProfileChange({ ...profile, avatarId: value });
    flash("PORTRAIT UPDATED");
  }

  function equipSkin() {
    if (!ownsPlanetSkin(vault, previewSkin)) return;
    const next = { ...vault, equipped: { ...vault.equipped, planetBody: previewSkin } };
    setVault(next);
    saveCosmeticVault(address, next);
    flash(`${selectedSkin.name.toUpperCase()} BOUND TO HOME`);
  }

  function commitVault(next: typeof vault, message: string) {
    setVault(next);
    saveCosmeticVault(address, next);
    flash(message);
  }

  function equipMarchSignature(signatureId: MarchSignatureId) {
    const effect = MARCH_SIGNATURES.find((item) => item.id === signatureId);
    if (!effect || !ownsMarchSignature(vault, signatureId)) { flash("MARCH SIGNATURE NOT RECOVERED"); return; }
    const next = { ...vault, equipped: { ...vault.equipped, marchSignature: signatureId } };
    commitVault(next, `${effect.name.toUpperCase()} BOUND TO FLEETS`);
  }

  function equipWarpSignature(signatureId: WarpSignatureId) {
    const effect = WARP_SIGNATURES.find((item) => item.id === signatureId);
    if (!effect || !ownsWarpSignature(vault, signatureId)) { flash("WARP ARRIVAL NOT RECOVERED"); return; }
    const next = { ...vault, equipped: { ...vault.equipped, warpSignature: signatureId } };
    commitVault(next, `${effect.name.toUpperCase()} BOUND TO WARPS`);
  }

  function equipStrikeSignature(signatureId: StrikeSignatureId) {
    const effect = STRIKE_SIGNATURES.find((item) => item.id === signatureId);
    if (!effect || !ownsStrikeSignature(vault, signatureId)) { flash("STRIKE IMPRINT NOT RECOVERED"); return; }
    const next = { ...vault, equipped: { ...vault.equipped, strikeSignature: signatureId } };
    commitVault(next, effect.name.toUpperCase() + " BOUND TO IMPACT");
  }

  function equipPlanetOrbit(orbitId: PlanetOrbitId) {
    const orbit = PLANET_ORBITS.find((item) => item.id === orbitId);
    if (!orbit || !ownsPlanetOrbit(vault, orbitId)) { flash("ORBITAL ARRAY NOT RECOVERED"); return; }
    const next = { ...vault, equipped: { ...vault.equipped, orbit: orbitId } };
    commitVault(next, `${orbit.name.toUpperCase()} BOUND TO ORBIT`);
  }

  function equipPlanetHalo(haloId: PlanetHaloId) {
    const halo = PLANET_HALOS.find((item) => item.id === haloId);
    if (!halo || !ownsPlanetHalo(vault, haloId)) { flash("PLANET HALO NOT RECOVERED"); return; }
    const next = { ...vault, equipped: { ...vault.equipped, halo: haloId } };
    commitVault(next, `${halo.name.toUpperCase()} BOUND TO HALO`);
  }

  function equipChatSignal(signalId: ChatSignalId) {
    const effect = CHAT_SIGNALS.find((item) => item.id === signalId);
    if (!effect || !ownsChatSignal(vault, signalId)) { flash("NAME SIGNAL NOT RECOVERED"); return; }
    const next = { ...vault, equipped: { ...vault.equipped, chatSignal: signalId } };
    commitVault(next, `${effect.name.toUpperCase()} BOUND TO COMMS`);
  }

  function equipTitleSeal(titleId: TitleId) {
    const effect = TITLE_SEALS.find((item) => item.id === titleId);
    if (!effect || !ownsTitleSeal(vault, titleId)) { flash("TITLE SEAL NOT RECOVERED"); return; }
    const next = { ...vault, equipped: { ...vault.equipped, title: titleId } };
    commitVault(next, `${effect.name.toUpperCase()} SEALED TO DOSSIER`);
    onProfileChange({ ...profile, title: effect.name.toUpperCase() });
  }

  function equipGameCursor(cursorId: GameCursorId) {
    const effect = GAME_CURSORS.find((item) => item.id === cursorId);
    if (!effect || !ownsGameCursor(vault, cursorId)) { flash("COMMAND CURSOR NOT RECOVERED"); return; }
    const next = { ...vault, equipped: { ...vault.equipped, cursor: cursorId } };
    commitVault(next, `${effect.name.toUpperCase()} BOUND TO COMMAND HAND`);
  }

  function unbind(kind: Exclude<RelicPreviewKind, "planet">) {
    const next = { ...vault, equipped: { ...vault.equipped } };
    if (kind === "halo") next.equipped.halo = null;
    else if (kind === "orbit") next.equipped.orbit = null;
    else if (kind === "march") next.equipped.marchSignature = null;
    else if (kind === "warp") next.equipped.warpSignature = null;
    else if (kind === "strike") next.equipped.strikeSignature = null;
    else if (kind === "chat") next.equipped.chatSignal = null;
    else if (kind === "title") next.equipped.title = null;
    else next.equipped.cursor = null;
    commitVault(next, `${selectedRelicTarget} RELIC RELEASED`);
    if (kind === "title") onProfileChange({ ...profile, title: "" });
  }

  function playSubtabSfx() {
    if (account.soundEnabled) playSfx(SFX_SUBTAB_SWITCH, SFX_SUBTAB_SWITCH_VOLUME * account.sfxVolume);
  }
  function switchSection(next: ArchiveSection) {
    if (next !== section) playSubtabSfx();
    setSection(next);
  }


  function pickRelic(cat: RelicCategory, id: string) {
    setPreviewKind(RELIC_META[cat].kind);
    if (cat === "core") setPreviewSkin(id as PlanetSkinId);
    else if (cat === "halo") setPreviewHalo(id as PlanetHaloId);
    else if (cat === "orbit") setPreviewOrbit(id as PlanetOrbitId);
    else if (cat === "march") setPreviewMarch(id as MarchSignatureId);
    else if (cat === "warp") setPreviewWarp(id as WarpSignatureId);
    else if (cat === "strike") setPreviewStrike(id as StrikeSignatureId);
    else if (cat === "name") setPreviewChat(id as ChatSignalId);
    else if (cat === "title") setPreviewTitle(id as TitleId);
    else setPreviewCursor(id as GameCursorId);
  }

  function openVaultCategory(cat: RelicCategory) {
    if (cat !== vaultCategory) playSubtabSfx();
    setVaultCategory(cat);
    const items = relicItems(cat);
    pickRelic(cat, (items.find((item) => item.equipped) || items[0]).id);
  }

  /** Every relic in a category, in catalog order, with ownership, equip state and a small icon. */
  function relicItems(cat: RelicCategory): { id: string; name: string; translatedName?: string; tier: string; owned: boolean; equipped: boolean; icon: ReactNode }[] {
    const e = vault.equipped;
    if (cat === "core") return PLANET_SKINS.map((x) => ({ id: x.id, name: x.name, translatedName: x.translatedName, tier: x.tier || "R", owned: ownsPlanetSkin(vault, x.id), equipped: e.planetBody === x.id, icon: <PlanetOrbitPreview skin={x.id} orbit={null} chrome={false} staticPreview className="profile-core-isolation" /> }));
    if (cat === "halo") return PLANET_HALOS.map((x) => ({ id: x.id, name: x.name, translatedName: x.translatedName, tier: x.tier || "R", owned: ownsPlanetHalo(vault, x.id), equipped: e.halo === x.id, icon: <i className={`halo-effect-icon halo-effect-${x.id}`} /> }));
    if (cat === "orbit") return PLANET_ORBITS.map((x) => ({ id: x.id, name: x.name, translatedName: x.translatedName, tier: x.tier || "R", owned: ownsPlanetOrbit(vault, x.id), equipped: e.orbit === x.id, icon: <i className={`orbit-effect-icon orbit-effect-${x.id}`} /> }));
    if (cat === "march") return MARCH_SIGNATURES.map((x) => ({ id: x.id, name: x.name, translatedName: x.translatedName, tier: x.tier || "R", owned: ownsMarchSignature(vault, x.id), equipped: e.marchSignature === x.id, icon: <i className={`march-effect-icon march-effect-${x.id}`} /> }));
    if (cat === "warp") return WARP_SIGNATURES.map((x) => ({ id: x.id, name: x.name, translatedName: x.translatedName, tier: x.tier || "R", owned: ownsWarpSignature(vault, x.id), equipped: (e.warpSignature ?? "teleport-beam") === x.id, icon: <i className={`warp-effect-icon warp-effect-${x.id}`} style={{ "--accent": x.accent } as CSSProperties}><span /></i> }));
    if (cat === "strike") return STRIKE_SIGNATURES.map((x) => ({ id: x.id, name: x.name, translatedName: x.translatedName, tier: x.tier || "R", owned: ownsStrikeSignature(vault, x.id), equipped: e.strikeSignature === x.id, icon: <i className={`strike-effect-icon strike-effect-${x.id}`}><span /></i> }));
    if (cat === "name") return CHAT_SIGNALS.map((x) => ({ id: x.id, name: x.name, translatedName: x.translatedName, tier: x.tier || "R", owned: ownsChatSignal(vault, x.id), equipped: e.chatSignal === x.id, icon: <i className="chat-effect-icon"><NameSignal signal={x.id} mode="static">A</NameSignal></i> }));
    if (cat === "title") return TITLE_SEALS.map((x, index) => ({ id: x.id, name: x.name.toUpperCase(), translatedName: x.translatedName, tier: x.tier || "R", owned: ownsTitleSeal(vault, x.id), equipped: e.title === x.id, icon: <i className="title-effect-icon">{["Ⅰ", "⌁", "◎"][index] || "◇"}</i> }));
    return GAME_CURSORS.map((x) => ({ id: x.id, name: x.name, translatedName: x.translatedName, tier: x.tier || "R", owned: ownsGameCursor(vault, x.id), equipped: e.cursor === x.id, icon: <i className={`cursor-effect-icon cursor-effect-${x.id}`}><CursorGlyph cursor={x.id} /></i> }));
  }

  function bindSelectedRelic() {
    if (previewKind === "planet") equipSkin();
    else if (previewKind === "halo") equipPlanetHalo(previewHalo);
    else if (previewKind === "orbit") equipPlanetOrbit(previewOrbit);
    else if (previewKind === "march") equipMarchSignature(previewMarch);
    else if (previewKind === "warp") equipWarpSignature(previewWarp);
    else if (previewKind === "strike") equipStrikeSignature(previewStrike);
    else if (previewKind === "chat") equipChatSignal(previewChat);
    else if (previewKind === "title") equipTitleSeal(previewTitle);
    else equipGameCursor(previewCursor);
  }

  function triggerSelectedRelic() {
    if (selectedRelicEquipped && previewKind !== "planet" && !(previewKind === "warp" && previewWarp === "teleport-beam")) unbind(previewKind);
    else bindSelectedRelic();
  }

  const ownedSkinCount = PLANET_SKINS.filter((skin) => ownsPlanetSkin(vault, skin.id)).length;
  const celestialRecovered = ownedSkinCount
    + PLANET_HALOS.filter((halo) => ownsPlanetHalo(vault, halo.id)).length
    + PLANET_ORBITS.filter((orbit) => ownsPlanetOrbit(vault, orbit.id)).length;
  const fieldRecovered = MARCH_SIGNATURES.filter((effect) => ownsMarchSignature(vault, effect.id)).length
    + WARP_SIGNATURES.filter((effect) => ownsWarpSignature(vault, effect.id)).length
    + STRIKE_SIGNATURES.filter((effect) => ownsStrikeSignature(vault, effect.id)).length
    + GAME_CURSORS.filter((cursor) => ownsGameCursor(vault, cursor.id)).length;
  const socialRecovered = CHAT_SIGNALS.filter((effect) => ownsChatSignal(vault, effect.id)).length
    + TITLE_SEALS.filter((title) => ownsTitleSeal(vault, title.id)).length;
  // First change of the system-issued name is free; after that the Rename Signal count shows and
  // each rename spends one (GM: unlimited, shown as ∞).
  const freeRenameReady = canRenameForFree(profile);
  const renameLocked = !freeRenameReady && renameSignals <= 0;
  const renameWindow = freeRenameReady ? "FIRST RENAME FREE" : `RENAME SIGNALS: ${isUnlimitedQuantity(renameSignals) ? "∞" : renameSignals}`;
  const socialSignal = previewKind === "chat" ? previewChat : vault.equipped.chatSignal;
  const socialTitle = previewKind === "title" ? selectedTitle.name.toUpperCase() : equippedTitle?.name.toUpperCase() || null;

  const cardPlayerId = loadBackendSession(address)?.player.id ?? profile.avatarPlayerId ?? account.playerId;
  const backendSession = loadBackendSession(address);
  // The uploaded photo stays a portrait option (older profiles: the photo in use counts too).
  const uploadedPhoto = profile.uploadedAvatar || (/^u\d+$/.test(profile.avatarId || "") ? profile.avatarId : undefined);
  const commanderId = commanderIdOf(backendSession?.player.id ?? address);
  const signInMethod = backendSession?.player.authMethod ?? (account.loginMethod === "google" ? "google" : "wallet");
  const signInLabel = signInMethod === "google" ? "Google" : signInMethod === "guest" ? "Quick Play" : "Wallet";
  const ownShieldBuff = activeBuffs(address, game.buildings.keep.lvl, now, getN()).find((buff) => buff.id === "shield");
  const ownShield = ownShieldBuff ? buffTimeLeft(ownShieldBuff, now) : null;
  const bioBlocked = bioLooksLikeLink(motto);
  const identityDirty = normalizeUsername(callsign) !== normalizeUsername(profile.name) || motto.trim() !== (profile.motto || "").trim();
  const loadoutSlots: { key: RelicCategory; label: string; relic: { name: string; translatedName?: string; tier?: string } | undefined }[] = [
    { key: "core", label: "CORE", relic: equippedSkin },
    { key: "halo", label: "HALO", relic: equippedHalo },
    { key: "orbit", label: "ORBIT", relic: equippedOrbit },
    { key: "warp", label: "WARP", relic: equippedWarp },
    { key: "march", label: "MARCH", relic: equippedMarch },
    { key: "strike", label: "STRIKE", relic: equippedStrike },
    { key: "name", label: "NAME", relic: equippedChat },
    { key: "title", label: "TITLE", relic: equippedTitle },
    { key: "cursor", label: "CURSOR", relic: equippedCursor },
  ];
  const tierSummary = (["UR", "SSR", "SR", "R"] as const)
    .map((tier) => [tier, loadoutSlots.filter((slot) => (slot.relic?.tier || (slot.relic ? "R" : "")) === tier).length] as const)
    .filter(([, count]) => count > 0);
  // Catalog relics only (the vault can also hold legacy ids), so the count never exceeds the total.
  const relicOwned = celestialRecovered + fieldRecovered + socialRecovered;
  const homeCoord = city?.kind === "city" ? `${Math.round(city.position.x).toString().padStart(3, "0")} : ${Math.round(city.position.y).toString().padStart(3, "0")}` : "Uncharted";
  const insignia = computeInsignia({ coreLevel: game.buildings.keep.lvl, rogue: player?.highestMonsterDefeated ?? 0, relics: relicOwned, aligned: !!profile.factionSymbol });

  return <section className={`profile-screen ${account.reducedMotion ? "profile-motion-stilled" : ""}`}>
    <CosmicBackdrop address={address} />
    <div className="world-page-black-hole" aria-hidden="true"><i className="world-page-hole-glow" /><i className="world-page-accretion" /><i className="world-page-hole-core" /></div>
    <GameNav view="profile" profile={profile} townhallLevel={game.buildings.keep.lvl} location={location}
      resources={game.res} incomePerHour={prodPerHour(game)} resourceCap={capacity(game)} stamina={player ? energyAt(player, now, world!.world.config) : 100} staminaCap={world?.world.config.energyCap ?? 100} troops={totalTroops(game)} wounded={game.wounded}
      might={mightBreakdown(game).total} credits={account.credits} onAlliance={onAlliance} onCity={onCity} onWorld={onWorld} onMessages={onMessages} onShop={onShop} onProfile={() => {}} />

    {signal && <div className="profile-signal" role="status">{signal}</div>}


    <nav className="profile-tabs" aria-label="Commander archive">
      {(["dossier", "vault", "wallet", "protocols"] as ArchiveSection[]).map((tab) => <button key={tab} className={section === tab ? "active" : ""} aria-current={section === tab ? "page" : undefined} onClick={() => switchSection(tab)}>
        <span>{tab === "dossier" ? "01" : tab === "vault" ? "02" : tab === "wallet" ? "03" : "04"}</span>
        <b>{tab === "dossier" ? "DOSSIER" : tab === "vault" ? "RELIC VAULT" : tab === "wallet" ? "ACCOUNT" : "GAME SETTINGS"}</b>
      </button>)}
    </nav>

    {section === "dossier" && <div className="dossier-grid">
      {/* Identity: the exact card other commanders see, plus portrait, name and introduction. */}
      <article className="profile-card dossier-identity">
        <header><small>YOUR COMMANDER CARD</small><span>AS OTHERS SEE IT</span></header>
        <div className="commander-card is-static" style={{ "--commander": "#38d9ff" } as CSSProperties}>
          <CommanderCardView id={cardPlayerId} name={profile.name} faction={profile.factionSymbol || null} avatar={profile.avatarId || "genesis"}
            coreLevel={game.buildings.keep.lvl} signal={vault.equipped.chatSignal} recon={null} now={now} shield={ownShield} bio={profile.motto || null} />
        </div>
        <div className="dossier-portrait">
          <CommanderAvatar playerId={cardPlayerId} avatar={avatarId} className="dossier-portrait-face" />
          <div>
            <small>PORTRAIT</small>
            <div className="dossier-portrait-actions">
              <button type="button" className="profile-action primary" disabled={portraitBusy} onClick={() => portraitInput.current?.click()}>{uploadedPhoto ? "NEW PHOTO" : "UPLOAD PHOTO"}</button>
              <input ref={portraitInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => void pickPortrait(event.target.files?.[0])} />
            </div>
            <div className="dossier-sigils" role="group" aria-label="Choose your portrait">
              {[...(uploadedPhoto ? [uploadedPhoto] : []), "genesis", "orbit"].map((option) => <button key={option} type="button" className={avatarId === option ? "selected" : ""} aria-label={option === uploadedPhoto ? "Use your photo" : `Use the ${option} sigil`} onClick={() => chooseAvatar(option)}><CommanderAvatar playerId={cardPlayerId} avatar={option} /></button>)}
            </div>
          </div>
        </div>
        <label className={`dossier-field${renameLocked ? " locked" : ""}`}><span>NAME <em>{renameWindow}</em></span><input value={callsign} maxLength={24} disabled={renameLocked} title={renameLocked ? "Renaming again uses a Rename Signal" : undefined} onChange={(event) => setCallsign(event.target.value)} /></label>
        <label className={`dossier-field${bioBlocked ? " invalid" : ""}`}><span>INTRODUCTION <em>{bioBlocked ? "NO LINKS OR WALLET ADDRESSES" : `${motto.length} / 80`}</em></span><textarea value={motto} maxLength={80} rows={2} placeholder="One line other commanders will see on your card." onChange={(event) => setMotto(event.target.value.replace(/\n/g, " "))} /></label>
        <button className="profile-action primary full" disabled={!identityDirty || bioBlocked} onClick={() => void saveIdentity()}>SAVE CHANGES</button>
      </article>

      {/* Loadout: the bound assembly, then every slot with the relic and its grade. */}
      <article className="profile-card dossier-loadout">
        <header><small>EQUIPPED RELICS</small><span className="dossier-tier-summary">{tierSummary.map(([tier, count]) => <i key={tier} className={`relic-tier tier-${tier}`}>{tier} ×{count}</i>)}</span></header>
        <div className="profile-home-stage"><PlanetOrbitPreview skin={vault.equipped.planetBody} halo={vault.equipped.halo} orbit={vault.equipped.orbit} chrome={false} fitAssembly className="profile-bound-assembly" /><span className="profile-home-lod">STAR MAP // LIVE</span></div>
        <div className="dossier-slots">
          {loadoutSlots.map((slot) => <button key={slot.key} type="button" className={slot.relic ? "" : "empty"} onClick={() => { setSection("vault"); openVaultCategory(slot.key); }}>
            <span className="dossier-slot-name">{slot.label}</span>
            {slot.relic ? <>
              <i className={`relic-tier tier-${slot.relic.tier || "R"}`}>{slot.relic.tier || "R"}</i>
              <b>{slot.relic.name}</b>
            </> : <><i className="relic-tier tier-none">—</i><b className="dossier-slot-empty">Empty</b></>}
            <span className="dossier-slot-go" aria-hidden="true">›</span>
          </button>)}
        </div>
      </article>

      {/* Record + insignia: real numbers only. */}
      <aside className="dossier-side">
        <article className="profile-card dossier-record">
          <header><small>SERVICE RECORD</small><span>FRONTIER I</span></header>
          <dl>
            <div><dt>MIGHT</dt><dd>{mightBreakdown(game).total.toLocaleString()}</dd></div>
            <div><dt>CORE</dt><dd>Lv.{game.buildings.keep.lvl}</dd></div>
            <div><dt>ALLIANCE</dt><dd>{profile.factionSymbol ? `$${profile.factionSymbol}` : "Unaligned"}</dd></div>
            <div><dt>JOINED</dt><dd>{player ? new Intl.DateTimeFormat(account.language, { month: "short", day: "numeric", year: "numeric" }).format(player.joinedAt) : "—"}</dd></div>
            <div><dt>RELICS</dt><dd>{relicOwned} held</dd></div>
            <div><dt>COORDINATES</dt><dd>{homeCoord}</dd></div>
          </dl>
        </article>
        <article className="profile-card dossier-insignia">
          <header><small>INSIGNIA</small><span>{insignia.filter((entry) => entry.earned).length} / {insignia.length} EARNED</span></header>
          <ul>
            {insignia.map((entry) => <li key={entry.id} className={entry.earned ? "earned" : ""}>
              <i aria-hidden="true">{entry.glyph}</i>
              <div>
                <b>{entry.name}{entry.rank ? <em>{entry.rank}</em> : null}</b>
                <small>{entry.detail}</small>
                {entry.next && <span className="dossier-progress" aria-label={`${entry.progress} of ${entry.next}`}><span style={{ width: `${Math.min(100, (entry.progress / entry.next) * 100)}%` }} /><em>{entry.progress} / {entry.next}</em></span>}
              </div>
            </li>)}
          </ul>
        </article>
      </aside>
    </div>}

    {section === "vault" && (() => {
      const items = relicItems(vaultCategory);
      const meta = RELIC_META[vaultCategory];
      const group = RELIC_GROUPS.find((entry) => entry.cats.includes(vaultCategory))!;
      const selectedId = previewKind === "planet" ? previewSkin : previewKind === "halo" ? previewHalo : previewKind === "orbit" ? previewOrbit : previewKind === "march" ? previewMarch : previewKind === "warp" ? previewWarp : previewKind === "strike" ? previewStrike : previewKind === "chat" ? previewChat : previewKind === "title" ? previewTitle : previewCursor;
      const locked = previewKind === "planet" || (previewKind === "warp" && previewWarp === "teleport-beam");
      const action = !selectedRelicOwned ? "NOT OWNED" : selectedRelicEquipped ? (locked ? "EQUIPPED" : "UNEQUIP") : "EQUIP";
      return <div className="vault">
        <nav className="vault-tabs" aria-label="Relic categories">
          {RELIC_GROUPS.map((entry) => <div key={entry.label} className="vault-tab-group">
            <small>{entry.label}</small>
            <div>{entry.cats.map((cat) => <button key={cat} type="button" className={vaultCategory === cat ? "active" : ""} aria-pressed={vaultCategory === cat} onClick={() => openVaultCategory(cat)}>
              <b>{RELIC_META[cat].label}</b>
            </button>)}</div>
          </div>)}
        </nav>
        <div className="vault-body">
          <article className="profile-card vault-preview">
            <header><small>PREVIEW · {meta.label}</small><i className={`relic-tier tier-${selectedRelicTier}`}>{selectedRelicTier}</i></header>
            <div className={`profile-vault-stage vault-stage preview-${previewKind}`}>
              {previewKind === "march" ? <MarchSignaturePreview signature={previewMarch} />
                : previewKind === "strike" ? <StrikeSignaturePreview signature={previewStrike} reducedMotion={account.reducedMotion} />
                : previewKind === "warp" ? <WarpSignaturePreview signature={previewWarp} reducedMotion={account.reducedMotion} />
                : previewKind === "cursor" ? <CursorPreview cursor={previewCursor} />
                : previewKind === "chat" || previewKind === "title" ? <ChatSignalPreview signal={previewKind === "chat" ? previewChat : vault.equipped.chatSignal} title={previewKind === "title" ? selectedTitle.name.toUpperCase() : equippedTitle?.name.toUpperCase() || null} username={profile.name} faction={profile.factionSymbol} reducedMotion={account.reducedMotion} />
                : <PlanetOrbitPreview skin={previewKind === "planet" ? previewSkin : vault.equipped.planetBody} halo={previewKind === "halo" ? previewHalo : vault.equipped.halo} orbit={previewKind === "orbit" ? previewOrbit : vault.equipped.orbit} chrome={false} fitAssembly className="profile-bound-assembly" />}
            </div>
            <div className="vault-copy">
              <h2>{selectedRelic.name}</h2>
              <p>{selectedRelic.transmission}</p>
              <button type="button" className={`profile-action full ${action === "EQUIP" ? "primary" : ""}`} disabled={action === "NOT OWNED" || action === "EQUIPPED"} onClick={triggerSelectedRelic}>{action}</button>
            </div>
          </article>
          <section className="vault-list">
            <div className="vault-list-head"><div><small>{group.label}</small><b>{meta.label}</b></div><span>{meta.where}</span></div>
            <div className={`vault-grid vault-grid-${vaultCategory}`}>
              {items.map((item) => <button key={item.id} type="button" className={`${item.id === selectedId ? "selected" : ""} ${item.owned ? "owned" : "locked"} ${item.equipped ? "equipped" : ""}`} onClick={() => pickRelic(vaultCategory, item.id)}>
                <span className="vault-tile-art">{item.icon}</span>
                <span className="vault-tile-copy">
                  <span className="vault-tile-top"><i className={`relic-tier tier-${item.tier}`}>{item.tier}</i>{item.equipped ? <em className="vault-state on">EQUIPPED</em> : null}</span>
                  <b>{item.name}</b>
                </span>
              </button>)}
            </div>
          </section>
        </div>
      </div>;
    })()}

    {section === "wallet" && <div className="profile-system-grid">
      <article className="profile-card"><header><small>ACCOUNT</small><span>{signInLabel.toUpperCase()}</span></header>
        <div className="profile-ledger">
          <div><small>SIGN-IN</small><span><b>{signInLabel}</b></span></div>
          {signInMethod === "wallet" && account.primaryWallet && <div><small>WALLET</small><span><b>{shortWallet(account.primaryWallet)}</b></span><button onClick={() => void copyText(account.primaryWallet!, "WALLET ADDRESS COPIED")}>COPY</button></div>}
          <div><small>COMMANDER ID</small><span><b>{commanderId}</b></span><button onClick={() => void copyText(commanderId, "COMMANDER ID COPIED")}>COPY</button></div>
        </div>
      </article>
      <article className="profile-card"><header><small>BALANCES</small><span>ACCOUNT-BOUND</span></header>
        <div className="profile-treasury">
          <div><small>CREDITS</small><b>◇ {account.credits.toLocaleString()}</b></div>
          <div><small>$MOJO</small><b>0</b></div>
        </div>
        <button className="profile-action full" onClick={onShop}>OPEN SHOP</button>
      </article>
    </div>}

    {section === "protocols" && <div className="profile-system-grid">
      <article className="profile-card"><header><small>DISPLAY</small><span>THIS DEVICE</span></header>
        <div className="profile-fields"><label><span>STAR MAP QUALITY</span><select value={account.graphicsTier} onChange={(event) => commitAccount({ ...account, graphicsTier: event.target.value as GraphicsTier })}>{(["auto", "ultra", "high", "medium", "low"] as GraphicsTier[]).map((tier) => <option value={tier} key={tier}>{GRAPHICS_TIER_LABEL[tier]}{tier === "auto" ? ` → ${GRAPHICS_TIER_LABEL[detectAutoTier()].toUpperCase()}` : ""}</option>)}</select></label><p className="profile-field-hint">{GRAPHICS_TIER_HINT[account.graphicsTier]}</p></div>
        <div className="profile-switch-list"><SwitchRow title="Reduce motion" detail="STILLS ANIMATED EFFECTS" checked={account.reducedMotion} onChange={(value) => commitAccount({ ...account, reducedMotion: value })} /></div>
      </article>
      <article className="profile-card"><header><small>SOUND</small><span>THIS ACCOUNT</span></header><div className="profile-switch-list">
        <SwitchRow title="Music" detail="BACKGROUND SCORE" checked={account.musicEnabled} onChange={(value) => commitAccount({ ...account, musicEnabled: value })} />
        <div className={`profile-volume-control ${account.musicEnabled ? "live" : "muted"}`}><span><b>Music volume</b><small>{Math.round(account.musicVolume * 100)}%</small></span><input aria-label="Music volume" type="range" min="0" max="100" step="1" value={Math.round(account.musicVolume * 100)} onChange={(event) => commitAccount({ ...account, musicVolume: Number(event.target.value) / 100 }, false)} onPointerUp={() => flash("MUSIC VOLUME SET")} /></div>
        <SwitchRow title="Sound effects" detail="CLICKS · FLEETS · ALERTS · COMMS" checked={account.soundEnabled} onChange={(value) => commitAccount({ ...account, soundEnabled: value })} />
        <div className={`profile-volume-control ${account.soundEnabled ? "live" : "muted"}`}><span><b>Sound effects volume</b><small>{Math.round(account.sfxVolume * 100)}%</small></span><input aria-label="Sound effects volume" type="range" min="0" max="100" step="1" value={Math.round(account.sfxVolume * 100)} onChange={(event) => commitAccount({ ...account, sfxVolume: Number(event.target.value) / 100 }, false)} onPointerUp={() => flash("EFFECTS VOLUME SET")} /></div>
      </div></article>
      <article className="profile-card profile-wide-card"><header><small>PRIVACY</small><span>THIS ACCOUNT</span></header><div className="profile-switch-list">
        <SwitchRow title="Filter messages from new commanders" detail="ONLY ALLIANCE MEMBERS AND CORE 10+ COMMANDERS CAN START A CHAT WITH YOU" checked={account.filterNewCommanderDms} onChange={(value) => commitAccount({ ...account, filterNewCommanderDms: value })} />
      </div></article>
      <article className="profile-card profile-wide-card profile-danger"><header><small>DELETE ACCOUNT</small><span>7-DAY GRACE PERIOD</span></header>
        <div className="delete-account">
          <p>Your commander, city, items, relics, portrait and messages are deleted 7 days after you confirm. Until then the account is frozen and hidden from other commanders — sign in again within 7 days to cancel. Purchase records are kept for refunds and accounting.</p>
          {!deleteOpen ? <button className="profile-action danger" disabled={!onReauth || !backendSession} onClick={() => setDeleteOpen(true)}>{onReauth && backendSession ? "DELETE ACCOUNT…" : "SIGN IN TO MANAGE YOUR ACCOUNT"}</button> : <>
            <div className={`delete-step${deleteVerified ? " done" : ""}`}>
              <b>1 · Confirm it's you</b>
              <button className="profile-action" disabled={deleteBusy || deleteVerified} onClick={() => void verifyForDeletion()}>{deleteVerified ? "VERIFIED ✓" : signInMethod === "wallet" ? "SIGN WITH YOUR WALLET" : signInMethod === "google" ? "SIGN IN WITH GOOGLE AGAIN" : "VERIFY THIS DEVICE"}</button>
            </div>
            <label className="delete-step">
              <b>2 · Type your Commander ID <code>{commanderId}</code></b>
              <input value={deleteTyped} spellCheck={false} autoComplete="off" placeholder="Paste your Commander ID" onChange={(event) => setDeleteTyped(event.target.value.toUpperCase())} />
            </label>
            <div className="delete-actions">
              <button className="profile-action" onClick={() => { setDeleteOpen(false); setDeleteVerified(false); setDeleteTyped(""); }}>KEEP MY ACCOUNT</button>
              <button className="profile-action danger" disabled={deleteBusy || !deleteVerified || deleteTyped.trim() !== commanderId} onClick={() => void confirmDeletion()}>DELETE MY ACCOUNT</button>
            </div>
          </>}
        </div>
      </article>
    </div>}
    {cropSource && <AvatarCropper image={cropSource} busy={portraitBusy} onCancel={closeCropper} onConfirm={(blob) => void uploadCropped(blob)} />}
  </section>;
}

function SwitchRow({ title, detail, checked, onChange }: { title: string; detail: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <div><span><b>{title}</b><small>{detail}</small></span><button className={checked ? "on" : ""} role="switch" aria-checked={checked} aria-label={title} onClick={() => onChange(!checked)}><i /></button></div>;
}

type Insignia = { id: string; glyph: string; name: string; rank: string | null; detail: string; earned: boolean; progress: number; next: number | null };

/**
 * Insignia families from real account data. Each shows its highest earned rank and the
 * progress toward the next one; nothing here is decorative filler.
 */
function computeInsignia({ coreLevel, rogue, relics, aligned }: { coreLevel: number; rogue: number; relics: number; aligned: boolean }): Insignia[] {
  const ladder = (id: string, glyph: string, name: string, value: number, steps: number[], unit: (step: number) => string): Insignia => {
    const earned = steps.filter((step) => value >= step).length;
    const next = steps[earned] ?? null;
    return { id, glyph, name, rank: earned ? ["I", "II", "III", "IV"][earned - 1] : null, earned: earned > 0,
      detail: next ? unit(next) : "Highest rank reached", progress: Math.min(value, next ?? value), next };
  };
  return [
    { id: "first-light", glyph: "Ⅰ", name: "FIRST LIGHT", rank: null, detail: "Founding commander of the Frontier alpha", earned: true, progress: 1, next: null },
    ladder("architect", "⌂", "ARCHITECT", coreLevel, [10, 20, 30], (step) => `Raise your Core to Lv.${step}`),
    ladder("rogue-hunter", "◈", "ROGUE HUNTER", rogue, [5, 10, 20], (step) => `Defeat a Lv.${step} Rogue`),
    ladder("collector", "✦", "RELIC COLLECTOR", relics, [5, 15, 30], (step) => `Recover ${step} relics`),
    { id: "sworn", glyph: "⚑", name: "SWORN", rank: null, detail: aligned ? "Pledged to an Alliance" : "Join an Alliance", earned: aligned, progress: aligned ? 1 : 0, next: aligned ? null : 1 },
  ];
}
