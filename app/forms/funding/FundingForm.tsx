"use client";

import { useMemo, useState } from "react";
import { shortDate } from "@/lib/dates";
import { parseMoneyInput } from "@/lib/ledger/fields";
import { fmt } from "@/lib/money";

export interface Awaiting {
  id: string;
  number: number;
  customer: string;
  lender: string | null;
  location: string;
  installedOn: string | null;
  financedCents: number;
  fundedCents: number;
  feeCents: number;
  /** Financed − (funded + fees) so far. */
  leftCents: number;
}

const money2 = (c: number) => fmt(c, { decimals: 2 });

export default function FundingForm({ awaiting, today, initialDeal }: { awaiting: Awaiting[]; today: string; initialDeal: string }) {
  const [dealId, setDealId] = useState(awaiting.some((a) => a.id === initialDeal) ? initialDeal : "");
  const [amount, setAmount] = useState("");
  const [fee, setFee] = useState("");
  const [feeTouched, setFeeTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ number: number; customer: string; amount: number; fee: number } | null>(null);
  const deal = useMemo(() => awaiting.find((a) => a.id === dealId) ?? null, [awaiting, dealId]);

  const amountCents = parseMoneyInput(amount);
  // Until the fee is typed, it's whatever the lender didn't send: what's left on the loan − this funding.
  const autoFee = deal && amountCents != null && !Number.isNaN(amountCents) ? Math.max(0, deal.leftCents - amountCents) : null;
  const feeCents = feeTouched ? parseMoneyInput(fee) : autoFee;
  const over = deal && amountCents != null && feeCents != null && !Number.isNaN(feeCents) && amountCents + feeCents > deal.leftCents + 50;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const f = new FormData(e.currentTarget);
    if (!deal) return setError("Pick the deal that was funded.");
    if (amountCents == null || Number.isNaN(amountCents) || amountCents <= 0) return setError("Enter what the lender sent.");
    if (feeCents == null || Number.isNaN(feeCents)) return setError("Enter the lender fee (0 if none).");
    setBusy(true);
    try {
      const res = await fetch("/api/forms/funding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealId: deal.id, fundedOn: f.get("fundedOn"), amountCents, lenderFeeCents: feeCents, reference: f.get("reference") || undefined, note: f.get("note") || undefined }),
      });
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) return setError(b.error ?? "Couldn't record the funding.");
      setDone({ number: deal.number, customer: deal.customer, amount: amountCents, fee: feeCents });
      setDealId("");
      setAmount("");
      setFee("");
      setFeeTouched(false);
      window.scrollTo({ top: 0 });
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="form-panel">
      {done && (
        <p className="saved-note" role="status">
          Recorded {money2(done.amount)} funded on #{done.number} {done.customer}, lender fee {money2(done.fee)}. It&apos;s on the <a href="/ledger">ledger</a> now.
        </p>
      )}
      {awaiting.length === 0 ? (
        <p className="empty">No financed deals are waiting on funding.</p>
      ) : (
        <form className="field-form" onSubmit={submit}>
          <label>Deal
            <select value={dealId} onChange={(e) => { setDealId(e.target.value); setFeeTouched(false); setFee(""); }} required>
              <option value="" disabled>Choose the deal that was funded…</option>
              {awaiting.map((a) => (
                <option key={a.id} value={a.id}>
                  #{a.number} {a.customer} · {a.lender ?? "no lender"} · {money2(a.leftCents)} left{a.installedOn ? ` · installed ${shortDate(a.installedOn)}` : " · not installed"}
                </option>
              ))}
            </select>
          </label>
          {deal && (
            <div className="funding-facts">
              <span>Financed <b>{money2(deal.financedCents)}</b></span>
              {deal.fundedCents > 0 && <span>Already funded <b>{money2(deal.fundedCents)}</b></span>}
              {deal.feeCents > 0 && <span>Fees so far <b>{money2(deal.feeCents)}</b></span>}
              <span>Left on the loan <b>{money2(deal.leftCents)}</b></span>
            </div>
          )}
          <div className="grid">
            <label>Funded on
              <input name="fundedOn" type="date" required defaultValue={today} max={today} />
            </label>
            <label>Amount the lender sent
              <input inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="$0.00" />
            </label>
            <label>Lender fee (what they kept)
              <input
                inputMode="decimal"
                value={feeTouched ? fee : autoFee != null ? (autoFee / 100).toFixed(2) : ""}
                onChange={(e) => { setFeeTouched(true); setFee(e.target.value); }}
                placeholder="$0.00"
              />
            </label>
            <label>Reference
              <input name="reference" placeholder="Optional: deposit or funding #" />
            </label>
          </div>
          {!feeTouched && autoFee != null && autoFee > 0 && (
            <p className="muted small">Fee filled in as what&apos;s left on the loan minus this funding. Change it if part of the loan is still coming.</p>
          )}
          {over && <p className="flash">Funding plus fee is more than what&apos;s left on the loan ({money2(deal!.leftCents)}).</p>}
          <label>Note
            <input name="note" placeholder="Optional" />
          </label>
          {error && <p className="flash" role="alert">{error}</p>}
          <div className="products-actions">
            <button type="submit" className="btn-primary" disabled={busy || !!over}>Record funding</button>
          </div>
        </form>
      )}
    </section>
  );
}
