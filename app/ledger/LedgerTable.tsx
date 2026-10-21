"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Modal from "../Modal";
import PaymentsModal from "./PaymentsModal";
import { shortDate, todayET } from "@/lib/dates";
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

/** Total still owed by the customer and the lender (over-funding counts as 0). */
const outstanding = (r: DerivedDeal) => Math.max(0, r.cashDueCents) + Math.max(0, r.fundingDueCents);
const TODAY = todayET();
const daysSince = (d: string | null) =>
  d == null ? null : Math.round((Date.parse(`${TODAY}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86_400_000);

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
  { key: "number", label: "#", fixed: true, cell: (r) => r.number, cellClass: () => "muted" },
  { key: "stage", label: "Stage", fixed: true, cell: (r) => <span className={`stage ${r.stage}`}>{r.stage}</span> },
  { key: "customer", label: "Customer", fixed: true, field: "customerName", cell: (r) => r.customerName, cellClass: () => "customer" },
  { key: "address", label: "Address", field: "customerAddress", cell: (r) => r.customerAddress ?? "" },
  { key: "location", label: "Location", field: "location", cell: (r) => LOCATION_NAME[r.location] ?? r.location },
  { key: "leadSource", label: "Lead Source", field: "leadSource", cell: (r) => r.leadSource ?? "" },
  { key: "closer", label: "Closer", field: "closer", cell: (r) => r.closer?.name ?? "" },
  { key: "setter", label: "Setter", field: "setter", cell: (r) => r.setter?.name ?? "" },
  { key: "manager", label: "Manager", field: "manager", cell: (r) => r.manager?.name ?? "" },
  { key: "sold", label: "Sold Date", field: "saleDate", cell: (r) => shortDate(r.saleDate) },
  { key: "products", label: "Products", field: "products", cell: (r) => productsText(r.lines) || <span className="muted">none</span> },
  { key: "price", label: "Price", field: "priceCents", ...money((r) => r.priceCents) },
  { key: "cash", label: "Cash Portion", field: "cashPortionCents", ...money((r) => r.cashPortionCents) },
  { key: "financed", label: "Financed", field: "financedPortionCents", ...money((r) => r.financedPortionCents) },
  { key: "lender", label: "Lender", field: "lender", cell: (r) => r.lender ?? "" },
  { key: "lenderRate", label: "Lender Fee %", field: "lenderRate", num: true, cell: (r) => fmtRate(r.lenderRate) },
  { key: "fees", label: "Fees", ...money((r) => r.feesCents) },
  { key: "net", label: "Net Revenue", ...money((r) => r.netRevenueCents) },
  { key: "collectedCustomer", label: "Customer Collected", ...money((r) => r.cashCollectedCents) },
  { key: "custOwes", label: "Customer Outstanding", ...money((r) => r.cashDueCents, (r) => Math.max(0, r.cashDueCents)), cellClass: (r) => (r.cashDueCents < 0 ? "neg" : "") },
  { key: "collectedLender", label: "Lender Collected", ...money((r) => r.fundedCents) },
  { key: "lenderOwes", label: "Lender Outstanding", ...money((r) => r.fundingDueCents, (r) => Math.max(0, r.fundingDueCents)), cellClass: (r) => (r.fundingDueCents < 0 ? "neg" : "") },
  {
    key: "outstanding",
    label: "Total Outstanding",
    ...money(outstanding),
  },
  { key: "commissionRate", label: "Commission %", field: "commissionRate", num: true, cell: (r) => fmtRate(r.commissionRate) },
  { key: "managerRate", label: "Override %", field: "managerRate", num: true, cell: (r) => fmtRate(r.managerRate) },
  { key: "adminFee", label: "Admin Fee", field: "adminFeeCents", ...money((r) => r.adminFeeCents) },
  { key: "extras", label: "Extras", field: "extrasCents", ...money((r) => r.extrasCents) },
  { key: "payouts", label: "Payouts Open", ...money(openPayouts) },
  { key: "installer", label: "Installer", field: "installer", cell: (r) => r.installer?.name ?? "" },
  { key: "installerPay", label: "Installer Pay", field: "installerPayCents", ...money((r) => r.installerPayCents) },
  { key: "scheduled", label: "Install Schedule", field: "installScheduledOn", cell: (r) => (r.installScheduledOn ? shortDate(r.installScheduledOn) : "") },
  { key: "installed", label: "Installed", field: "installed", cell: (r) => (r.installedOn ? "Yes" : "No") },
  {
    key: "daysOut",
    label: "Days Since Install",
    num: true,
    cell: (r) => daysSince(r.installedOn) ?? "—",
    cellClass: (r) => {
      const d = daysSince(r.installedOn);
      return d == null || outstanding(r) <= 50 ? "" : d > 60 ? "age-bad" : d > 30 ? "age-warn" : "";
    },
  },
  { key: "cogs", label: "Cost of Goods", ...money((r) => r.cogsCents) },
  { key: "profit", label: "Net Profit", ...money((r) => r.netProfitCents), cellClass: (r) => ((r.netProfitCents ?? 0) < 0 ? "neg" : "") },
  { key: "margin", label: "Margin", num: true, cell: (r) => (r.margin == null ? "—" : `${(r.margin * 100).toFixed(1)}%`) },
  { key: "done", label: "Done", field: "closed", cell: (r) => (r.closedAt ? "✓" : "") },
  { key: "note", label: "Note", field: "note", cell: (r) => r.note ?? "", cellClass: () => "wrap" },
  { key: "issues", label: "Issues", cell: (r) => r.issues.join(" · "), cellClass: () => "issues" },
];

/** Column views. Each view starts from its preset; tweaks are remembered per view in this browser. */
const CONSOLIDATED = ["location", "sold", "price", "cash", "financed", "fees", "collectedCustomer", "collectedLender", "outstanding", "scheduled", "installed", "profit"];
const RECEIVABLES = ["location", "closer", "sold", "lender", "installed", "daysOut", "price", "collectedCustomer", "custOwes", "collectedLender", "lenderOwes", "outstanding"];
const only = (keep: string[]) => COLUMNS.filter((c) => !c.fixed && !keep.includes(c.key)).map((c) => c.key);

interface ViewDef {
  label: string;
  collapsed: string[];
  /** Hide collapsed columns outright instead of showing thin strips. */
  hide: boolean;
  filter?: (r: DerivedDeal) => boolean;
  sort?: (a: DerivedDeal, b: DerivedDeal) => number;
  note?: string;
}

const VIEWS: Record<"consolidated" | "receivables" | "all", ViewDef> = {
  consolidated: { label: "Consolidated", collapsed: only(CONSOLIDATED), hide: true },
  receivables: {
    label: "Receivables",
    collapsed: only(RECEIVABLES),
    hide: true,
    // Only deals with money still owed. Installed jobs first (that's real AR), oldest balance first, then biggest.
    filter: (r) => r.stage !== "cancelled" && outstanding(r) > 50,
    sort: (a, b) =>
      Number(b.isInstalled) - Number(a.isInstalled) ||
      (daysSince(b.installedOn) ?? -1) - (daysSince(a.installedOn) ?? -1) ||
      outstanding(b) - outstanding(a),
    note: "Deals with money still owed. Installed jobs first, oldest balance on top; then jobs not installed yet.",
  },
  all: { label: "All Deals", collapsed: [], hide: false },
};
type ViewKey = keyof typeof VIEWS;
const DEFAULT_VIEW: ViewKey = "consolidated";
const viewStorage = (v: ViewKey) => `ledger.view.${v}.collapsed.v2`; // v2: Total Outstanding + Collected - Lender in Consolidated
const NUM_W = 56;
const STAGE_W = 104;
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
    case "installed": return r.installedOn != null;
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

type NumSort = "asc" | "desc" | null;
const sortStorage = (v: string) => `ledger.view.${v}.numSort`;

export default function LedgerTable({ rows: initial, options }: { rows: DerivedDeal[]; options: LedgerOptions }) {
  const [rows, setRows] = useState(initial);
  const [view, setView] = useState<ViewKey>(DEFAULT_VIEW);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(VIEWS[DEFAULT_VIEW].collapsed));
  const [flash, setFlash] = useState<string | null>(null);
  // null = the view's own order (newest first, or Receivables' priority order).
  const [numSort, setNumSort] = useState<NumSort>(null);
  const [paymentsFor, setPaymentsFor] = useState<{ id: string; source: "customer" | "lender" } | null>(null);
  const closePayments = useCallback(() => setPaymentsFor(null), []);
  const replaceRow = useCallback((d: DerivedDeal) => setRows((rs) => rs.map((r) => (r.id === d.id ? d : r))), []);

  useEffect(() => setRows(initial), [initial]);

  const loadView = (v: ViewKey) => {
    let next = new Set<string>(VIEWS[v].collapsed);
    try {
      const raw = localStorage.getItem(viewStorage(v));
      const saved = raw == null ? null : JSON.parse(raw);
      if (Array.isArray(saved)) next = new Set(saved.filter((k) => COLUMNS.some((c) => c.key === k && !c.fixed)));
    } catch {
      /* storage unavailable: use the preset */
    }
    let dir: NumSort = null;
    try {
      const s = localStorage.getItem(sortStorage(v));
      if (s === "asc" || s === "desc") dir = s;
    } catch {
      /* ignore */
    }
    setView(v);
    setCollapsed(next);
    setNumSort(dir);
    try {
      localStorage.setItem("ledger.view", v);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    let v: ViewKey = DEFAULT_VIEW;
    try {
      const saved = localStorage.getItem("ledger.view");
      if (saved && saved in VIEWS) v = saved as ViewKey;
    } catch {
      /* ignore */
    }
    loadView(v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persist = (next: Set<string>) => {
    try {
      localStorage.setItem(viewStorage(view), JSON.stringify([...next]));
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
  const resetView = () => {
    try {
      localStorage.removeItem(viewStorage(view));
    } catch {
      /* ignore */
    }
    setCollapsed(new Set(VIEWS[view].collapsed));
  };
  const customized = [...collapsed].sort().join() !== [...VIEWS[view].collapsed].sort().join();

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

  // Consolidated hides its collapsed columns outright; All Deals keeps them as thin strips you can reopen.
  const viewDef = VIEWS[view];
  const hideCollapsed = viewDef.hide;
  const shown = hideCollapsed ? COLUMNS.filter((c) => !collapsed.has(c.key)) : COLUMNS;
  const viewRows = (() => {
    const kept = viewDef.filter ? rows.filter(viewDef.filter) : rows;
    if (numSort) return [...kept].sort((a, b) => (numSort === "asc" ? a.number - b.number : b.number - a.number));
    return viewDef.sort ? [...kept].sort(viewDef.sort) : [...kept].sort((a, b) => b.number - a.number);
  })();
  // What the # header arrow shows; null when the view is in its own (non-number) order.
  const numDir: NumSort = numSort ?? (viewDef.sort ? null : "desc");
  const flipNumSort = () => {
    const next: NumSort = numDir === "desc" ? "asc" : "desc";
    setNumSort(next);
    try {
      localStorage.setItem(sortStorage(view), next);
    } catch {
      /* ignore */
    }
  };
  const clearNumSort = () => {
    setNumSort(null);
    try {
      localStorage.removeItem(sortStorage(view));
    } catch {
      /* ignore */
    }
  };
  const hiddenCount = hideCollapsed ? COLUMNS.length - shown.length : 0;

  const pin = (key: string) =>
    key === "number"
      ? { cls: "pin pin-num", style: { left: 0, width: NUM_W, minWidth: NUM_W, maxWidth: NUM_W } }
      : key === "stage"
        ? { cls: "pin pin-stage", style: { left: NUM_W, width: STAGE_W, minWidth: STAGE_W, maxWidth: STAGE_W } }
        : key === "customer"
          ? { cls: "pin pin-name", style: { left: NUM_W + STAGE_W } }
          : { cls: "", style: {} };

  return (
    <>
      <div className="table-bar">
        <nav className="filters views" aria-label="Column view">
          {(Object.keys(VIEWS) as ViewKey[]).map((v) => (
            <button key={v} type="button" className={v === view ? "on" : ""} aria-pressed={v === view} onClick={() => loadView(v)}>
              {VIEWS[v].label}
            </button>
          ))}
        </nav>
        {customized && (
          <button type="button" className="linkbtn" onClick={resetView}>
            Reset {VIEWS[view].label} columns
          </button>
        )}
        {viewDef.sort && numSort && (
          <button type="button" className="linkbtn" onClick={clearNumSort}>
            Back to {VIEWS[view].label} order
          </button>
        )}
        {viewDef.note && <span className="view-note">{viewDef.note}</span>}
        {hiddenCount > 0 && !viewDef.note && <span>{hiddenCount} columns hidden in this view. Switch to All Deals to see them.</span>}
        <span className="legend">White cells: click to edit. Shaded cells are calculated. Click a Customer Collected or Lender Collected amount to record a payment.</span>
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
              {shown.map((c) => {
                const isC = collapsed.has(c.key);
                const p = pin(c.key);
                return (
                  <th key={c.key} className={`${c.num ? "num" : ""} ${p.cls} ${isC ? "col-collapsed" : ""}`} style={p.style}>
                    {c.key === "number" ? (
                      <button
                        type="button"
                        className="sortbtn"
                        onClick={flipNumSort}
                        title={numDir === "desc" ? "Newest first. Click for oldest first." : numDir === "asc" ? "Oldest first. Click for newest first." : "Sort by deal number"}
                        aria-label={`Sort by deal number, ${numDir === "desc" ? "currently newest first" : numDir === "asc" ? "currently oldest first" : "not sorted"}`}
                      >
                        # <span aria-hidden="true">{numDir === "desc" ? "▼" : numDir === "asc" ? "▲" : "↕"}</span>
                      </button>
                    ) : isC ? (
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
            {viewRows.map((r) => (
              <tr key={r.id}>
                {shown.map((c) => {
                  const isC = collapsed.has(c.key);
                  const p = pin(c.key);
                  const base = `${c.num ? "num" : ""} ${p.cls}`;
                  if (isC) return <td key={c.key} className={`${base} col-collapsed`} style={p.style} />;
                  if (c.key === "collectedCustomer" || c.key === "collectedLender") {
                    const source = c.key === "collectedLender" ? "lender" : "customer";
                    return (
                      <td key={c.key} className={`${base} calc action`} style={p.style}>
                        <button type="button" className="cellbtn" onClick={() => setPaymentsFor({ id: r.id, source })} title="See and record payments">
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
          {viewRows.length > 0 && (
            <tfoot>
              <tr>
                {shown.map((c) => {
                  const isC = collapsed.has(c.key);
                  const p = pin(c.key);
                  const content = isC ? null : c.key === "number" ? viewRows.length : c.key === "stage" || c.key === "daysOut" ? null : c.key === "customer" ? "deals" : c.field && !c.num ? null : c.total?.(viewRows);
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
        {viewRows.length === 0 && <p className="empty">No deals in this view.</p>}
      </div>
      {paymentsFor && rows.find((r) => r.id === paymentsFor.id) && (
        <PaymentsModal deal={rows.find((r) => r.id === paymentsFor.id)!} initialSource={paymentsFor.source} onClose={closePayments} onDeal={replaceRow} />
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

  // Yes/No: one click toggles and saves.
  if (kind === "bool") {
    const checked = rawValue(row, field) as boolean;
    const label = FIELDS[field].label;
    const tip = error ?? (field === "installed" && row.installedOn ? `Installed ${row.installedOn}` : undefined);
    if (field === "installed") {
      return (
        <td className={`${className} editable ${saving ? "saving" : ""} ${error ? "cell-error" : ""}`} style={style} title={tip}>
          <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={`${label}: ${row.customerName}`}
            className={`toggle ${checked ? "on" : ""}`}
            disabled={saving}
            onClick={() => commit(!checked)}
          >
            <span className="knob" />
            <span className="toggle-text">{checked ? "Yes" : "No"}</span>
          </button>
        </td>
      );
    }
    return (
      <td className={`${className} editable center ${saving ? "saving" : ""} ${error ? "cell-error" : ""}`} style={style} title={tip}>
        <input type="checkbox" aria-label={`${label}: ${row.customerName}`} checked={checked} disabled={saving} onChange={(e) => commit(e.target.checked)} />
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
