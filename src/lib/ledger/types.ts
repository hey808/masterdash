import type { Cents } from "../money";

export type PayoutKind = "closer" | "override" | "setter" | "canvasser" | "installer";
export const PAYOUT_KINDS: PayoutKind[] = ["closer", "override", "setter", "canvasser", "installer"];

export interface Person {
  id: string;
  name: string;
}

export interface DealLine {
  skuCode: string;
  qty: number;
  unitCostCents: Cents;
}

export interface Payment {
  /** Row id; absent only in hand-built test fixtures. */
  id?: string;
  source: "customer" | "lender";
  method: string;
  amountCents: Cents;
  feeCents: Cents;
  receivedOn: string | null;
}

export interface Payout {
  id?: string;
  kind: PayoutKind;
  personId: string | null;
  amountCents: Cents;
  paidOn: string | null;
}

/** A deal as stored: typed facts plus stamped rates. Nothing derived. */
export interface Deal {
  id: string;
  number: number;
  /** Row version for optimistic concurrency; bumps on every write. */
  version: number;
  location: string; // location slug
  customerName: string;
  customerAddress: string | null;
  saleDate: string; // yyyy-mm-dd
  leadSource: string | null;
  externalRef: string | null;

  closer: Person | null;
  manager: Person | null;
  setter: Person | null;
  canvasser: Person | null;
  installer: Person | null;

  priceCents: Cents;
  cashPortionCents: Cents;
  financedPortionCents: Cents;
  splitException: string | null;
  lender: string | null;

  lenderRate: number;
  commissionRate: number;
  commissionRateSource: "plan" | "override";
  managerRate: number;
  setterRate: number;
  canvasserRate: number;
  adminFeeCents: Cents;
  extrasCents: Cents;
  installerPayCents: Cents | null;

  loanInterestOverrideCents: Cents | null;
  cardFeeOverrideCents: Cents | null;
  fundingExpectedOverrideCents: Cents | null;
  cogsOverrideCents: Cents | null;
  overrideReason: string | null;

  installScheduledOn: string | null;
  installedOn: string | null;
  cancelledAt: string | null;
  closedAt: string | null;
  note: string | null;

  lines: DealLine[];
  payments: Payment[];
  payouts: Payout[];
}

export type Stage = "cancelled" | "sold" | "installed" | "collected" | "closed";

/** Earned / paid / owed for one payout kind on one deal. */
export interface PayoutPosition {
  kind: PayoutKind;
  person: Person | null;
  earnedCents: Cents;
  paidCents: Cents;
  /** earned − paid. Negative = overpaid. */
  openCents: Cents;
  /** Whether the open amount can be paid now (money in / install done). */
  payable: boolean;
  waitingOn: string | null;
}

export interface DerivedDeal extends Deal {
  stage: Stage;
  isInstalled: boolean;
  /** Revenue month (yyyy-mm): the install month. Null until installed. */
  revenueMonth: string | null;
  saleMonth: string;

  loanInterestCents: Cents;
  cardFeeCents: Cents;
  feesCents: Cents;
  netRevenueCents: Cents;

  cashCollectedCents: Cents;
  fundedCents: Cents;
  collectedCents: Cents;
  cashDueCents: Cents;
  fundingExpectedCents: Cents;
  fundingDueCents: Cents;
  balanceCents: Cents;
  splitDiffCents: Cents;

  commissionBaseCents: Cents;
  commissionCents: Cents;
  managerOverrideCents: Cents;
  setterCommissionCents: Cents;
  canvasserCommissionCents: Cents;
  salesCompCents: Cents;

  cogsCents: Cents | null;
  isCosted: boolean;
  netProfitCents: Cents | null;
  margin: number | null;

  payoutPositions: PayoutPosition[];
  issues: string[];
}
