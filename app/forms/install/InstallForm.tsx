"use client";

import { useMemo, useState } from "react";
import { shortDate } from "@/lib/dates";
import { parseMoneyInput } from "@/lib/ledger/fields";

export interface OpenJob {
  id: string;
  number: number;
  customer: string;
  address: string | null;
  scheduled: string | null;
  location: string;
  products: string;
}

export default function InstallForm({ jobs, people, today }: { jobs: OpenJob[]; people: Array<{ id: string; name: string; roles: string[] }>; today: string }) {
  const installers = [...people].sort((a, b) => Number(b.roles.includes("installer")) - Number(a.roles.includes("installer")) || a.name.localeCompare(b.name));
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<OpenJob | null>(null);
  const [collected, setCollected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<OpenJob | null>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? jobs.filter((j) => `${j.number} ${j.customer} ${j.address ?? ""}`.toLowerCase().includes(q)) : jobs;
    return list.slice(0, 40);
  }, [jobs, query]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!picked) return setError("Pick the customer from the list.");
    const f = new FormData(e.currentTarget);
    const amount = collected ? parseMoneyInput(String(f.get("amount") ?? "")) : null;
    if (collected && (amount == null || Number.isNaN(amount) || amount <= 0)) return setError("Enter the amount collected.");
    setBusy(true);
    try {
      const res = await fetch("/api/forms/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealId: picked.id,
          installerId: f.get("installerId"),
          installedOn: f.get("installedOn"),
          collected: collected ? { amountCents: amount, method: f.get("method") } : null,
          note: f.get("note") || undefined,
        }),
      });
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) return setError(b.error ?? "Couldn't save the install.");
      setDone(picked);
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
        <h2>#{done.number} {done.customer} marked installed</h2>
        <p>{done.products ? `${done.products} came out of the ${done.location} warehouse count.` : "No products were on this deal."}</p>
        <div className="row-actions">
          <a className="btn-primary big" href="/forms/install">Log another install</a>
          <a className="linkbtn" href="/ledger">Open the ledger</a>
        </div>
      </div>
    );
  }

  return (
    <form className="field-form" onSubmit={submit}>
      <fieldset>
        <legend>Customer</legend>
        {picked ? (
          <div className="picked">
            <div>
              <strong>#{picked.number} {picked.customer}</strong>
              <div className="muted">{picked.address ?? "No address"} · {picked.location}{picked.scheduled ? ` · scheduled ${shortDate(picked.scheduled)}` : ""}</div>
            </div>
            <button type="button" className="linkbtn" onClick={() => setPicked(null)}>Change</button>
          </div>
        ) : (
          <>
            <label className="wide">Find the customer
              <input type="search" placeholder="Name, address or deal #" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
            </label>
            <ul className="job-list" role="listbox" aria-label="Jobs waiting for install">
              {matches.map((j) => (
                <li key={j.id}>
                  <button type="button" role="option" aria-selected={false} onClick={() => setPicked(j)}>
                    <span><strong>#{j.number} {j.customer}</strong> <span className="muted">· {j.location}</span></span>
                    <span className="muted">{j.address ?? "No address"}{j.scheduled ? ` · scheduled ${shortDate(j.scheduled)}` : ""}</span>
                  </button>
                </li>
              ))}
              {matches.length === 0 && <li className="muted pad">No open job matches. Only sold jobs that aren't installed yet are listed.</li>}
            </ul>
          </>
        )}
      </fieldset>

      {picked && (
        <>
          <fieldset>
            <legend>Equipment leaving the warehouse</legend>
            {picked.products ? (
              <p className="pull">{picked.products} <span className="muted">from {picked.location}</span></p>
            ) : (
              <p className="warn">No products are on this deal. Add them in the ledger so the warehouse count stays right.</p>
            )}
          </fieldset>

          <fieldset>
            <legend>Install</legend>
            <div className="grid">
              <label>Installer
                <select name="installerId" required defaultValue="">
                  <option value="" disabled>Choose…</option>
                  {installers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              <label>Install date<input name="installedOn" type="date" required defaultValue={today} max={today} /></label>
            </div>
            <label className="check">
              <input type="checkbox" checked={collected} onChange={(e) => setCollected(e.target.checked)} /> Collected money from the customer at the install
            </label>
            {collected && (
              <div className="grid">
                <label>Amount<input name="amount" inputMode="decimal" required placeholder="$0.00" /></label>
                <label>Method
                  <select name="method" defaultValue="check">
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
            <label className="wide">Notes<textarea name="note" rows={3} placeholder="Anything the office should know" /></label>
          </fieldset>

          {error && <p className="flash" role="alert">{error}</p>}
          <div className="row-actions">
            <button type="submit" className="btn-primary big" disabled={busy}>{busy ? "Saving…" : "Mark installed"}</button>
          </div>
        </>
      )}
      {!picked && error && <p className="flash" role="alert">{error}</p>}
    </form>
  );
}
