import { todayET } from "@/lib/dates";
import { loadLedger } from "@/lib/ledger/repo";
import FundingForm, { type Awaiting } from "./FundingForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Record funding" };

export default async function FundingFormPage({ searchParams }: { searchParams: { deal?: string } }) {
  const today = todayET();
  const deals = await loadLedger(today);
  const awaiting: Awaiting[] = deals
    .filter((d) => d.stage !== "cancelled" && d.financedPortionCents > 0)
    .map((d) => {
      const lenderPaid = d.payments.filter((p) => p.source === "lender");
      const usedCents = lenderPaid.reduce((s, p) => s + p.amountCents + p.feeCents, 0);
      return {
        id: d.id,
        number: d.number,
        customer: d.customerName,
        lender: d.lender,
        location: d.location,
        installedOn: d.installedOn,
        financedCents: d.financedPortionCents,
        fundedCents: d.fundedCents,
        feeCents: lenderPaid.reduce((s, p) => s + p.feeCents, 0),
        leftCents: d.financedPortionCents - usedCents,
      };
    })
    .filter((a) => a.leftCents > 50 || a.id === searchParams.deal)
    // Installed first (that's when lenders fund), oldest install first.
    .sort((a, b) => Number(b.installedOn != null) - Number(a.installedOn != null) || (a.installedOn ?? "").localeCompare(b.installedOn ?? "") || a.number - b.number);
  return (
    <>
      <p className="crumb"><a href="/forms">Forms</a> / Record funding</p>
      <h1>Record funding</h1>
      <FundingForm awaiting={awaiting} today={today} initialDeal={searchParams.deal ?? ""} />
    </>
  );
}
