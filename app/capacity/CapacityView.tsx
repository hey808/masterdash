"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AdsLevel, LocationCapacity, RoleWeek } from "@/lib/capacity";

const weekLabel = (w: string, i: number) =>
  i === 0 ? "This week" : i === 1 ? "Next week" : `Week of ${new Date(`${w}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;
const TONE: Record<AdsLevel, string> = { "push-hard": "push", push: "push", steady: "ok", hold: "hold", pull: "pull" };

export default function CapacityView({ locations, weeks }: { locations: LocationCapacity[]; weeks: string[] }) {
  return (
    <div className="cap2">
      {locations.map((l) => <LocationCard key={l.slug} l={l} weeks={weeks} />)}
    </div>
  );
}

function LocationCard({ l, weeks }: { l: LocationCapacity; weeks: string[] }) {
  const ads = l.ads[0]!;
  const reps = l.members.filter((m) => m.role === "sales");
  const installers = l.members.filter((m) => m.role === "install");
  const counted = (role: "sales" | "install") => l.members.filter((m) => m.role === role && m.active && m.primary).length;
  return (
    <section className="cap2-card">
      <header className="cap2-head">
        <h2>{l.name}</h2>
        <span className={`ads-pill tone-${TONE[ads.level]}`}>{ads.headline}</span>
      </header>
      <p className="cap2-why">{ads.why}</p>

      <div className="tablewrap cap2-table">
        <table>
          <thead>
            <tr>
              <th />
              {weeks.map((w, i) => <th key={w}>{weekLabel(w, i)}</th>)}
            </tr>
          </thead>
          <tbody>
            <Row label="Sales appointments" sub={`${counted("sales")} rep${counted("sales") === 1 ? "" : "s"}`} cells={l.sales} target={l.targetPct} />
            <Row label="Installs" sub={`${counted("install")} installer${counted("install") === 1 ? "" : "s"} · ${l.backlogJobs} sold, not installed`} cells={l.install} target={l.targetPct} />
          </tbody>
        </table>
      </div>

      <div className="cap2-team">
        <Team title="Reps" people={reps} />
        <Team title="Installers" people={installers} />
      </div>
    </section>
  );
}

function Row({ label, sub, cells, target }: { label: string; sub: string; cells: RoleWeek[]; target: number }) {
  return (
    <tr>
      <th scope="row">
        <span className="cap2-label">{label}</span>
        <span className="muted small">{sub}</span>
      </th>
      {cells.map((c) => {
        const pct = c.capacity > 0 ? Math.round((c.booked / c.capacity) * 100) : null;
        const tone = pct == null ? "none" : pct > 100 ? "over" : pct >= target ? "full" : pct >= target - 25 ? "mid" : "low";
        return (
          <td key={c.week} className={`cap2-cell ${tone}`}>
            <span className="cap2-pct">{pct == null ? "—" : `${pct}%`}</span>
            <span className="cap2-bar"><span style={{ width: `${Math.min(100, pct ?? 0)}%` }} /></span>
            <span className="cap2-nums">{c.booked} of {c.capacity} booked</span>
          </td>
        );
      })}
    </tr>
  );
}

function Team({ title, people }: { title: string; people: LocationCapacity["members"] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  if (people.length === 0) return <div className="cap2-team-group"><span className="muted small">{title}: nobody on the calendar yet</span></div>;
  return (
    <div className="cap2-team-group">
      <span className="cap2-team-title">{title}</span>
      {people.map((m) => {
        const counts = m.active && m.primary;
        return (
          <button
            key={m.id}
            type="button"
            className={`cap2-chip ${counts ? "on" : ""}`}
            aria-pressed={m.active}
            disabled={busy === m.id}
            title={!m.primary ? "Mostly books at the other location, so counted there" : m.active ? "Counted. Click to leave out" : "Left out. Click to count"}
            onClick={async () => {
              setBusy(m.id);
              await fetch("/api/capacity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "updateMember", id: m.id, active: !m.active }) }).catch(() => null);
              setBusy(null);
              router.refresh();
            }}
          >
            {m.personName}
            {!m.primary && <span className="cap2-chip-note"> · other location</span>}
            {!m.active && <span className="cap2-chip-note"> · off</span>}
          </button>
        );
      })}
    </div>
  );
}
