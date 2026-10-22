/**
 * Permanently delete a deal (office only). Its payments, payouts and products
 * go with it (foreign keys cascade); form submissions, customer agreements and
 * appointment outcomes stay as history, unlinked from the deal. The audit log
 * keeps the deleted rows (before-images), actor and time.
 *
 * Prefer cancelling: it keeps the history and can be undone. Delete is for
 * deals that shouldn't exist at all (duplicates, tests, entered by mistake).
 */
import { z } from "zod";
import { tx } from "../db";
import { EditError } from "./edit";

export interface DeleteImpact {
  number: number;
  customer: string;
  payments: number;
  paymentsCents: number;
  payouts: number;
  payoutsCents: number;
  products: number;
  agreements: number;
  forms: number;
  installed: boolean;
}

async function impact(c: { query: (q: string, p: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> }, id: string): Promise<DeleteImpact | null> {
  const r = (
    await c.query(
      `select d.number, d.customer_name, d.installed_on is not null as installed,
              (select count(*) from payments x where x.deal_id = d.id) as payments,
              (select coalesce(sum(amount_cents), 0) from payments x where x.deal_id = d.id) as payments_cents,
              (select count(*) from payouts x where x.deal_id = d.id) as payouts,
              (select coalesce(sum(amount_cents), 0) from payouts x where x.deal_id = d.id) as payouts_cents,
              (select coalesce(sum(qty), 0) from deal_lines x where x.deal_id = d.id) as products,
              (select count(*) from form_submissions x where x.deal_id = d.id) as forms,
              (select count(*) from agreements x where x.deal_id = d.id) as agreements
       from deals d where d.id = $1`,
      [id],
    )
  ).rows[0];
  if (!r) return null;
  return {
    number: Number(r.number),
    customer: String(r.customer_name),
    installed: !!r.installed,
    payments: Number(r.payments),
    paymentsCents: Number(r.payments_cents),
    payouts: Number(r.payouts),
    payoutsCents: Number(r.payouts_cents),
    products: Number(r.products),
    agreements: Number(r.agreements),
    forms: Number(r.forms),
  };
}

const Input = z.object({ confirm: z.union([z.number().int(), z.string().regex(/^\s*#?\d+\s*$/)]) });

/** `confirm` must be the deal's number, typed by the person deleting it. */
export async function deleteDeal(id: string, input: unknown, actor: string): Promise<DeleteImpact> {
  if (!z.string().uuid().safeParse(id).success) throw new EditError("Unknown deal.", 404);
  const p = Input.safeParse(input);
  if (!p.success) throw new EditError("Type the deal number to confirm.", 400);
  const typed = Number(String(p.data.confirm).replace(/[#\s]/g, ""));
  return tx(actor, async (c) => {
    const lock = await c.query("select number from deals where id = $1 for update", [id]);
    if (!lock.rows[0]) throw new EditError("That deal was already deleted.", 404);
    if (Number(lock.rows[0].number) !== typed) throw new EditError(`That's not this deal's number. Type ${lock.rows[0].number} to delete it.`, 400);
    const before = (await impact(c, id))!;
    await c.query("delete from deals where id = $1", [id]);
    return before;
  });
}

export async function deleteImpact(id: string): Promise<DeleteImpact | null> {
  if (!z.string().uuid().safeParse(id).success) return null;
  const { db } = await import("../db");
  return impact(db(), id);
}
