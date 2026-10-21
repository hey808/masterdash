/**
 * The Friday pay run.
 *
 * Commissions are paid every Friday. A pay run on Friday F covers the
 * previous Friday (F − 7) through Thursday (F − 1); the cutoff is Thursday
 * at midnight, Eastern. A payout is owed once the install is done AND the
 * money is collected. A run pays exactly the lines that crossed that line
 * during its week: no carryovers (Cade, 2026-10-20). Payouts recorded
 * F through F + 6 belong to run F.
 *
 * Pure: stored Deals in, the run out. Dates are yyyy-mm-dd strings in ET.
 */
import { sumCents, type Cents } from "../money";
import { SETTLED_CENTS, derive } from "./derive";
import type { Deal, DerivedDeal, Payment, Payout, PayoutKind } from "./types";

/* ── Dates ───────────────────────────────────────────────────────────── */

const toUTC = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
export const addDays = (d: string, n: number): string => new Date(toUTC(d) + n * 86_400_000).toISOString().slice(0, 10);
const weekday = (d: string) => new Date(toUTC(d)).getUTCDay(); // 0 Sun … 5 Fri

export const isFriday = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && weekday(d) === 5;

/** The pay run a day belongs to: today if Friday, otherwise the coming Friday. */
export function payDateFor(today: string): string {
  return addDays(today, (5 - weekday(today) + 7) % 7);
}

export interface PayWeek {
  payDate: string; // Friday the run is paid
  start: string; // previous Friday, first day of collections counted
  cutoff: string; // Thursday; collections through end of this day count
  runEnd: string; // last day a payout still counts toward this run
}

export function payWeek(payDate: string): PayWeek {
  return { payDate, start: addDays(payDate, -7), cutoff: addDays(payDate, -1), runEnd: addDays(payDate, 6) };
}

const within = (d: string | null, from: string, to: string) => d != null && d >= from && d <= to;

/** The Friday on or before a day. */
const fridayOnOrBefore = (d: string) => addDays(d, -((weekday(d) - 5 + 7) % 7));

/** The pay run a payout belongs to: the one it was recorded against, else the Friday on or before it was paid. Undated = before every run. */
export const runOf = (p: Pick<Payout, "paidOn" | "payRun">): string | null => p.payRun ?? (p.paidOn ? fridayOnOrBefore(p.paidOn) : null);

/* ── The run ─────────────────────────────────────────────────────────── */

export const KINDS: PayoutKind[] = ["closer", "override", "setter", "canvasser", "installer"];

export interface RunLine {
  dealId: string;
  dealNumber: number;
  customer: string;
  location: string;
  kind: PayoutKind;
  personId: string | null;
  person: string;
  /** Owed going into this run: earned − paid before Friday. */
  dueCents: Cents;
  /** Recorded as paid in this run (Friday through the next Thursday). */
  paidThisRunCents: Cents;
  /** dueCents − paidThisRunCents. */
  remainingCents: Cents;
  /** Always true for lines owed in this run; false only for a payout recorded in this run against an older line. */
  isNew: boolean;
  /** What completed it this week: the install or the payment that finished the money. */
  unlockedBy: string | null;
  payoutIds: string[]; // payouts recorded in this run, for undo
}

export interface Collection {
  dealId: string;
  dealNumber: number;
  customer: string;
  location: string;
  payment: Payment;
  /** True once this payment completed the deal's money (commissions unlocked). */
  completesDeal: boolean;
}

export interface WaitingLine {
  dealId: string;
  dealNumber: number;
  customer: string;
  kind: PayoutKind;
  person: string;
  openCents: Cents;
  waitingOn: string | null;
}

export interface PayRun {
  week: PayWeek;
  lines: RunLine[];
  collections: Collection[];
  waiting: WaitingLine[];
  totals: {
    collectedCents: Cents;
    newlyPayableCents: Cents;
    dueCents: Cents;
    paidThisRunCents: Cents;
    remainingCents: Cents;
    waitingCents: Cents;
  };
  /** Payments/payouts with no date (imported). Counted as having happened before this run. */
  undatedPayments: number;
  undatedPayouts: number;
}

/** The deal as it stood at a cutoff: only money received and installs done by then. */
function asOf(d: Deal, cutoff: string, payoutsBefore: string): Deal {
  return {
    ...d,
    payments: d.payments.filter((p) => p.receivedOn == null || p.receivedOn <= cutoff),
    payouts: d.payouts.filter((p) => { const r = runOf(p); return r == null || r < payoutsBefore; }),
    installedOn: d.installedOn && d.installedOn <= cutoff ? d.installedOn : null,
    closedAt: null, // sign-off doesn't change what's owed
  };
}

export function buildPayRun(deals: Deal[], payDate: string): PayRun {
  const week = payWeek(payDate);
  const prev = payWeek(addDays(payDate, -7));
  const lines: RunLine[] = [];
  const collections: Collection[] = [];
  const waiting: WaitingLine[] = [];
  let undatedPayments = 0;
  let undatedPayouts = 0;

  for (const d of deals) {
    if (d.cancelledAt) continue;
    undatedPayments += d.payments.filter((p) => p.receivedOn == null).length;
    undatedPayouts += d.payouts.filter((p) => p.paidOn == null).length;

    const now: DerivedDeal = derive(asOf(d, week.cutoff, week.payDate), week.cutoff);
    const before: DerivedDeal = derive(asOf(d, prev.cutoff, prev.payDate), prev.cutoff);

    // Money collected during the week.
    const inWeek = d.payments.filter((p) => within(p.receivedOn, week.start, week.cutoff)).sort((a, b) => (a.receivedOn! < b.receivedOn! ? -1 : 1));
    for (const p of inWeek) {
      const upTo = derive(asOf(d, p.receivedOn!, week.payDate), p.receivedOn!);
      const dayBefore = derive(asOf(d, addDays(p.receivedOn!, -1), week.payDate), addDays(p.receivedOn!, -1));
      const settled = (x: DerivedDeal) => x.cashDueCents <= SETTLED_CENTS && x.fundingDueCents <= SETTLED_CENTS;
      collections.push({
        dealId: d.id, dealNumber: d.number, customer: d.customerName, location: d.location, payment: p,
        completesDeal: settled(upTo) && !settled(dayBefore),
      });
    }

    for (const pos of now.payoutPositions) {
      if (pos.openCents <= SETTLED_CENTS) continue;
      if (!pos.payable) {
        waiting.push({ dealId: d.id, dealNumber: d.number, customer: d.customerName, kind: pos.kind, person: pos.person?.name ?? "Unassigned", openCents: pos.openCents, waitingOn: pos.waitingOn });
        continue;
      }
      const prevPos = before.payoutPositions.find((x) => x.kind === pos.kind);
      const isNew = !prevPos || !prevPos.payable;
      if (!isNew) continue; // no carryovers: only what became payable this week
      const runPayouts = d.payouts.filter((p) => p.kind === pos.kind && runOf(p) === week.payDate);
      const paidThisRun = sumCents(runPayouts.map((p) => p.amountCents));
      const lastIn = inWeek.at(-1);
      lines.push({
        dealId: d.id,
        dealNumber: d.number,
        customer: d.customerName,
        location: d.location,
        kind: pos.kind,
        personId: pos.person?.id ?? null,
        person: pos.person?.name ?? "Unassigned",
        dueCents: pos.openCents,
        paidThisRunCents: paidThisRun,
        remainingCents: pos.openCents - paidThisRun,
        isNew,
        unlockedBy:
          lastIn && (!d.installedOn || d.installedOn <= lastIn.receivedOn!)
            ? `${lastIn.source === "lender" ? (d.lender ?? "lender") + " funded" : "customer paid in full"} ${lastIn.receivedOn}`
            : `installed ${d.installedOn}`,
        payoutIds: runPayouts.map((p) => p.id).filter((x): x is string => !!x),
      });
    }

    // Lines that were due before this run and got paid in it still belong on the sheet.
    for (const k of KINDS) {
      if (lines.some((l) => l.dealId === d.id && l.kind === k)) continue;
      const runPayouts = d.payouts.filter((p) => p.kind === k && runOf(p) === week.payDate);
      if (!runPayouts.length) continue;
      const pos = now.payoutPositions.find((x) => x.kind === k);
      const paid = sumCents(runPayouts.map((p) => p.amountCents));
      lines.push({
        dealId: d.id, dealNumber: d.number, customer: d.customerName, location: d.location, kind: k,
        personId: pos?.person?.id ?? null, person: pos?.person?.name ?? "Unassigned",
        dueCents: paid, paidThisRunCents: paid, remainingCents: 0, isNew: false, unlockedBy: null,
        payoutIds: runPayouts.map((p) => p.id).filter((x): x is string => !!x),
      });
    }
  }

  lines.sort((a, b) => a.person.localeCompare(b.person) || Number(b.isNew) - Number(a.isNew) || b.dueCents - a.dueCents);
  collections.sort((a, b) => (a.payment.receivedOn! < b.payment.receivedOn! ? -1 : 1));
  const total = (xs: RunLine[], f: (l: RunLine) => Cents) => sumCents(xs.map(f));
  return {
    week,
    lines,
    collections,
    waiting,
    totals: {
      collectedCents: sumCents(collections.map((c) => c.payment.amountCents)),
      newlyPayableCents: total(lines.filter((l) => l.isNew), (l) => l.dueCents),
      dueCents: total(lines, (l) => l.dueCents),
      paidThisRunCents: total(lines, (l) => l.paidThisRunCents),
      remainingCents: total(lines, (l) => Math.max(0, l.remainingCents)),
      waitingCents: sumCents(waiting.map((w) => w.openCents)),
    },
    undatedPayments,
    undatedPayouts,
  };
}
