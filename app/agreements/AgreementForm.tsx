"use client";

import { useState } from "react";
import { MAINTENANCE_PLAN, SOAP_PACKAGES, SYSTEMS, type SoapPackage } from "@/lib/agreement-terms";
import type { AgreementDraft } from "@/lib/agreement-prefill";
import { parseMoneyInput } from "@/lib/ledger/fields";
import ShareAgreement from "./ShareAgreement";

const dollars = (c: number | null) => (c == null ? "" : (c / 100).toFixed(2).replace(/\.00$/, ""));

export default function AgreementForm({ draft, reps, me, lenders, today }: {
  draft: AgreementDraft;
  reps: Array<{ id: string; name: string }>;
  me: { personId: string; name: string } | null;
  lenders: string[];
  today: string;
}) {
  const [systems, setSystems] = useState<string[]>(draft.systems);
  const [equipment, setEquipment] = useState<string[]>(draft.equipment);
  const [newItem, setNewItem] = useState("");
  const [soap, setSoap] = useState<SoapPackage>(draft.soapPackage);
  const [plan, setPlan] = useState(draft.maintenancePlan);
  const [financed, setFinanced] = useState(dollars(draft.financedCents || null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; token: string; number: string; name: string; phone: string; email: string } | null>(null);

  if (created) return <ShareAgreement {...created} fresh />;

  const financedCents = parseMoneyInput(financed) ?? 0;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const f = new FormData(e.currentTarget);
    const g = (k: string) => String(f.get(k) ?? "").trim();
    const price = parseMoneyInput(g("price"));
    const deposit = parseMoneyInput(g("deposit")) ?? 0;
    if (price == null || Number.isNaN(price) || price <= 0) return setError("Enter the total price.");
    if (Number.isNaN(financedCents) || Number.isNaN(deposit)) return setError("Check the financed and deposit amounts.");
    if (systems.length === 0 && equipment.length === 0) return setError("Pick at least one system.");
    setBusy(true);
    try {
      const res = await fetch("/api/agreements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId: draft.dealId,
          appointmentId: draft.appointmentId,
          location: draft.location,
          repId: me?.personId ?? g("repId"),
          firstName: g("firstName"),
          lastName: g("lastName"),
          address: g("address"),
          unit: g("unit"),
          city: g("city"),
          state: g("state"),
          zip: g("zip"),
          phone: g("phone"),
          phone2: g("phone2"),
          email: g("email"),
          hardness: g("hardness"),
          systems,
          equipment,
          soapPackage: soap,
          maintenancePlan: plan,
          priceCents: price,
          financedCents,
          lender: financedCents > 0 ? g("lender") || null : null,
          depositCents: deposit,
          depositMethod: deposit > 0 ? g("depositMethod") : null,
          installDate: g("installDate") || null,
          notes: g("notes"),
          installerNotes: g("installerNotes"),
        }),
      });
      const b = (await res.json().catch(() => ({}))) as { id?: string; token?: string; number?: string; error?: string };
      if (!res.ok || !b.token) return setError(b.error ?? "Couldn't create the agreement.");
      setCreated({ id: b.id!, token: b.token, number: b.number!, name: `${g("firstName")} ${g("lastName")}`.trim(), phone: g("phone"), email: g("email") });
      window.scrollTo({ top: 0 });
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="field-form agr-form" onSubmit={submit}>
      <fieldset>
        <legend>Customer</legend>
        <div className="grid">
          <label>First name<input name="firstName" required defaultValue={draft.firstName} autoComplete="off" /></label>
          <label>Last name<input name="lastName" required defaultValue={draft.lastName} autoComplete="off" /></label>
          <label className="wide">Address<input name="address" defaultValue={draft.address} autoComplete="off" /></label>
          <label className="wide">Apt / suite / unit<input name="unit" defaultValue={draft.unit} placeholder="Optional" autoComplete="off" /></label>
          <label>City<input name="city" defaultValue={draft.city} autoComplete="off" /></label>
          <label>State<input name="state" defaultValue={draft.state || "SC"} maxLength={2} autoComplete="off" /></label>
          <label>ZIP<input name="zip" inputMode="numeric" defaultValue={draft.zip} autoComplete="off" /></label>
          <label>Phone<input name="phone" type="tel" required defaultValue={draft.phone} autoComplete="off" /></label>
          <label>Second phone<input name="phone2" type="tel" placeholder="Optional" autoComplete="off" /></label>
          <label className="wide">Email<input name="email" type="email" defaultValue={draft.email} autoComplete="off" /></label>
        </div>
      </fieldset>

      <fieldset>
        <legend>Water test &amp; system</legend>
        <label>Hardness test result<input name="hardness" placeholder="e.g. 250 ppm / 14.6 gpg" /></label>
        <span className="agr-label">System type</span>
        <div className="dispo-reasons">
          {SYSTEMS.map((s) => (
            <button key={s} type="button" className={`chip-btn ${systems.includes(s) ? "on" : ""}`} aria-pressed={systems.includes(s)} onClick={() => setSystems((xs) => (xs.includes(s) ? xs.filter((x) => x !== s) : [...xs, s]))}>{s}</button>
          ))}
        </div>
        <span className="agr-label">Equipment on the agreement</span>
        <ul className="agr-items">
          {equipment.map((it, i) => (
            <li key={`${it}-${i}`}>
              <span>{it}</span>
              <button type="button" className="linkbtn danger" onClick={() => setEquipment((xs) => xs.filter((_, j) => j !== i))}>Remove</button>
            </li>
          ))}
          {equipment.length === 0 && <li className="muted">None listed: the systems above are used.</li>}
        </ul>
        <div className="agr-add">
          <input value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="Add equipment, e.g. Aquonyx Diamond Whole-Home System" />
          <button type="button" className="btn-outline" disabled={!newItem.trim()} onClick={() => { setEquipment((xs) => [...xs, newItem.trim()]); setNewItem(""); }}>Add</button>
        </div>
      </fieldset>

      <fieldset>
        <legend>Pricing &amp; payment</legend>
        <span className="agr-label">Soap package</span>
        <div className="segmented agr-seg" role="group" aria-label="Soap package">
          {(Object.keys(SOAP_PACKAGES) as SoapPackage[]).map((k) => (
            <button key={k} type="button" className={soap === k ? "on" : ""} aria-pressed={soap === k} onClick={() => setSoap(k)}>{SOAP_PACKAGES[k]}</button>
          ))}
        </div>
        <div className="grid">
          <label>Total price<input name="price" inputMode="decimal" required defaultValue={dollars(draft.priceCents)} placeholder="$7,495" /></label>
          <label>Financed<input inputMode="decimal" value={financed} onChange={(e) => setFinanced(e.target.value)} placeholder="$0" /></label>
          {financedCents > 0 && (
            <label>Lender
              <select name="lender" defaultValue={draft.lender ?? ""} required>
                <option value="" disabled>Choose…</option>
                {lenders.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </label>
          )}
          <label>Down payment<input name="deposit" inputMode="decimal" defaultValue={dollars(draft.depositCents || null)} placeholder="$0" /></label>
          <label>Paid by
            <select name="depositMethod" defaultValue={draft.depositMethod ?? "check"}>
              <option value="check">Check</option>
              <option value="card">Card</option>
              <option value="cash">Cash</option>
              <option value="other">Other</option>
            </select>
          </label>
        </div>
        <label className="agr-toggle">
          <input type="checkbox" checked={plan} onChange={(e) => setPlan(e.target.checked)} />
          <span><strong>Yearly inspection add-on</strong><span className="muted"> {MAINTENANCE_PLAN.name}: one service visit and salt delivery, {(MAINTENANCE_PLAN.priceCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}/year</span></span>
        </label>
      </fieldset>

      <fieldset>
        <legend>Install &amp; notes</legend>
        <div className="grid">
          <label>Installation date<input name="installDate" type="date" defaultValue={draft.installDate ?? ""} min={today} /></label>
          {me ? (
            <label>Representative<input value={me.name} readOnly className="readonly" /></label>
          ) : (
            <label>Representative
              <select name="repId" required defaultValue={draft.repId ?? ""}>
                <option value="" disabled>Choose…</option>
                {reps.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          )}
        </div>
        <label>Notes (on the agreement)<textarea name="notes" rows={2} defaultValue={draft.notes} placeholder="e.g. 6 bags of salt, chrome RO faucet" /></label>
        <label>Installer notes (on the agreement)<textarea name="installerNotes" rows={2} placeholder="Where things go, access, anything the installer needs" /></label>
      </fieldset>

      <p className="muted small">Saving locks the system, price and payment. The customer can only correct their contact details, then initial and sign.</p>
      {error && <p className="flash" role="alert">{error}</p>}
      <div className="row-actions">
        <button type="submit" className="btn-primary big" disabled={busy}>{busy ? "Saving…" : "Save & lock for signature"}</button>
      </div>
    </form>
  );
}
