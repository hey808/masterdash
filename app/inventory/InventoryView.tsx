"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { shortDate } from "@/lib/dates";
import type { PurchaseOrderView, StockRow } from "@/lib/inventory";
import { parseMoneyInput } from "@/lib/ledger/fields";
import { fmt, sumCents } from "@/lib/money";
import Modal from "../Modal";

const STATUS_LABEL: Record<StockRow["status"], string> = { short: "Short", order: "Order", ok: "OK", idle: "No stock" };

async function post(url: string, payload: unknown): Promise<{ ok: boolean; error?: string; data?: Record<string, unknown> }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const b = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, error: res.ok ? undefined : String(b.error ?? "Couldn't save."), data: b };
  } catch {
    return { ok: false, error: "Couldn't reach the server." };
  }
}

export default function InventoryView(props: {
  location: string;
  locationName: string;
  stock: StockRow[];
  pos: PurchaseOrderView[];
  skus: Array<{ code: string; name: string; costCents?: number }>;
  today: string;
}) {
  const { location, locationName, stock, pos, today } = props;
  const router = useRouter();
  const [counting, setCounting] = useState<StockRow | null>(null);
  const [newPO, setNewPO] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const closeCount = useCallback(() => setCounting(null), []);
  const closePO = useCallback(() => setNewPO(false), []);

  const needsCount = stock.some((r) => r.received === 0 && r.adjusted === 0 && r.installed > 0);
  const toOrder = stock.filter((r) => r.status === "short" || r.status === "order");

  async function poAction(po: PurchaseOrderView, action: "receive" | "cancel") {
    setBusy(po.id);
    setError(null);
    const r = await post(`/api/purchase-orders/${po.id}`, { action, receivedOn: today });
    setBusy(null);
    if (!r.ok) setError(r.error ?? "Couldn't update the order.");
    router.refresh();
  }

  return (
    <>
      <div className="run-totals">
        <Stat label="On the shelf" value={String(stock.reduce((s, r) => s + Math.max(0, r.onHand), 0))} note={`units at ${locationName}`} />
        <Stat label="Set aside for sold jobs" value={String(stock.reduce((s, r) => s + r.committed, 0))} note="leave when installed" />
        <Stat label="On order" value={String(stock.reduce((s, r) => s + r.onOrder, 0))} note={`${pos.filter((p) => p.status === "ordered").length} open purchase orders`} />
        <Stat label="Shelf value" value={fmt(sumCents(stock.map((r) => r.valueCents)))} note="at current cost" />
        <Stat label="Need ordering" value={String(toOrder.length)} note={toOrder.map((r) => r.skuCode).join(", ") || "nothing"} tone={toOrder.length ? "due" : "paid"} />
      </div>

      {needsCount && (
        <p className="hint block">
          No starting count or purchase orders yet for some products, so their shelf number is negative (installs have been subtracting from zero). Click <strong>Count</strong> on each row and enter what's on the shelf today.
        </p>
      )}
      {error && <p className="flash" role="alert">{error}</p>}

      <div className="section-head">
        <h2 className="section">Stock at {locationName}</h2>
      </div>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th className="num">On shelf</th>
              <th className="num">Set aside</th>
              <th className="num">Available</th>
              <th className="num">On order</th>
              <th className="num">Installed last 4 wks</th>
              <th className="num">Weeks of cover</th>
              <th>Status</th>
              <th className="num">Value</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {stock.map((r) => (
              <tr key={r.skuCode}>
                <td><strong>{r.skuCode}</strong> <span className="muted">{r.name}</span></td>
                <td className={`num ${r.onHand < 0 ? "neg" : ""}`}>{r.onHand}</td>
                <td className="num">{r.committed || "—"}</td>
                <td className={`num strong ${r.available < 0 ? "neg" : ""}`}>{r.available}</td>
                <td className="num">{r.onOrder || "—"}</td>
                <td className="num">{r.usedLast28 || "—"}</td>
                <td className="num">{r.weeksOfCover == null ? "—" : r.weeksOfCover.toFixed(1)}</td>
                <td><span className={`inv-status ${r.status}`}>{STATUS_LABEL[r.status]}</span></td>
                <td className="num">{fmt(r.valueCents)}</td>
                <td><button type="button" className="btn-outline" onClick={() => setCounting(r)}>Count</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">On shelf = received on purchase orders + counts − installed jobs. Set aside = products on sold jobs not installed yet. Order when available + on order covers less than 3 weeks of installs.</p>

      <div className="section-head">
        <h2 className="section">Purchase orders</h2>
        <button type="button" className="btn-primary" onClick={() => setNewPO(true)}>New purchase order</button>
      </div>
      {pos.length === 0 ? (
        <p className="empty">No purchase orders for {locationName} yet.</p>
      ) : (
        <div className="tablewrap">
          <table>
            <thead>
              <tr><th>PO</th><th>Vendor</th><th>Ordered</th><th>Expected</th><th>Items</th><th className="num">Total</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {pos.map((po) => (
                <tr key={po.id}>
                  <td className="muted">PO-{String(po.number).padStart(4, "0")}</td>
                  <td>{po.vendor}</td>
                  <td>{shortDate(po.orderedOn)}</td>
                  <td>{po.expectedOn ? shortDate(po.expectedOn) : "—"}</td>
                  <td>{po.lines.map((l) => `${l.qty}× ${l.skuCode}`).join(", ")}</td>
                  <td className="num">{fmt(po.totalCents, { decimals: 2 })}</td>
                  <td>
                    <span className={`status ${po.status === "ordered" ? "waiting" : po.status === "received" ? "payable" : "paid"}`}>
                      {po.status === "ordered" ? "Ordered" : po.status === "received" ? `Received ${po.receivedOn ? shortDate(po.receivedOn) : ""}` : "Cancelled"}
                    </span>
                  </td>
                  <td>
                    {po.status === "ordered" && (
                      <span className="row-actions tight">
                        <button type="button" className="btn-outline" disabled={busy != null} onClick={() => poAction(po, "receive")}>Mark received</button>
                        <button type="button" className="linkbtn danger" disabled={busy != null} onClick={() => poAction(po, "cancel")}>Cancel</button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {counting && <CountModal row={counting} location={location} locationName={locationName} today={today} onClose={closeCount} onDone={() => { setCounting(null); router.refresh(); }} />}
      {newPO && <POModal location={location} locationName={locationName} skus={props.skus} today={today} onClose={closePO} onDone={() => { setNewPO(false); router.refresh(); }} />}
    </>
  );
}

function Stat({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: "due" | "paid" }) {
  return (
    <div className={`stat ${tone ?? ""}`}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {note && <div className="note">{note}</div>}
    </div>
  );
}

function CountModal({ row, location, locationName, today, onClose, onDone }: { row: StockRow; location: string; locationName: string; today: string; onClose: () => void; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    const r = await post("/api/inventory/count", {
      location, skuCode: row.skuCode, countedQty: Number(f.get("counted")), countedOn: f.get("countedOn"), note: f.get("note") || null,
    });
    setBusy(false);
    if (!r.ok) return setError(r.error ?? "Couldn't save the count.");
    onDone();
  }
  return (
    <Modal title={`Count ${row.skuCode} at ${locationName}`} onClose={onClose}>
      <form className="pay-form" onSubmit={submit}>
        <p className="muted">The books say <strong>{row.onHand}</strong> on the shelf. Enter what you actually counted; the difference is recorded as a count adjustment.</p>
        <div className="grid">
          <label>Units on the shelf<input name="counted" type="number" min={0} required defaultValue={Math.max(0, row.onHand)} /></label>
          <label>Counted on<input name="countedOn" type="date" required defaultValue={today} max={today} /></label>
        </div>
        <label>Note<input name="note" placeholder="Optional" /></label>
        {error && <p className="flash">{error}</p>}
        <div className="products-actions"><button type="submit" className="btn-primary" disabled={busy}>Save count</button></div>
      </form>
    </Modal>
  );
}

function POModal({ location, locationName, skus, today, onClose, onDone }: {
  location: string; locationName: string; skus: Array<{ code: string; name: string; costCents?: number }>; today: string; onClose: () => void; onDone: () => void;
}) {
  const [lines, setLines] = useState<Array<{ skuCode: string; qty: string; cost: string }>>([{ skuCode: skus[0]?.code ?? "", qty: "1", cost: ((skus[0]?.costCents ?? 0) / 100).toFixed(2) }]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const costOf = (code: string) => ((skus.find((s) => s.code === code)?.costCents ?? 0) / 100).toFixed(2);
  const totalCents = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (parseMoneyInput(l.cost) || 0), 0);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const f = new FormData(e.currentTarget);
    const parsed = lines.map((l) => ({ skuCode: l.skuCode, qty: Number(l.qty), unitCostCents: parseMoneyInput(l.cost) }));
    if (parsed.some((l) => !l.qty || l.qty < 1 || l.unitCostCents == null || Number.isNaN(l.unitCostCents))) return setError("Every line needs a quantity and a unit cost.");
    setBusy(true);
    const r = await post("/api/purchase-orders", {
      location, vendor: f.get("vendor"), orderedOn: f.get("orderedOn"), expectedOn: f.get("expectedOn") || null, note: f.get("note") || null, lines: parsed,
    });
    setBusy(false);
    if (!r.ok) return setError(r.error ?? "Couldn't save the order.");
    onDone();
  }

  return (
    <Modal title={`New purchase order: ${locationName}`} onClose={onClose} width={640}>
      <form className="pay-form" onSubmit={submit}>
        <div className="grid">
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
    </Modal>
  );
}
