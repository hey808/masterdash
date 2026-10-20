import { todayET } from "@/lib/dates";
import { SETTLED_CENTS } from "@/lib/ledger/derive";
import { loadOptions, type LedgerOptions } from "@/lib/ledger/options";
import { loadLedger } from "@/lib/ledger/repo";
import type { DerivedDeal } from "@/lib/ledger/types";
import LedgerTable from "./LedgerTable";

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
  let options: LedgerOptions;
  try {
    [all, options] = await Promise.all([loadLedger(asOf), loadOptions()]);
  } catch (e) {
    return (
      <>
        <h1>Deal Ledger</h1>
        <p className="error">Could not load the ledger: {(e as Error).message}</p>
      </>
    );
  }
  const scoped = loc ? all.filter((r) => r.location === loc) : all;
  const rows = applyView(scoped, view);
  const href = (v: string, l: string) => `/ledger?${new URLSearchParams({ ...(v !== "all" ? { view: v } : {}), ...(l ? { loc: l } : {}) })}`;

  return (
    <>
      <h1>Deal Ledger</h1>
      <nav className="filters">
        {VIEWS.map(([k, label]) => (
          <a key={k} href={href(k, loc)} className={k === view ? "on" : ""}>{label}</a>
        ))}
        <span className="sep" />
        {LOCATIONS.map(([k, label]) => (
          <a key={k || "all"} href={href(view, k)} className={k === loc ? "on" : ""}>{label}</a>
        ))}
      </nav>

      <LedgerTable rows={rows} options={options} />
    </>
  );
}
