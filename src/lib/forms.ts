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
import { tx } from "./db";
import { EditError } from "./ledger/edit";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date");
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
    lender: z.string().min(1).nullable(),
    deposit: z.object({ amountCents: cents.refine((n) => n > 0, "Deposit amount must be more than $0"), method }).nullable(),
    installScheduledOn: date.nullable(),
    note: optText,
  })
  .superRefine((v, ctx) => {
    if (v.financedPortionCents > v.priceCents) ctx.addIssue({ code: "custom", path: ["financedPortionCents"], message: "Financed can't be more than the price" });
    if (v.financedPortionCents > 0 && !v.lender) ctx.addIssue({ code: "custom", path: ["lender"], message: "Pick the lender for the financed amount" });
    if (v.deposit && v.deposit.amountCents > v.priceCents - v.financedPortionCents)
      ctx.addIssue({ code: "custom", path: ["deposit"], message: "Deposit is more than the cash portion" });
    if (v.installScheduledOn && v.installScheduledOn < v.saleDate) ctx.addIssue({ code: "custom", path: ["installScheduledOn"], message: "Install can't be scheduled before the sale" });
  });

export const InstallForm = z.object({
  dealId: uuid,
  installerId: uuid,
  installedOn: date,
  collected: z.object({ amountCents: cents.refine((n) => n > 0, "Amount must be more than $0"), method }).nullable(),
  note: optText,
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
         install_scheduled_on, note)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
       returning id, number`,
      [
        loc.id, v.customerName, v.customerAddress, v.customerPhone, v.customerEmail, v.saleDate, v.leadSource,
        v.closerId, manager?.id ?? null, v.setterId ?? null, v.priceCents, v.priceCents - v.financedPortionCents, v.financedPortionCents, lenderId,
        plan.id, lenderRate, rate, isManagerOwnDeal ? 0 : Number(plan.manager_rate), v.setterId ? Number(plan.setter_rate) : 0,
        Number(plan.canvasser_rate), Number(plan.admin_fee_cents), v.installScheduledOn, v.note,
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
    return { id: d.id as string, number: Number(d.number) };
  });
}
