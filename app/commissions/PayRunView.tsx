"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { KIND_LABEL } from "@/lib/ledger/payouts";
import { addDays, type PayRun, type RunLine } from "@/lib/ledger/payrun";
import { fmt, sumCents } from "@/lib/money";

const LOC: Record<string, string> = { wilmington: "Wilmington", "myrtle-beach": "Myrtle Beach" };

const longDay = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const money2 = (c: number) => fmt(c, { decimals: 2 });

export default function PayRunView({ run, today, currentPayDate }: { run: PayRun; today: string; currentPayDate: string }) {
  const router = useRouter();
  const { week, totals } = run;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Everyone starts collapsed; the browser remembers who you've opened.
  const [open, setOpen] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("payrun.open") ?? "[]");
      if (Array.isArray(saved)) setOpen(new Set(saved));
    } catch {
      /* storage unavailable: everyone stays collapsed */
    }
  }, []);
  const saveOpen = (next: Set<string>) => {
    setOpen(next);
    try {
      localStorage.setItem("payrun.open", JSON.stringify([...next]));
    } catch {
      /* ignore */
    }
  };
  const folded = { has: (person: string) => !open.has(person) };
  const toggleFold = (person: string) => {
    const next = new Set(open);
    if (next.has(person)) next.delete(person);
    else next.add(person);
    saveOpen(next);
  };

  // A payout belongs to the run it is recorded for: never before Friday, never past the run.
  const paidOn = today < week.payDate ? week.payDate : today > week.runEnd ? week.runEnd : today;

  async function pay(lines: RunLine[], key: string) {
    setBusy(key);
    setError(null);
    try {
      for (const l of lines) {
        if (l.remainingCents <= 0) continue;
        const res = await fetch("/api/payouts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dealId: l.dealId, kind: l.kind, personId: l.personId, amountCents: l.remainingCents, paidOn }),
        });
        if (!res.ok) {
          const b = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(`${l.customer}: ${b.error ?? "couldn't record the payout"}`);
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      router.refresh();
    }
  }

  async function undo(l: RunLine) {
    setBusy(`undo-${l.dealId}-${l.kind}`);
    setError(null);
    try {
      for (const id of l.payoutIds) {
        const res = await fetch(`/api/payouts/${id}`, { method: "DELETE" });
        if (!res.ok) {
          const b = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(b.error ?? "Couldn't undo.");
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      router.refresh();
    }
  }

  const people = groupBy(run.lines, (l) => l.person);
  const isCurrent = week.payDate === currentPayDate;

  return (
    <>
      <div className="run-head">
        <a className="btn-ghost" href={`/commissions?run=${addDays(week.payDate, -7)}`} aria-label="Previous pay run">←</a>
        <div>
          <div className="run-title">
            Pay run {longDay(week.payDate)}
            {isCurrent ? <span className="pill now">This Friday</span> : week.payDate < currentPayDate ? <span className="pill past">Past run</span> : <span className="pill">Upcoming</span>}
          </div>
          <div className="muted">
            Money collected {longDay(week.start)} through {longDay(week.cutoff)}, cutoff Thursday midnight
          </div>
        </div>
        <a className="btn-ghost" href={`/commissions?run=${addDays(week.payDate, 7)}`} aria-label="Next pay run">→</a>
        {!isCurrent && <a className="linkbtn" href="/commissions">Back to this Friday</a>}
      </div>

      <section className="run-totals">
        <Stat label="Collected this week" value={fmt(totals.collectedCents)} note={`${run.collections.length} payment${run.collections.length === 1 ? "" : "s"}`} />
        <Stat label="Payable this week" value={fmt(totals.newlyPayableCents)} note="installed and paid in full by Thursday" tone="new" />
        <Stat label="Paid this run" value={fmt(totals.paidThisRunCents)} tone="paid" />
        <Stat label="Left to pay" value={fmt(totals.remainingCents)} tone={totals.remainingCents > 0 ? "due" : "paid"} big />
      </section>

      {error && <p className="flash" role="alert">{error}</p>}
      {(run.undatedPayments > 0 || run.undatedPayouts > 0) && (
        <p className="hint block">
          {run.undatedPayments} payments imported from Mission Control have no date, so those deals count as collected before this run and won't appear in it.
          If one of them was really collected this week, set its date from the ledger (click the Customer Collected or Lender Collected amount).
        </p>
      )}

      <div className="section-head">
        <h2 className="section">To pay this Friday</h2>
        {people.length > 1 && (
          <span className="fold-all">
            <button type="button" className="linkbtn" onClick={() => saveOpen(new Set(people.map(([p]) => p)))}>Expand all</button>
            <button type="button" className="linkbtn" onClick={() => saveOpen(new Set())}>Collapse all</button>
          </span>
        )}
      </div>
      {people.length === 0 ? (
        <p className="empty">Nothing is payable in this run.</p>
      ) : (
        <div className="tablewrap">
          <table className="run">
            <thead>
              <tr>
                <th>#</th>
                <th>Customer</th>
                <th>For</th>
                <th>Completed</th>
                <th className="num">Due</th>
                <th className="num">Paid</th>
                <th />
              </tr>
            </thead>
            {people.map(([person, lines]) => {
              const remaining = sumCents(lines.map((l) => Math.max(0, l.remainingCents)));
              const paid = sumCents(lines.map((l) => l.paidThisRunCents));
              const due = sumCents(lines.map((l) => l.dueCents));
              return (
                <tbody key={person}>
                  <tr className="person-head">
                    <td colSpan={4}>
                      <button
                        type="button"
                        className="fold"
                        aria-expanded={!folded.has(person)}
                        aria-label={`${folded.has(person) ? "Show" : "Hide"} ${person}'s lines`}
                        onClick={() => toggleFold(person)}
                      >
                        {folded.has(person) ? "▸" : "▾"}
                      </button>
                      <strong className="fold-name" onClick={() => toggleFold(person)}>{person}</strong>{" "}
                      <span className="muted">
                        {lines.length} line{lines.length === 1 ? "" : "s"} · due {money2(due)}
                        {paid > 0 && ` · paid ${money2(paid)}`}
                      </span>
                    </td>
                    <td className="num" colSpan={2}>
                      {remaining > 0 ? <strong className="due">{money2(remaining)} to pay</strong> : <span className="status paid">All paid</span>}
                    </td>
                    <td>
                      {remaining > 0 && person === "Unassigned" && <span className="hint">Name the person on each deal in the ledger to pay</span>}
                      {remaining > 0 && person !== "Unassigned" && (
                        <button type="button" className="btn-primary" disabled={busy != null} onClick={() => pay(lines, `all-${person}`)}>
                          {busy === `all-${person}` ? "Recording…" : `Pay all ${money2(remaining)}`}
                        </button>
                      )}
                    </td>
                  </tr>
                  {!folded.has(person) && lines.map((l) => {
                    const key = `${l.dealId}-${l.kind}`;
                    const done = l.remainingCents <= 50;
                    return (
                      <tr key={key} className={done ? "is-paid" : ""}>
                        <td className="muted">{l.dealNumber}</td>
                        <td>
                          {l.customer} <span className="muted">· {LOC[l.location] ?? l.location}</span>
                        </td>
                        <td>{KIND_LABEL[l.kind]}</td>
                        <td>
                          {l.isNew ? <span className="muted">{l.unlockedBy}</span> : <span className="muted">paid this run (owed from an earlier week)</span>}
                        </td>
                        <td className="num">{money2(l.dueCents)}</td>
                        <td className="num">{l.paidThisRunCents ? money2(l.paidThisRunCents) : "—"}</td>
                        <td>
                          {done ? (
                            <span className="paid-cell">
                              ✓ Paid
                              {l.payoutIds.length > 0 && (
                                <button type="button" className="linkbtn" disabled={busy != null} onClick={() => undo(l)}>
                                  Undo
                                </button>
                              )}
                            </span>
                          ) : l.personId == null ? (
                            <span className="muted">No person on deal</span>
                          ) : (
                            <button type="button" className="btn-outline" disabled={busy != null} onClick={() => pay([l], key)}>
                              {busy === key ? "Recording…" : "Mark paid"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              );
            })}
          </table>
        </div>
      )}
      <p className="muted small">Mark paid records the payout dated {longDay(paidOn)} for the full amount still due on that line.</p>

      <h2 className="section">Collected this week</h2>
      {run.collections.length === 0 ? (
        <p className="empty">No dated payments between {longDay(week.start)} and {longDay(week.cutoff)}.</p>
      ) : (
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Received</th>
                <th>#</th>
                <th>Customer</th>
                <th>From</th>
                <th className="num">Amount</th>
                <th>Effect</th>
              </tr>
            </thead>
            <tbody>
              {run.collections.map((c) => (
                <tr key={c.payment.id ?? `${c.dealId}-${c.payment.receivedOn}-${c.payment.amountCents}`}>
                  <td>{longDay(c.payment.receivedOn!)}</td>
                  <td className="muted">{c.dealNumber}</td>
                  <td>{c.customer}</td>
                  <td>{c.payment.source === "lender" ? "Lender funding" : `Customer (${c.payment.method})`}</td>
                  <td className="num">{money2(c.payment.amountCents)}</td>
                  <td>{c.completesDeal ? <span className="status payable">Paid in full: commissions unlocked</span> : <span className="muted">partial</span>}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4}>{run.collections.length} payments</td>
                <td className="num">{money2(totals.collectedCents)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <details className="waiting">
        <summary>
          Still waiting: {fmt(totals.waitingCents)} across {run.waiting.length} line{run.waiting.length === 1 ? "" : "s"} (not installed or not paid in full by the cutoff)
        </summary>
        <div className="tablewrap">
          <table>
            <thead>
              <tr><th>#</th><th>Customer</th><th>Person</th><th>For</th><th className="num">Amount</th><th>Waiting on</th></tr>
            </thead>
            <tbody>
              {run.waiting.map((w) => (
                <tr key={`${w.dealId}-${w.kind}`}>
                  <td className="muted">{w.dealNumber}</td>
                  <td>{w.customer}</td>
                  <td>{w.person}</td>
                  <td>{KIND_LABEL[w.kind]}</td>
                  <td className="num">{money2(w.openCents)}</td>
                  <td className="muted">{w.waitingOn}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}

function Stat({ label, value, note, tone, big }: { label: string; value: string; note?: string; tone?: "new" | "carry" | "paid" | "due"; big?: boolean }) {
  return (
    <div className={`stat ${tone ?? ""} ${big ? "big" : ""}`}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {note && <div className="note">{note}</div>}
    </div>
  );
}

function groupBy<T>(xs: T[], key: (x: T) => string): Array<[string, T[]]> {
  const m = new Map<string, T[]>();
  for (const x of xs) m.set(key(x), [...(m.get(key(x)) ?? []), x]);
  return [...m.entries()];
}
