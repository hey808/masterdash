/**
 * Apply one field edit to one deal, server side. One transaction:
 * lock the row, check the version, write, read back, derive.
 * The audit trigger records before/after under the actor passed in.
 */
import type pg from "pg";
import { tx } from "../db";
import { todayET } from "../dates";
import { derive } from "./derive";
import { FIELDS, valueSchema, type FieldKey } from "./fields";
import { loadDeal } from "./repo";
import type { DerivedDeal } from "./types";

export class EditError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409, readonly current?: DerivedDeal) {
    super(message);
  }
}

/** Database constraint → plain-language message. */
const CONSTRAINT_MESSAGES: Record<string, string> = {
  deals_split_matches: "Cash portion + financed has to equal the price.",
  deals_financed_needs_lender: "A financed amount needs a lender. Pick the lender first.",
  deals_install_after_sale: "Install date can't be more than 30 days before the sale date.",
  deals_override_reason: "That change needs a reason recorded.",
  deals_customer_name_check: "Customer can't be blank.",
};

export async function applyEdit(
  dealId: string,
  field: FieldKey,
  rawValue: unknown,
  version: number,
  actor: string,
): Promise<DerivedDeal> {
  const parsed = valueSchema(field).safeParse(rawValue);
  if (!parsed.success) throw new EditError(parsed.error.issues[0]?.message ?? "Invalid value", 400);
  const value = parsed.data;
  const def = FIELDS[field];

  try {
    return await tx(actor, async (c) => {
      const { rows } = await c.query(
        "select version, sale_date::text, price_cents, cash_portion_cents, financed_portion_cents, override_reason from deals where id = $1 for update",
        [dealId],
      );
      const cur = rows[0] as
        | { version: number; sale_date: string; price_cents: number; cash_portion_cents: number; financed_portion_cents: number; override_reason: string | null }
        | undefined;
      if (!cur) throw new EditError("That deal no longer exists.", 404);
      if (cur.version !== version) {
        const latest = await loadDeal(dealId, c);
        throw new EditError("Someone else changed this deal. The row now shows the latest values; make your edit again.", 409, latest ? derive(latest, todayET()) : undefined);
      }

      await write(c, dealId, field, value, cur);
      const after = await loadDeal(dealId, c);
      return derive(after!, todayET());
    });
  } catch (e) {
    if (e instanceof EditError) throw e;
    const pgErr = e as { code?: string; constraint?: string; message?: string };
    if (pgErr.code === "23514" || pgErr.code === "23503" || pgErr.code === "22P02") {
      throw new EditError(CONSTRAINT_MESSAGES[pgErr.constraint ?? ""] ?? `Not allowed: ${pgErr.message}`, 400);
    }
    throw e;
  }

  async function write(
    c: pg.PoolClient,
    id: string,
    key: FieldKey,
    v: unknown,
    cur: { sale_date: string; price_cents: number; cash_portion_cents: number; financed_portion_cents: number; override_reason: string | null },
  ) {
    const set = (sql: string, params: unknown[]) => c.query(`update deals set ${sql} where id = $1`, [id, ...params]);
    switch (def.kind) {
      case "text":
      case "date":
        return set(`${def.column} = $2`, [v === "" ? null : v]);

      case "money": {
        // Cash + financed must equal the price, so the split moves together:
        //   price     → all-financed deals stay all-financed; otherwise financed stays and cash absorbs the change
        //   financed  → cash = price − financed
        //   cash      → financed = price − cash
        const n = v as number;
        const price = cur.price_cents;
        if (key === "priceCents") {
          const allFin = cur.cash_portion_cents === 0 && cur.financed_portion_cents === price;
          if (allFin) return set("price_cents = $2, financed_portion_cents = $2", [n]);
          if (n < cur.financed_portion_cents) throw new EditError("The price can't be less than the financed amount. Lower the financed amount first.", 400);
          return set("price_cents = $2, cash_portion_cents = $2 - financed_portion_cents", [n]);
        }
        if (key === "financedPortionCents") {
          if (n > price) throw new EditError("Financed can't be more than the price.", 400);
          return set("financed_portion_cents = $2, cash_portion_cents = price_cents - $2", [n]);
        }
        if (key === "cashPortionCents") {
          if (n > price) throw new EditError("Cash can't be more than the price.", 400);
          return set("cash_portion_cents = $2, financed_portion_cents = price_cents - $2", [n]);
        }
        return set(`${def.column} = $2`, [n]);
      }

      case "rate":
        if (key === "commissionRate") {
          const reason = appendReason(cur.override_reason, "commission rate edited in the ledger");
          return set("commission_rate = $2, commission_rate_source = 'override', override_reason = $3", [v, reason]);
        }
        return set(`${def.column} = $2`, [v]);

      case "person": {
        if (v != null) {
          const ok = await c.query("select 1 from people where id = $1", [v]);
          if (!ok.rowCount) throw new EditError("That person isn't on the roster.", 400);
        }
        return set(`${def.column} = $2`, [v]);
      }

      case "location": {
        const loc = await c.query("select id from locations where slug = $1", [v]);
        if (!loc.rowCount) throw new EditError("Unknown location.", 400);
        return set("location_id = $2", [loc.rows[0].id]);
      }

      case "lender": {
        if (v == null) return set("lender_id = null", []);
        const l = await c.query("select id from lenders where name = $1", [v]);
        if (!l.rowCount) throw new EditError("Unknown lender.", 400);
        // Stamp the lender's fee in force on the sale date (keep the current rate if none is on file).
        return set("lender_id = $2, lender_rate = coalesce(lender_rate_on($2, sale_date), lender_rate)", [l.rows[0].id]);
      }

      case "products": {
        const lines = v as Array<{ skuCode: string; qty: number }>;
        await c.query("delete from deal_lines where deal_id = $1", [id]);
        for (const [i, l] of lines.entries()) {
          const cost = await c.query("select sku_cost_on($1, $2::date) as cents", [l.skuCode, cur.sale_date]);
          const cents = cost.rows[0]?.cents;
          if (cents == null) throw new EditError(`No cost on file for ${l.skuCode} on the sale date.`, 400);
          await c.query("insert into deal_lines (deal_id, sku_code, qty, unit_cost_cents, sort) values ($1,$2,$3,$4,$5)", [id, l.skuCode, l.qty, cents, i]);
        }
        // Touch the deal so its version moves with its lines.
        return set("updated_at = now()", []);
      }

      case "cancel":
        // A reason cancels (keeps the first cancel time); null brings the deal back.
        return v == null
          ? set("cancelled_at = null, cancel_reason = null", [])
          : set("cancelled_at = coalesce(cancelled_at, now()), cancel_reason = $2", [v]);

      case "bool":
        if (key === "installed") {
          // Yes stamps today's date (Eastern) unless an install date is already set; No clears it.
          return set("installed_on = case when $2::boolean then coalesce(installed_on, $3::date) else null end", [v, todayET()]);
        }
        return set("closed_at = case when $2::boolean then coalesce(closed_at, now()) else null end", [v]);
    }
  }
}

function appendReason(existing: string | null, add: string): string {
  if (!existing) return add;
  return existing.includes(add) ? existing : `${existing}; ${add}`;
}
