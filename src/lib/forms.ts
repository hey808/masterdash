/**
 * The two field forms.
 *
 *   Sales form (closer)    → creates the deal, stamps today's comp plan / lender
 *                            rates and SKU costs, allocates the products from the
 *                            location's stock, records any deposit.
 *   Installer form         → picks an EXISTING deal, marks it installed (the units
 *                            leave the warehouse), records any money collected.
 *
 * Every submission is stored as submitted in form_submissions, and every write
 * lands in the audit log under the form's actor.
 */
import { z } from "zod";
import { MAINTENANCE_PLAN } from "./agreement-terms";
import { tx } from "./db";
import { EditError } from "./ledger/edit";
import { assertPayoutFits } from "./ledger/money-events";

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date")
  .refine((d) => d >= "2000-01-01" && d <= "2099-12-31" && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)), "That date doesn't look right");
const uuid = z.string().uuid();
const cents = z.number().int().min(0).max(100_000_000_00);
const method = z.enum(["cash", "check", "card", "ach", "zelle", "other"]);
const optText = z.string().trim().max(500).optional().transform((s) => (s ? s : null));

export const SaleForm = z
  .object({
    closerId: uuid,
    setterId: uuid.nullable().optional(),
    location: z.string().regex(/^[a-z0-9-]+$/),
    customerName: z.string().trim().min(2, "Customer name is required").max(200),
    customerAddress: z.string().trim().min(5, "Service address is required").max(300),
    customerPhone: optText,
    customerEmail: z.string().trim().email("That email doesn't look right").max(200).optional().or(z.literal("")).transform((s) => (s ? s : null)),
    saleDate: date,
    leadSource: optText,
    products: z.array(z.object({ skuCode: z.string().min(1), qty: z.number().int().min(1).max(20) })).min(1, "Pick at least one product"),
    priceCents: cents.refine((n) => n > 0, "Price is required"),
    financedPortionCents: cents,
    cardPortionCents: cents.optional().default(0),
    /** The GoHighLevel appointment this sale came from (kept on the form submission). */
    appointmentId: z.string().max(64).nullable().optional(),
    soap: z.boolean().optional().default(false),
    maintenancePlan: z.boolean().optional().default(false),
    lender: z.string().min(1).nullable(),
    deposit: z.object({ amountCents: cents.refine((n) => n > 0, "Deposit amount must be more than $0"), method }).nullable(),
    installScheduledOn: z.string({ required_error: "Pick the install date", invalid_type_error: "Pick the install date" }).regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the install date"),
    note: optText,
  })
  .superRefine((v, ctx) => {
    if (v.financedPortionCents + v.cardPortionCents > v.priceCents)
      ctx.addIssue({ code: "custom", path: ["financedPortionCents"], message: "Financed plus card can't be more than the price" });
    if (v.financedPortionCents > 0 && !v.lender) ctx.addIssue({ code: "custom", path: ["lender"], message: "Pick the lender for the financed amount" });
    if (v.deposit && v.deposit.amountCents > v.priceCents - v.financedPortionCents)
      ctx.addIssue({ code: "custom", path: ["deposit"], message: "Deposit is more than the cash and card amounts" });
    if (v.installScheduledOn && v.installScheduledOn < v.saleDate) ctx.addIssue({ code: "custom", path: ["installScheduledOn"], message: "Install can't be scheduled before the sale" });
  });

export const InstallForm = z.object({
  dealId: uuid,
  installerId: uuid,
  installedOn: date,
  collected: z.object({ amountCents: cents.refine((n) => n > 0, "Amount must be more than $0"), method }).nullable(),
  note: optText,
  /** The GoHighLevel install appointment this came from. */
  appointmentId: z.string().max(64).nullable().optional(),
});

const first = (e: z.ZodError) => {
  const i = e.issues[0];
  return i?.message ?? "Check the form";
};

export async function submitSale(input: unknown): Promise<{ id: string; number: number }> {
  const p = SaleForm.safeParse(input);
  if (!p.success) throw new EditError(first(p.error), 400);
  const v = p.data;

  return tx("form:sale", async (c) => {
    const closer = (await c.query("select id, roles from people where id = $1 and active", [v.closerId])).rows[0];
    if (!closer) throw new EditError("Pick a closer from the roster.", 400);
    const loc = (await c.query("select id from locations where slug = $1", [v.location])).rows[0];
    if (!loc) throw new EditError("Unknown location.", 400);
    const plan = (await c.query("select * from comp_plan_on($1::date)", [v.saleDate])).rows[0];
    if (!plan?.id) throw new EditError("No commission plan covers that sale date.", 400);

    // The manager earns the override on everyone's deals but their own.
    const manager = (await c.query("select id from people where active and 'manager' = any(roles) order by name limit 1")).rows[0];
    const isManagerOwnDeal = manager && manager.id === v.closerId;

    let lenderId: string | null = null;
    let lenderRate = 0;
    if (v.financedPortionCents > 0 && v.lender) {
      const l = (await c.query("select id, coalesce(lender_rate_on(id, $2::date), 0) as rate from lenders where name = $1", [v.lender, v.saleDate])).rows[0];
      if (!l) throw new EditError("Unknown lender.", 400);
      lenderId = l.id;
      lenderRate = Number(l.rate);
    }

    const rate = v.priceCents >= Number(plan.tier_threshold_cents) ? Number(plan.rate_at_or_above) : Number(plan.rate_below);
    const { rows } = await c.query(
      `insert into deals (location_id, customer_name, customer_address, customer_phone, customer_email, sale_date, lead_source,
         closer_id, manager_id, setter_id, price_cents, cash_portion_cents, financed_portion_cents, lender_id,
         comp_plan_id, lender_rate, commission_rate, manager_rate, setter_rate, canvasser_rate, admin_fee_cents,
         install_scheduled_on, note, card_portion_cents, soap, maintenance_arr_cents)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
       returning id, number`,
      [
        loc.id, v.customerName, v.customerAddress, v.customerPhone, v.customerEmail, v.saleDate, v.leadSource,
        v.closerId, manager?.id ?? null, v.setterId ?? null, v.priceCents, v.priceCents - v.financedPortionCents - v.cardPortionCents, v.financedPortionCents, lenderId,
        plan.id, lenderRate, rate, isManagerOwnDeal ? 0 : Number(plan.manager_rate), v.setterId ? Number(plan.setter_rate) : 0,
        Number(plan.canvasser_rate), Number(plan.admin_fee_cents), v.installScheduledOn, v.note, v.cardPortionCents, v.soap, v.maintenancePlan ? MAINTENANCE_PLAN.priceCents : 0,
      ],
    );
    const deal = rows[0] as { id: string; number: number };

    // Products: snapshot today's cost; this is what allocates them from the location's stock.
    for (const [i, l] of v.products.entries()) {
      const cost = (await c.query("select sku_cost_on($1, $2::date) as cents", [l.skuCode, v.saleDate])).rows[0]?.cents;
      if (cost == null) throw new EditError(`${l.skuCode} has no cost on file.`, 400);
      await c.query("insert into deal_lines (deal_id, sku_code, qty, unit_cost_cents, sort) values ($1,$2,$3,$4,$5)", [deal.id, l.skuCode, l.qty, cost, i]);
    }
    if (v.deposit) {
      await c.query(
        "insert into payments (deal_id, source, method, amount_cents, received_on, note) values ($1,'customer',$2,$3,$4,'Deposit on the sales form')",
        [deal.id, v.deposit.method, v.deposit.amountCents, v.saleDate],
      );
    }
    await c.query("insert into form_submissions (kind, deal_id, submitted_by, payload) values ('sale', $1, $2, $3)", [deal.id, v.closerId, v]);
    // The appointment it came from is now closed, linked to this deal.
    if (v.appointmentId && (await c.query("select to_regclass('appointment_dispositions') is not null as ok")).rows[0]?.ok) {
      await c.query(
        `insert into appointment_dispositions (appointment_id, location_id, person_id, appointment_day, customer_name, outcome, deal_id, recorded_by)
         values ($1,$2,$3,$4,$5,'closed',$6,'form:sale')
         on conflict (appointment_id) do update set outcome = 'closed', deal_id = excluded.deal_id, reason = null, rescheduled_to = null, updated_at = now()`,
        [v.appointmentId, loc.id, v.closerId, v.saleDate, v.customerName, deal.id],
      );
    }
    return { id: deal.id, number: Number(deal.number) };
  });
}

export async function submitInstall(input: unknown): Promise<{ id: string; number: number }> {
  const p = InstallForm.safeParse(input);
  if (!p.success) throw new EditError(first(p.error), 400);
  const v = p.data;

  return tx("form:install", async (c) => {
    const d = (await c.query("select id, number, sale_date::text, installed_on, cancelled_at, note from deals where id = $1 for update", [v.dealId])).rows[0];
    if (!d) throw new EditError("Pick an existing customer from the list.", 400);
    if (d.cancelled_at) throw new EditError("That deal is cancelled.", 400);
    if (d.installed_on) throw new EditError("That job is already marked installed. Change it in the ledger if it's wrong.", 400);
    if (v.installedOn < d.sale_date) throw new EditError("Install date is before the sale date.", 400);
    const inst = (await c.query("select id, name from people where id = $1 and active", [v.installerId])).rows[0];
    if (!inst) throw new EditError("Pick an installer from the roster.", 400);

    const stamp = `Install ${v.installedOn} (${inst.name})${v.note ? `: ${v.note}` : ""}`;
    await c.query(
      "update deals set installer_id = $2, installed_on = $3, note = case when coalesce(note,'') = '' then $4 else note || E'\\n' || $4 end where id = $1",
      [v.dealId, v.installerId, v.installedOn, stamp],
    );
    if (v.collected) {
      await c.query(
        "insert into payments (deal_id, source, method, amount_cents, received_on, note) values ($1,'customer',$2,$3,$4,'Collected at install')",
        [v.dealId, v.collected.method, v.collected.amountCents, v.installedOn],
      );
    }
    await c.query("insert into form_submissions (kind, deal_id, submitted_by, payload) values ('install', $1, $2, $3)", [v.dealId, v.installerId, v]);
    // The install appointment it came from is now done, linked to the deal.
    const hasKind = (await c.query("select 1 from information_schema.columns where table_name = 'appointment_dispositions' and column_name = 'kind'")).rowCount;
    if (v.appointmentId && hasKind) {
      await c.query(
        `insert into appointment_dispositions (appointment_id, kind, location_id, person_id, appointment_day, customer_name, outcome, deal_id, recorded_by)
         select $1, 'install', d.location_id, $2, $3, d.customer_name, 'completed', d.id, 'form:install' from deals d where d.id = $4
         on conflict (appointment_id) do update set outcome = 'completed', deal_id = excluded.deal_id, reason = null, rescheduled_to = null, updated_at = now()`,
        [v.appointmentId, v.installerId, v.installedOn, v.dealId],
      );
    }
    return { id: d.id as string, number: Number(d.number) };
  });
}

/* ── Payout form ─────────────────────────────────────────────────────── */

const PAYOUT_KINDS = ["closer", "override", "setter", "canvasser", "installer"] as const;
const isFriday = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay() === 5;

const PayeeBatch = z.object({
  personId: uuid,
  method: z.enum(["check", "zelle", "cashapp", "venmo", "ach", "cash", "other"]),
  reference: optText, // check number, confirmation id
  note: optText,
  lines: z
    .array(z.object({ dealId: uuid, kind: z.enum(PAYOUT_KINDS), amountCents: cents.refine((n) => n > 0, "Each line needs an amount") }))
    .min(1, "Pick at least one deal for each person you're paying")
    .max(300),
});

export const PayoutForm = z.object({
  payRun: date.refine(isFriday, "Pay runs are on Fridays"),
  paidOn: date,
  payees: z.array(PayeeBatch).min(1, "Pick at least one person to pay").max(50),
});

/** Who a payout kind belongs to on a deal. */
const KIND_PERSON_COL: Record<(typeof PAYOUT_KINDS)[number], string> = {
  closer: "closer_id",
  override: "manager_id",
  setter: "setter_id",
  canvasser: "canvasser_id",
  installer: "installer_id",
};

export interface PayoutResult {
  people: number;
  lines: number;
  totalCents: number;
}

/**
 * A whole pay run in one go: one payment per person (method, check # / reference),
 * each split across that person's deals. Every line becomes a payout row tagged with the
 * pay run, so it shows on that Friday's run on the Commissions tab. All or nothing.
 */
export async function submitPayouts(input: unknown): Promise<PayoutResult> {
  const p = PayoutForm.safeParse(input);
  if (!p.success) throw new EditError(first(p.error), 400);
  const v = p.data;
  const seen = new Set<string>();
  for (const b of v.payees) {
    if (seen.has(b.personId)) throw new EditError("The same person is on the payout twice.", 400);
    seen.add(b.personId);
    const ls = new Set<string>();
    for (const l of b.lines) {
      const k = `${l.dealId}:${l.kind}`;
      if (ls.has(k)) throw new EditError("The same deal is on someone's payout twice.", 400);
      ls.add(k);
    }
  }
  return tx("form:payout", async (c) => {
    let total = 0;
    let lineCount = 0;
    for (const b of v.payees) {
      const person = await c.query("select name from people where id = $1", [b.personId]);
      if (!person.rowCount) throw new EditError("Someone on the payout no longer exists. Reload and try again.", 400);
      const name: string = person.rows[0].name;
      const ref = [b.method === "check" && b.reference ? `Check #${b.reference.replace(/^#/, "")}` : b.reference, b.note].filter(Boolean).join(" · ") || null;
      let personTotal = 0;
      for (const l of b.lines) {
        const d = await c.query(`select number, ${KIND_PERSON_COL[l.kind]} as person_id from deals where id = $1`, [l.dealId]);
        const row = d.rows[0];
        if (row && row.person_id !== b.personId) throw new EditError(`${name} isn't the ${l.kind} on deal #${row.number}.`, 400);
        // Locks the deal; rejects cancelled deals and anything over what's still owed.
        await assertPayoutFits(c, { dealId: l.dealId, kind: l.kind, personId: b.personId, amountCents: l.amountCents });
        await c.query(
          "insert into payouts (deal_id, person_id, kind, amount_cents, paid_on, method, note, pay_run) values ($1,$2,$3,$4,$5,$6,$7,$8)",
          [l.dealId, b.personId, l.kind, l.amountCents, v.paidOn, b.method, ref, v.payRun],
        );
        await c.query("update deals set updated_at = now() where id = $1", [l.dealId]);
        personTotal += l.amountCents;
      }
      await c.query("insert into form_submissions (kind, deal_id, submitted_by, payload) values ('payout', $1, $2, $3)", [
        b.lines.length === 1 ? b.lines[0]!.dealId : null,
        b.personId,
        { payRun: v.payRun, paidOn: v.paidOn, ...b, totalCents: personTotal },
      ]);
      total += personTotal;
      lineCount += b.lines.length;
    }
    return { people: v.payees.length, lines: lineCount, totalCents: total };
  });
}

/* ── Record funding ──────────────────────────────────────────────────── */

export const FundingForm = z.object({
  dealId: uuid,
  fundedOn: date,
  amountCents: cents.refine((n) => n > 0, "Enter what the lender sent"),
  /** What the lender kept: financed − funded, recorded in dollars when the funding hits. */
  lenderFeeCents: cents,
  reference: optText,
  note: optText,
});

/**
 * The lender's money hit the bank: a lender payment for what they sent, carrying
 * the fee they kept. Together they can't exceed the financed amount.
 */
export async function submitFunding(input: unknown): Promise<{ dealId: string; number: number }> {
  const p = FundingForm.safeParse(input);
  if (!p.success) throw new EditError(first(p.error), 400);
  const v = p.data;
  return tx("form:funding", async (c) => {
    const d = (await c.query("select id, number, financed_portion_cents, cancelled_at from deals where id = $1 for update", [v.dealId])).rows[0];
    if (!d) throw new EditError("That deal no longer exists.", 404);
    if (d.cancelled_at) throw new EditError("That deal is cancelled.", 400);
    if (Number(d.financed_portion_cents) <= 0) throw new EditError("That deal has nothing financed.", 400);
    const prior = (await c.query("select coalesce(sum(amount_cents + fee_cents), 0)::bigint as n from payments where deal_id = $1 and source = 'lender'", [v.dealId])).rows[0];
    const room = Number(d.financed_portion_cents) - Number(prior.n);
    if (v.amountCents + v.lenderFeeCents > room + 50)
      throw new EditError(`Funding plus fee is more than what's left on the loan (${(room / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })}).`, 409);
    await c.query(
      "insert into payments (deal_id, source, method, amount_cents, fee_cents, received_on, bank_ref, note) values ($1,'lender','lender',$2,$3,$4,$5,$6)",
      [v.dealId, v.amountCents, v.lenderFeeCents, v.fundedOn, v.reference, v.note ?? "Recorded on the funding form"],
    );
    // The fee recorded here replaces any fee typed by hand.
    await c.query("update deals set loan_interest_override_cents = null, updated_at = now() where id = $1", [v.dealId]);
    await c.query("insert into form_submissions (kind, deal_id, submitted_by, payload) values ('funding', $1, null, $2)", [v.dealId, v]);
    return { dealId: v.dealId, number: Number(d.number) };
  });
}
