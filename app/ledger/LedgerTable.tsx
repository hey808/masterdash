"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Modal from "../Modal";
import PaymentsModal from "./PaymentsModal";
import { shortDate } from "@/lib/dates";
import { FIELDS, parseMoneyInput, parseRateInput, type FieldDef, type FieldKey } from "@/lib/ledger/fields";
import type { LedgerOptions } from "@/lib/ledger/options";
import type { DealLine, DerivedDeal } from "@/lib/ledger/types";
import { fmt, fmtRate, sumCents } from "@/lib/money";

/* ── Columns ─────────────────────────────────────────────────────────── */

type Col = {
  key: string;
  label: string;
  num?: boolean;
  /** The customer column anchors the row; it never collapses. */
  fixed?: boolean;
  /** Typed field behind this column. Absent = calculated, read-only. */
  field?: FieldKey;
  cell: (r: DerivedDeal) => ReactNode;
  cellClass?: (r: DerivedDeal) => string;
  total?: (rows: DerivedDeal[]) => ReactNode;
};

const openPayouts = (r: DerivedDeal) => sumCents(r.payoutPositions.map((p) => Math.max(0, p.openCents)));
const sum = (pick: (r: DerivedDeal) => number) => (rows: DerivedDeal[]) => fmt(sumCents(rows.map(pick)));
const money = (pick: (r: DerivedDeal) => number | null, totalPick?: (r: DerivedDeal) => number) => ({
  num: true,
  cell: (r: DerivedDeal) => fmt(pick(r)),
  total: sum(totalPick ?? ((r) => pick(r) ?? 0)),
});
const LOCATION_NAME: Record<string, string> = { wilmington: "Wilmington", "myrtle-beach": "Myrtle Beach" };
const productsText = (lines: DealLine[]) => lines.map((l) => (l.qty > 1 ? `${l.qty}× ${l.skuCode}` : l.skuCode)).join(" + ");

const COLUMNS: Col[] = [
  { key: "number", label: "#", cell: (r) => r.number, cellClass: () => "muted" },
  { key: "customer", label: "Customer", fixed: true, field: "customerName", cell: (r) => r.customerName, cellClass: () => "customer" },
  { key: "address", label: "Address", field: "customerAddress", cell: (r) => r.customerAddress ?? "" },
  { key: "location", label: "Location", field: "location", cell: (r) => LOCATION_NAME[r.location] ?? r.location },
  { key: "leadSource", label: "Lead source", field: "leadSource", cell: (r) => r.leadSource ?? "" },
  { key: "closer", label: "Closer", field: "closer", cell: (r) => r.closer?.name ?? "" },
  { key: "setter", label: "Setter", field: "setter", cell: (r) => r.setter?.name ?? "" },
  { key: "manager", label: "Manager", field: "manager", cell: (r) => r.manager?.name ?? "" },
  { key: "sold", label: "Sold", field: "saleDate", cell: (r) => shortDate(r.saleDate) },
  { key: "products", label: "Products", field: "products", cell: (r) => productsText(r.lines) || <span className="muted">none</span> },
  { key: "price", label: "Price", field: "priceCents", ...money((r) => r.priceCents) },
  { key: "cash", label: "Cash portion", field: "cashPortionCents", ...money((r) => r.cashPortionCents) },
  { key: "financed", label: "Financed", field: "financedPortionCents", ...money((r) => r.financedPortionCents) },
  { key: "lender", label: "Lender", field: "lender", cell: (r) => r.lender ?? "" },
  { key: "lenderRate", label: "Lender fee %", field: "lenderRate", num: true, cell: (r) => fmtRate(r.lenderRate) },
  { key: "fees", label: "Fees", ...money((r) => r.feesCents) },
  { key: "net", label: "Net revenue", ...money((r) => r.netRevenueCents) },
  { key: "collected", label: "Collected", ...money((r) => r.collectedCents) },
  { key: "custOwes", label: "Customer owes", ...money((r) => r.cashDueCents, (r) => Math.max(0, r.cashDueCents)), cellClass: (r) => (r.cashDueCents < 0 ? "neg" : "") },
  { key: "lenderOwes", label: "Lender owes", ...money((r) => r.fundingDueCents, (r) => Math.max(0, r.fundingDueCents)), cellClass: (r) => (r.fundingDueCents < 0 ? "neg" : "") },
  { key: "commissionRate", label: "Commission %", field: "commissionRate", num: true, cell: (r) => fmtRate(r.commissionRate) },
  { key: "managerRate", label: "Override %", field: "managerRate", num: true, cell: (r) => fmtRate(r.managerRate) },
  { key: "adminFee", label: "Admin fee", field: "adminFeeCents", ...money((r) => r.adminFeeCents) },
  { key: "extras", label: "Extras", field: "extrasCents", ...money((r) => r.extrasCents) },
  { key: "payouts", label: "Payouts open", ...money(openPayouts) },
  { key: "installer", label: "Installer", field: "installer", cell: (r) => r.installer?.name ?? "" },
  { key: "installerPay", label: "Installer pay", field: "installerPayCents", ...money((r) => r.installerPayCents) },
  { key: "scheduled", label: "Install scheduled", field: "installScheduledOn", cell: (r) => (r.installScheduledOn ? shortDate(r.installScheduledOn) : "") },
  { key: "installed", label: "Installed", field: "installedOn", cell: (r) => (r.installedOn ? shortDate(r.installedOn) : "") },
  { key: "stage", label: "Stage", cell: (r) => <span className={`stage ${r.stage}`}>{r.stage}</span> },
  { key: "cogs", label: "Cost of goods", ...money((r) => r.cogsCents) },
  { key: "profit", label: "Net profit", ...money((r) => r.netProfitCents), cellClass: (r) => ((r.netProfitCents ?? 0) < 0 ? "neg" : "") },
  { key: "margin", label: "Margin", num: true, cell: (r) => (r.margin == null ? "—" : `${(r.margin * 100).toFixed(1)}%`) },
  { key: "done", label: "Done", field: "closed", cell: (r) => (r.closedAt ? "✓" : "") },
  { key: "note", label: "Note", field: "note", cell: (r) => r.note ?? "", cellClass: () => "wrap" },
  { key: "issues", label: "Issues", cell: (r) => r.issues.join(" · "), cellClass: () => "issues" },
];

/** Less-used typed columns start collapsed for a new browser. */
const DEFAULT_COLLAPSED = ["address", "leadSource", "manager", "setter", "lenderRate", "managerRate", "adminFee", "extras", "note"];
const STORAGE_KEY = "ledger.collapsedColumns.v2";
const NUM_W = 56;
const COLLAPSED_W = 28;

/** The stored value behind a typed field, as the editor starts from it. */
function rawValue(r: DerivedDeal, f: FieldKey): unknown {
  switch (f) {
    case "customerName": return r.customerName;
    case "customerAddress": return r.customerAddress ?? "";
    case "leadSource": return r.leadSource ?? "";
    case "note": return r.note ?? "";
    case "location": return r.location;
    case "closer": return r.closer?.id ?? null;
    case "setter": return r.setter?.id ?? null;
    case "manager": return r.manager?.id ?? null;
    case "installer": return r.installer?.id ?? null;
    case "saleDate": return r.saleDate;
    case "installScheduledOn": return r.installScheduledOn ?? "";
    case "installedOn": return r.installedOn ?? "";
    case "products": return r.lines.map((l) => ({ skuCode: l.skuCode, qty: l.qty }));
    case "priceCents": return r.priceCents;
    case "cashPortionCents": return r.cashPortionCents;
    case "financedPortionCents": return r.financedPortionCents;
    case "adminFeeCents": return r.adminFeeCents;
    case "extrasCents": return r.extrasCents;
    case "installerPayCents": return r.installerPayCents;
    case "lender": return r.lender;
    case "lenderRate": return r.lenderRate;
    case "commissionRate": return r.commissionRate;
    case "managerRate": return r.managerRate;
    case "closed": return r.closedAt != null;
  }
}

/* ── Table ───────────────────────────────────────────────────────────── */

type SaveResult = string | null; // error message, or null on success

export default function LedgerTable({ rows: initial, options }: { rows: DerivedDeal[]; options: LedgerOptions }) {
  const [rows, setRows] = useState(initial);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [flash, setFlash] = useState<string | null>(null);
  const [paymentsFor, setPaymentsFor] = useState<string | null>(null);
  const closePayments = useCallback(() => setPaymentsFor(null), []);
  const replaceRow = useCallback((d: DerivedDeal) => setRows((rs) => rs.map((r) => (r.id === d.id ? d : r))), []);

  useEffect(() => setRows(initial), [initial]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const saved = raw == null ? DEFAULT_COLLAPSED : JSON.parse(raw);
      if (Array.isArray(saved)) setCollapsed(new Set(saved.filter((k) => COLUMNS.some((c) => c.key === k && !c.fixed))));
    } catch {
      setCollapsed(new Set(DEFAULT_COLLAPSED));
    }
  }, []);

  const persist = (next: Set<string>) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
    } catch {
      /* storage unavailable */
    }
  };
  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      persist(next);
      return next;
    });
  const expandAll = () => {
    const next = new Set<string>();
    setCollapsed(next);
    persist(next);
  };

  async function save(row: DerivedDeal, field: FieldKey, value: unknown): Promise<SaveResult> {
    try {
      const res = await fetch(`/api/deals/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field, value, version: row.version }),
      });
      const body = (await res.json().catch(() => ({}))) as { deal?: DerivedDeal; error?: string };
      if (body.deal) setRows((rs) => rs.map((r) => (r.id === row.id ? body.deal! : r)));
      if (!res.ok) {
        const msg = body.error ?? "Couldn't save.";
        setFlash(`${row.customerName}: ${msg}`);
        return msg;
      }
      return null;
    } catch {
      const msg = "Couldn't reach the server. Check your connection and try again.";
      setFlash(msg);
      return msg;
    }
  }

  const numWidth = collapsed.has("number") ? COLLAPSED_W : NUM_W;
  const pin = (key: string) =>
    key === "number"
      ? { cls: "pin pin-num", style: { left: 0, width: numWidth, minWidth: numWidth, maxWidth: numWidth } }
      : key === "customer"
        ? { cls: "pin pin-name", style: { left: numWidth } }
        : { cls: "", style: {} };

  return (
    <>
      <div className="table-bar">
        <span className="legend">White cells: click to edit. Shaded cells are calculated. Click a Collected amount to record a payment.</span>
        {collapsed.size > 0 && (
          <span>
            {collapsed.size} column{collapsed.size > 1 ? "s" : ""} collapsed.{" "}
            <button type="button" className="linkbtn" onClick={expandAll}>Show all columns</button>
          </span>
        )}
      </div>
      {flash && (
        <p className="flash" role="alert">
          {flash} <button type="button" className="linkbtn" onClick={() => setFlash(null)}>Dismiss</button>
        </p>
      )}
      <div className="tablewrap ledger-scroll">
        <table>
          <thead>
            <tr>
              {COLUMNS.map((c) => {
                const isC = collapsed.has(c.key);
                const p = pin(c.key);
                return (
                  <th key={c.key} className={`${c.num ? "num" : ""} ${p.cls} ${isC ? "col-collapsed" : ""}`} style={p.style}>
                    {isC ? (
                      <button type="button" className="colbtn" onClick={() => toggle(c.key)} title={`Show ${c.label}`} aria-label={`Show ${c.label} column`}>+</button>
                    ) : (
                      <span className="th-inner">
                        <span>{c.label}</span>
                        {!c.fixed && (
                          <button type="button" className="colbtn" onClick={() => toggle(c.key)} title={`Collapse ${c.label}`} aria-label={`Collapse ${c.label} column`}>−</button>
                        )}
                      </span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                {COLUMNS.map((c) => {
                  const isC = collapsed.has(c.key);
                  const p = pin(c.key);
                  const base = `${c.num ? "num" : ""} ${p.cls}`;
                  if (isC) return <td key={c.key} className={`${base} col-collapsed`} style={p.style} />;
                  if (c.key === "collected") {
                    return (
                      <td key={c.key} className={`${base} calc action`} style={p.style}>
                        <button type="button" className="cellbtn" onClick={() => setPaymentsFor(r.id)} title="See and record payments">
                          {c.cell(r)}
                        </button>
                      </td>
                    );
                  }
                  if (!c.field) {
                    return (
                      <td key={c.key} className={`${base} calc ${c.cellClass?.(r) ?? ""}`} style={p.style}>
                        {c.cell(r)}
                      </td>
                    );
                  }
                  return (
                    <EditableCell
                      key={`${c.key}-${r.version}`}
                      className={`${base} ${c.cellClass?.(r) ?? ""}`}
                      style={p.style}
                      row={r}
                      field={c.field}
                      display={c.cell(r)}
                      options={options}
                      onSave={(v) => save(r, c.field!, v)}
                    />
                  );
                })}
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr>
                {COLUMNS.map((c) => {
                  const isC = collapsed.has(c.key);
                  const p = pin(c.key);
                  const content = isC ? null : c.key === "number" ? rows.length : c.key === "customer" ? "deals" : c.field && !c.num ? null : c.total?.(rows);
                  return (
                    <td key={c.key} className={`${c.num ? "num" : ""} ${p.cls} ${isC ? "col-collapsed" : ""}`} style={p.style}>
                      {content}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          )}
        </table>
        {rows.length === 0 && <p className="empty">No deals in this view.</p>}
      </div>
      {paymentsFor && rows.find((r) => r.id === paymentsFor) && (
        <PaymentsModal deal={rows.find((r) => r.id === paymentsFor)!} onClose={closePayments} onDeal={replaceRow} />
      )}
    </>
  );
}

/* ── Editable cell ───────────────────────────────────────────────────── */

function EditableCell(props: {
  className: string;
  style: React.CSSProperties;
  row: DerivedDeal;
  field: FieldKey;
  display: ReactNode;
  options: LedgerOptions;
  onSave: (value: unknown) => Promise<SaveResult>;
}) {
  const { className, style, row, field, display, options, onSave } = props;
  const kind = FIELDS[field].kind;
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const commit = async (value: unknown) => {
    setEditing(false);
    if (JSON.stringify(value) === JSON.stringify(rawValue(row, field))) return;
    setSaving(true);
    const err = await onSave(value);
    setSaving(false);
    setError(err);
  };

  // Checkbox: one click toggles and saves.
  if (kind === "bool") {
    const checked = rawValue(row, field) as boolean;
    return (
      <td className={`${className} editable center ${saving ? "saving" : ""} ${error ? "cell-error" : ""}`} style={style} title={error ?? undefined}>
        <input type="checkbox" aria-label={`Done: ${row.customerName}`} checked={checked} disabled={saving} onChange={(e) => commit(e.target.checked)} />
      </td>
    );
  }

  return (
    <td
      className={`${className} editable ${editing && kind !== "products" ? "is-editing" : ""} ${saving ? "saving" : ""} ${error ? "cell-error" : ""}`}
      style={style}
      title={error ?? (field === "customerName" ? row.customerName : undefined)}
      tabIndex={editing ? -1 : 0}
      onClick={() => !editing && !saving && setEditing(true)}
      onKeyDown={(e) => {
        if (!editing && (e.key === "Enter" || e.key === "F2")) {
          e.preventDefault();
          setEditing(true);
        }
      }}
    >
      {editing && kind === "products" ? (
        <>
          {display}
          <Modal title={`Products: ${row.customerName}`} onClose={() => setEditing(false)}>
            <ProductsEditor initial={rawValue(row, field) as Array<{ skuCode: string; qty: number }>} skus={options.skus} onCommit={commit} onCancel={() => setEditing(false)} />
          </Modal>
        </>
      ) : editing ? (
        <Editor kind={kind} field={field} row={row} options={options} onCommit={commit} onCancel={() => setEditing(false)} />
      ) : (
        display
      )}
    </td>
  );
}

function Editor(props: {
  kind: (typeof FIELDS)[FieldKey]["kind"];
  field: FieldKey;
  row: DerivedDeal;
  options: LedgerOptions;
  onCommit: (v: unknown) => void;
  onCancel: () => void;
}) {
  const { kind, field, row, options, onCommit, onCancel } = props;
  const raw = rawValue(row, field);
  const def: FieldDef = FIELDS[field];
  const label = def.label;
  const ref = useRef<HTMLInputElement & HTMLSelectElement>(null);
  useEffect(() => {
    const el = ref.current as HTMLElement | null;
    el?.focus();
    if (el instanceof HTMLInputElement && el.type === "text") el.select();
  }, []);
  const keys = (e: React.KeyboardEvent, commitFn: () => void) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitFn();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  if (kind === "text" || kind === "date") {
    const initial = (raw as string | null) ?? "";
    const done = (v: string) => onCommit(v.trim() === "" ? (def.required ? v : null) : v.trim());
    return (
      <input
        ref={ref}
        aria-label={label}
        className="cell-input"
        type={kind === "date" ? "date" : "text"}
        defaultValue={initial}
        onBlur={(e) => done(e.target.value)}
        onKeyDown={(e) => keys(e, () => done((e.target as HTMLInputElement).value))}
      />
    );
  }

  if (kind === "money" || kind === "rate") {
    const initial =
      kind === "money" ? (raw == null ? "" : ((raw as number) / 100).toFixed(2)) : String(Math.round((raw as number) * 100000) / 1000);
    const done = (s: string) => {
      const v = kind === "money" ? parseMoneyInput(s) : parseRateInput(s);
      if (v == null && def.required) return onCancel();
      if (v != null && Number.isNaN(v)) return onCancel();
      onCommit(v);
    };
    return (
      <input
        ref={ref}
        aria-label={label}
        className="cell-input num"
        type="text"
        inputMode="decimal"
        defaultValue={initial}
        placeholder={kind === "rate" ? "%" : "$"}
        onBlur={(e) => done(e.target.value)}
        onKeyDown={(e) => keys(e, () => done((e.target as HTMLInputElement).value))}
      />
    );
  }

  if (kind === "person" || kind === "location" || kind === "lender") {
    const role = kind === "person" ? def.role : undefined;
    const people = kind === "person" ? [...options.people].sort((a, b) => Number(b.roles.includes(role!)) - Number(a.roles.includes(role!)) || a.name.localeCompare(b.name)) : [];
    const choices: Array<{ value: string; label: string }> =
      kind === "person"
        ? people.map((p) => ({ value: p.id, label: p.name }))
        : kind === "location"
          ? options.locations.map((l) => ({ value: l.slug, label: l.active ? l.name : `${l.name} (not open)` }))
          : options.lenders.map((l) => ({ value: l, label: l }));
    const current = (raw as string | null) ?? "";
    return (
      <select
        ref={ref}
        aria-label={label}
        className="cell-input"
        defaultValue={current}
        onChange={(e) => onCommit(e.target.value === "" ? null : e.target.value)}
        onBlur={onCancel}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
      >
        {kind !== "location" && <option value="">(none)</option>}
        {choices.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    );
  }

  return null;
}

function ProductsEditor(props: {
  initial: Array<{ skuCode: string; qty: number }>;
  skus: Array<{ code: string; name: string }>;
  onCommit: (v: unknown) => void;
  onCancel: () => void;
}) {
  const [qty, setQty] = useState<Record<string, number>>(() => Object.fromEntries(props.initial.map((l) => [l.skuCode, l.qty])));
  const lines = () => props.skus.filter((s) => (qty[s.code] ?? 0) > 0).map((s) => ({ skuCode: s.code, qty: qty[s.code]! }));
  return (
    <div className="products-editor" onClick={(e) => e.stopPropagation()}>
      {props.skus.map((s, i) => (
        <label key={s.code} title={s.name}>
          <input
            type="checkbox"
            autoFocus={i === 0}
            checked={(qty[s.code] ?? 0) > 0}
            onChange={(e) => setQty((q) => ({ ...q, [s.code]: e.target.checked ? Math.max(1, q[s.code] ?? 0) : 0 }))}
          />
          {s.code}
          {(qty[s.code] ?? 0) > 0 && (
            <input
              type="number"
              min={1}
              max={20}
              aria-label={`${s.code} quantity`}
              className="qty"
              value={qty[s.code]}
              onChange={(e) => setQty((q) => ({ ...q, [s.code]: Math.max(1, Math.min(20, Number(e.target.value) || 1)) }))}
            />
          )}
        </label>
      ))}
      <div className="products-actions">
        <button type="button" className="btn-primary" onClick={() => props.onCommit(lines())}>Save products</button>
        <button type="button" className="linkbtn" onClick={props.onCancel}>Cancel</button>
      </div>
    </div>
  );
}
