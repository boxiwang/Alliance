import { useMemo, useState } from "react";
import CosmicBackdrop from "./CosmicBackdrop";
import GameNav from "./GameNav";
import MarchSignaturePreview from "./MarchSignaturePreview";
import PlanetOrbitPreview from "./PlanetOrbitPreview";
import PlayerCard from "./PlayerCard";
import { canRenameForFree, nextFreeRenameAt, normalizeUsername, usernameLength, type Profile } from "./lib/profile";
import { mightBreakdown, project, totalTroops, worldMarchSlots } from "./lib/game";
import { initGame, loadGame } from "./lib/gamestore";
import { loadLocalWorldSession } from "./lib/world-adapter";
import { energyAt } from "./lib/world-engine";
import {
  CONSENT_VERSIONS,
  CHAT_SIGNALS,
  MARCH_SIGNATURES,
  PLANET_HALOS,
  PLANET_ORBITS,
  PLANET_SKINS,
  type ChatSignalId,
  type ConsentKey,
  type LanguageCode,
  type MarchSignatureId,
  type PlanetHaloId,
  type PlanetOrbitId,
  type PlanetSkinId,
  loadCosmeticVault,
  loadPlayerAccount,
  ownsChatSignal,
  ownsMarchSignature,
  ownsPlanetHalo,
  ownsPlanetOrbit,
  ownsPlanetSkin,
  saveCosmeticVault,
  savePlayerAccount,
} from "./lib/player-account";

type ArchiveSection = "dossier" | "vault" | "wallet" | "protocols";
type RelicPreviewKind = "planet" | "halo" | "orbit" | "march" | "chat";

function initialArchiveSection(): ArchiveSection {
  const requested = new URLSearchParams(window.location.search).get("section") as ArchiveSection | null;
  return requested && ["dossier", "vault", "wallet", "protocols"].includes(requested) ? requested : "dossier";
}

function initialRelicPreviewKind(): RelicPreviewKind {
  const requested = new URLSearchParams(window.location.search).get("preview") as RelicPreviewKind | null;
  return requested && ["planet", "halo", "orbit", "march", "chat"].includes(requested) ? requested : "planet";
}

const LANGUAGE_NAMES: Record<LanguageCode, string> = {
  en: "English",
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
  ja: "日本語",
  ko: "한국어",
  es: "Español",
};

const LEGAL_RECORDS: Array<{ key: ConsentKey; name: string; legal: string }> = [
  { key: "terms", name: "Service Accord", legal: "Terms of Service" },
  { key: "privacy", name: "Data Charter", legal: "Privacy Policy" },
  { key: "digitalAssets", name: "Asset Risk Codex", legal: "Digital Asset Risk Disclosure" },
];

function shortWallet(address: string | null): string {
  if (!address) return "NO KEY LINKED";
  return address.length > 14 ? `${address.slice(0, 8)}…${address.slice(-6)}` : address;
}

function ChatSignalPreview({ signal, username, faction }: { signal: ChatSignalId; username: string; faction: string | null }) {
  return <div className={`relic-chat-preview relic-chat-${signal}`}>
    <div className="relic-chat-channel"><span>◇ ALLIANCE SIGNAL</span><i>LIVE</i></div>
    <div className="relic-chat-message"><div className="relic-chat-avatar">{username.slice(0, 1)}</div><div><header><small>[{faction || "SOLO"}]</small><b>{username}</b><time>NOW</time></header><p>The frontier remembers who crossed it.</p></div></div>
    <div className="relic-chat-message reply"><div className="relic-chat-avatar">N</div><div><header><small>[ORBT]</small><b>NyxValidator</b><time>NOW</time></header><p>Signal received. Opening a direct channel.</p></div></div>
    <small>COMMS IDENTITY // OUTBOUND</small>
  </div>;
}

export default function ProfileScreen({
  address, profile, onProfileChange, onCity, onWorld, onMessages,
}: {
  address: string;
  profile: Profile;
  onProfileChange: (profile: Profile) => void;
  onCity: () => void;
  onWorld: () => void;
  onMessages: () => void;
}) {
  const [section, setSection] = useState<ArchiveSection>(initialArchiveSection);
  const [account, setAccount] = useState(() => loadPlayerAccount(address));
  const [vault, setVault] = useState(() => loadCosmeticVault(address));
  const previewParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const requestedSkin = previewParams.get("skin") as PlanetSkinId | null;
  const requestedHalo = previewParams.get("halo") as PlanetHaloId | null;
  const requestedOrbit = previewParams.get("orbit") as PlanetOrbitId | null;
  const requestedMarch = previewParams.get("signature") as MarchSignatureId | null;
  const requestedChat = previewParams.get("signal") as ChatSignalId | null;
  const [previewKind, setPreviewKind] = useState<RelicPreviewKind>(initialRelicPreviewKind);
  const [previewSkin, setPreviewSkin] = useState<PlanetSkinId>(() => PLANET_SKINS.some((skin) => skin.id === requestedSkin) ? requestedSkin! : vault.equipped.planetBody);
  const [previewHalo, setPreviewHalo] = useState<PlanetHaloId>(() => PLANET_HALOS.some((halo) => halo.id === requestedHalo) ? requestedHalo! : vault.equipped.halo);
  const [previewOrbit, setPreviewOrbit] = useState<PlanetOrbitId>(() => PLANET_ORBITS.some((orbit) => orbit.id === requestedOrbit) ? requestedOrbit! : vault.equipped.orbit);
  const [previewMarch, setPreviewMarch] = useState<MarchSignatureId>(() => MARCH_SIGNATURES.some((signature) => signature.id === requestedMarch) ? requestedMarch! : vault.equipped.marchSignature);
  const [previewChat, setPreviewChat] = useState<ChatSignalId>(() => CHAT_SIGNALS.some((signal) => signal.id === requestedChat) ? requestedChat! : vault.equipped.chatSignal);
  const [editing, setEditing] = useState(false);
  const [callsign, setCallsign] = useState(profile.name);
  const [motto, setMotto] = useState(profile.motto || "THE FRONTIER REMEMBERS.");
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
  const selectedChat = CHAT_SIGNALS.find((effect) => effect.id === previewChat) || CHAT_SIGNALS[0];
  const selectedRelic = previewKind === "planet" ? selectedSkin : previewKind === "halo" ? selectedHalo : previewKind === "orbit" ? selectedOrbit : previewKind === "march" ? selectedMarch : selectedChat;
  const selectedRelicTier = "tier" in selectedRelic ? selectedRelic.tier || selectedRelic.rarity : selectedRelic.rarity;
  const selectedRelicType = previewKind === "planet" ? "CORE" : previewKind === "halo" ? "PLANET HALO" : previewKind === "orbit" ? "ORBITAL ARRAY" : previewKind === "march" ? "MARCH SIGNATURE" : "NAME SIGNAL";
  const selectedRelicTarget = previewKind === "planet" ? "CORE" : previewKind === "halo" ? "HALO" : previewKind === "orbit" ? "ORBIT" : previewKind === "march" ? "FLEETS" : "COMMS";
  const selectedRelicOwned = previewKind === "planet" ? ownsPlanetSkin(vault, previewSkin) : previewKind === "halo" ? ownsPlanetHalo(vault, previewHalo) : previewKind === "orbit" ? ownsPlanetOrbit(vault, previewOrbit) : previewKind === "march" ? ownsMarchSignature(vault, previewMarch) : ownsChatSignal(vault, previewChat);
  const selectedRelicEquipped = previewKind === "planet" ? vault.equipped.planetBody === previewSkin : previewKind === "halo" ? vault.equipped.halo === previewHalo : previewKind === "orbit" ? vault.equipped.orbit === previewOrbit : previewKind === "march" ? vault.equipped.marchSignature === previewMarch : vault.equipped.chatSignal === previewChat;
  const equippedSkin = PLANET_SKINS.find((skin) => skin.id === vault.equipped.planetBody) || PLANET_SKINS[0];
  const equippedHalo = PLANET_HALOS.find((halo) => halo.id === vault.equipped.halo) || PLANET_HALOS[0];
  const equippedOrbit = PLANET_ORBITS.find((orbit) => orbit.id === vault.equipped.orbit) || PLANET_ORBITS[0];
  const equippedMarch = MARCH_SIGNATURES.find((effect) => effect.id === vault.equipped.marchSignature) || MARCH_SIGNATURES[0];
  const equippedChat = CHAT_SIGNALS.find((effect) => effect.id === vault.equipped.chatSignal) || CHAT_SIGNALS[0];

  function flash(message: string) {
    setSignal(message);
    window.setTimeout(() => setSignal((current) => current === message ? "" : current), 2200);
  }

  function commitAccount(next: typeof account, announce = true) {
    setAccount(next);
    savePlayerAccount(next);
    if (announce) flash("PROTOCOL WRITTEN");
  }

  function saveIdentity() {
    const nextName = normalizeUsername(callsign);
    const nameChanged = nextName !== normalizeUsername(profile.name);
    if (usernameLength(nextName) < 3 || usernameLength(nextName) > 24) {
      flash("NAME SIGNAL MUST HOLD 3–24 GLYPHS");
      return;
    }
    if (nameChanged && !canRenameForFree(profile, now)) {
      flash("RENAME RELIC REQUIRED");
      return;
    }
    const next: Profile = {
      ...profile,
      name: nextName,
      motto: motto.trim().slice(0, 72),
      avatarId,
      title: profile.title || "FRONTIER BORN",
      lastRenamedAt: nameChanged ? new Date(now).toISOString() : profile.lastRenamedAt,
      renamedOnce: nameChanged ? true : profile.renamedOnce,
    };
    onProfileChange(next);
    setEditing(false);
    flash("DOSSIER SEALED");
  }

  function equipSkin() {
    if (!ownsPlanetSkin(vault, previewSkin)) return;
    const next = { ...vault, equipped: { ...vault.equipped, planetBody: previewSkin } };
    setVault(next);
    saveCosmeticVault(address, next);
    flash(`${selectedSkin.name.toUpperCase()} BOUND TO HOME`);
  }

  function equipMarchSignature(signatureId: MarchSignatureId) {
    const effect = MARCH_SIGNATURES.find((item) => item.id === signatureId);
    if (!effect || !ownsMarchSignature(vault, signatureId)) { flash("MARCH SIGNATURE NOT RECOVERED"); return; }
    const next = { ...vault, equipped: { ...vault.equipped, marchSignature: signatureId } };
    setVault(next);
    saveCosmeticVault(address, next);
    flash(`${effect.name.toUpperCase()} BOUND TO FLEETS`);
  }

  function equipPlanetOrbit(orbitId: PlanetOrbitId) {
    const orbit = PLANET_ORBITS.find((item) => item.id === orbitId);
    if (!orbit || !ownsPlanetOrbit(vault, orbitId)) { flash("ORBITAL ARRAY NOT RECOVERED"); return; }
    const next = { ...vault, equipped: { ...vault.equipped, orbit: orbitId } };
    setVault(next);
    saveCosmeticVault(address, next);
    flash(`${orbit.name.toUpperCase()} BOUND TO ORBIT`);
  }

  function equipPlanetHalo(haloId: PlanetHaloId) {
    const halo = PLANET_HALOS.find((item) => item.id === haloId);
    if (!halo || !ownsPlanetHalo(vault, haloId)) { flash("PLANET HALO NOT RECOVERED"); return; }
    const next = { ...vault, equipped: { ...vault.equipped, halo: haloId } };
    setVault(next);
    saveCosmeticVault(address, next);
    flash(`${halo.name.toUpperCase()} BOUND TO HALO`);
  }

  function equipChatSignal(signalId: ChatSignalId) {
    const effect = CHAT_SIGNALS.find((item) => item.id === signalId);
    if (!effect || !ownsChatSignal(vault, signalId)) { flash("NAME SIGNAL NOT RECOVERED"); return; }
    const next = { ...vault, equipped: { ...vault.equipped, chatSignal: signalId } };
    setVault(next);
    saveCosmeticVault(address, next);
    flash(`${effect.name.toUpperCase()} BOUND TO COMMS`);
  }

  function bindSelectedRelic() {
    if (previewKind === "planet") equipSkin();
    else if (previewKind === "halo") equipPlanetHalo(previewHalo);
    else if (previewKind === "orbit") equipPlanetOrbit(previewOrbit);
    else if (previewKind === "march") equipMarchSignature(previewMarch);
    else equipChatSignal(previewChat);
  }

  const publicWallet = account.alliancePledge?.wallet || account.primaryWallet;
  const ownedSkinCount = PLANET_SKINS.filter((skin) => ownsPlanetSkin(vault, skin.id)).length;
  const freeRenameReady = canRenameForFree(profile, now);
  const renameReadyAt = nextFreeRenameAt(profile);
  const renameWindow = freeRenameReady ? "FREE RENAME // READY" : `FREE RENAME // ${new Intl.DateTimeFormat(account.language, { month: "short", day: "numeric", year: "numeric" }).format(renameReadyAt)}`;
  const pledgeFading = !!account.alliancePledge?.graceEndsAt && Date.parse(account.alliancePledge.graceEndsAt) > now;
  const pledgeExpired = !!account.alliancePledge?.graceEndsAt && Date.parse(account.alliancePledge.graceEndsAt) <= now;
  const pledgeState = account.alliancePledge ? (pledgeFading ? "PLEDGE FADING" : pledgeExpired ? "PLEDGE LOST" : "GATE OPEN") : "NO PLEDGE RECORDED";
  const playerSignal = {
    username: profile.name,
    allianceSymbol: profile.factionSymbol,
    title: profile.title || "FRONTIER BORN",
    wallet: publicWallet,
    skin: { id: equippedSkin.id, name: equippedSkin.name, rarity: equippedSkin.rarity },
    halo: vault.equipped.halo,
    orbit: vault.equipped.orbit,
    nameSignal: vault.equipped.chatSignal,
    coreLevel: game.buildings.keep.lvl,
    might: mightBreakdown(game).total,
    achievements: account.showAchievements ? [{ mark: "Ⅰ", name: "FIRST LIGHT" }, { mark: "◈", name: "ECHO HUNTER" }] : [],
    online: true,
  };

  return <section className={`profile-screen ${account.reducedMotion ? "profile-motion-stilled" : ""}`}>
    <CosmicBackdrop />
    <div className="world-page-black-hole" aria-hidden="true"><i className="world-page-hole-glow" /><i className="world-page-accretion" /><i className="world-page-hole-core" /></div>
    <GameNav view="profile" profile={profile} townhallLevel={game.buildings.keep.lvl} location={location}
      resources={game.res} energy={player ? energyAt(player, now, world!.world.config) : 100} energyCap={world?.world.config.energyCap ?? 100}
      activeFleets={activeFleets} fleetCap={player?.marchSlots ?? worldMarchSlots(game)} standing={totalTroops(game)} wounded={game.wounded}
      might={mightBreakdown(game).total} credits={account.credits} onCity={onCity} onWorld={onWorld} onMessages={onMessages} onProfile={() => {}} />

    {signal && <div className="profile-signal" role="status">{signal}</div>}

    <header className="profile-archive-head">
      <div><small>COMMANDER ARCHIVE // {account.playerId}</small><h1>{profile.name}</h1><p>Every empire leaves a signal. Make yours impossible to mistake.</p></div>
      <div className="profile-archive-mark"><span>CORE</span><b>{game.buildings.keep.lvl.toString().padStart(2, "0")}</b></div>
    </header>

    <nav className="profile-tabs" aria-label="Commander archive">
      {(["dossier", "vault", "wallet", "protocols"] as ArchiveSection[]).map((tab) => <button key={tab} className={section === tab ? "active" : ""} aria-current={section === tab ? "page" : undefined} onClick={() => setSection(tab)}>
        <span>{tab === "dossier" ? "01" : tab === "vault" ? "02" : tab === "wallet" ? "03" : "04"}</span>
        <b>{tab === "dossier" ? "DOSSIER" : tab === "vault" ? "RELIC VAULT" : tab === "wallet" ? "WALLET LINK" : "PROTOCOLS"}</b>
      </button>)}
    </nav>

    {section === "dossier" && <div className="profile-dossier-grid">
      <article className="profile-card profile-identity-card">
        <header><small>COMMANDER DOSSIER</small><span>FRONTIER I</span></header>
        <div className="profile-avatar-stage"><button className={`profile-avatar profile-avatar-${profile.avatarId || "genesis"}`} aria-label="Change sigil" onClick={() => setEditing(true)}><i /><em>{game.buildings.keep.lvl}</em></button><h2>{profile.name}</h2><b>[{profile.factionSymbol || "SOLO"}] · {profile.title || "FRONTIER BORN"}</b><p>“{profile.motto || motto}”</p></div>
        <div className="profile-id-band"><span>{shortWallet(publicWallet)}</span><i /> <b>{profile.factionSymbol ? `$${profile.factionSymbol}` : "UNALIGNED"}</b></div>
        <button className="profile-action full" onClick={() => setEditing((value) => !value)}>{editing ? "CLOSE SCRIBE" : "REWRITE DOSSIER"}</button>
      </article>

      <article className="profile-card profile-home-card">
        <header><small>HOME SIGNAL</small><span>{equippedSkin.rarity}</span></header>
        <div className="profile-home-stage"><PlanetOrbitPreview skin={vault.equipped.planetBody} halo={vault.equipped.halo} orbit={vault.equipped.orbit} chrome={false} className="profile-bound-assembly" /><div className="profile-home-caption"><small>BOUND ASSEMBLY</small><b>{equippedSkin.name} · {equippedHalo.name} · {equippedOrbit.name}</b></div><span className="profile-home-lod">STAR MAP // ACTIVE</span></div>
        <div className="profile-loadout"><button onClick={() => setSection("vault")}><small>CORE</small><b>{equippedSkin.name}</b></button><button onClick={() => setSection("vault")}><small>HALO</small><b>{equippedHalo.name}</b></button><button onClick={() => setSection("vault")}><small>ORBIT</small><b>{equippedOrbit.name}</b></button><button onClick={() => setSection("vault")}><small>MARCH</small><b>{equippedMarch.name}</b></button><button onClick={() => setSection("vault")}><small>COMMS</small><b>{equippedChat.name}</b></button><button onClick={() => setSection("vault")}><small>TITLE</small><b>{profile.title || "Frontier Born"}</b></button></div>
      </article>

      <aside className="profile-dossier-side">
        <div className="profile-signal-preview"><div><small>OUTBOUND SIGNAL</small><span>STAR MAP · COMMS</span></div><PlayerCard signal={playerSignal} /></div>
        <article className="profile-card"><header><small>INSIGNIA</small><span>2 SEALED</span></header><div className="profile-medals"><div><i>Ⅰ</i><span><b>FIRST LIGHT</b><small>FOUNDING PIONEER</small></span></div><div><i>◈</i><span><b>ECHO HUNTER</b><small>ROGUE CODEX I</small></span></div><div className="locked"><i>◎</i><span><b>MARKET MAKER</b><small>3 / 50 ORDERS</small></span></div></div></article>
      </aside>

      {editing && <article className="profile-card profile-scribe">
        <header><small>IDENTITY SCRIBE</small><span>{renameWindow}</span></header>
        <div className="profile-field-grid"><label><span>UNIVERSAL NAME</span><input value={callsign} onChange={(event) => setCallsign(event.target.value)} /></label><label><span>RENAME RELICS</span><input value="0 RECOVERED" disabled /></label><label className="wide"><span>OATHLINE</span><input value={motto} maxLength={72} onChange={(event) => setMotto(event.target.value)} /></label></div>
        <div className="profile-sigil-array"><button className={avatarId === "genesis" ? "selected" : ""} onClick={() => setAvatarId("genesis")}><i className="genesis" /><span>GENESIS</span></button><button className={avatarId === "orbit" ? "selected" : ""} onClick={() => setAvatarId("orbit")}><i className="orbit" /><span>ORBITAL</span></button><button disabled><i className="void" /><span>VOID SEAL · LOCKED</span></button></div>
        <div className="profile-scribe-actions"><button className="profile-action" onClick={() => setEditing(false)}>DISCARD</button><button className="profile-action primary" onClick={saveIdentity}>SEAL DOSSIER</button></div>
      </article>}
    </div>}

    {section === "vault" && <div className="profile-vault-grid">
      <article className="profile-card profile-vault-preview"><header><small>RELIC CHAMBER // {selectedRelicType}</small><span>{selectedRelicTier}</span></header><div className={`profile-vault-stage preview-${previewKind}`}>{previewKind === "planet" || previewKind === "halo" || previewKind === "orbit" ? <PlanetOrbitPreview skin={previewKind === "planet" ? previewSkin : vault.equipped.planetBody} halo={previewKind === "halo" ? previewHalo : vault.equipped.halo} orbit={previewKind === "orbit" ? previewOrbit : vault.equipped.orbit} chrome={false} className="profile-bound-assembly" /> : previewKind === "march" ? <MarchSignaturePreview signature={previewMarch} /> : <ChatSignalPreview signal={previewChat} username={profile.name} faction={profile.factionSymbol} />}</div><div className="profile-relic-copy"><small>{selectedRelicTier} // {selectedRelicType}</small><h2>{selectedRelic.name}{"translatedName" in selectedRelic && selectedRelic.translatedName ? <span className="profile-relic-translation">{selectedRelic.translatedName}</span> : null}</h2><p>{selectedRelic.transmission}</p><em>RECOVERED FROM // {selectedRelic.source}</em><button className="profile-action primary full" disabled={!selectedRelicOwned || selectedRelicEquipped} onClick={bindSelectedRelic}>{!selectedRelicOwned ? "RELIC NOT RECOVERED" : selectedRelicEquipped ? `BOUND TO ${selectedRelicTarget}` : `BIND TO ${selectedRelicTarget}`}</button></div></article>
      <div className="profile-vault-list"><div className="profile-section-title"><div><small>CORES</small><b>{ownedSkinCount} / {PLANET_SKINS.length} RECOVERED</b></div><span>MIGHT SIGNATURE // 0</span></div><div className="profile-relic-grid">{PLANET_SKINS.map((skin) => {
        const owned = ownsPlanetSkin(vault, skin.id); const equipped = vault.equipped.planetBody === skin.id;
        return <button key={skin.id} className={`${previewKind === "planet" && previewSkin === skin.id ? "selected" : ""} ${owned ? "owned" : "locked"}`} onClick={() => { setPreviewKind("planet"); setPreviewSkin(skin.id); }}><div><PlanetOrbitPreview skin={skin.id} orbit={null} chrome={false} staticPreview className="profile-core-isolation" /></div><span>{equipped ? "BOUND" : owned ? "RECOVERED" : "UNKNOWN"}</span><b>{skin.name}</b><small>{skin.rarity} · CORE</small></button>;
      })}</div><div className="profile-vault-slots">
        <article className="profile-card"><header><small>PLANET HALOS</small><span>{PLANET_HALOS.filter((halo) => ownsPlanetHalo(vault, halo.id)).length} / {PLANET_HALOS.length}</span></header><div>{PLANET_HALOS.map((halo) => { const owned = ownsPlanetHalo(vault, halo.id); return <button key={halo.id} className={`${vault.equipped.halo === halo.id ? "active" : ""} ${previewKind === "halo" && previewHalo === halo.id ? "previewed" : ""} ${owned ? "" : "locked"}`} onClick={() => { setPreviewKind("halo"); setPreviewHalo(halo.id); }}><i className={`halo-effect-icon halo-effect-${halo.id}`} /><span><b>{halo.name} <em>{halo.translatedName}</em></b><small>{vault.equipped.halo === halo.id ? "BOUND TO HALO" : owned ? `${halo.tier} · RECOVERED` : `${halo.tier} · UNKNOWN`}</small></span></button>; })}</div></article>
        <article className="profile-card"><header><small>ORBITAL ARRAYS</small><span>{PLANET_ORBITS.filter((orbit) => ownsPlanetOrbit(vault, orbit.id)).length} / {PLANET_ORBITS.length}</span></header><div>{PLANET_ORBITS.map((orbit) => { const owned = ownsPlanetOrbit(vault, orbit.id); return <button key={orbit.id} className={`${vault.equipped.orbit === orbit.id ? "active" : ""} ${previewKind === "orbit" && previewOrbit === orbit.id ? "previewed" : ""} ${owned ? "" : "locked"}`} onClick={() => { setPreviewKind("orbit"); setPreviewOrbit(orbit.id); }}><i className={`orbit-effect-icon orbit-effect-${orbit.id}`} /><span><b>{orbit.name} <em>{orbit.translatedName}</em></b><small>{vault.equipped.orbit === orbit.id ? "BOUND TO ORBIT" : owned ? `${orbit.tier} · RECOVERED` : `${orbit.tier} · UNKNOWN`}</small></span></button>; })}</div></article>
        <article className="profile-card"><header><small>MARCH SIGNATURES</small><span>{MARCH_SIGNATURES.filter((effect) => ownsMarchSignature(vault, effect.id)).length} / {MARCH_SIGNATURES.length}</span></header><div>{MARCH_SIGNATURES.map((effect) => { const owned = ownsMarchSignature(vault, effect.id); return <button key={effect.id} className={`${vault.equipped.marchSignature === effect.id ? "active" : ""} ${previewKind === "march" && previewMarch === effect.id ? "previewed" : ""} ${owned ? "" : "locked"}`} onClick={() => { setPreviewKind("march"); setPreviewMarch(effect.id); }}><i className={`march-effect-icon march-effect-${effect.id}`} /><span><b>{effect.name} <em>{effect.translatedName}</em></b><small>{vault.equipped.marchSignature === effect.id ? "BOUND TO FLEETS" : owned ? `${effect.tier} · RECOVERED` : `${effect.tier} · UNKNOWN`}</small></span></button>; })}</div></article>
        <article className="profile-card"><header><small>NAME SIGNALS</small><span>{CHAT_SIGNALS.filter((effect) => ownsChatSignal(vault, effect.id)).length} / {CHAT_SIGNALS.length}</span></header><div>{CHAT_SIGNALS.map((effect) => { const owned = ownsChatSignal(vault, effect.id); return <button key={effect.id} className={`${vault.equipped.chatSignal === effect.id ? "active" : ""} ${previewKind === "chat" && previewChat === effect.id ? "previewed" : ""} ${owned ? "" : "locked"}`} onClick={() => { setPreviewKind("chat"); setPreviewChat(effect.id); }}><i className={`chat-effect-icon chat-effect-${effect.id}`}>A</i><span><b>{effect.name}</b><small>{vault.equipped.chatSignal === effect.id ? "BOUND TO COMMS" : owned ? `${effect.rarity} · RECOVERED` : `${effect.rarity} · UNKNOWN`}</small></span></button>; })}</div></article>
        <article className="profile-card"><header><small>TITLE SEALS</small><span>1 / 3</span></header><div><button className="active" onClick={() => flash("FRONTIER BORN ALREADY SEALED")}><i>Ⅰ</i><span><b>FRONTIER BORN</b><small>ISSUED · BOUND</small></span></button><button className="locked" onClick={() => flash("TITLE SEAL NOT RECOVERED")}><i>⌁</i><span><b>RIFT CARTOGRAPHER</b><small>MYTHIC · UNKNOWN</small></span></button><button className="locked" onClick={() => flash("TITLE SEAL NOT RECOVERED")}><i>◎</i><span><b>WHALE FALL</b><small>SOVEREIGN · UNKNOWN</small></span></button></div></article>
      </div></div>
    </div>}

    {section === "wallet" && <div className="profile-system-grid">
      <article className="profile-card"><header><small>KEYRING</small><span>{account.loginMethod === "google" ? "GOOGLE SEAL" : "WALLET SIGNATURE"}</span></header><div className="profile-ledger"><div><small>LOGIN SEAL</small><span><b>{account.loginMethod === "google" ? "GOOGLE" : "WALLET"}</b><em>THE COMMANDER BEHIND THE KEYS</em></span><strong>LIVE</strong></div><div><small>PUBLIC KEY</small><span><b>{shortWallet(account.primaryWallet)}</b><em>{account.primaryWallet ? "RHCHAIN 4663 · EXPOSED" : "NO ON-CHAIN TRACE"}</em></span><button onClick={() => flash(account.primaryWallet ? "PUBLIC KEY COPIED" : "LINK RITE NOT YET OPEN")}>{account.primaryWallet ? "COPY" : "LINK"}</button></div><div><small>PLAYER SEAL</small><span><b>{account.playerId}</b><em>UNCHANGED BY KEY OR NAME</em></span><button onClick={() => flash("PLAYER SEAL COPIED")}>COPY</button></div></div><div className="profile-lore-note">One commander. Many keys. The gate reads only the pledged key.</div></article>
      <article className="profile-card"><header><small>ALLIANCE PLEDGE</small><span className={pledgeFading ? "profile-pledge-fading" : ""}>{pledgeState}</span></header><div className="profile-ledger"><div><small>PLEDGED KEY</small><span><b>{shortWallet(account.alliancePledge?.wallet || null)}</b><em>{account.alliancePledge ? `CHAIN ${account.alliancePledge.chainId} · LAST READ ${new Date(account.alliancePledge.lastCheckedAt).toLocaleDateString()}` : "NO TOKEN GATE READ"}</em></span><strong>{account.alliancePledge ? (pledgeFading ? "FADING" : pledgeExpired ? "LOST" : "HELD") : "DARK"}</strong></div><div><small>GATE TOKEN</small><span><b>{shortWallet(account.alliancePledge?.tokenAddress || profile.faction)}</b><em>{profile.factionSymbol ? `$${profile.factionSymbol} PLEDGE` : "UNALIGNED"}</em></span><button onClick={() => flash("PLEDGE RITE NOT YET OPEN")}>{account.alliancePledge ? "READ" : "PRESENT"}</button></div></div><div className="profile-lore-note">The login seal opens the game. A pledged key opens a token-gated Alliance.</div></article>
      <article className="profile-card"><header><small>TREASURY LEDGER</small><span>ACCOUNT-BOUND</span></header><div className="profile-treasury"><div><small>CREDITS</small><b>◇ {account.credits.toLocaleString()}</b><span>COSMETICS · WARP · SHIELDS</span></div><div><small>RECOVERED RELICS</small><b>{vault.owned.length}</b><span>{ownedSkinCount} CORE{ownedSkinCount === 1 ? "" : "S"}</span></div></div><button className="profile-action full" onClick={() => flash("CREDIT EXCHANGE NOT YET OPEN")}>OPEN CREDIT EXCHANGE</button></article>
      <article className="profile-card profile-wide-card"><header><small>SIGNAL RULES</small><span>FRONTIER-WIDE</span></header><div className="profile-switch-list"><SwitchRow title="Display war record" detail="DOSSIER · BATTLE REPORTS" checked={account.showAchievements} onChange={(value) => commitAccount({ ...account, showAchievements: value })} /><SwitchRow title="Receive unknown signals" detail="DIRECT COMMS OUTSIDE ALLIANCE" checked={account.allowDirectMessages} onChange={(value) => commitAccount({ ...account, allowDirectMessages: value })} /></div></article>
    </div>}

    {section === "protocols" && <div className="profile-system-grid">
      <article className="profile-card"><header><small>COMMAND TONGUE</small><span>ACCOUNT-WIDE</span></header><div className="profile-fields"><label><span>LANGUAGE</span><select value={account.language} onChange={(event) => commitAccount({ ...account, language: event.target.value as LanguageCode })}>{Object.entries(LANGUAGE_NAMES).map(([code, name]) => <option value={code} key={code}>{name}</option>)}</select></label><label><span>RESET CLOCK</span><select value={account.timeZone} onChange={(event) => commitAccount({ ...account, timeZone: event.target.value })}><option value="America/Los_Angeles">AMERICA // LOS ANGELES</option><option value="Asia/Shanghai">ASIA // SHANGHAI</option><option value="UTC">UNIVERSAL // UTC</option></select></label><label><span>LEDGER NOTATION</span><select value={account.numberFormat} onChange={(event) => commitAccount({ ...account, numberFormat: event.target.value as "compact" | "full" })}><option value="compact">1.25M</option><option value="full">1,250,000</option></select></label></div></article>
      <article className="profile-card"><header><small>SHIP SYSTEMS</small><span>SYNCED</span></header><div className="profile-switch-list"><SwitchRow title="Celestial Drift" detail="DEEP-SPACE SCORE · CONTINUOUS" checked={account.musicEnabled} onChange={(value) => commitAccount({ ...account, musicEnabled: value })} /><div className={`profile-volume-control ${account.musicEnabled ? "live" : "muted"}`}><span><b>Drift signal</b><small>AMBIENT BAND · {Math.round(account.musicVolume * 100)}%</small></span><input aria-label="Celestial Drift volume" type="range" min="0" max="100" step="1" value={Math.round(account.musicVolume * 100)} onChange={(event) => commitAccount({ ...account, musicVolume: Number(event.target.value) / 100 }, false)} onPointerUp={() => flash("DRIFT LEVEL SEALED")} /></div><SwitchRow title="Combat audio" detail="FLEETS · ALERTS · COMMS" checked={account.soundEnabled} onChange={(value) => commitAccount({ ...account, soundEnabled: value })} /><SwitchRow title="Still the cosmos" detail="REDUCED MOTION" checked={account.reducedMotion} onChange={(value) => commitAccount({ ...account, reducedMotion: value })} /><SwitchRow title="Translate unknown tongues" detail="AUTO-TRANSLATE COMMS" checked={account.autoTranslateComms} onChange={(value) => commitAccount({ ...account, autoTranslateComms: value })} /><SwitchRow title="Raise battle alarms" detail="ATTACKS · RALLIES · ORDERS" checked={account.criticalNotifications} onChange={(value) => commitAccount({ ...account, criticalNotifications: value })} /></div></article>
      <article className="profile-card profile-wide-card"><header><small>OATHS &amp; ACCORDS</small><span>WALLET-SEALED</span></header><div className="profile-accord-list">{LEGAL_RECORDS.map((record) => {
        const consent = account.consents[record.key]; const current = consent.version === CONSENT_VERSIONS[record.key] && !!consent.acceptedAt;
        return <div key={record.key}><span><b>{record.name}</b><small>{record.legal.toUpperCase()} · V{CONSENT_VERSIONS[record.key]}</small></span><em className={current ? "sealed" : "unsealed"}>{current ? "SEALED" : "UNSEALED"}</em><button onClick={() => flash(`${record.name.toUpperCase()} ARCHIVE NOT YET INSCRIBED`)}>OPEN</button></div>;
      })}</div></article>
      <article className="profile-card profile-wide-card profile-danger"><header><small>FINAL ORDERS</small><span>WALLET SIGNATURE REQUIRED</span></header><div className="profile-final-actions"><button onClick={() => flash("ACCOUNT EXPORT QUEUED")}>EXPORT ARCHIVE</button><button onClick={() => flash("KEY RELEASE NOT YET OPEN")}>RELEASE WALLET</button><button className="danger" onClick={() => flash("ERASURE RITE REQUIRES FINAL CONFIRMATION")}>ERASE CIVILIZATION</button></div></article>
    </div>}
  </section>;
}

function SwitchRow({ title, detail, checked, onChange }: { title: string; detail: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <div><span><b>{title}</b><small>{detail}</small></span><button className={checked ? "on" : ""} role="switch" aria-checked={checked} aria-label={title} onClick={() => onChange(!checked)}><i /></button></div>;
}
