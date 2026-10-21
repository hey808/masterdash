/**
 * Reads the ledger out of Postgres as stored Deals. The only place SQL for
 * the ledger lives; every page and report calls loadDeals() then derive().
 */
import type pg from "pg";
import { db } from "../db";
import { derive } from "./derive";
import type { Deal, DerivedDeal, Person } from "./types";

const LEDGER_SQL = `
select d.*,
  l.slug as location_slug,
  le.name as lender_name,
  (select jsonb_build_object('id', p.id, 'name', p.name) from people p where p.id = d.closer_id)    as closer,
  (select jsonb_build_object('id', p.id, 'name', p.name) from people p where p.id = d.manager_id)   as manager,
  (select jsonb_build_object('id', p.id, 'name', p.name) from people p where p.id = d.setter_id)    as setter,
  (select jsonb_build_object('id', p.id, 'name', p.name) from people p where p.id = d.canvasser_id) as canvasser,
  (select jsonb_build_object('id', p.id, 'name', p.name) from people p where p.id = d.installer_id) as installer,
  coalesce((select jsonb_agg(jsonb_build_object('skuCode', x.sku_code, 'qty', x.qty, 'unitCostCents', x.unit_cost_cents) order by x.sort)
            from deal_lines x where x.deal_id = d.id), '[]') as lines,
  coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'source', x.source, 'method', x.method, 'amountCents', x.amount_cents,
                                                'feeCents', x.fee_cents, 'receivedOn', x.received_on) order by x.received_on nulls first)
            from payments x where x.deal_id = d.id), '[]') as payments,
  coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'personId', x.person_id, 'amountCents', x.amount_cents,
                                                'paidOn', x.paid_on, 'payRun', x.pay_run) order by x.paid_on nulls first)
            from payouts x where x.deal_id = d.id), '[]') as payouts
from deals d
join locations l on l.id = d.location_id
left join lenders le on le.id = d.lender_id`;
const ORDER = " order by d.number desc";

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? null : String(v));
const n = (v: unknown) => (v == null ? null : Number(v));
const ts = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));

export function rowToDeal(r: Row): Deal {
  return {
    id: String(r.id),
    number: Number(r.number),
    version: Number(r.version),
    location: String(r.location_slug),
    customerName: String(r.customer_name),
    customerAddress: s(r.customer_address),
    saleDate: String(r.sale_date),
    leadSource: s(r.lead_source),
    externalRef: s(r.external_ref),
    closer: (r.closer as Person | null) ?? null,
    manager: (r.manager as Person | null) ?? null,
    setter: (r.setter as Person | null) ?? null,
    canvasser: (r.canvasser as Person | null) ?? null,
    installer: (r.installer as Person | null) ?? null,
    priceCents: Number(r.price_cents),
    cashPortionCents: Number(r.cash_portion_cents),
    cardPortionCents: Number(r.card_portion_cents ?? 0),
    soap: !!r.soap,
    maintenanceArrCents: Number(r.maintenance_arr_cents ?? 0),
    financedPortionCents: Number(r.financed_portion_cents),
    splitException: s(r.split_exception),
    lender: s(r.lender_name),
    lenderRate: Number(r.lender_rate),
    commissionRate: Number(r.commission_rate),
    commissionRateSource: r.commission_rate_source === "override" ? "override" : "plan",
    managerRate: Number(r.manager_rate),
    setterRate: Number(r.setter_rate),
    canvasserRate: Number(r.canvasser_rate),
    adminFeeCents: Number(r.admin_fee_cents),
    extrasCents: Number(r.extras_cents),
    installerPayCents: n(r.installer_pay_cents),
    loanInterestOverrideCents: n(r.loan_interest_override_cents),
    cardFeeOverrideCents: n(r.card_fee_override_cents),
    fundingExpectedOverrideCents: n(r.funding_expected_override_cents),
    cogsOverrideCents: n(r.cogs_override_cents),
    overrideReason: s(r.override_reason),
    installScheduledOn: s(r.install_scheduled_on),
    installedOn: s(r.installed_on),
    cancelledAt: ts(r.cancelled_at),
    cancelReason: (r.cancel_reason as string | null) ?? null,
    closedAt: ts(r.closed_at),
    note: s(r.note),
    lines: r.lines as Deal["lines"],
    payments: r.payments as Deal["payments"],
    payouts: r.payouts as Deal["payouts"],
  };
}

export async function loadDeals(client: pg.Pool | pg.PoolClient = db()): Promise<Deal[]> {
  const { rows } = await client.query(LEDGER_SQL + ORDER);
  return rows.map(rowToDeal);
}

export async function loadDeal(id: string, client: pg.Pool | pg.PoolClient = db()): Promise<Deal | null> {
  const { rows } = await client.query(LEDGER_SQL + " where d.id = $1", [id]);
  return rows[0] ? rowToDeal(rows[0]) : null;
}

export async function loadLedger(asOf: string, client?: pg.Pool | pg.PoolClient): Promise<DerivedDeal[]> {
  return (await loadDeals(client)).map((d) => derive(d, asOf));
}
