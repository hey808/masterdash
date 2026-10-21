"use client";

import { useMemo, useState } from "react";
import { parseMoneyInput } from "@/lib/ledger/fields";
import type { SaleAppointment } from "@/lib/appointments";
import type { LedgerOptions } from "@/lib/ledger/options";

type Method = "check" | "card" | "cash" | "other";

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });

export default function SaleForm({ options, stock, today, me, appointments = [], apptNote, initialAppt }: {
  options: LedgerOptions;
  stock: Record<string, Record<string, number>>;
  today: string;
  me?: { personId: string; name: string } | null;
  /** Today's sales appointments (the rep's own, or everyone's for the office). */
  appointments?: SaleAppointment[];
  apptNote?: string | null;
  /** Opened from "Closed" on the appointments page: start with this one picked. */
  initialAppt?: string;
}) {
  const openLocations = options.locations.filter((l) => l.active);
  const closers = options.people.filter((p) => p.roles.includes("closer") || p.roles.includes("manager"));
  const setters = options.people.filter((p) => p.roles.includes("setter"));
  const defaultSetter = setters.find((p) => p.name.toLowerCase() === "adam")?.id ?? "";

  // No default: a wrong location would set aside stock from the wrong warehouse.
  const first = appointments.find((a) => a.id === initialAppt && a.soldDealNumber == null) ?? null;
  const [location, setLocation] = useState(first?.location ?? "");
  // Step one: which of today's appointments is this sale from? (Or none: typed by hand.)
  const [appt, setAppt] = useState<SaleAppointment | null>(first);
  const [manual, setManual] = useState(appointments.length === 0);
  // The sale happened on the appointment's day (Eastern), never later than today.
  const apptDay = appt ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(appt.start)) : today;
  const saleDay = apptDay < today ? apptDay : today;
  const pick = (a: SaleAppointment) => {
    setAppt(a);
    setLocation(a.location);
    window.scrollTo({ top: 0 });
  };
  const [qty, setQty] = useState<Record<string, number>>({});
  const [price, setPrice] = useState("");
  const [financed, setFinanced] = useState("");
  const [lender, setLender] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; number: number; customer: string } | null>(null);

  const priceCents = parseMoneyInput(price);
  const financedCents = parseMoneyInput(financed) ?? 0;
  // No card split here: final payment is taken at install. The deposit's method can be card.
  const cashCents = priceCents != null && !Number.isNaN(priceCents) && !Number.isNaN(financedCents) ? priceCents - financedCents : null;
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
    // Deposit is optional: blank or $0 means none was collected.
    const depositCents = parseMoneyInput(String(f.get("depositAmount") ?? ""));
    if (depositCents != null && Number.isNaN(depositCents)) return setError("Deposit amount isn't a valid number.");
    if (cashCents != null && depositCents != null && depositCents > cashCents) return setError("The deposit is more than the price minus what's financed.");
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
          appointmentId: appt?.id ?? null,
          soap: f.get("soap") === "on",
          maintenancePlan: f.get("maintenancePlan") === "on",
          financedPortionCents: financedCents,
          lender: financedCents > 0 ? lender || null : null,
          deposit: depositCents ? { amountCents: depositCents, method: f.get("depositMethod") as Method } : null,
          installScheduledOn: f.get("installScheduledOn") || null,
          note: f.get("note") || undefined,
        }),
      });
      const b = (await res.json().catch(() => ({}))) as { id?: string; number?: number; error?: string };
      if (!res.ok) return setError(b.error ?? "Couldn't save the sale.");
      setDone({ id: b.id!, number: b.number!, customer: String(f.get("customerName")) });
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
        <p><strong>Next: the customer agreement.</strong> It fills in from this sale; you add the water test and options, then they sign.</p>
        <div className="row-actions">
          <a className="btn-primary big" href={`/agreements/new?deal=${done.id}`}>Create customer agreement</a>
          {me ? <a className="linkbtn" href="/appointments">Back to my appointments</a> : <a className="linkbtn" href="/forms/sale">Enter another sale</a>}
        </div>
      </div>
    );
  }

  if (!appt && !manual) {
    return (
      <section className="appt-pick">
        <h2>Which appointment are you at?</h2>
        <p className="muted">{me ? "Your" : "Today's"} sales appointments for today. Pick one and the customer&apos;s details fill in.</p>
        <div className="appt-list">
          {appointments.map((a) => (
            <button key={a.id} type="button" className="appt-card" disabled={a.soldDealNumber != null} onClick={() => pick(a)}>
              <span className="appt-time">{timeOf(a.start)}</span>
              <span className="appt-name">{a.customerName}</span>
              {a.address && <span className="appt-addr">{a.address}</span>}
              <span className="appt-meta">
                {a.locationName}
                {!me && a.repName ? ` · ${a.repName}` : ""}
                {a.soldDealNumber != null ? <b className="appt-sold"> · Sold, deal #{a.soldDealNumber}</b> : null}
              </span>
            </button>
          ))}
        </div>
        <button type="button" className="linkbtn" onClick={() => setManual(true)}>Not on the calendar? Enter the customer by hand</button>
      </section>
    );
  }

  return (
    <form className="field-form" onSubmit={submit} key={appt?.id ?? "manual"}>
      {apptNote && !appt && <p className="hint block">{apptNote}</p>}
      {appt && (
        <div className="appt-chosen">
          <span>
            From the <strong>{timeOf(appt.start)}</strong> appointment with <strong>{appt.customerName}</strong>
            {appt.contactUrl && <> · <a href={appt.contactUrl} target="_blank" rel="noreferrer">GoHighLevel contact</a></>}
          </span>
          <button type="button" className="linkbtn" onClick={() => { setAppt(null); setManual(false); }}>Change</button>
        </div>
      )}
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
              <select name="closerId" required defaultValue={appt?.repPersonId && closers.some((c) => c.id === appt.repPersonId) ? appt.repPersonId : ""}>
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
            <input name="saleDate" type="date" required defaultValue={saleDay} max={today} />
          </label>
          <label className="wide">Lead source
            <input name="leadSource" placeholder="Meta, referral, door knock…" defaultValue={appt?.leadSource ?? ""} />
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend>Customer</legend>
        <div className="grid">
          <label className="wide">Name<input name="customerName" required autoComplete="off" defaultValue={appt?.customerName ?? ""} /></label>
          <label className="wide">Service address<input name="customerAddress" required autoComplete="off" defaultValue={appt?.address ?? ""} /></label>
          <label>Phone<input name="customerPhone" type="tel" autoComplete="off" defaultValue={appt?.phone ?? ""} /></label>
          <label>Email<input name="customerEmail" type="email" autoComplete="off" defaultValue={appt?.email ?? ""} /></label>
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
          {financedCents > 0 && (
            <label>Lender
              <select value={lender} onChange={(e) => setLender(e.target.value)} required>
                <option value="" disabled>Choose…</option>
                {options.lenders.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </label>
          )}
          <label>Deposit amount
            <input name="depositAmount" inputMode="decimal" placeholder="$0" />
          </label>
          <label>Deposit method
            <select name="depositMethod" defaultValue="check">
              <option value="check">Check</option>
              <option value="card">Card</option>
              <option value="cash">Cash</option>
              <option value="other">Other</option>
            </select>
          </label>
          {cashCents != null && cashCents < 0 && <p className="flash wide">Financed is more than the price.</p>}
        </div>
        <label className="agr-toggle"><input type="checkbox" name="soap" /><span><strong>Soap package</strong><span className="muted"> The tier goes on the agreement.</span></span></label>
        <label className="agr-toggle"><input type="checkbox" name="maintenancePlan" /><span><strong>Annual maintenance plan</strong><span className="muted"> $300/year: one service visit and salt delivery.</span></span></label>
      </fieldset>

      <fieldset>
        <legend>Install</legend>
        <div className="grid">
          <label>Install scheduled for<input name="installScheduledOn" type="date" required min={today} /></label>
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
