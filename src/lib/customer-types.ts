/** A customer profile as sent to the browser (ledger popup and the profile page). No server imports. */
export type TimelineKind =
  | "appointment"
  | "disposition"
  | "sale"
  | "agreement"
  | "signed"
  | "payment"
  | "funding"
  | "install-scheduled"
  | "installed"
  | "install-outcome"
  | "payout"
  | "cancelled"
  | "note";

export interface TimelineItem {
  at: string; // ISO, or yyyy-mm-dd for date-only events
  kind: TimelineKind;
  title: string;
  detail?: string | null;
  who?: string | null;
  href?: string | null;
  future?: boolean;
}

export interface CustomerProfile {
  key: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  location: string | null;
  contactUrl: string | null;
  deal: {
    id: string;
    number: number;
    stage: string;
    stageLabel: string;
    saleDate: string;
    closer: string | null;
    setter: string | null;
    installer: string | null;
    installScheduledOn: string | null;
    installedOn: string | null;
    priceCents: number;
    cashCents: number;
    cardCents: number;
    financedCents: number;
    lender: string | null;
    collectedCents: number;
    customerOwesCents: number;
    lenderOwesCents: number;
    lenderFeeCents: number;
    soap: boolean;
    maintenanceArrCents: number;
    netProfitCents: number | null;
    note: string | null;
    issues: string[];
  } | null;
  equipment: Array<{ name: string; qty: number; installed: boolean }>;
  agreements: Array<{ id: string; number: string; status: "sent" | "signed" | "void"; createdAt: string; signedAt: string | null; priceCents: number; pdf: string }>;
  timeline: TimelineItem[];
  /** Office-only figures (profit, payouts) are left out for reps. */
  full: boolean;
}

export interface CustomerRow {
  key: string;
  name: string;
  phone: string | null;
  location: string | null;
  dealNumber: number | null;
  stageLabel: string | null;
  priceCents: number | null;
  saleDate: string | null;
  closer: string | null;
  agreement: "sent" | "signed" | "void" | null;
}
