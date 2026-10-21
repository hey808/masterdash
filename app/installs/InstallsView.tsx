"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { INCOMPLETE_REASONS, outcomeLabel, type Outcome } from "@/lib/appointment-types";
import type { InstallAppointment } from "@/lib/appointments";

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
const money = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default function InstallsView({ appointments, day, showWho }: { appointments: InstallAppointment[]; day: string; showWho: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  if (appointments.length === 0) return <p className="empty appts-empty">No installs{showWho ? "" : " on your calendar"} this day.</p>;
  return (
    <ul className="appts-list">
      {appointments.map((a) => {
        const done = a.disposition?.outcome === "completed" || (a.deal?.installedOn != null && a.deal.installedOn <= day);
        const outcome: Outcome | null = done ? "completed" : a.disposition?.outcome ?? null;
        const isOpen = open === a.id;
        return (
          <li key={a.id} className={`appt-item k-install ${outcome ? `o-${outcome}` : ""} ${isOpen ? "open" : ""}`}>
            <button type="button" className="appt-row" aria-expanded={isOpen} disabled={done} onClick={() => setOpen(isOpen ? null : a.id)}>
              <span className="appt-time">{timeOf(a.start)}</span>
              <span className="appt-name">{a.customerName}</span>
              {a.address && <span className="appt-addr">{a.address}</span>}
              {a.deal?.products && <span className="appt-products">{a.deal.products}</span>}
              <span className="appt-meta">
                {showWho && a.installerName ? `${a.installerName} · ` : ""}
                {a.locationName}
                {a.deal ? ` · deal #${a.deal.number}` : " · no matching deal"}
              </span>
              {!done && a.deal && a.deal.customerOwesCents > 50 && <span className="appt-collect">Collect {money(a.deal.customerOwesCents)}</span>}
              {outcome && (
                <span className={`appt-badge o-${outcome}`}>
                  {outcomeLabel({ outcome, reason: a.disposition?.reason ?? null, rescheduledTo: a.disposition?.rescheduledTo ?? null, dealNumber: a.deal?.number ?? null })}
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

function Dispose({ a, day, onDone }: { a: InstallAppointment; day: string; onDone: () => void }) {
  const router = useRouter();
  const prior = a.disposition?.outcome;
  const [choice, setChoice] = useState<"incomplete" | "rescheduled" | null>(prior === "incomplete" || prior === "rescheduled" ? prior : null);
  const [reason, setReason] = useState(a.disposition?.reason ?? "");
  const [note, setNote] = useState(a.disposition?.note ?? "");
  const [newDate, setNewDate] = useState(a.disposition?.rescheduledTo ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const completeHref = a.deal ? `/forms/install?deal=${a.deal.id}&appt=${encodeURIComponent(a.id)}` : "/forms/install";

  async function save() {
    if (!choice) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appointmentId: a.id, day, kind: "install", outcome: choice, reason: choice === "incomplete" ? reason || null : null, note: note || null, rescheduledTo: choice === "rescheduled" ? newDate || null : null }),
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
      {(a.phone || a.address) && (
        <div className="dispo-links">
          {a.phone && <a className="btn-outline" href={`tel:${a.phone.replace(/[^\d+]/g, "")}`}>Call</a>}
          {a.address && <a className="btn-outline" href={`https://maps.google.com/?q=${encodeURIComponent(a.address)}`} target="_blank" rel="noreferrer">Directions</a>}
        </div>
      )}
      {a.deal?.notes && <p className="dispo-note">{a.deal.notes}</p>}
      <p className="dispo-q">How did it go?</p>
      <div className="dispo-choices">
        <a className="dispo-btn d-closed" href={completeHref}>Completed</a>
        <button type="button" className={`dispo-btn d-rescheduled ${choice === "rescheduled" ? "on" : ""}`} aria-pressed={choice === "rescheduled"} onClick={() => setChoice("rescheduled")}>Rescheduled</button>
        <button type="button" className={`dispo-btn d-declined ${choice === "incomplete" ? "on" : ""}`} aria-pressed={choice === "incomplete"} onClick={() => setChoice("incomplete")}>Couldn&apos;t finish</button>
      </div>
      {!a.deal && <p className="muted small">This install didn&apos;t match a deal in the ledger. Completed opens the installer form so you can pick the customer.</p>}
      {choice === "incomplete" && (
        <div className="dispo-detail">
          <span className="dispo-label">What happened?</span>
          <div className="dispo-reasons">
            {INCOMPLETE_REASONS.map((r) => (
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
          <button type="button" className="btn-primary big" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : choice === "incomplete" ? "Save as not completed" : "Save as rescheduled"}</button>
        </>
      )}
    </div>
  );
}
