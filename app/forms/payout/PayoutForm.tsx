"use client";

import { useMemo, useState } from "react";
import { shortDate } from "@/lib/dates";
import { parseMoneyInput } from "@/lib/ledger/fields";
import type { PayoutKind } from "@/lib/ledger/types";
import { fmt } from "@/lib/money";

export interface OpenLine {
  dealId: string;
  number: number;
  customer: string;
  kind: PayoutKind;
  kindLabel: string;
  earnedCents: number;
  paidCents: number;
  openCents: number;
  payable: boolean;
  waitingOn: string | null;
  installedOn: string | null;
}

export interface Payee {
  id: string;
  name: string;
  payableCents: number;
  waitingCents: number;
  lines: OpenLine[];
}

const METHODS = [
  ["check", "Check"],
  ["zelle", "Zelle"],
  ["cashapp", "Cash App"],
  ["venmo", "Venmo"],
  ["ach", "ACH"],
  ["cash", "Cash"],
  ["other", "Other"],
] as const;
type Method = (typeof METHODS)[number][0];

const key = (l: OpenLine) => `${l.dealId}:${l.kind}`;
const dollars = (c: number) => (c / 100).toFixed(2);

export default function PayoutForm({ payees, today }: { payees: Payee[]; today: string }) {
  const [personId, setPersonId] = useState("");
  const [picked, setPicked] = useState<Record<string, string>>({}); // key → amount typed
  const [showWaiting, setShowWaiting] = useState(false);
  const [method, setMethod] = useState<Method>("zelle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ name: string; count: number; totalCents: number } | null>(null);

  const payee = payees.find((p) => p.id === personId) ?? null;
  const visible = payee ? payee.lines.filter((l) => l.payable || showWaiting || key(l) in picked) : [];
  const waitingCount = payee ? payee.lines.filter((l) => !l.payable).length : 0;

  function choose(id: string) {
    setPersonId(id);
    setError(null);
    const p = payees.find((x) => x.id === id);
    // Start with everything that's payable now, for the full amount owed.
    setPicked(Object.fromEntries((p?.lines ?? []).filter((l) => l.payable).map((l) => [key(l), dollars(l.openCents)])));
    setShowWaiting(false);
  }

  const totals = useMemo(() => {
    let cents = 0;
    let bad = false;
    for (const v of Object.values(picked)) {
      const c = parseMoneyInput(v);
      if (c == null || Number.isNaN(c) || c <= 0) bad = true;
      else cents += c;
    }
    return { cents, bad, count: Object.keys(picked).length };
  }, [picked]);
  const advances = payee ? payee.lines.filter((l) => !l.payable && key(l) in picked).length : 0;
  const over = payee ? payee.lines.filter((l) => key(l) in picked && (parseMoneyInput(picked[key(l)]!) ?? 0) > l.openCents).length : 0;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!payee) return setError("Pick who you're paying.");
    if (!totals.count) return setError("Pick at least one deal.");
    if (totals.bad) return setError("Every picked line needs an amount above $0.");
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/forms/payout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          personId: payee.id,
          paidOn: f.get("paidOn"),
          method,
          reference: f.get("reference") || undefined,
          note: f.get("note") || undefined,
          lines: payee.lines.filter((l) => key(l) in picked).map((l) => ({ dealId: l.dealId, kind: l.kind, amountCents: parseMoneyInput(picked[key(l)]!) })),
        }),
      });
      const b = (await res.json().catch(() => ({}))) as { count?: number; totalCents?: number; error?: string };
      if (!res.ok) return setError(b.error ?? "Couldn't save the payout.");
      setDone({ name: payee.name, count: b.count ?? 0, totalCents: b.totalCents ?? 0 });
      window.scrollTo({ top: 0 });
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="form-done">
        <h2>{fmt(done.totalCents, { decimals: 2 })} paid to {done.name}</h2>
        <p>Recorded on {done.count} deal{done.count === 1 ? "" : "s"}.</p>
        <div className="row-actions">
          <a className="btn-primary big" href="/forms/payout">Record another payout</a>
          <a className="linkbtn" href="/commissions?tab=all">Open commissions</a>
        </div>
      </div>
    );
  }

  return (
    <form className="field-form" onSubmit={submit}>
      <fieldset>
        <legend>Who and how</legend>
        <div className="grid">
          <label className="wide">Paying
            <select value={personId} onChange={(e) => choose(e.target.value)} required>
              <option value="" disabled>Choose…</option>
              {payees.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}: {fmt(p.payableCents)} payable{p.waitingCents ? `, ${fmt(p.waitingCents)} not yet` : ""}
                </option>
              ))}
            </select>
          </label>
          <label>Paid on<input name="paidOn" type="date" required defaultValue={today} max={today} /></label>
          <label>Method
            <select value={method} onChange={(e) => setMethod(e.target.value as Method)}>
              {METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label>{method === "check" ? "Check #" : "Reference"}<input name="reference" autoComplete="off" placeholder={method === "check" ? "1206" : "Optional"} /></label>
          <label className="wide">Note<input name="note" autoComplete="off" placeholder="Optional" /></label>
        </div>
      </fieldset>

      {payee && (
        <fieldset>
          <legend>Deals</legend>
          {payee.lines.length === 0 ? (
            <p className="muted">Nothing owed to {payee.name}.</p>
          ) : (
            <>
              <div className="row-actions tight">
                <button type="button" className="linkbtn" onClick={() => setPicked(Object.fromEntries(payee.lines.filter((l) => l.payable).map((l) => [key(l), dollars(l.openCents)])))}>All payable</button>
                <button type="button" className="linkbtn" onClick={() => setPicked({})}>None</button>
                {waitingCount > 0 && (
                  <label className="check inline">
                    <input type="checkbox" checked={showWaiting} onChange={(e) => setShowWaiting(e.target.checked)} /> Show {waitingCount} not payable yet
                  </label>
                )}
              </div>
              <div className="tablewrap">
                <table className="payout-lines">
                  <thead>
                    <tr><th /><th>Deal</th><th>For</th><th className="num">Earned</th><th className="num">Paid</th><th className="num">Owed</th><th className="num">Paying</th></tr>
                  </thead>
                  <tbody>
                    {visible.map((l) => {
                      const k = key(l);
                      const on = k in picked;
                      return (
                        <tr key={k} className={`${on ? "on" : ""} ${l.payable ? "" : "waiting"}`}>
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`Pay deal ${l.number}`}
                              checked={on}
                              onChange={(e) =>
                                setPicked((m) => {
                                  const n = { ...m };
                                  if (e.target.checked) n[k] = dollars(l.openCents);
                                  else delete n[k];
                                  return n;
                                })
                              }
                            />
                          </td>
                          <td>
                            <strong>#{l.number}</strong> {l.customer}
                            {!l.payable && <span className="act-detail">Advance: {l.waitingOn ?? "not payable yet"}</span>}
                            {l.payable && l.installedOn && <span className="act-detail">Installed {shortDate(l.installedOn)}</span>}
                          </td>
                          <td className="muted">{l.kindLabel}</td>
                          <td className="num">{fmt(l.earnedCents, { decimals: 2 })}</td>
                          <td className="num">{fmt(l.paidCents, { decimals: 2 })}</td>
                          <td className="num strong">{fmt(l.openCents, { decimals: 2 })}</td>
                          <td className="num">
                            {on && (
                              <input
                                aria-label={`Amount for deal ${l.number}`}
                                inputMode="decimal"
                                className="amt"
                                value={picked[k]}
                                onChange={(e) => setPicked((m) => ({ ...m, [k]: e.target.value }))}
                              />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={6}>{totals.count} deal{totals.count === 1 ? "" : "s"}</td>
                      <td className="num strong">{fmt(totals.cents, { decimals: 2 })}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              {advances > 0 && <p className="warn">{advances} line{advances === 1 ? " is" : "s are"} an advance: the job isn&apos;t installed and paid in full yet.</p>}
              {over > 0 && <p className="warn">{over} line{over === 1 ? " pays" : "s pay"} more than is owed; it will show as overpaid.</p>}
            </>
          )}
        </fieldset>
      )}

      {error && <p className="flash" role="alert">{error}</p>}
      <div className="row-actions">
        <button type="submit" className="btn-primary big" disabled={busy || !payee || !totals.count}>
          {busy ? "Saving…" : payee && totals.count ? `Record ${fmt(totals.cents, { decimals: 2 })} to ${payee.name}` : "Record payout"}
        </button>
      </div>
    </form>
  );
}
