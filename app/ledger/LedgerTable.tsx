"use client";

import { useEffect, useState, type ReactNode } from "react";
import { shortDate } from "@/lib/dates";
import type { DerivedDeal } from "@/lib/ledger/types";
import { fmt, sumCents } from "@/lib/money";

type Col = {
  key: string;
  label: string;
  num?: boolean;
  /** The customer column anchors the row; it never collapses. */
  fixed?: boolean;
  cell: (r: DerivedDeal) => ReactNode;
  cellClass?: (r: DerivedDeal) => string;
  total?: (rows: DerivedDeal[]) => ReactNode;
};

const openPayouts = (r: DerivedDeal) => sumCents(r.payoutPositions.map((p) => Math.max(0, p.openCents)));
const money = (pick: (r: DerivedDeal) => number | null, totalPick?: (r: DerivedDeal) => number) => ({
  num: true,
  cell: (r: DerivedDeal) => fmt(pick(r)),
  total: (rows: DerivedDeal[]) => fmt(sumCents(rows.map(totalPick ?? ((r) => pick(r) ?? 0)))),
});

const COLUMNS: Col[] = [
  { key: "number", label: "#", cell: (r) => r.number, cellClass: () => "muted" },
  { key: "customer", label: "Customer", fixed: true, cell: (r) => r.customerName, cellClass: () => "customer" },
  { key: "location", label: "Location", cell: (r) => (r.location === "myrtle-beach" ? "Myrtle Beach" : "Wilmington") },
  { key: "closer", label: "Closer", cell: (r) => r.closer?.name ?? "—" },
  { key: "sold", label: "Sold", cell: (r) => shortDate(r.saleDate) },
  {
    key: "installed",
    label: "Installed",
    cell: (r) =>
      r.installedOn ? shortDate(r.installedOn) : <span className="muted">{r.installScheduledOn ? `sched ${shortDate(r.installScheduledOn)}` : "—"}</span>,
  },
  { key: "stage", label: "Stage", cell: (r) => <span className={`stage ${r.stage}`}>{r.stage}</span> },
  {
    key: "products",
    label: "Products",
    cell: (r) => r.lines.map((l) => (l.qty > 1 ? `${l.qty}× ${l.skuCode}` : l.skuCode)).join(" + ") || <span className="muted">none</span>,
  },
  { key: "price", label: "Price", ...money((r) => r.priceCents) },
  { key: "fees", label: "Fees", ...money((r) => r.feesCents) },
  { key: "net", label: "Net revenue", ...money((r) => r.netRevenueCents) },
  { key: "collected", label: "Collected", ...money((r) => r.collectedCents) },
  { key: "custOwes", label: "Customer owes", ...money((r) => r.cashDueCents, (r) => Math.max(0, r.cashDueCents)), cellClass: (r) => (r.cashDueCents < 0 ? "neg" : "") },
  { key: "lenderOwes", label: "Lender owes", ...money((r) => r.fundingDueCents, (r) => Math.max(0, r.fundingDueCents)), cellClass: (r) => (r.fundingDueCents < 0 ? "neg" : "") },
  { key: "payouts", label: "Payouts open", ...money(openPayouts) },
  { key: "cogs", label: "Cost of goods", ...money((r) => r.cogsCents) },
  { key: "profit", label: "Net profit", ...money((r) => r.netProfitCents), cellClass: (r) => ((r.netProfitCents ?? 0) < 0 ? "neg" : "") },
  { key: "margin", label: "Margin", num: true, cell: (r) => (r.margin == null ? "—" : `${(r.margin * 100).toFixed(1)}%`) },
  { key: "issues", label: "Issues", cell: (r) => r.issues.join(" · "), cellClass: () => "issues" },
];

const STORAGE_KEY = "ledger.collapsedColumns";
const NUM_W = 56;
const COLLAPSED_W = 28;

export default function LedgerTable({ rows }: { rows: DerivedDeal[] }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
      if (Array.isArray(saved)) setCollapsed(new Set(saved.filter((k) => COLUMNS.some((c) => c.key === k && !c.fixed))));
    } catch {
      /* storage unavailable: start expanded */
    }
  }, []);

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  const expandAll = () => {
    setCollapsed(new Set());
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  };

  // The first two columns are pinned; the customer column sits right of the # column.
  const numWidth = collapsed.has("number") ? COLLAPSED_W : NUM_W;
  const pin = (key: string) =>
    key === "number" ? { cls: "pin pin-num", style: { left: 0, width: numWidth, minWidth: numWidth, maxWidth: numWidth } } :
    key === "customer" ? { cls: "pin pin-name", style: { left: numWidth } } : { cls: "", style: {} };

  return (
    <>
      {collapsed.size > 0 && (
        <p className="collapsed-note">
          {collapsed.size} column{collapsed.size > 1 ? "s" : ""} collapsed.{" "}
          <button type="button" className="linkbtn" onClick={expandAll}>Show all columns</button>
        </p>
      )}
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              {COLUMNS.map((c) => {
                const isC = collapsed.has(c.key);
                const p = pin(c.key);
                return (
                  <th key={c.key} className={`${c.num ? "num" : ""} ${p.cls} ${isC ? "col-collapsed" : ""}`} style={p.style}>
                    {isC ? (
                      <button type="button" className="colbtn" onClick={() => toggle(c.key)} title={`Show ${c.label}`} aria-label={`Show ${c.label} column`}>
                        +
                      </button>
                    ) : (
                      <span className="th-inner">
                        <span>{c.label}</span>
                        {!c.fixed && (
                          <button type="button" className="colbtn" onClick={() => toggle(c.key)} title={`Collapse ${c.label}`} aria-label={`Collapse ${c.label} column`}>
                            −
                          </button>
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
                  return (
                    <td
                      key={c.key}
                      className={`${c.num ? "num" : ""} ${p.cls} ${isC ? "col-collapsed" : c.cellClass?.(r) ?? ""}`}
                      style={p.style}
                      title={c.key === "customer" ? r.customerName : undefined}
                    >
                      {isC ? null : c.cell(r)}
                    </td>
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
                  const content = c.key === "number" ? (isC ? null : rows.length) : c.key === "customer" ? "deals" : isC ? null : c.total?.(rows);
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
    </>
  );
}
