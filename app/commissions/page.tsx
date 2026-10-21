import { todayET } from "@/lib/dates";
import { buildPayRun, isFriday, payDateFor, type PayRun } from "@/lib/ledger/payrun";
import { loadDeals } from "@/lib/ledger/repo";
import AllCommissions from "./AllCommissions";
import PayRunView from "./PayRunView";

export const dynamic = "force-dynamic";

export default async function CommissionsPage({ searchParams }: { searchParams: { tab?: string; run?: string; view?: string; kind?: string; loc?: string } }) {
  const tab = searchParams.tab === "all" ? "all" : "run";
  const today = todayET();

  return (
    <>
      <div className="page-head">
        <h1>Commissions</h1>
        <div className="page-actions">
          <a className="btn-primary page-btn" href="/forms/payout">Payout form</a>
        </div>
      </div>
      <nav className="tabs">
        <a href="/commissions" className={tab === "run" ? "on" : ""}>Friday pay run</a>
        <a href="/commissions?tab=all" className={tab === "all" ? "on" : ""}>All commissions</a>
      </nav>
      {tab === "all" ? <AllCommissions searchParams={searchParams} /> : <Run runParam={searchParams.run} today={today} />}
    </>
  );
}

async function Run({ runParam, today }: { runParam?: string; today: string }) {
  const payDate = runParam && isFriday(runParam) ? runParam : payDateFor(today);
  let run: PayRun;
  try {
    run = buildPayRun(await loadDeals(), payDate);
  } catch (e) {
    return <p className="error">Could not load the ledger: {(e as Error).message}</p>;
  }
  return <PayRunView run={run} today={today} currentPayDate={payDateFor(today)} />;
}
