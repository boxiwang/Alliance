import { useEffect, useMemo, useState } from "react";
import { gmGrantShield, gmReleaseWorldPlayers, gmWorldRoster, resumeBackendSession, type BackendSession, type GmRosterPlayer } from "./lib/backend";

// Live Ops: server-side GM tools (docs/BETA-P0.md). Uses the GM session the game
// already signed in with on this origin; nothing here edits numbers.json.

function ago(ts: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - ts) / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

export default function AdminOps() {
  const [session, setSession] = useState<BackendSession | null | undefined>(undefined);
  const [roster, setRoster] = useState<GmRosterPlayer[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const now = Date.now();

  useEffect(() => { resumeBackendSession().then(setSession).catch(() => setSession(null)); }, []);
  const gm = session?.player.role === "gm";

  async function load() {
    if (!session) return;
    setBusy(true); setNote("");
    try { setRoster(await gmWorldRoster(session.token)); setPicked(new Set()); }
    catch (error) { setNote(`Roster failed: ${(error as Error).message}`); }
    finally { setBusy(false); }
  }
  useEffect(() => { if (gm) void load(); }, [gm]); // eslint-disable-line react-hooks/exhaustive-deps

  const sorted = useMemo(() => [...(roster || [])].sort((a, b) => a.lastSeen - b.lastSeen), [roster]);

  async function release() {
    if (!session || !picked.size) return;
    const names = sorted.filter((player) => picked.has(player.id)).map((player) => player.name).join(", ");
    if (!window.confirm(`Release ${picked.size} map slot(s)?\n\n${names}\n\nAccounts and progress stay in the database; they respawn on the outer ring if they log in again.`)) return;
    setBusy(true);
    try {
      const result = await gmReleaseWorldPlayers(session.token, [...picked]);
      setNote(`Released ${result.released.length}${result.skippedOnline.length ? ` · skipped ${result.skippedOnline.length} online` : ""}.`);
      await load();
    } catch (error) { setNote(`Release failed: ${(error as Error).message}`); }
    finally { setBusy(false); }
  }

  async function grantShield() {
    if (!session || !picked.size) return;
    const names = sorted.filter((player) => picked.has(player.id)).map((player) => player.name).join(", ");
    if (!window.confirm(`Give an 8-hour shield to ${picked.size} player(s)?\n\n${names}\n\nA running shield is extended by 8 hours.`)) return;
    setBusy(true);
    try {
      const result = await gmGrantShield(session.token, [...picked], 8);
      setNote(`Shielded ${result.granted.length} for 8h.`);
      await load();
    } catch (error) { setNote(`Shield failed: ${(error as Error).message}`); }
    finally { setBusy(false); }
  }

  const toggle = (id: string) => setPicked((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div>
      <div className="adm-view-intro"><div><span className="adm-eyebrow">LIVE OPS</span><h2>World roster</h2><p>Every civilization on the shared map. Releasing a slot removes the city from the map only — the account and all progress stay in the database, and the player respawns on a random outer-ring slot on their next login.</p></div></div>
      {session === undefined && <p className="adm-note">Checking GM session…</p>}
      {session !== undefined && !gm && <p className="adm-note">Sign in to the game as a GM on this site first, then reopen this page.</p>}
      {gm && <div className="adm-ops">
        <div className="adm-ops-bar">
          <span>{roster ? `${roster.length} on the map · ${roster.filter((player) => player.online).length} online` : "Loading…"}</span>
          <button className="adm-btn" disabled={busy} onClick={() => void load()}>Refresh</button>
          <button className="adm-btn" disabled={busy || !picked.size} onClick={() => void grantShield()}>Shield 8h ({picked.size})</button>
          <button className="adm-btn adm-btn-danger" disabled={busy || !picked.size} onClick={() => void release()}>Release selected ({picked.size})</button>
          {note && <span className="adm-savednote">{note}</span>}
        </div>
        <table className="adm-ops-table">
          <thead><tr><th /><th>Name</th><th>Player id</th><th>Core</th><th>Shield item</th><th>Last seen</th><th>Status</th></tr></thead>
          <tbody>{sorted.map((player) => <tr key={player.id} className={picked.has(player.id) ? "picked" : ""}>
            <td><input type="checkbox" aria-label={`Select ${player.name}`} checked={picked.has(player.id)} onChange={() => toggle(player.id)} /></td>
            <td>{player.name}</td>
            <td className="mono">{player.id.length > 18 ? `${player.id.slice(0, 10)}…${player.id.slice(-6)}` : player.id}</td>
            <td>{player.keepLevel}</td>
            <td>{(player.shieldUntil || 0) > now ? `${Math.ceil(((player.shieldUntil || 0) - now) / 3_600_000)}h left` : "—"}</td>
            <td>{player.lastSeen ? ago(player.lastSeen, now) : "—"}</td>
            <td>{player.online ? <b className="adm-ops-online">ONLINE</b> : "offline"}</td>
          </tr>)}</tbody>
        </table>
      </div>}
    </div>
  );
}
