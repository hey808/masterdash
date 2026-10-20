import { sumCents, type Cents } from "../money";
import { SETTLED_CENTS } from "./derive";
import type { DerivedDeal, PayoutKind } from "./types";

const live = (rows: DerivedDeal[]) => rows.filter((r) => r.stage !== "cancelled");

export interface OpenItem {
  dealId: string;
  number: number;
  customer: string;
  location: string;
  kind: "Customer" | "Lender";
  who: string;
  amountCents: Cents;
  installedOn: string | null;
  daysOpen: number | null;
}

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** Receivables: money owed on INSTALLED jobs. Sold-not-installed is backlog, not AR. */
export function receivables(rows: DerivedDeal[], asOf: string): OpenItem[] {
  const out: OpenItem[] = [];
  for (const r of live(rows)) {
    if (!r.isInstalled) continue;
    const base = {
      dealId: r.id,
      number: r.number,
      customer: r.customerName,
      location: r.location,
      installedOn: r.installedOn,
      daysOpen: r.installedOn ? daysBetween(r.installedOn, asOf) : null,
    };
    if (r.cashDueCents > SETTLED_CENTS) out.push({ ...base, kind: "Customer", who: r.customerName, amountCents: r.cashDueCents });
    if (r.fundingDueCents > SETTLED_CENTS) out.push({ ...base, kind: "Lender", who: r.lender ?? "Lender", amountCents: r.fundingDueCents });
  }
  return out.sort((a, b) => b.amountCents - a.amountCents);
}

export interface PayableItem {
  dealId: string;
  number: number;
  customer: string;
  kind: PayoutKind;
  person: string;
  amountCents: Cents;
  payable: boolean;
  waitingOn: string | null;
}

/** Everything earned and not yet paid, split into payable now vs waiting. */
export function payables(rows: DerivedDeal[]): PayableItem[] {
  const out: PayableItem[] = [];
  for (const r of live(rows)) {
    for (const p of r.payoutPositions) {
      if (p.openCents <= SETTLED_CENTS) continue;
      out.push({
        dealId: r.id,
        number: r.number,
        customer: r.customerName,
        kind: p.kind,
        person: p.person?.name ?? "Unassigned",
        amountCents: p.openCents,
        payable: p.payable,
        waitingOn: p.waitingOn,
      });
    }
  }
  return out.sort((a, b) => b.amountCents - a.amountCents);
}

export interface LedgerTotals {
  deals: number;
  installed: number;
  backlog: number;
  contractCents: Cents;
  feesCents: Cents;
  netRevenueCents: Cents;
  collectedCents: Cents;
  receivablesCents: Cents;
  backlogCents: Cents;
  payableNowCents: Cents;
  payableLaterCents: Cents;
  netProfitCents: Cents;
  costedDeals: number;
  dealsWithIssues: number;
}

export function totals(rows: DerivedDeal[], asOf: string): LedgerTotals {
  const l = live(rows);
  const pay = payables(l);
  const costed = l.filter((r) => r.netProfitCents != null);
  return {
    deals: l.length,
    installed: l.filter((r) => r.isInstalled).length,
    backlog: l.filter((r) => !r.isInstalled).length,
    contractCents: sumCents(l.map((r) => r.priceCents)),
    feesCents: sumCents(l.map((r) => r.feesCents)),
    netRevenueCents: sumCents(l.map((r) => r.netRevenueCents)),
    collectedCents: sumCents(l.map((r) => r.collectedCents)),
    receivablesCents: sumCents(receivables(l, asOf).map((x) => x.amountCents)),
    backlogCents: sumCents(l.filter((r) => !r.isInstalled).map((r) => r.priceCents)),
    payableNowCents: sumCents(pay.filter((p) => p.payable).map((p) => p.amountCents)),
    payableLaterCents: sumCents(pay.filter((p) => !p.payable).map((p) => p.amountCents)),
    netProfitCents: sumCents(costed.map((r) => r.netProfitCents!)),
    costedDeals: costed.length,
    dealsWithIssues: l.filter((r) => r.issues.length > 0).length,
  };
}
