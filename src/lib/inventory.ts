/**
 * Inventory by location.
 *
 *   on hand    = received on purchase orders + counts/adjustments − units on installed jobs
 *   committed  = units on sold jobs not installed yet (allocated by the sales form)
 *   available  = on hand − committed
 *   on order   = units on open purchase orders
 *
 * A unit leaves the warehouse when the installer form marks its job installed.
 */
import { z } from "zod";
import { db, tx } from "./db";
import { todayET } from "./dates";
import { EditError } from "./ledger/edit";
import { addDays } from "./ledger/payrun";

export interface StockRow {
  skuCode: string;
  name: string;
  unitCostCents: number;
  received: number;
  adjusted: number;
  installed: number;
  onHand: number;
  committed: number;
  available: number;
  onOrder: number;
  usedLast28: number;
  weeklyUse: number;
  weeksOfCover: number | null;
  status: "short" | "order" | "ok" | "idle";
  valueCents: number;
}

/** Order when available + on order covers fewer than this many weeks of installs. */
export const COVER_WEEKS = 3;

export function stockStatus(available: number, onOrder: number, weeklyUse: number): StockRow["status"] {
  if (available < 0) return "short";
  if (weeklyUse === 0) return available + onOrder > 0 ? "ok" : "idle";
  return available + onOrder < weeklyUse * COVER_WEEKS ? "order" : "ok";
}

/** One location's stock, or every location combined when locationSlug is null. */
export async function loadStock(locationSlug: string | null, today = todayET()): Promise<StockRow[]> {
  const since = addDays(today, -28);
  const { rows } = await db().query(
    `with loc as (select id from locations where $1::text is null or slug = $1)
     select s.code, s.name,
       coalesce(sku_cost_on(s.code, $2::date), 0) as cost,
       coalesce((select sum(pol.qty) from purchase_order_lines pol join purchase_orders po on po.id = pol.po_id
                 where pol.sku_code = s.code and po.location_id in (select id from loc) and po.status = 'received'), 0) as received,
       coalesce((select sum(pol.qty) from purchase_order_lines pol join purchase_orders po on po.id = pol.po_id
                 where pol.sku_code = s.code and po.location_id in (select id from loc) and po.status = 'ordered'), 0) as on_order,
       coalesce((select sum(a.qty_delta) from inventory_adjustments a where a.sku_code = s.code and a.location_id in (select id from loc)), 0) as adjusted,
       coalesce((select sum(dl.qty) from deal_lines dl join deals d on d.id = dl.deal_id
                 where dl.sku_code = s.code and d.location_id in (select id from loc) and d.cancelled_at is null and d.installed_on is not null), 0) as installed,
       coalesce((select sum(dl.qty) from deal_lines dl join deals d on d.id = dl.deal_id
                 where dl.sku_code = s.code and d.location_id in (select id from loc) and d.cancelled_at is null and d.installed_on is null), 0) as committed,
       coalesce((select sum(dl.qty) from deal_lines dl join deals d on d.id = dl.deal_id
                 where dl.sku_code = s.code and d.location_id in (select id from loc) and d.cancelled_at is null and d.installed_on > $3::date), 0) as used28
     from skus s where s.active order by s.code`,
    [locationSlug, today, since],
  );
  return rows.map((r) => {
    const onHand = Number(r.received) + Number(r.adjusted) - Number(r.installed);
    const committed = Number(r.committed);
    const available = onHand - committed;
    const onOrder = Number(r.on_order);
    const weeklyUse = Number(r.used28) / 4;
    return {
      skuCode: r.code,
      name: r.name,
      unitCostCents: Number(r.cost),
      received: Number(r.received),
      adjusted: Number(r.adjusted),
      installed: Number(r.installed),
      onHand,
      committed,
      available,
      onOrder,
      usedLast28: Number(r.used28),
      weeklyUse,
      // Nothing available = no cover (not negative weeks); the Short status says the rest.
      weeksOfCover: weeklyUse > 0 ? Math.max(0, available) / weeklyUse : null,
      status: stockStatus(available, onOrder, weeklyUse),
      valueCents: Math.max(0, onHand) * Number(r.cost),
    };
  });
}

export interface PurchaseOrderView {
  id: string;
  number: number;
  locationName: string;
  vendor: string;
  status: "ordered" | "received" | "cancelled";
  orderedOn: string;
  expectedOn: string | null;
  receivedOn: string | null;
  note: string | null;
  lines: Array<{ skuCode: string; qty: number; unitCostCents: number }>;
  totalCents: number;
}

export async function loadPurchaseOrders(locationSlug: string | null): Promise<PurchaseOrderView[]> {
  const { rows } = await db().query(
    `select po.id, po.number, loc.name as location_name, po.vendor, po.status, po.ordered_on, po.expected_on, po.received_on, po.note,
       coalesce((select jsonb_agg(jsonb_build_object('skuCode', l.sku_code, 'qty', l.qty, 'unitCostCents', l.unit_cost_cents) order by l.sku_code)
                 from purchase_order_lines l where l.po_id = po.id), '[]') as lines
     from purchase_orders po join locations loc on loc.id = po.location_id
     where $1::text is null or loc.slug = $1
     order by case po.status when 'ordered' then 0 else 1 end, po.number desc
     limit 100`,
    [locationSlug],
  );
  return rows.map((r) => {
    const lines = (r.lines as PurchaseOrderView["lines"]).map((l) => ({ ...l, qty: Number(l.qty), unitCostCents: Number(l.unitCostCents) }));
    return {
      id: r.id, number: Number(r.number), locationName: r.location_name, vendor: r.vendor, status: r.status, orderedOn: r.ordered_on, expectedOn: r.expected_on,
      receivedOn: r.received_on, note: r.note, lines, totalCents: lines.reduce((s, l) => s + l.qty * l.unitCostCents, 0),
    };
  });
}

/* ── Writes ──────────────────────────────────────────────────────────── */

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date");
const first = (e: z.ZodError) => e.issues[0]?.message ?? "Check the form";

export const NewPO = z.object({
  location: z.string().regex(/^[a-z0-9-]+$/),
  vendor: z.string().trim().min(1, "Vendor is required").max(120),
  orderedOn: date,
  expectedOn: date.nullable(),
  note: z.string().trim().max(500).nullable().optional(),
  lines: z
    .array(z.object({ skuCode: z.string().min(1), qty: z.number().int().min(1, "Quantity must be at least 1").max(10_000), unitCostCents: z.number().int().min(0).max(10_000_000) }))
    .min(1, "Add at least one product"),
});

export async function createPurchaseOrder(input: unknown): Promise<{ id: string; number: number }> {
  const p = NewPO.safeParse(input);
  if (!p.success) throw new EditError(first(p.error), 400);
  const v = p.data;
  return tx("web:inventory", async (c) => {
    const loc = (await c.query("select id from locations where slug = $1", [v.location])).rows[0];
    if (!loc) throw new EditError("Unknown location.", 400);
    const { rows } = await c.query(
      "insert into purchase_orders (location_id, vendor, ordered_on, expected_on, note) values ($1,$2,$3,$4,$5) returning id, number",
      [loc.id, v.vendor, v.orderedOn, v.expectedOn, v.note ?? null],
    );
    for (const l of v.lines) {
      await c.query("insert into purchase_order_lines (po_id, sku_code, qty, unit_cost_cents) values ($1,$2,$3,$4)", [rows[0].id, l.skuCode, l.qty, l.unitCostCents]);
    }
    return { id: rows[0].id, number: Number(rows[0].number) };
  });
}

export async function setPurchaseOrderStatus(id: string, input: unknown): Promise<void> {
  const p = z.object({ action: z.enum(["receive", "cancel", "reopen"]), receivedOn: date.optional() }).safeParse(input);
  if (!p.success || !z.string().uuid().safeParse(id).success) throw new EditError(p.success ? "Bad purchase order" : first(p.error), 400);
  const v = p.data;
  await tx("web:inventory", async (c) => {
    const po = (await c.query("select status from purchase_orders where id = $1 for update", [id])).rows[0];
    if (!po) throw new EditError("That purchase order no longer exists.", 404);
    if (v.action === "receive") {
      if (po.status !== "ordered") throw new EditError("Only an open order can be received.", 400);
      await c.query("update purchase_orders set status = 'received', received_on = $2 where id = $1", [id, v.receivedOn ?? todayET()]);
    } else if (v.action === "cancel") {
      if (po.status !== "ordered") throw new EditError("Only an open order can be cancelled.", 400);
      await c.query("update purchase_orders set status = 'cancelled' where id = $1", [id]);
    } else {
      await c.query("update purchase_orders set status = 'ordered', received_on = null where id = $1", [id]);
    }
  });
}

export const CountInput = z.object({
  location: z.string().regex(/^[a-z0-9-]+$/),
  skuCode: z.string().min(1),
  countedQty: z.number().int().min(0, "Count can't be negative").max(100_000),
  countedOn: date,
  note: z.string().trim().max(300).nullable().optional(),
});

/** Record a shelf count: stores the difference between the count and what the books say. */
export async function recordCount(input: unknown): Promise<{ delta: number }> {
  const p = CountInput.safeParse(input);
  if (!p.success) throw new EditError(first(p.error), 400);
  const v = p.data;
  const row = (await loadStock(v.location)).find((r) => r.skuCode === v.skuCode);
  if (!row) throw new EditError("Unknown product.", 400);
  const delta = v.countedQty - row.onHand;
  if (delta === 0) return { delta };
  await tx("web:inventory", async (c) => {
    const loc = (await c.query("select id from locations where slug = $1", [v.location])).rows[0];
    await c.query(
      "insert into inventory_adjustments (location_id, sku_code, qty_delta, reason, adjusted_on, note) values ($1,$2,$3,'count',$4,$5)",
      [loc.id, v.skuCode, delta, v.countedOn, v.note ?? `Shelf count: ${v.countedQty}`],
    );
  });
  return { delta };
}
