/**
 * The ledger math. Pure: a stored Deal in, a DerivedDeal out. Every money
 * figure in the app comes from here, so there is exactly one answer.
 *
 * Kept from Mission Control (docs/deal-ledger-spec.md there):
 *   - the lender's fee is charged on the financed portion only
 *   - net profit subtracts the fee in dollars, not the rate
 *   - balance is price − collected (the lender funds against the gross ticket)
 *   - the admin fee comes off the commission base but the company keeps it
 *
 * Changed:
 *   - integer cents throughout
 *   - rates are read from the deal (stamped at sale), never from today's plan
 *   - collected is the sum of payment rows; paid is the sum of payout rows
 *   - revenue is recognized in the install month
 */
import { applyRate, sumCents, type Cents } from "../money";
import type { Deal, DerivedDeal, PayoutKind, PayoutPosition, Person, Stage } from "./types";

/** Tolerance for "settled": half a dollar, matching Mission Control. */
export const SETTLED_CENTS = 50;

const month = (d: string) => d.slice(0, 7);

export function derive(d: Deal, asOf: string): DerivedDeal {
  const loanInterestCents = d.loanInterestOverrideCents ?? applyRate(d.financedPortionCents, d.lenderRate);
  const cardFeeCents =
    d.cardFeeOverrideCents ?? sumCents(d.payments.filter((p) => p.source === "customer").map((p) => p.feeCents));
  const feesCents = loanInterestCents + cardFeeCents;
  const netRevenueCents = d.priceCents - feesCents;

  const cashCollectedCents = sumCents(d.payments.filter((p) => p.source === "customer").map((p) => p.amountCents));
  const fundedCents = sumCents(d.payments.filter((p) => p.source === "lender").map((p) => p.amountCents));
  const collectedCents = cashCollectedCents + fundedCents;
  const cashDueCents = d.cashPortionCents - cashCollectedCents;
  const fundingExpectedCents =
    d.fundingExpectedOverrideCents ?? Math.max(0, d.financedPortionCents - loanInterestCents);
  const fundingDueCents = fundingExpectedCents - fundedCents;
  const balanceCents = d.priceCents - collectedCents;
  const splitDiffCents = d.priceCents - (d.cashPortionCents + d.financedPortionCents);

  const commissionBaseCents = netRevenueCents - d.extrasCents - d.adminFeeCents;
  const commissionCents = d.closer ? applyRate(commissionBaseCents, d.commissionRate) : 0;
  // Whether a manager earns an override on their own deal is a plan rule,
  // applied when the rate is stamped at sale; derive just honors the rate.
  const managerOverrideCents = d.manager ? applyRate(commissionBaseCents, d.managerRate) : 0;
  const setterCommissionCents = d.setter ? applyRate(commissionBaseCents, d.setterRate) : 0;
  const canvasserCommissionCents = d.canvasser ? applyRate(commissionBaseCents, d.canvasserRate) : 0;
  const salesCompCents = commissionCents + managerOverrideCents + setterCommissionCents + canvasserCommissionCents;

  const linesCost = d.lines.length ? sumCents(d.lines.map((l) => l.qty * l.unitCostCents)) : null;
  const cogsCents = d.cogsOverrideCents ?? linesCost;
  const isCosted = cogsCents != null && d.installerPayCents != null;
  // Fees (loan interest + card fee) are already out of net revenue.
  const netProfitCents =
    cogsCents != null && d.installerPayCents != null
      ? netRevenueCents - d.extrasCents - salesCompCents - cogsCents - d.installerPayCents
      : null;
  const margin = netProfitCents == null || d.priceCents === 0 ? null : netProfitCents / d.priceCents;

  const isInstalled = d.installedOn != null;
  const moneyIn = cashDueCents <= SETTLED_CENTS && fundingDueCents <= SETTLED_CENTS;
  const stage: Stage = d.cancelledAt
    ? "cancelled"
    : d.closedAt
      ? "closed"
      : isInstalled && moneyIn
        ? "collected"
        : isInstalled
          ? "installed"
          : "sold";

  const waitingForMoney =
    cashDueCents > SETTLED_CENTS
      ? `customer owes $${Math.round(cashDueCents / 100).toLocaleString("en-US")}`
      : fundingDueCents > SETTLED_CENTS
        ? `${d.lender ?? "lender"} has not funded $${Math.round(fundingDueCents / 100).toLocaleString("en-US")}`
        : null;

  const position = (kind: PayoutKind, person: Person | null, earned: Cents): PayoutPosition => {
    const paid = sumCents(d.payouts.filter((p) => p.kind === kind).map((p) => p.amountCents));
    // Nothing is paid out until the install is done AND the money is collected (Cade, 2026-10-20).
    const waitingOn = [isInstalled ? null : "install not done", waitingForMoney].filter(Boolean).join("; ") || null;
    return { kind, person, earnedCents: earned, paidCents: paid, openCents: earned - paid, payable: waitingOn == null, waitingOn };
  };
  const payoutPositions = [
    position("closer", d.closer, commissionCents),
    position("override", d.manager, managerOverrideCents),
    position("setter", d.setter, setterCommissionCents),
    position("canvasser", d.canvasser, canvasserCommissionCents),
    position("installer", d.installer, d.installerPayCents ?? 0),
  ].filter((p) => p.earnedCents !== 0 || p.paidCents !== 0);

  const issues: string[] = [];
  if (!d.cancelledAt) {
    if (!d.lines.length) issues.push(d.cogsOverrideCents != null ? "No products (cost typed by hand)" : "No products");
    if (d.installerPayCents == null) issues.push("No installer pay");
    if (!isInstalled && d.installScheduledOn && d.installScheduledOn < asOf) issues.push("Install date passed");
    if (!isInstalled && !d.installScheduledOn) issues.push("No install date");
    if (fundingDueCents < -SETTLED_CENTS) issues.push("Lender over-funded");
    if (cashDueCents < -SETTLED_CENTS) issues.push("Customer over-paid");
    if (splitDiffCents !== 0) issues.push("Cash + financed does not equal price");
    if (d.financedPortionCents > 0 && d.lenderRate === 0 && d.loanInterestOverrideCents == null) issues.push("Financed at 0% lender fee");
    if (d.commissionRate >= 0.5) issues.push("Commission rate looks wrong");
    if (payoutPositions.some((p) => p.openCents < -SETTLED_CENTS)) issues.push("Paid more than earned");
    if (d.closedAt && (cashDueCents > SETTLED_CENTS || fundingDueCents > SETTLED_CENTS)) issues.push("Closed with money still owed");
  }

  return {
    ...d,
    stage,
    isInstalled,
    revenueMonth: d.installedOn ? month(d.installedOn) : null,
    saleMonth: month(d.saleDate),
    loanInterestCents,
    cardFeeCents,
    feesCents,
    netRevenueCents,
    cashCollectedCents,
    fundedCents,
    collectedCents,
    cashDueCents,
    fundingExpectedCents,
    fundingDueCents,
    balanceCents,
    splitDiffCents,
    commissionBaseCents,
    commissionCents,
    managerOverrideCents,
    setterCommissionCents,
    canvasserCommissionCents,
    salesCompCents,
    cogsCents,
    isCosted,
    netProfitCents,
    margin,
    payoutPositions,
    issues,
  };
}
