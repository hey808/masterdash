"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DECLINE_REASONS, type Outcome } from "@/lib/appointment-types";
import type { SaleAppointment } from "@/lib/appointments";

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
const shortDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

const BADGE: Record<Outcome, string> = { declined: "Declined", rescheduled: "Rescheduled", closed: "Closed" };

export default function AppointmentsView({ appointments, day, showRep }: { appointments: SaleAppointment[]; day: string; showRep: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  if (appointments.length === 0) return <p className="empty appts-empty">No sales appointments{showRep ? "" : " on your calendar"} this day.</p>;
  return (
    <ul className="appts-list">
      {appointments.map((a) => {
        const sold = a.soldDealNumber != null || a.disposition?.outcome === "closed";
        const outcome: Outcome | null = sold ? "closed" : a.disposition?.outcome ?? null;
        const isOpen = open === a.id;
        return (
          <li key={a.id} className={`appt-item ${outcome ? `o-${outcome}` : ""} ${isOpen ? "open" : ""}`}>
            <button type="button" className="appt-row" aria-expanded={isOpen} disabled={sold} onClick={() => setOpen(isOpen ? null : a.id)}>
              <span className="appt-time">{timeOf(a.start)}</span>
              <span className="appt-name">{a.customerName}</span>
              {a.address && <span className="appt-addr">{a.address}</span>}
              {(showRep || a.phone) && (
                <span className="appt-meta">
                  {showRep && a.repName ? `${a.repName} · ` : ""}
                  {a.locationName}
                  {a.phone ? ` · ${a.phone}` : ""}
                </span>
              )}
              {outcome && (
                <span className={`appt-badge o-${outcome}`}>
                  {BADGE[outcome]}
                  {outcome === "closed" && a.soldDealNumber != null ? ` · deal #${a.soldDealNumber}` : ""}
                  {outcome === "rescheduled" && a.disposition?.rescheduledTo ? ` to ${shortDay(a.disposition.rescheduledTo)}` : ""}
                  {outcome === "declined" && a.disposition?.reason ? `: ${a.disposition.reason}` : ""}
                </span>
              )}
            </button>
            {isOpen && <Dispose a={a} day={day} onDone={() => setOpen(null)} />}
          </li>
        );
      })}
    </ul>
  );
}

function Dispose({ a, day, onDone }: { a: SaleAppointment; day: string; onDone: () => void }) {
  const router = useRouter();
  const [choice, setChoice] = useState<"declined" | "rescheduled" | null>(a.disposition?.outcome === "closed" ? null : (a.disposition?.outcome ?? null));
  const [reason, setReason] = useState(a.disposition?.reason ?? "");
  const [note, setNote] = useState(a.disposition?.note ?? "");
  const [newDate, setNewDate] = useState(a.disposition?.rescheduledTo ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!choice) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appointmentId: a.id, day, outcome: choice, reason: choice === "declined" ? reason || null : null, note: note || null, rescheduledTo: choice === "rescheduled" ? newDate || null : null }),
      });
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) return setError(b.error ?? "Couldn't save.");
      onDone();
      router.refresh();
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dispo">
      <p className="dispo-q">How did it go?</p>
      <div className="dispo-choices">
        <button type="button" className={`dispo-btn d-declined ${choice === "declined" ? "on" : ""}`} aria-pressed={choice === "declined"} onClick={() => setChoice("declined")}>Declined</button>
        <button type="button" className={`dispo-btn d-rescheduled ${choice === "rescheduled" ? "on" : ""}`} aria-pressed={choice === "rescheduled"} onClick={() => setChoice("rescheduled")}>Rescheduled</button>
        <a className="dispo-btn d-closed" href={`/forms/sale?appt=${encodeURIComponent(a.id)}&day=${day}`}>Closed</a>
      </div>
      {choice === "declined" && (
        <div className="dispo-detail">
          <span className="dispo-label">Why?</span>
          <div className="dispo-reasons">
            {DECLINE_REASONS.map((r) => (
              <button key={r} type="button" className={`chip-btn ${reason === r ? "on" : ""}`} aria-pressed={reason === r} onClick={() => setReason(reason === r ? "" : r)}>{r}</button>
            ))}
          </div>
        </div>
      )}
      {choice === "rescheduled" && (
        <label className="dispo-detail">
          <span className="dispo-label">New date</span>
          <input type="date" value={newDate} min={day} onChange={(e) => setNewDate(e.target.value)} />
        </label>
      )}
      {choice && (
        <>
          <label className="dispo-detail">
            <span className="dispo-label">Note</span>
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
          </label>
          {error && <p className="flash" role="alert">{error}</p>}
          <button type="button" className="btn-primary big" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : `Save as ${choice}`}</button>
        </>
      )}
    </div>
  );
}
