import { shortDate, todayET } from "@/lib/dates";
import { addDays, payDateFor } from "@/lib/ledger/payrun";
import { loadLedger } from "@/lib/ledger/repo";
import { KIND_LABEL } from "@/lib/ledger/payouts";
import PayoutForm, { type OpenLine, type Payee } from "./PayoutForm";

export const dynamic = "force-dynamic";

export default async function PayoutFormPage() {
  const today = todayET();
  const deals = await loadLedger(today);
  const byPerson = new Map<string, Payee>();
  for (const d of deals) {
    if (d.stage === "cancelled") continue;
    for (const p of d.payoutPositions) {
      if (!p.person || p.openCents <= 50) continue;
      const line: OpenLine = {
        dealId: d.id,
        number: d.number,
        customer: d.customerName,
        kind: p.kind,
        kindLabel: KIND_LABEL[p.kind],
        earnedCents: p.earnedCents,
        paidCents: p.paidCents,
        openCents: p.openCents,
        payable: p.payable,
        waitingOn: p.waitingOn,
        installedOn: d.installedOn,
      };
      const e = byPerson.get(p.person.id) ?? { id: p.person.id, name: p.person.name, payableCents: 0, waitingCents: 0, lines: [] };
      e.lines.push(line);
      if (p.payable) e.payableCents += p.openCents;
      else e.waitingCents += p.openCents;
      byPerson.set(p.person.id, e);
    }
  }
  const payees = [...byPerson.values()]
    .map((p) => ({ ...p, lines: p.lines.sort((a, b) => Number(b.payable) - Number(a.payable) || a.number - b.number) }))
    .sort((a, b) => b.payableCents - a.payableCents || a.name.localeCompare(b.name));

  // This Friday's run by default; last Friday's and next Friday's are there for late or early payouts.
  const thisRun = payDateFor(today);
  const runs = [-14, -7, 0, 7].map((n) => {
    const date = addDays(thisRun, n);
    return { date, label: `Fri ${shortDate(date)}${n === 0 ? " (this Friday)" : n === -7 ? " (last Friday)" : ""}` };
  });

  return (
    <>
      <p className="crumb"><a href="/forms">Forms</a> / Payout form</p>
      <h1>Payout form</h1>
      <PayoutForm payees={payees} runs={runs} defaultRun={thisRun} today={today} />
    </>
  );
}
