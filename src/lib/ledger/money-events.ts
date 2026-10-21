/**
 * Money in (payments) and money out (payouts): record, re-date, remove.
 * Each call is one audited transaction. Imported history can be re-dated
 * but not deleted.
 */
import { z } from "zod";
import { tx } from "../db";
import { todayET } from "../dates";
import { SETTLED_CENTS, derive } from "./derive";
import { EditError } from "./edit";
import { loadDeal } from "./repo";
import type { DerivedDeal } from "./types";

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-10-23")
  .refine((d) => d >= "2000-01-01" && d <= "2099-12-31" && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)), "That date doesn't look right");
const uuid = z.string().uuid();

export const NewPayout = z.object({
  dealId: uuid,
  kind: z.enum(["closer", "override", "setter", "canvasser", "installer"]),
  personId: uuid.nullable(),
  amountCents: z.number().int().positive("Amount must be more than $0").max(10_000_000),
  paidOn: date,
  method: z.string().max(40).nullable().optional(),
  /** The Friday pay run this pays; omitted = go by paidOn. */
  payRun: date.refine((d) => new Date(`${d}T12:00:00Z`).getUTCDay() === 5, "Pay runs are on Fridays").nullable().optional(),
});

export const NewPayment = z.object({
  source: z.enum(["customer", "lender"]),
  method: z.enum(["cash", "check", "card", "ach", "zelle", "lender", "other"]),
  amountCents: z.number().int().refine((n) => n !== 0, "Amount can't be $0").refine((n) => Math.abs(n) <= 100_000_000, "Too large"),
  feeCents: z.number().int().min(0).max(10_000_000).default(0),
  receivedOn: date,
  note: z.string().max(500).nullable().optional(),
});

const first = (e: z.ZodError) => e.issues[0]?.message ?? "Invalid";

async function derivedDeal(id: string, c: Parameters<typeof loadDeal>[1]): Promise<DerivedDeal> {
  const d = await loadDeal(id, c);
  if (!d) throw new EditError("That deal no longer exists.", 404);
  return derive(d, todayET());
}

const KIND_WORD: Record<string, string> = { closer: "closer", override: "manager", setter: "setter", canvasser: "canvasser", installer: "installer" };
const usd = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Guard for every payout write: the deal is locked, live, the person is the one in that role,
 * and the amount isn't more than is still owed (earned − paid). Stops double payments from a
 * double click, two open tabs, or a stale page.
 */
export async function assertPayoutFits(
  c: Parameters<typeof loadDeal>[1],
  v: { dealId: string; kind: string; personId: string | null; amountCents: number },
): Promise<void> {
  const lock = await c!.query("select number, cancelled_at from deals where id = $1 for update", [v.dealId]);
  const row = lock.rows[0];
  if (!row) throw new EditError("That deal no longer exists. Reload and try again.", 404);
  if (row.cancelled_at) throw new EditError(`Deal #${row.number} is cancelled; nothing is owed on it.`, 400);
  const d = await derivedDeal(v.dealId, c);
  const pos = d.payoutPositions.find((p) => p.kind === v.kind);
  if (!pos || !pos.person) throw new EditError(`Deal #${row.number} has no ${KIND_WORD[v.kind] ?? v.kind} to pay.`, 400);
  if (pos.person.id !== v.personId) throw new EditError(`${pos.person.name} is the ${KIND_WORD[v.kind] ?? v.kind} on deal #${row.number}, not the person picked.`, 400);
  if (v.amountCents > pos.openCents + SETTLED_CENTS) {
    throw new EditError(
      pos.openCents <= SETTLED_CENTS
        ? `${pos.person.name} is already paid in full on deal #${row.number}. Reload to see the latest.`
        : `Deal #${row.number}: only ${usd(pos.openCents)} is still owed to ${pos.person.name}.`,
      409,
    );
  }
}

export async function recordPayout(input: unknown, actor: string): Promise<{ id: string }> {
  const p = NewPayout.safeParse(input);
  if (!p.success) throw new EditError(first(p.error), 400);
  const v = p.data;
  return tx(actor, async (c) => {
    await assertPayoutFits(c, v);
    const { rows } = await c.query(
      "insert into payouts (deal_id, person_id, kind, amount_cents, paid_on, method, pay_run) values ($1,$2,$3,$4,$5,$6,$7) returning id",
      [v.dealId, v.personId, v.kind, v.amountCents, v.paidOn, v.method ?? null, v.payRun ?? null],
    );
    return { id: rows[0].id as string };
  });
}

export async function removePayout(id: string, actor: string): Promise<void> {
  if (!uuid.safeParse(id).success) throw new EditError("Bad payout id", 400);
  await tx(actor, async (c) => {
    const { rows } = await c.query("select import_batch_id from payouts where id = $1 for update", [id]);
    if (!rows[0]) throw new EditError("That payout was already removed.", 404);
    if (rows[0].import_batch_id) throw new EditError("Imported payout history can't be deleted here.", 400);
    await c.query("delete from payouts where id = $1", [id]);
  });
}

export async function recordPayment(dealId: string, input: unknown, actor: string): Promise<DerivedDeal> {
  if (!uuid.safeParse(dealId).success) throw new EditError("Bad deal id", 400);
  const p = NewPayment.safeParse(input);
  if (!p.success) throw new EditError(first(p.error), 400);
  const v = p.data;
  if (v.source === "lender" && v.method !== "lender") v.method = "lender";
  return tx(actor, async (c) => {
    const deal = await c.query("select 1 from deals where id = $1 for update", [dealId]);
    if (!deal.rowCount) throw new EditError("That deal no longer exists.", 404);
    await c.query(
      "insert into payments (deal_id, source, method, amount_cents, fee_cents, received_on, note) values ($1,$2,$3,$4,$5,$6,$7)",
      [dealId, v.source, v.method, v.amountCents, v.feeCents, v.receivedOn, v.note ?? null],
    );
    await c.query("update deals set updated_at = now() where id = $1", [dealId]); // bump version
    return derivedDeal(dealId, c);
  });
}

export async function redatePayment(id: string, input: unknown, actor: string): Promise<DerivedDeal> {
  if (!uuid.safeParse(id).success) throw new EditError("Bad payment id", 400);
  const p = z.object({ receivedOn: date }).safeParse(input);
  if (!p.success) throw new EditError(first(p.error), 400);
  return tx(actor, async (c) => {
    const { rows } = await c.query("update payments set received_on = $2 where id = $1 returning deal_id", [id, p.data.receivedOn]);
    if (!rows[0]) throw new EditError("That payment no longer exists.", 404);
    await c.query("update deals set updated_at = now() where id = $1", [rows[0].deal_id]);
    return derivedDeal(rows[0].deal_id, c);
  });
}

export async function removePayment(id: string, actor: string): Promise<DerivedDeal> {
  if (!uuid.safeParse(id).success) throw new EditError("Bad payment id", 400);
  return tx(actor, async (c) => {
    const { rows } = await c.query("select deal_id, import_batch_id from payments where id = $1 for update", [id]);
    if (!rows[0]) throw new EditError("That payment was already removed.", 404);
    if (rows[0].import_batch_id) throw new EditError("Imported payment history can't be deleted. Change its date instead.", 400);
    await c.query("delete from payments where id = $1", [id]);
    await c.query("update deals set updated_at = now() where id = $1", [rows[0].deal_id]);
    return derivedDeal(rows[0].deal_id, c);
  });
}
