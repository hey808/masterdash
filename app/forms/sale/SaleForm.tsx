"use client";

import { useMemo, useState } from "react";
import { parseMoneyInput } from "@/lib/ledger/fields";
import type { LedgerOptions } from "@/lib/ledger/options";
import { fmt } from "@/lib/money";

type Method = "check" | "zelle" | "card" | "ach" | "cash" | "other";

export default function SaleForm({ options, stock, today, me }: { options: LedgerOptions; stock: Record<string, Record<string, number>>; today: string; me?: { personId: string; name: string } | null }) {
  const openLocations = options.locations.filter((l) => l.active);
  const closers = options.people.filter((p) => p.roles.includes("closer") || p.roles.includes("manager"));
  const setters = options.people.filter((p) => p.roles.includes("setter"));
  const defaultSetter = setters.find((p) => p.name.toLowerCase() === "adam")?.id ?? "";

  // No default: a wrong location would set aside stock from the wrong warehouse.
  const [location, setLocation] = useState("");
  const [qty, setQty] = useState<Record<string, number>>({});
  const [price, setPrice] = useState("");
  const [financed, setFinanced] = useState("");
  const [card, setCard] = useState("");
  const [lender, setLender] = useState("");
  const [hasDeposit, setHasDeposit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ number: number; customer: string } | null>(null);

  const priceCents = parseMoneyInput(price);
  const financedCents = parseMoneyInput(financed) ?? 0;
  const cardCents = parseMoneyInput(card) ?? 0;
  const cashCents =
    priceCents != null && !Number.isNaN(priceCents) && !Number.isNaN(financedCents) && !Number.isNaN(cardCents) ? priceCents - financedCents - cardCents : null;
  const avail = stock[location] ?? {};
  const short = useMemo(() => (location ? Object.entries(qty).filter(([sku, q]) => q > 0 && q > (avail[sku] ?? 0)) : []), [qty, avail, location]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const f = new FormData(e.currentTarget);
    const products = Object.entries(qty).filter(([, q]) => q > 0).map(([skuCode, q]) => ({ skuCode, qty: q }));
    if (!location) return setError("Pick the location.");
    if (priceCents == null || Number.isNaN(priceCents)) return setError("Enter the price.");
    if (Number.isNaN(financedCents)) return setError("Financed amount isn't a valid number.");
    if (Number.isNaN(cardCents)) return setError("Card amount isn't a valid number.");
    const depositCents = hasDeposit ? parseMoneyInput(String(f.get("depositAmount") ?? "")) : null;
    if (hasDeposit && (depositCents == null || Number.isNaN(depositCents))) return setError("Enter the deposit amount.");
    setBusy(true);
    try {
      const res = await fetch("/api/forms/sale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          closerId: f.get("closerId"),
          setterId: f.get("setterId") || null,
          location,
          customerName: f.get("customerName"),
          customerAddress: f.get("customerAddress"),
          customerPhone: f.get("customerPhone") || undefined,
          customerEmail: f.get("customerEmail") || undefined,
          saleDate: f.get("saleDate"),
          leadSource: f.get("leadSource") || undefined,
          products,
          priceCents,
          financedPortionCents: financedCents,
          cardPortionCents: cardCents,
          lender: financedCents > 0 ? lender || null : null,
          deposit: hasDeposit && depositCents ? { amountCents: depositCents, method: f.get("depositMethod") as Method } : null,
          installScheduledOn: f.get("installScheduledOn") || null,
          note: f.get("note") || undefined,
        }),
      });
      const b = (await res.json().catch(() => ({}))) as { number?: number; error?: string };
      if (!res.ok) return setError(b.error ?? "Couldn't save the sale.");
      setDone({ number: b.number!, customer: String(f.get("customerName")) });
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
        <h2>Deal #{done.number} saved</h2>
        <p>{done.customer} is in the ledger and the products are set aside from {openLocations.find((l) => l.slug === location)?.name} stock.</p>
        <div className="row-actions">
          <a className="btn-primary big" href="/forms/sale">Enter another sale</a>
          {me ? <a className="linkbtn" href="/me">My commissions</a> : <a className="linkbtn" href="/ledger">Open the ledger</a>}
        </div>
      </div>
    );
  }

  return (
    <form className="field-form" onSubmit={submit}>
      <fieldset>
        <legend>The sale</legend>
        <div className="grid">
          {me ? (
            <label>Closer
              <input type="hidden" name="closerId" value={me.personId} />
              <input value={me.name} readOnly aria-readonly="true" className="readonly" />
            </label>
          ) : (
            <label>Closer
              <select name="closerId" required defaultValue="">
                <option value="" disabled>Choose…</option>
                {closers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          )}
          <label>Setter
            <select name="setterId" defaultValue={defaultSetter}>
              <option value="">(none)</option>
              {setters.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label>Location
            <select name="location" value={location} onChange={(e) => setLocation(e.target.value)} required>
              <option value="" disabled>Choose…</option>
              {openLocations.map((l) => <option key={l.slug} value={l.slug}>{l.name}</option>)}
            </select>
          </label>
          <label>Sale date
            <input name="saleDate" type="date" required defaultValue={today} max={today} />
          </label>
          <label className="wide">Lead source
            <input name="leadSource" placeholder="Meta, referral, door knock…" />
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend>Customer</legend>
        <div className="grid">
          <label className="wide">Name<input name="customerName" required autoComplete="off" /></label>
          <label className="wide">Service address<input name="customerAddress" required autoComplete="off" /></label>
          <label>Phone<input name="customerPhone" type="tel" autoComplete="off" /></label>
          <label>Email<input name="customerEmail" type="email" autoComplete="off" /></label>
        </div>
      </fieldset>

      <fieldset>
        <legend>Products</legend>
        <p className="hint-inline">
          {location ? `Set aside from ${openLocations.find((l) => l.slug === location)?.name} stock when you submit.` : "Pick the location above to see what's on the shelf there."}
        </p>
        <div className="sku-grid">
          {options.skus.map((s) => {
            const q = qty[s.code] ?? 0;
            const a = avail[s.code] ?? 0;
            return (
              <div key={s.code} className={`sku ${q > 0 ? "on" : ""} ${location && q > 0 && q > a ? "short" : ""}`}>
                <label>
                  <input type="checkbox" checked={q > 0} onChange={(e) => setQty((m) => ({ ...m, [s.code]: e.target.checked ? Math.max(1, m[s.code] ?? 0) : 0 }))} />
                  <span>
                    <strong>{s.code}</strong>
                    <span className="muted">{s.name}</span>
                  </span>
                </label>
                {location && <span className={`avail ${a <= 0 ? "none" : ""}`}>{a} available</span>}
                {q > 0 && (
                  <input
                    type="number"
                    min={1}
                    max={20}
                    aria-label={`${s.code} quantity`}
                    className="qty"
                    value={q}
                    onChange={(e) => setQty((m) => ({ ...m, [s.code]: Math.max(1, Math.min(20, Number(e.target.value) || 1)) }))}
                  />
                )}
              </div>
            );
          })}
        </div>
        {short.length > 0 && (
          <p className="warn">Not enough on the shelf for {short.map(([sku]) => sku).join(", ")}. You can still submit; it shows as short on the Inventory tab so someone orders it.</p>
        )}
      </fieldset>

      <fieldset>
        <legend>Price and payment</legend>
        <div className="grid">
          <label>Price
            <input inputMode="decimal" required value={price} onChange={(e) => setPrice(e.target.value)} placeholder="$7,495" />
          </label>
          <label>Financed amount
            <input inputMode="decimal" value={financed} onChange={(e) => setFinanced(e.target.value)} placeholder="$0" />
          </label>
          <label>Paid by card
            <input inputMode="decimal" value={card} onChange={(e) => setCard(e.target.value)} placeholder="$0" />
          </label>
          {financedCents > 0 && (
            <label>Lender
              <select value={lender} onChange={(e) => setLender(e.target.value)} required>
                <option value="" disabled>Choose…</option>
                {options.lenders.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </label>
          )}
          <div className="computed">
            <span className="muted">Cash</span>
            <strong>{cashCents == null ? "—" : cashCents < 0 ? <span className="neg">more than the price</span> : fmt(cashCents, { decimals: 2 })}</strong>
          </div>
        </div>
        <label className="check">
          <input type="checkbox" checked={hasDeposit} onChange={(e) => setHasDeposit(e.target.checked)} /> Collected a deposit today
        </label>
        {hasDeposit && (
          <div className="grid">
            <label>Deposit amount<input name="depositAmount" inputMode="decimal" required placeholder="$500" /></label>
            <label>Method
              <select name="depositMethod" defaultValue="check">
                <option value="check">Check</option>
                <option value="zelle">Zelle</option>
                <option value="card">Card</option>
                <option value="ach">ACH</option>
                <option value="cash">Cash</option>
                <option value="other">Other</option>
              </select>
            </label>
          </div>
        )}
      </fieldset>

      <fieldset>
        <legend>Install</legend>
        <div className="grid">
          <label>Install scheduled for<input name="installScheduledOn" type="date" min={today} /></label>
          <label className="wide">Notes<textarea name="note" rows={3} /></label>
        </div>
      </fieldset>

      {error && <p className="flash" role="alert">{error}</p>}
      <div className="row-actions">
        <button type="submit" className="btn-primary big" disabled={busy}>{busy ? "Saving…" : "Submit sale"}</button>
      </div>
    </form>
  );
}
