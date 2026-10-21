"use client";

import { useMemo, useState } from "react";
import type { CustomerRow } from "@/lib/customer-types";

const money = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const AGR = { sent: "Agreement sent", signed: "Agreement signed", void: "Agreement cancelled" } as const;

export default function CustomerList({ rows, showCloser }: { rows: CustomerRow[]; showCloser: boolean }) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? rows.filter((r) => `${r.name} ${r.phone ?? ""} ${r.dealNumber ?? ""} ${r.closer ?? ""} ${r.location ?? ""}`.toLowerCase().includes(s)) : rows;
  }, [rows, q]);
  return (
    <>
      <input className="cust-search" type="search" placeholder={`Search ${rows.length} customers by name, phone or deal #`} value={q} onChange={(e) => setQ(e.target.value)} />
      {shown.length === 0 ? (
        <p className="empty">No customers match.</p>
      ) : (
        <ul className="agr-list">
          {shown.map((r) => (
            <li key={r.key}>
              <a href={`/customers/${r.key}`} className={`agr-row ${r.stageLabel === "Cancelled" ? "st-void" : ""}`}>
                <span className="agr-row-main">
                  <strong>{r.name}</strong>
                  <span className="muted">
                    {[r.dealNumber != null ? `#${r.dealNumber}` : null, r.location, showCloser ? r.closer : null, r.agreement ? AGR[r.agreement] : null].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="agr-row-side">
                  {r.priceCents != null && <span className="agr-price">{money(r.priceCents)}</span>}
                  {r.stageLabel && <span className="cust-stage">{r.stageLabel}</span>}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
