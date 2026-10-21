"use client";

import { useState } from "react";
import { ACKNOWLEDGEMENT, COMPANY, ESIGN_CONSENT, MAINTENANCE_PLAN, SOAP_PACKAGES, TERMS, type SoapPackage } from "@/lib/agreement-terms";
import SignaturePad from "./SignaturePad";

export interface CustomerView {
  token: string;
  number: string;
  status: "sent" | "signed" | "void";
  createdAt: string;
  repName: string | null;
  repInitials: string | null;
  firstName: string;
  lastName: string;
  address: string | null;
  unit: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  phone2: string | null;
  email: string | null;
  hardness: string | null;
  systems: string[];
  equipment: string[];
  soapPackage: SoapPackage;
  maintenancePlan: boolean;
  priceCents: number;
  financedCents: number;
  lender: string | null;
  depositCents: number;
  depositMethod: string | null;
  installDate: string | null;
  notes: string | null;
  installerNotes: string | null;
  signedAt: string | null;
}

const money = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
const longDate = (d: string) => new Date(d.length === 10 ? `${d}T12:00:00Z` : d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: d.length === 10 ? "UTC" : "America/New_York" });
const METHOD: Record<string, string> = { check: "check", card: "card", cash: "cash", other: "other" };

export default function SignAgreement({ a }: { a: CustomerView }) {
  const [signature, setSignature] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signed, setSigned] = useState(a.status === "signed");
  const pdf = `/c/${a.token}/pdf`;

  if (a.status === "void") {
    return (
      <section className="sign-page sign-done">
        <h1>This agreement was cancelled</h1>
        <p className="muted">Please contact {a.repName ?? "your representative"} at {COMPANY.phone} for an updated agreement.</p>
      </section>
    );
  }
  if (signed) {
    return (
      <section className="sign-page sign-done">
        <div className="sign-check" aria-hidden="true">✓</div>
        <h1>Signed successfully</h1>
        <p className="muted">Thank you{a.firstName ? `, ${a.firstName}` : ""}. Your water treatment specialist will follow up with next steps.</p>
        <a className="btn-primary big" href={pdf} target="_blank" rel="noreferrer">Download your signed agreement (PDF)</a>
        <p className="muted small">Provided by {COMPANY.name} · {COMPANY.phone}</p>
      </section>
    );
  }

  const balance = Math.max(0, a.priceCents - a.financedCents - a.depositCents);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const f = new FormData(e.currentTarget);
    const g = (k: string) => String(f.get(k) ?? "").trim();
    if (!signature) return setError("Draw your signature in the box.");
    if (!consent) return setError("Check the box to agree to sign electronically.");
    setBusy(true);
    try {
      const res = await fetch(`/api/c/${a.token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: g("firstName"), lastName: g("lastName"), address: g("address"), unit: g("unit"), city: g("city"), state: g("state"), zip: g("zip"),
          phone: g("phone"), phone2: g("phone2"), email: g("email"), initials: g("initials"), signature, consent,
        }),
      });
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) return setError(b.error ?? "Couldn't save your signature.");
      setSigned(true);
      window.scrollTo({ top: 0 });
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="sign-page" onSubmit={submit}>
      <header className="sign-head">
        <div>
          <h1>Customer Agreement &amp; Order Form</h1>
          <p className="muted">{COMPANY.name} · Agreement {a.number} · {longDate(a.createdAt)}</p>
        </div>
        <p className="sign-for">Prepared for <strong>{`${a.firstName} ${a.lastName}`.trim()}</strong>{a.repName ? <> by {a.repName}</> : null}</p>
      </header>

      <section className="sign-card">
        <h2>Your details</h2>
        <p className="muted small">Correct anything that&apos;s wrong. The system, price and payment below were set by your representative.</p>
        <div className="grid">
          <label>First name<input name="firstName" required defaultValue={a.firstName} autoComplete="given-name" /></label>
          <label>Last name<input name="lastName" required defaultValue={a.lastName} autoComplete="family-name" /></label>
          <label className="wide">Address<input name="address" defaultValue={a.address ?? ""} autoComplete="address-line1" /></label>
          <label className="wide">Apt / suite / unit<input name="unit" defaultValue={a.unit ?? ""} placeholder="Optional" autoComplete="address-line2" /></label>
          <label>City<input name="city" defaultValue={a.city ?? ""} autoComplete="address-level2" /></label>
          <label>State<input name="state" defaultValue={a.state ?? ""} maxLength={2} autoComplete="address-level1" /></label>
          <label>ZIP<input name="zip" inputMode="numeric" defaultValue={a.zip ?? ""} autoComplete="postal-code" /></label>
          <label>Phone<input name="phone" type="tel" required defaultValue={a.phone ?? ""} autoComplete="tel" /></label>
          <label>Second phone<input name="phone2" type="tel" defaultValue={a.phone2 ?? ""} placeholder="Optional" /></label>
          <label className="wide">Email<input name="email" type="email" defaultValue={a.email ?? ""} autoComplete="email" /></label>
        </div>
      </section>

      <section className="sign-card">
        <h2>Your system</h2>
        <ul className="sign-lines">
          {(a.equipment.length ? a.equipment : a.systems).map((e) => <li key={e}><span>{e}</span><span>Included</span></li>)}
          {a.soapPackage !== "none" && <li><span>Soap package: {SOAP_PACKAGES[a.soapPackage]}</span><span>Included</span></li>}
          {a.maintenancePlan && <li><span>{MAINTENANCE_PLAN.name}<small>{MAINTENANCE_PLAN.detail}</small></span><span>{money(MAINTENANCE_PLAN.priceCents)} / year</span></li>}
        </ul>
        <dl className="sign-totals">
          <div className="total"><dt>Total contract price</dt><dd>{money(a.priceCents)}</dd></div>
          {a.financedCents > 0 && <div><dt>Financed{a.lender ? ` (${a.lender})` : ""}</dt><dd>{money(a.financedCents)}</dd></div>}
          {a.depositCents > 0 && <div><dt>Down payment{a.depositMethod ? ` (${METHOD[a.depositMethod] ?? a.depositMethod})` : ""} · received</dt><dd>{money(a.depositCents)}</dd></div>}
          <div><dt>Balance due at installation</dt><dd>{money(balance)}</dd></div>
        </dl>
        <dl className="sign-details">
          {a.hardness && <div><dt>Hardness test</dt><dd>{a.hardness}</dd></div>}
          {a.systems.length > 0 && <div><dt>System type</dt><dd>{a.systems.join(", ")}</dd></div>}
          <div><dt>Installation</dt><dd>{a.installDate ? longDate(a.installDate) : "To be scheduled"}</dd></div>
          {a.notes && <div><dt>Notes</dt><dd>{a.notes}</dd></div>}
          {a.installerNotes && <div><dt>Installer notes</dt><dd>{a.installerNotes}</dd></div>}
        </dl>
      </section>

      <section className="sign-card">
        <h2>Terms &amp; conditions</h2>
        <div className="sign-terms" tabIndex={0} aria-label="Terms and conditions">
          {TERMS.map((s) => (
            <div key={s.heading}>
              <h3>{s.heading}</h3>
              {s.intro && <p>{s.intro}</p>}
              {s.items.length > 0 && (
                <ol className={s.items.length === 1 ? "single" : ""}>
                  {s.items.map((it, i) => <li key={i}>{it.title && <strong>{it.title}. </strong>}{it.text}</li>)}
                </ol>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="sign-card">
        <h2>Sign</h2>
        <p>{ACKNOWLEDGEMENT}</p>
        <div className="grid">
          <label>Your initials<input name="initials" required maxLength={6} autoComplete="off" className="sign-initials" placeholder="JD" /></label>
          <label>Representative initials<input value={a.repInitials ?? ""} readOnly className="readonly sign-initials" /></label>
        </div>
        <span className="agr-label">Your signature</span>
        <SignaturePad onChange={setSignature} />
        <label className="sign-consent">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>{ESIGN_CONSENT}</span>
        </label>
        {error && <p className="flash" role="alert">{error}</p>}
        <button type="submit" className="btn-primary big sign-submit" disabled={busy}>{busy ? "Signing…" : "Sign agreement"}</button>
        <p className="muted small">You&apos;ll get a PDF copy as soon as you sign. Questions? Call {COMPANY.phone}.</p>
      </section>
    </form>
  );
}
