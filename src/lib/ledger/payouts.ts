/**
 * Commissions payable: every payout line the ledger says someone has
 * earned, grouped by person. Pure, from DerivedDeal rows only.
 */
import { sumCents, type Cents } from "../money";
import { SETTLED_CENTS } from "./derive";
import type { DerivedDeal, PayoutKind } from "./types";

export const KIND_LABEL: Record<PayoutKind, string> = {
  closer: "Closer commission",
  override: "Manager override",
  setter: "Setter commission",
  canvasser: "Canvasser commission",
  installer: "Installer pay",
};

export type LineStatus = "payable" | "waiting" | "paid" | "overpaid";

export interface PayoutLine {
  dealId: string;
  dealNumber: number;
  customer: string;
  location: string;
  saleDate: string;
  installedOn: string | null;
  kind: PayoutKind;
  person: string;
  baseCents: Cents | null;
  rate: number | null;
  earnedCents: Cents;
  paidCents: Cents;
  openCents: Cents;
  status: LineStatus;
  waitingOn: string | null;
}

export interface PersonPayables {
  person: string;
  kinds: PayoutKind[];
  payableNowCents: Cents;
  waitingCents: Cents;
  paidCents: Cents;
  earnedCents: Cents;
  lines: PayoutLine[];
}

const rateFor = (r: DerivedDeal, k: PayoutKind): number | null =>
  k === "closer" ? r.commissionRate : k === "override" ? r.managerRate : k === "setter" ? r.setterRate : k === "canvasser" ? r.canvasserRate : null;

export function payoutLines(rows: DerivedDeal[]): PayoutLine[] {
  const out: PayoutLine[] = [];
  for (const r of rows) {
    if (r.stage === "cancelled") continue;
    for (const p of r.payoutPositions) {
      const status: LineStatus =
        p.openCents < -SETTLED_CENTS ? "overpaid" : p.openCents <= SETTLED_CENTS ? "paid" : p.payable ? "payable" : "waiting";
      out.push({
        dealId: r.id,
        dealNumber: r.number,
        customer: r.customerName,
        location: r.location,
        saleDate: r.saleDate,
        installedOn: r.installedOn,
        kind: p.kind,
        person: p.person?.name ?? "Unassigned",
        baseCents: p.kind === "installer" ? null : r.commissionBaseCents,
        rate: rateFor(r, p.kind),
        earnedCents: p.earnedCents,
        paidCents: p.paidCents,
        openCents: p.openCents,
        status,
        waitingOn: status === "waiting" ? p.waitingOn : null,
      });
    }
  }
  return out;
}

export function byPerson(lines: PayoutLine[]): PersonPayables[] {
  const m = new Map<string, PayoutLine[]>();
  for (const l of lines) m.set(l.person, [...(m.get(l.person) ?? []), l]);
  return [...m.entries()]
    .map(([person, ls]) => ({
      person,
      kinds: [...new Set(ls.map((l) => l.kind))],
      payableNowCents: sumCents(ls.filter((l) => l.status === "payable").map((l) => l.openCents)),
      waitingCents: sumCents(ls.filter((l) => l.status === "waiting").map((l) => l.openCents)),
      paidCents: sumCents(ls.map((l) => l.paidCents)),
      earnedCents: sumCents(ls.map((l) => l.earnedCents)),
      lines: ls.sort((a, b) => order(a.status) - order(b.status) || b.saleDate.localeCompare(a.saleDate)),
    }))
    .sort((a, b) => b.payableNowCents - a.payableNowCents || b.waitingCents - a.waitingCents || a.person.localeCompare(b.person));
}

const order = (s: LineStatus) => ({ overpaid: 0, payable: 1, waiting: 2, paid: 3 })[s];
