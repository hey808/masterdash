import { shortDate, todayET } from "@/lib/dates";
import { SETTLED_CENTS } from "@/lib/ledger/derive";
import { loadLedger } from "@/lib/ledger/repo";
import { totals } from "@/lib/ledger/rollups";
import type { DerivedDeal } from "@/lib/ledger/types";
import { fmt, sumCents } from "@/lib/money";

export const dynamic = "force-dynamic";

const VIEWS = [
  ["all", "All deals"],
  ["backlog", "Not installed"],
  ["receivables", "Money owed to us"],
  ["payables", "We owe payouts"],
  ["issues", "Has issues"],
] as const;
type View = (typeof VIEWS)[number][0];

const LOCATIONS = [
  ["", "All locations"],
  ["wilmington", "Wilmington"],
  ["myrtle-beach", "Myrtle Beach"],
] as const;

function applyView(rows: DerivedDeal[], view: View): DerivedDeal[] {
  switch (view) {
    case "backlog":
      return rows.filter((r) => !r.isInstalled && r.stage !== "cancelled");
    case "receivables":
      return rows.filter((r) => r.isInstalled && (r.cashDueCents > SETTLED_CENTS || r.fundingDueCents > SETTLED_CENTS));
    case "payables":
      return rows.filter((r) => r.payoutPositions.some((p) => p.openCents > SETTLED_CENTS));
    case "issues":
      return rows.filter((r) => r.issues.length > 0);
    default:
      return rows;
  }
}

export default async function LedgerPage({ searchParams }: { searchParams: { view?: string; loc?: string } }) {
  const asOf = todayET();
  const view = (VIEWS.find(([k]) => k === searchParams.view)?.[0] ?? "all") as View;
  const loc = LOCATIONS.find(([k]) => k === searchParams.loc)?.[0] ?? "";

  let all: DerivedDeal[];
  try {
    all = await loadLedger(asOf);
  } catch (e) {
    return (
      <>
        <h1>Deal Ledger</h1>
        <p className="error">Could not load the ledger: {(e as Error).message}</p>
      </>
    );
  }
  const scoped = loc ? all.filter((r) => r.location === loc) : all;
  const t = totals(scoped, asOf);
  const rows = applyView(scoped, view);
  const href = (v: string, l: string) => `/ledger?${new URLSearchParams({ ...(v !== "all" ? { view: v } : {}), ...(l ? { loc: l } : {}) })}`;
  const open = (r: DerivedDeal) => sumCents(r.payoutPositions.map((p) => Math.max(0, p.openCents)));

  return (
    <>
      <h1>Deal Ledger</h1>
      <p className="sub">
        One row per deal. Every number below is calculated from what was typed: price, payments, payouts, products, rates. As of {shortDate(asOf)}.
      </p>

      <section className="kpis">
        <Kpi label="Contract value" value={fmt(t.contractCents)} note={`${t.deals} deals`} />
        <Kpi label="Net revenue" value={fmt(t.netRevenueCents)} note={`after ${fmt(t.feesCents)} lender and card fees`} />
        <Kpi label="Collected" value={fmt(t.collectedCents)} />
        <Kpi label="Owed to us" value={fmt(t.receivablesCents)} note="installed jobs only" />
        <Kpi label="Not installed" value={fmt(t.backlogCents)} note={`${t.backlog} jobs`} />
        <Kpi label="Payouts due now" value={fmt(t.payableNowCents)} note={`${fmt(t.payableLaterCents)} more once money is in`} />
        <Kpi label="Net profit" value={fmt(t.netProfitCents)} note={`${t.costedDeals} of ${t.deals} deals costed`} />
        <Kpi label="Deals with issues" value={String(t.dealsWithIssues)} alert={t.dealsWithIssues > 0} />
      </section>

      <nav className="filters">
        {VIEWS.map(([k, label]) => (
          <a key={k} href={href(k, loc)} className={k === view ? "on" : ""}>{label}</a>
        ))}
        <span className="sep" />
        {LOCATIONS.map(([k, label]) => (
          <a key={k || "all"} href={href(view, k)} className={k === loc ? "on" : ""}>{label}</a>
        ))}
      </nav>

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th className="pin pin-num">#</th>
              <th className="pin pin-name">Customer</th>
              <th>Location</th>
              <th>Closer</th>
              <th>Sold</th>
              <th>Installed</th>
              <th>Stage</th>
              <th>Products</th>
              <th className="num">Price</th>
              <th className="num">Fees</th>
              <th className="num">Net revenue</th>
              <th className="num">Collected</th>
              <th className="num">Customer owes</th>
              <th className="num">Lender owes</th>
              <th className="num">Payouts open</th>
              <th className="num">Cost of goods</th>
              <th className="num">Net profit</th>
              <th className="num">Margin</th>
              <th>Issues</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="pin pin-num muted">{r.number}</td>
                <td className="pin pin-name customer" title={r.customerName}>{r.customerName}</td>
                <td>{r.location === "myrtle-beach" ? "Myrtle Beach" : "Wilmington"}</td>
                <td>{r.closer?.name ?? "—"}</td>
                <td>{shortDate(r.saleDate)}</td>
                <td>{r.installedOn ? shortDate(r.installedOn) : <span className="muted">{r.installScheduledOn ? `sched ${shortDate(r.installScheduledOn)}` : "—"}</span>}</td>
                <td><span className={`stage ${r.stage}`}>{r.stage}</span></td>
                <td>{r.lines.map((l) => (l.qty > 1 ? `${l.qty}× ${l.skuCode}` : l.skuCode)).join(" + ") || <span className="muted">none</span>}</td>
                <td className="num">{fmt(r.priceCents)}</td>
                <td className="num">{fmt(r.feesCents)}</td>
                <td className="num">{fmt(r.netRevenueCents)}</td>
                <td className="num">{fmt(r.collectedCents)}</td>
                <td className={`num ${r.cashDueCents < 0 ? "neg" : ""}`}>{fmt(r.cashDueCents)}</td>
                <td className={`num ${r.fundingDueCents < 0 ? "neg" : ""}`}>{fmt(r.fundingDueCents)}</td>
                <td className="num">{fmt(open(r))}</td>
                <td className="num">{fmt(r.cogsCents)}</td>
                <td className={`num ${(r.netProfitCents ?? 0) < 0 ? "neg" : ""}`}>{fmt(r.netProfitCents)}</td>
                <td className="num">{r.margin == null ? "—" : `${(r.margin * 100).toFixed(1)}%`}</td>
                <td className="issues">{r.issues.join(" · ")}</td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr>
                <td className="pin pin-num" colSpan={2}>{rows.length} deals</td>
                <td colSpan={6} />
                <td className="num">{fmt(sumCents(rows.map((r) => r.priceCents)))}</td>
                <td className="num">{fmt(sumCents(rows.map((r) => r.feesCents)))}</td>
                <td className="num">{fmt(sumCents(rows.map((r) => r.netRevenueCents)))}</td>
                <td className="num">{fmt(sumCents(rows.map((r) => r.collectedCents)))}</td>
                <td className="num">{fmt(sumCents(rows.map((r) => Math.max(0, r.cashDueCents))))}</td>
                <td className="num">{fmt(sumCents(rows.map((r) => Math.max(0, r.fundingDueCents))))}</td>
                <td className="num">{fmt(sumCents(rows.map(open)))}</td>
                <td className="num">{fmt(sumCents(rows.map((r) => r.cogsCents ?? 0)))}</td>
                <td className="num">{fmt(sumCents(rows.map((r) => r.netProfitCents ?? 0)))}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
        {rows.length === 0 && <p className="empty">No deals in this view.</p>}
      </div>
    </>
  );
}

function Kpi({ label, value, note, alert }: { label: string; value: string; note?: string; alert?: boolean }) {
  return (
    <div className={`kpi ${alert ? "alert" : ""}`}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {note && <div className="note">{note}</div>}
    </div>
  );
}
