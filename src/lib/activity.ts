/**
 * Activity feed: what came in through the forms and what changed in the
 * warehouses, newest first.
 *
 *   sale / install    form_submissions (joined to the deal as it is now)
 *   po_ordered        purchase_orders.created_at
 *   po_received/cancelled  the audit_log row where the status flipped
 *   adjustment        inventory_adjustments (shelf counts and write-offs)
 */
import { db } from "./db";

export type ActivityKind = "sale" | "install" | "payout" | "po_ordered" | "po_received" | "po_cancelled" | "adjustment";
export const FORM_KINDS: ActivityKind[] = ["sale", "install", "payout"];
export const INVENTORY_KINDS: ActivityKind[] = ["po_ordered", "po_received", "po_cancelled", "adjustment"];

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  at: string; // ISO timestamp
  location: string | null;
  who: string | null;
  dealId: string | null;
  dealNumber: number | null;
  customer: string | null;
  amountCents: number | null;
  /** Units moved, e.g. "2× WH, 1× RO" or "WH +3". */
  items: string | null;
  poNumber: number | null;
  vendor: string | null;
  detail: string | null;
}

const SQL = `
with
sale_install as (
  select fs.id::text as id, fs.kind, fs.created_at as at, l.name as location, p.name as who,
         d.id::text as deal_id, d.number as deal_number, d.customer_name as customer,
         case fs.kind when 'sale' then d.price_cents
                      when 'payout' then (fs.payload ->> 'totalCents')::bigint
                      else nullif((fs.payload #>> '{collected,amountCents}')::bigint, 0) end as amount_cents,
         case when fs.kind = 'payout' then
                jsonb_array_length(fs.payload -> 'lines') || ' deal' || case when jsonb_array_length(fs.payload -> 'lines') = 1 then '' else 's' end
                || ' · ' || (fs.payload ->> 'method') || coalesce(' ' || nullif(fs.payload ->> 'reference', ''), '')
              else (select string_agg(dl.qty || '× ' || dl.sku_code, ', ' order by dl.sku_code) from deal_lines dl where dl.deal_id = d.id) end as items,
         null::bigint as po_number, null::text as vendor,
         nullif(trim(fs.payload ->> 'note'), '') as detail
  from form_submissions fs
  left join deals d on d.id = fs.deal_id
  left join locations l on l.id = d.location_id
  left join people p on p.id = fs.submitted_by
),
po_lines as (
  select po_id, string_agg(qty || '× ' || sku_code, ', ' order by sku_code) as items, sum(qty * unit_cost_cents) as total
  from purchase_order_lines group by po_id
),
po_events as (
  select po.id::text || ':ordered' as id, 'po_ordered' as kind, po.created_at as at, l.name as location, null::text as who,
         null::text, null::bigint, null::text, pl.total, pl.items, po.number, po.vendor, po.note
  from purchase_orders po join locations l on l.id = po.location_id left join po_lines pl on pl.po_id = po.id
  union all
  select po.id::text || ':' || (a.after ->> 'status') || ':' || a.id, 'po_' || (a.after ->> 'status'), a.at, l.name, null::text,
         null::text, null::bigint, null::text, pl.total, pl.items, po.number, po.vendor, null::text
  from audit_log a
  join purchase_orders po on po.id::text = a.row_id
  join locations l on l.id = po.location_id
  left join po_lines pl on pl.po_id = po.id
  where a.table_name = 'purchase_orders' and a.action = 'update'
    and (a.after ->> 'status') in ('received', 'cancelled')
    and (a.before ->> 'status') is distinct from (a.after ->> 'status')
),
adjustments as (
  select ia.id::text, 'adjustment', ia.created_at, l.name, null::text,
         null::text, null::bigint, null::text, null::bigint,
         ia.sku_code || ' ' || case when ia.qty_delta > 0 then '+' else '' end || ia.qty_delta,
         null::bigint, null::text,
         ia.reason || coalesce(': ' || nullif(trim(ia.note), ''), '')
  from inventory_adjustments ia join locations l on l.id = ia.location_id
)
select * from (
  select * from sale_install
  union all select * from po_events
  union all select * from adjustments
) x
where ($1::text[] is null or kind = any($1))
  and ($2::text is null or location = (select name from locations where slug = $2))
order by at desc
limit $3`;

export async function loadActivity(opts: { kinds?: ActivityKind[] | null; location?: string | null; limit?: number } = {}): Promise<ActivityItem[]> {
  const { rows } = await db().query(SQL, [opts.kinds ?? null, opts.location ?? null, opts.limit ?? 300]);
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    at: r.at instanceof Date ? r.at.toISOString() : String(r.at),
    location: r.location,
    who: r.who,
    dealId: r.deal_id,
    dealNumber: r.deal_number == null ? null : Number(r.deal_number),
    customer: r.customer,
    amountCents: r.amount_cents == null ? null : Number(r.amount_cents),
    items: r.items,
    poNumber: r.po_number == null ? null : Number(r.po_number),
    vendor: r.vendor,
    detail: r.detail,
  }));
}
