"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AdsLevel, CapRole, LocationCapacity, Member, RoleWeek } from "@/lib/capacity";
import { parseMoneyInput } from "@/lib/ledger/fields";
import { fmt } from "@/lib/money";

const weekLabel = (w: string) => {
  const d = new Date(`${w}T12:00:00Z`);
  const e = new Date(d.getTime() + 6 * 86_400_000);
  const f = (x: Date) => x.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${f(d)} – ${f(e)}`;
};
const pct = (booked: number, cap: number) => (cap > 0 ? Math.round((booked / cap) * 100) : null);
const LEVEL_TONE: Record<AdsLevel, string> = { "push-hard": "push", push: "push", steady: "ok", hold: "hold", pull: "pull" };

async function post(payload: unknown): Promise<string | null> {
  try {
    const res = await fetch("/api/capacity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (res.ok) return null;
    const b = (await res.json().catch(() => ({}))) as { error?: string };
    return b.error ?? "Couldn't save.";
  } catch {
    return "Couldn't reach the server.";
  }
}

export default function CapacityView({ loc, weeks, weekIdx, people, ghlUsers, today }: {
  loc: LocationCapacity;
  weeks: string[];
  weekIdx: number;
  people: Array<{ id: string; name: string; roles: string[] }>;
  ghlUsers: Array<{ id: string; name: string }>;
  today: string;
}) {
  const router = useRouter();
  const [w, setW] = useState(weekIdx);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const act = async (payload: unknown) => {
    setBusy(true);
    setError(null);
    const err = await post(payload);
    setBusy(false);
    if (err) setError(err);
    else router.refresh();
  };

  const sales = loc.sales[w]!;
  const install = loc.install[w]!;
  const ads = loc.ads[w]!;
  const week = weeks[w]!;
  const ghlName = new Map(ghlUsers.map((u) => [u.id, u.name]));
  const noTeam = loc.members.filter((m) => m.active).length === 0;

  return (
    <>
      <div className="table-bar">
        <nav className="segmented" aria-label="Week">
          {weeks.map((wk, i) => (
            <button key={wk} type="button" className={i === w ? "on" : ""} aria-pressed={i === w} onClick={() => setW(i)}>
              {i === 0 ? "This week" : i === 1 ? "Next week" : weekLabel(wk)}
            </button>
          ))}
        </nav>
        <span className="muted">{weekLabel(week)}</span>
      </div>
      {error && <p className="flash" role="alert">{error}</p>}

      {noTeam ? (
        <p className="hint block">Add {loc.name}&apos;s salespeople and installers below, with how many appointments or installs each can take in a week. Utilization and the ads call fill in from there.</p>
      ) : (
        <section className={`ads-call tone-${LEVEL_TONE[ads.level]}`}>
          <div>
            <div className="ads-kicker">Ads, {w === 0 ? "this week" : w === 1 ? "next week" : weekLabel(week)}</div>
            <div className="ads-head">{ads.headline}</div>
            <p>{ads.why}</p>
          </div>
          {ads.needed > 0 && (ads.level === "push" || ads.level === "push-hard") && (
            <div className="ads-need">
              <div><span className="big">{ads.needed}</span> more booked appointments</div>
              <div className="muted">
                {ads.spendCents != null ? <>≈ <strong>{fmt(ads.spendCents)}</strong> in ads at {fmt(loc.costPerApptCents!)} per booked appointment</> : "Set a cost per booked appointment below to see the spend."}
              </div>
            </div>
          )}
        </section>
      )}

      <div className="util-cards">
        <UtilCard title="Sales appointments" rw={sales} target={loc.targetPct} />
        <UtilCard
          title="Installs"
          rw={install}
          target={loc.targetPct}
          extra={
            <span>
              {loc.backlogJobs} sold job{loc.backlogJobs === 1 ? "" : "s"} not installed
              {loc.backlogWeeks != null ? ` · ${loc.backlogWeeks.toFixed(1)} weeks of install work` : ""}
            </span>
          }
        />
      </div>

      <h2 className="section">Next 4 weeks</h2>
      <div className="tablewrap">
        <table className="outlook">
          <thead>
            <tr><th>Week</th><th className="num">Sales booked</th><th className="num">Sales capacity</th><th>Sales utilization</th><th className="num">Installs booked</th><th className="num">Install capacity</th><th>Install utilization</th><th>Ads</th></tr>
          </thead>
          <tbody>
            {weeks.map((wk, i) => (
              <tr key={wk} className={i === w ? "sel" : ""} onClick={() => setW(i)}>
                <td><strong>{i === 0 ? "This week" : i === 1 ? "Next week" : weekLabel(wk)}</strong></td>
                <td className="num">{loc.sales[i]!.booked}</td>
                <td className="num">{loc.sales[i]!.capacity}</td>
                <td><Bar booked={loc.sales[i]!.booked} cap={loc.sales[i]!.capacity} target={loc.targetPct} /></td>
                <td className="num">{loc.install[i]!.booked}</td>
                <td className="num">{loc.install[i]!.capacity}</td>
                <td><Bar booked={loc.install[i]!.booked} cap={loc.install[i]!.capacity} target={loc.targetPct} /></td>
                <td><span className={`ads-pill tone-${LEVEL_TONE[loc.ads[i]!.level]}`}>{loc.ads[i]!.headline}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="section">Team at {loc.name}</h2>
      <Team loc={loc} w={w} week={week} ghlUsers={ghlUsers} ghlName={ghlName} people={people} act={act} busy={busy} />

      <h2 className="section">Settings</h2>
      <Settings loc={loc} act={act} busy={busy} />
      <p className="muted small">
        Booked = appointments on {loc.name}&apos;s GoHighLevel sales and installer calendars that week, not cancelled (no-shows count; they used the slot). Today is {today}.
      </p>
    </>
  );
}

function Bar({ booked, cap, target }: { booked: number; cap: number; target: number }) {
  const p = pct(booked, cap);
  if (p == null) return <span className="muted">no capacity set</span>;
  const tone = p > 100 ? "over" : p >= target ? "full" : p >= target - 25 ? "mid" : "low";
  return (
    <span className={`ubar ${tone}`}>
      <span className="track"><span className="fill" style={{ width: `${Math.min(100, p)}%` }} /><span className="target" style={{ left: `${Math.min(100, target)}%` }} /></span>
      <b>{p}%</b>
    </span>
  );
}

function UtilCard({ title, rw, target, extra }: { title: string; rw: RoleWeek; target: number; extra?: React.ReactNode }) {
  const p = pct(rw.booked, rw.capacity);
  const open = Math.max(0, rw.capacity - rw.booked);
  return (
    <section className="util-card">
      <div className="util-top">
        <span className="label">{title}</span>
        <span className="util-pct">{p == null ? "—" : `${p}%`}</span>
      </div>
      <Bar booked={rw.booked} cap={rw.capacity} target={target} />
      <div className="util-nums">
        <span><b>{rw.booked}</b> booked</span>
        <span><b>{rw.capacity}</b> capacity</span>
        <span><b>{open}</b> open</span>
      </div>
      {rw.unmatched > 0 && <p className="muted small">{rw.unmatched} booked under someone not on the team below (or with no one assigned).</p>}
      {extra && <p className="muted small">{extra}</p>}
    </section>
  );
}

function Team({ loc, w, week, ghlUsers, ghlName, people, act, busy }: {
  loc: LocationCapacity; w: number; week: string; ghlUsers: Array<{ id: string; name: string }>; ghlName: Map<string, string>;
  people: Array<{ id: string; name: string; roles: string[] }>; act: (p: unknown) => Promise<void>; busy: boolean;
}) {
  const [role, setRole] = useState<CapRole>("sales");
  const [personId, setPersonId] = useState("");
  const [slots, setSlots] = useState("10");
  const [ghl, setGhl] = useState("");
  const groups: Array<[CapRole, string]> = [["sales", "Salespeople"], ["install", "Installers"]];
  return (
    <div className="tablewrap">
      <table className="team-cap">
        <thead>
          <tr><th>Name</th><th>Books in GoHighLevel as</th><th className="num">Slots / week</th><th className="num">Slots this week</th><th className="num">Booked</th><th>Utilization</th><th /></tr>
        </thead>
        {groups.map(([r, label]) => {
          const ms = loc.members.filter((m) => m.role === r);
          return (
            <tbody key={r}>
              <tr className="group"><td colSpan={7}>{label}</td></tr>
              {ms.length === 0 && <tr><td colSpan={7} className="muted">None yet.</td></tr>}
              {ms.map((m) => <MemberRow key={m.id} m={m} w={w} week={week} ghlUsers={ghlUsers} ghlName={ghlName} act={act} busy={busy} />)}
            </tbody>
          );
        })}
        <tfoot>
          <tr>
            <td colSpan={7}>
              <form
                className="add-member"
                onSubmit={(e) => {
                  e.preventDefault();
                  const n = Number(slots);
                  if (!personId || !Number.isInteger(n)) return;
                  void act({ action: "addMember", location: loc.slug, personId, role, weeklySlots: n, ghlUserId: ghl || null }).then(() => {
                    setPersonId("");
                    setGhl("");
                  });
                }}
              >
                <strong>Add</strong>
                <select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as CapRole)}>
                  <option value="sales">Salesperson</option>
                  <option value="install">Installer</option>
                </select>
                <select aria-label="Person" value={personId} onChange={(e) => setPersonId(e.target.value)} required>
                  <option value="">Who…</option>
                  {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <select aria-label="GoHighLevel user" value={ghl} onChange={(e) => setGhl(e.target.value)}>
                  <option value="">GoHighLevel user…</option>
                  {ghlUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
                <label className="inline-num">
                  <input type="number" min={0} max={200} value={slots} onChange={(e) => setSlots(e.target.value)} aria-label="Slots per week" /> per week
                </label>
                <button type="submit" className="btn-primary" disabled={busy || !personId}>Add</button>
              </form>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function MemberRow({ m, w, week, ghlUsers, ghlName, act, busy }: {
  m: Member; w: number; week: string; ghlUsers: Array<{ id: string; name: string }>; ghlName: Map<string, string>; act: (p: unknown) => Promise<void>; busy: boolean;
}) {
  const wk = m.weeks[w]!;
  const [base, setBase] = useState(String(m.weeklySlots));
  const [thisWeek, setThisWeek] = useState(String(wk.slots));
  const saveBase = () => {
    const n = Number(base);
    if (Number.isInteger(n) && n !== m.weeklySlots) void act({ action: "updateMember", id: m.id, weeklySlots: n });
  };
  const saveWeek = () => {
    const n = Number(thisWeek);
    if (!Number.isInteger(n) || n === wk.slots) return;
    void act({ action: "setWeek", id: m.id, week, slots: n === m.weeklySlots ? null : n });
  };
  return (
    <tr className={m.active ? "" : "off"}>
      <td><strong>{m.personName}</strong>{!m.active && <span className="muted"> (off)</span>}</td>
      <td>
        <select aria-label={`GoHighLevel user for ${m.personName}`} value={m.ghlUserId ?? ""} disabled={busy} onChange={(e) => void act({ action: "updateMember", id: m.id, ghlUserId: e.target.value || null })}>
          <option value="">Not matched</option>
          {ghlUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          {m.ghlUserId && !ghlName.has(m.ghlUserId) && <option value={m.ghlUserId}>Unknown user</option>}
        </select>
      </td>
      <td className="num">
        <input className="slot-in" type="number" min={0} max={200} value={base} aria-label="Slots per week" onChange={(e) => setBase(e.target.value)} onBlur={saveBase} onKeyDown={(e) => e.key === "Enter" && saveBase()} />
      </td>
      <td className="num">
        <input className={`slot-in ${wk.override ? "override" : ""}`} type="number" min={0} max={200} value={thisWeek} aria-label="Slots this week" title={wk.override ? "Different this week" : "Same as usual"} onChange={(e) => setThisWeek(e.target.value)} onBlur={saveWeek} onKeyDown={(e) => e.key === "Enter" && saveWeek()} />
      </td>
      <td className="num">{m.ghlUserId ? wk.booked : <span className="muted">—</span>}</td>
      <td>{m.ghlUserId ? <Bar booked={wk.booked} cap={wk.slots} target={100} /> : <span className="muted small">match a GHL user</span>}</td>
      <td>
        <button type="button" className="linkbtn" disabled={busy} onClick={() => void act({ action: "updateMember", id: m.id, active: !m.active })}>{m.active ? "Turn off" : "Turn on"}</button>
      </td>
    </tr>
  );
}

function Settings({ loc, act, busy }: { loc: LocationCapacity; act: (p: unknown) => Promise<void>; busy: boolean }) {
  const [target, setTarget] = useState(String(loc.targetPct));
  const [cost, setCost] = useState(loc.costPerApptCents != null ? (loc.costPerApptCents / 100).toFixed(0) : "");
  return (
    <form
      className="cap-settings"
      onSubmit={(e) => {
        e.preventDefault();
        const c = cost.trim() ? parseMoneyInput(cost) : null;
        if (c != null && Number.isNaN(c)) return;
        void act({ action: "settings", location: loc.slug, targetPct: Number(target), costPerApptCents: c });
      }}
    >
      <label>Target utilization
        <span className="inline-num"><input type="number" min={10} max={150} value={target} onChange={(e) => setTarget(e.target.value)} /> %</span>
      </label>
      <label>Ad cost per booked sales appointment
        <span className="inline-num">$<input inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="e.g. 120" /></span>
      </label>
      <button type="submit" className="btn-outline" disabled={busy}>Save</button>
    </form>
  );
}
