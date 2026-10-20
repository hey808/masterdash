"use client";

import { useState } from "react";
import { todayET, shortDate } from "@/lib/dates";
import { parseMoneyInput } from "@/lib/ledger/fields";
import type { DerivedDeal } from "@/lib/ledger/types";
import { fmt } from "@/lib/money";
import Modal from "../Modal";

/** Money in on one deal: every payment with its date, plus a form to record a new one. */
export default function PaymentsModal({ deal, initialSource, onClose, onDeal }: { deal: DerivedDeal; initialSource?: "customer" | "lender"; onClose: () => void; onDeal: (d: DerivedDeal) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [source, setSource] = useState<"customer" | "lender">(initialSource ?? (deal.cashDueCents > 50 || deal.financedPortionCents === 0 ? "customer" : "lender"));
  const suggested = source === "customer" ? Math.max(0, deal.cashDueCents) : Math.max(0, deal.fundingDueCents);

  async function call(url: string, method: string, payload?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: payload ? JSON.stringify(payload) : undefined });
      const b = (await res.json().catch(() => ({}))) as { deal?: DerivedDeal; error?: string };
      if (b.deal) onDeal(b.deal);
      if (!res.ok) setError(b.error ?? "Couldn't save.");
      return res.ok;
    } catch {
      setError("Couldn't reach the server.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const amount = parseMoneyInput(String(f.get("amount") ?? ""));
    const fee = parseMoneyInput(String(f.get("fee") ?? "")) ?? 0;
    if (amount == null || Number.isNaN(amount) || amount === 0) return setError("Enter the amount received.");
    if (Number.isNaN(fee)) return setError("Fee isn't a valid amount.");
    const ok = await call(`/api/deals/${deal.id}/payments`, "POST", {
      source,
      method: source === "lender" ? "lender" : String(f.get("method")),
      amountCents: amount,
      feeCents: fee,
      receivedOn: String(f.get("receivedOn")),
    });
    if (ok) e.currentTarget?.reset?.();
  }

  return (
    <Modal title={`Payments: ${deal.customerName}`} onClose={onClose} width={560}>
      <div className="pay-summary">
        <span>Price <strong>{fmt(deal.priceCents)}</strong></span>
        <span>Collected <strong>{fmt(deal.collectedCents)}</strong></span>
        <span>Customer owes <strong>{fmt(deal.cashDueCents)}</strong></span>
        <span>Lender owes <strong>{fmt(deal.fundingDueCents)}</strong></span>
      </div>

      {deal.payments.length === 0 ? (
        <p className="muted">No money recorded yet.</p>
      ) : (
        <table className="mini">
          <thead>
            <tr><th>Received</th><th>From</th><th>Method</th><th className="num">Amount</th><th className="num">Fee</th><th /></tr>
          </thead>
          <tbody>
            {deal.payments.map((p) => (
              <tr key={p.id}>
                <td>
                  <input
                    type="date"
                    aria-label="Date received"
                    className="date-inline"
                    defaultValue={p.receivedOn ?? ""}
                    disabled={busy}
                    onChange={(e) => e.target.value && p.id && call(`/api/payments/${p.id}`, "PATCH", { receivedOn: e.target.value })}
                  />
                  {!p.receivedOn && <span className="hint">imported, no date</span>}
                </td>
                <td>{p.source === "lender" ? deal.lender ?? "Lender" : "Customer"}</td>
                <td className="muted">{p.method}</td>
                <td className="num">{fmt(p.amountCents, { decimals: 2 })}</td>
                <td className="num">{fmt(p.feeCents, { decimals: 2 })}</td>
                <td>
                  {p.receivedOn && p.id && (
                    <button type="button" className="linkbtn danger" disabled={busy} onClick={() => call(`/api/payments/${p.id}`, "DELETE")}>
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form className="pay-form" onSubmit={add}>
        <h3>Record money received</h3>
        <div className="seg" role="radiogroup" aria-label="From">
          {(["customer", "lender"] as const).map((s) => (
            <button key={s} type="button" role="radio" aria-checked={source === s} className={source === s ? "on" : ""} onClick={() => setSource(s)}>
              {s === "customer" ? "Customer" : deal.lender ?? "Lender"}
            </button>
          ))}
        </div>
        <div className="grid">
          <label>
            Date received
            <input name="receivedOn" type="date" required defaultValue={todayET()} max={todayET()} />
          </label>
          <label>
            Amount
            <input key={`${source}-${suggested}`} name="amount" inputMode="decimal" required defaultValue={suggested ? (suggested / 100).toFixed(2) : ""} />
          </label>
          {source === "customer" && (
            <label>
              Method
              <select name="method" defaultValue="check">
                <option value="check">Check</option>
                <option value="zelle">Zelle</option>
                <option value="card">Card</option>
                <option value="ach">ACH</option>
                <option value="cash">Cash</option>
                <option value="other">Other</option>
              </select>
            </label>
          )}
          {source === "customer" && (
            <label>
              Card fee
              <input name="fee" inputMode="decimal" placeholder="0.00" />
            </label>
          )}
        </div>
        {error && <p className="flash">{error}</p>}
        <div className="products-actions">
          <button type="submit" className="btn-primary" disabled={busy}>Record payment</button>
          <span className="muted">Commissions on this deal become payable in the Friday run after the money is in.</span>
        </div>
      </form>
      {deal.payments.some((p) => !p.receivedOn) && (
        <p className="hint">Payments imported from Mission Control have no date. Set one so they land in the right pay week ({shortDate(todayET())} is today).</p>
      )}
    </Modal>
  );
}
