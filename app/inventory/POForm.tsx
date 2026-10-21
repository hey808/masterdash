"use client";

import { useState } from "react";
import { parseMoneyInput } from "@/lib/ledger/fields";
import { fmt } from "@/lib/money";

async function post(url: string, payload: unknown): Promise<{ ok: boolean; error?: string; data?: Record<string, unknown> }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const b = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, error: res.ok ? undefined : String(b.error ?? "Couldn't save."), data: b };
  } catch {
    return { ok: false, error: "Couldn't reach the server." };
  }
}

/** The purchase order form: in the Inventory modal and on its own page under Forms. */
export default function POForm({ location: fixedLocation, locations, skus, today, onDone }: {
  location: string | null; locations: Array<{ slug: string; name: string }>; skus: Array<{ code: string; name: string; costCents?: number }>; today: string; onDone: (po: { id: string; number: number }) => void;
}) {
  const [lines, setLines] = useState<Array<{ skuCode: string; qty: string; cost: string }>>([{ skuCode: skus[0]?.code ?? "", qty: "1", cost: ((skus[0]?.costCents ?? 0) / 100).toFixed(2) }]);
  const [location, setLocation] = useState(fixedLocation ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const costOf = (code: string) => ((skus.find((s) => s.code === code)?.costCents ?? 0) / 100).toFixed(2);
  const totalCents = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (parseMoneyInput(l.cost) || 0), 0);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const f = new FormData(e.currentTarget);
    const parsed = lines.map((l) => ({ skuCode: l.skuCode, qty: Number(l.qty), unitCostCents: parseMoneyInput(l.cost) }));
    if (!location) return setError("Pick which warehouse it's going to.");
    if (parsed.some((l) => !l.qty || l.qty < 1 || l.unitCostCents == null || Number.isNaN(l.unitCostCents))) return setError("Every line needs a quantity and a unit cost.");
    setBusy(true);
    const r = await post("/api/purchase-orders", {
      location, vendor: f.get("vendor"), orderedOn: f.get("orderedOn"), expectedOn: f.get("expectedOn") || null, note: f.get("note") || null, lines: parsed,
    });
    setBusy(false);
    if (!r.ok) return setError(r.error ?? "Couldn't save the order.");
    onDone({ id: String(r.data?.id ?? ""), number: Number(r.data?.number ?? 0) });
  }

  return (
  <form className="pay-form" onSubmit={submit}>
      <div className="grid">
        {!fixedLocation && (
          <label>Warehouse
            <select value={location} onChange={(e) => setLocation(e.target.value)} required>
              <option value="" disabled>Choose…</option>
              {locations.map((l) => <option key={l.slug} value={l.slug}>{l.name}</option>)}
            </select>
          </label>
        )}
        <label>Vendor<input name="vendor" required placeholder="Aquonyx" /></label>
        <label>Ordered on<input name="orderedOn" type="date" required defaultValue={today} /></label>
        <label>Expected<input name="expectedOn" type="date" min={today} /></label>
      </div>
      <table className="mini po-lines">
        <thead><tr><th>Product</th><th className="num">Qty</th><th className="num">Unit cost</th><th className="num">Line</th><th /></tr></thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td>
                <select aria-label="Product" value={l.skuCode} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, skuCode: e.target.value, cost: costOf(e.target.value) } : x)))}>
                  {skus.map((s) => <option key={s.code} value={s.code}>{s.code}: {s.name}</option>)}
                </select>
              </td>
              <td className="num"><input aria-label="Quantity" type="number" min={1} value={l.qty} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} /></td>
              <td className="num"><input aria-label="Unit cost" inputMode="decimal" value={l.cost} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, cost: e.target.value } : x)))} /></td>
              <td className="num">{fmt((Number(l.qty) || 0) * (parseMoneyInput(l.cost) || 0), { decimals: 2 })}</td>
              <td>{lines.length > 1 && <button type="button" className="linkbtn danger" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>Remove</button>}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3}>
              <button type="button" className="linkbtn" onClick={() => setLines((ls) => [...ls, { skuCode: skus[0]?.code ?? "", qty: "1", cost: costOf(skus[0]?.code ?? "") }])}>+ Add product</button>
            </td>
            <td className="num">{fmt(totalCents, { decimals: 2 })}</td>
            <td />
          </tr>
        </tfoot>
      </table>
      <label>Note<input name="note" placeholder="Optional" /></label>
      {error && <p className="flash">{error}</p>}
      <div className="products-actions">
        <button type="submit" className="btn-primary" disabled={busy}>Save purchase order</button>
        <span className="muted">Stock counts it as on order until you mark it received.</span>
      </div>
    </form>
);
}
