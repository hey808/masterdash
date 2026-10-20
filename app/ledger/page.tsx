import { todayET } from "@/lib/dates";
import { loadOptions, type LedgerOptions } from "@/lib/ledger/options";
import { loadLedger } from "@/lib/ledger/repo";
import type { DerivedDeal } from "@/lib/ledger/types";
import LedgerTable from "./LedgerTable";

export const dynamic = "force-dynamic";

const LOCATIONS = [
  ["", "All locations"],
  ["wilmington", "Wilmington"],
  ["myrtle-beach", "Myrtle Beach"],
] as const;

export default async function LedgerPage({ searchParams }: { searchParams: { loc?: string } }) {
  const asOf = todayET();
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
  const rows = scoped;
  const href = (l: string) => (l ? `/ledger?loc=${l}` : "/ledger");

  return (
    <>
      <h1>Deal Ledger</h1>
      <nav className="filters">
        {LOCATIONS.map(([k, label]) => (
          <a key={k || "all"} href={href(k)} className={k === loc ? "on" : ""}>{label}</a>
        ))}
      </nav>

      <LedgerTable rows={rows} options={options} />
    </>
  );
}
