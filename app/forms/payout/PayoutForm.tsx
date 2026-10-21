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
  ["zelle", "Zelle"],
  ["check", "Check"],
  ["cashapp", "Cash App"],
  ["venmo", "Venmo"],
  ["ach", "ACH"],
  ["cash", "Cash"],
  ["other", "Other"],
] as const;
type Method = (typeof METHODS)[number][0];

interface PersonState {
  on: boolean;
  open: boolean;
  showWaiting: boolean;
  method: Method | null; // null = use the default method
  reference: string;
  picked: Record<string, string>; // line key → amount typed
}

const key = (l: OpenLine) => `${l.dealId}:${l.kind}`;
const dollars = (c: number) => (c / 100).toFixed(2);
const allPayable = (p: Payee) => Object.fromEntries(p.lines.filter((l) => l.payable).map((l) => [key(l), dollars(l.openCents)]));
const cents = (s: string) => {
  const c = parseMoneyInput(s);
  return c == null || Number.isNaN(c) ? null : c;
};

export default function PayoutForm({ payees, runs, defaultRun, today }: { payees: Payee[]; runs: Array<{ date: string; label: string }>; defaultRun: string; today: string }) {
  const [payRun, setPayRun] = useState(defaultRun);
  const [paidOn, setPaidOn] = useState(today);
  const [method, setMethod] = useState<Method>("zelle");
  const [state, setState] = useState<Record<string, PersonState>>(() =>
    Object.fromEntries(payees.map((p) => [p.id, { on: p.payableCents > 0, open: false, showWaiting: false, method: null, reference: "", picked: allPayable(p) }])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ people: number; lines: number; totalCents: number } | null>(null);

  const set = (id: string, patch: Partial<PersonState> | ((s: PersonState) => Partial<PersonState>)) =>
    setState((m) => ({ ...m, [id]: { ...m[id]!, ...(typeof patch === "function" ? patch(m[id]!) : patch) } }));

  const summary = useMemo(() => {
    let total = 0;
    let people = 0;
    let lines = 0;
    let bad = false;
    for (const p of payees) {
      const s = state[p.id]!;
      const ks = Object.keys(s.picked);
      if (!s.on || !ks.length) continue;
      people++;
      lines += ks.length;
      for (const k of ks) {
        const c = cents(s.picked[k]!);
        if (c == null || c <= 0) bad = true;
        else total += c;
      }
    }
    return { total, people, lines, bad };
  }, [payees, state]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!summary.people) return setError("Pick at least one person to pay.");
    if (summary.bad) return setError("Every picked deal needs an amount above $0.");
    setBusy(true);
    setError(null);
    const batch = payees
      .filter((p) => state[p.id]!.on && Object.keys(state[p.id]!.picked).length)
      .map((p) => {
        const s = state[p.id]!;
        return {
          personId: p.id,
          method: s.method ?? method,
          reference: s.reference || undefined,
          lines: p.lines.filter((l) => key(l) in s.picked).map((l) => ({ dealId: l.dealId, kind: l.kind, amountCents: cents(s.picked[key(l)]!) })),
        };
      });
    try {
      const res = await fetch("/api/forms/payout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payRun, paidOn, payees: batch }) });
      const b = (await res.json().catch(() => ({}))) as { people?: number; lines?: number; totalCents?: number; error?: string };
      if (!res.ok) return setError(b.error ?? "Couldn't save the payouts.");
      setDone({ people: b.people ?? 0, lines: b.lines ?? 0, totalCents: b.totalCents ?? 0 });
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
        <h2>{fmt(done.totalCents, { decimals: 2 })} paid to {done.people} {done.people === 1 ? "person" : "people"}</h2>
        <p>{done.lines} deal line{done.lines === 1 ? "" : "s"}, on the {runs.find((r) => r.date === payRun)?.label ?? payRun} pay run.</p>
        <div className="row-actions">
          <a className="btn-primary big" href={`/commissions?run=${payRun}`}>Open that pay run</a>
          <a className="linkbtn" href="/forms/payout">Record more payouts</a>
        </div>
      </div>
    );
  }

  return (
    <form className="field-form payout-form" onSubmit={submit}>
      <fieldset>
        <legend>Pay run</legend>
        <div className="grid">
          <label>Pay run
            <select value={payRun} onChange={(e) => setPayRun(e.target.value)}>
              {runs.map((r) => <option key={r.date} value={r.date}>{r.label}</option>)}
            </select>
          </label>
          <label>Paid on<input type="date" required value={paidOn} max={today} onChange={(e) => setPaidOn(e.target.value)} /></label>
          <label>Method
            <select value={method} onChange={(e) => setMethod(e.target.value as Method)}>
              {METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        </div>
      </fieldset>

      {payees.length === 0 && <p className="empty">Nobody is owed anything right now.</p>}

      <div className="payees">
        {payees.map((p) => {
          const s = state[p.id]!;
          const picked = p.lines.filter((l) => key(l) in s.picked);
          const sum = picked.reduce((t, l) => t + (cents(s.picked[key(l)]!) ?? 0), 0);
          const advances = picked.filter((l) => !l.payable).length;
          const waiting = p.lines.filter((l) => !l.payable).length;
          const visible = p.lines.filter((l) => l.payable || s.showWaiting || key(l) in s.picked);
          const m = s.method ?? method;
          return (
            <section key={p.id} className={`payee ${s.on && picked.length ? "on" : ""}`}>
              <div className="payee-head">
                <label className="check">
                  <input type="checkbox" checked={s.on} onChange={(e) => set(p.id, (x) => ({ on: e.target.checked, picked: e.target.checked && !Object.keys(x.picked).length ? allPayable(p) : x.picked }))} />
                  <strong>{p.name}</strong>
                </label>
                <button type="button" className="linkbtn" aria-expanded={s.open} onClick={() => set(p.id, (x) => ({ open: !x.open }))}>
                  {picked.length} of {p.lines.length} deal{p.lines.length === 1 ? "" : "s"} {s.open ? "▴" : "▾"}
                </button>
                {advances > 0 && <span className="pill warn-pill">{advances} advance{advances === 1 ? "" : "s"}</span>}
                <span className="payee-spacer" />
                <select aria-label={`Method for ${p.name}`} value={m} disabled={!s.on} onChange={(e) => set(p.id, { method: e.target.value as Method })}>
                  {METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <input
                  aria-label={`${m === "check" ? "Check number" : "Reference"} for ${p.name}`}
                  className="ref"
                  placeholder={m === "check" ? "Check #" : "Reference"}
                  value={s.reference}
                  disabled={!s.on}
                  onChange={(e) => set(p.id, { reference: e.target.value })}
                />
                <span className="payee-total">{s.on ? fmt(sum, { decimals: 2 }) : "—"}</span>
              </div>
              {s.open && (
                <div className="payee-body">
                  <div className="row-actions tight">
                    <button type="button" className="linkbtn" onClick={() => set(p.id, { picked: allPayable(p), on: true })}>All payable</button>
                    <button type="button" className="linkbtn" onClick={() => set(p.id, { picked: {} })}>None</button>
                    {waiting > 0 && (
                      <label className="check inline">
                        <input type="checkbox" checked={s.showWaiting} onChange={(e) => set(p.id, { showWaiting: e.target.checked })} /> Show {waiting} not payable yet
                      </label>
                    )}
                  </div>
                  <table className="payout-lines">
                    <thead>
                      <tr><th /><th>Deal</th><th>For</th><th className="num">Earned</th><th className="num">Paid</th><th className="num">Owed</th><th className="num">Paying</th></tr>
                    </thead>
                    <tbody>
                      {visible.map((l) => {
                        const k = key(l);
                        const on = k in s.picked;
                        return (
                          <tr key={k} className={`${on ? "on" : ""} ${l.payable ? "" : "waiting"}`}>
                            <td>
                              <input
                                type="checkbox"
                                aria-label={`Pay deal ${l.number}`}
                                checked={on}
                                onChange={(e) =>
                                  set(p.id, (x) => {
                                    const n = { ...x.picked };
                                    if (e.target.checked) n[k] = dollars(l.openCents);
                                    else delete n[k];
                                    return { picked: n, on: e.target.checked ? true : x.on };
                                  })
                                }
                              />
                            </td>
                            <td>
                              <strong>#{l.number}</strong> {l.customer}
                              {!l.payable ? <span className="act-detail">Advance: {l.waitingOn ?? "not payable yet"}</span> : l.installedOn ? <span className="act-detail">Installed {shortDate(l.installedOn)}</span> : null}
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
                                  value={s.picked[k]}
                                  onChange={(e) => set(p.id, (x) => ({ picked: { ...x.picked, [k]: e.target.value } }))}
                                />
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        })}
      </div>

      {error && <p className="flash" role="alert">{error}</p>}
      <div className="payout-bar">
        <span>
          <strong>{summary.people}</strong> {summary.people === 1 ? "person" : "people"} · {summary.lines} deal line{summary.lines === 1 ? "" : "s"}
        </span>
        <span className="payout-bar-total">{fmt(summary.total, { decimals: 2 })}</span>
        <button type="submit" className="btn-primary big" disabled={busy || !summary.people}>
          {busy ? "Saving…" : `Record ${summary.people ? fmt(summary.total, { decimals: 2 }) : "payouts"}`}
        </button>
      </div>
    </form>
  );
}
