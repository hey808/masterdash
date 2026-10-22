/** Permanent delete against a real Postgres (TEST_DATABASE_URL, disposable). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "../db";
import { deleteDeal, deleteImpact } from "./delete";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("deleteDeal (database)", () => {
  let deal: { id: string; number: number };
  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    deal = (await db().query("select d.id, d.number from deals d where exists (select 1 from payments p where p.deal_id = d.id) order by d.number limit 1")).rows[0];
  });
  afterAll(closeDb);

  it("reports what goes with it", async () => {
    const i = await deleteImpact(deal.id);
    expect(i?.number).toBe(Number(deal.number));
    expect(i!.payments).toBeGreaterThan(0);
  });

  it("refuses the wrong number", async () => {
    await expect(deleteDeal(deal.id, { confirm: Number(deal.number) + 1000 }, "test:delete")).rejects.toThrow(/not this deal/);
    expect((await db().query("select 1 from deals where id = $1", [deal.id])).rowCount).toBe(1);
  });

  it("deletes the deal and its payments, and logs it", async () => {
    await deleteDeal(deal.id, { confirm: `#${deal.number}` }, "test:delete");
    expect((await db().query("select 1 from deals where id = $1", [deal.id])).rowCount).toBe(0);
    expect((await db().query("select 1 from payments where deal_id = $1", [deal.id])).rowCount).toBe(0);
    const log = await db().query("select actor from audit_log where table_name = 'deals' and row_id = $1 and after is null", [deal.id]);
    expect(log.rows[0]?.actor).toBe("test:delete");
  });

  it("says so if it's already gone", async () => {
    await expect(deleteDeal(deal.id, { confirm: deal.number }, "test:delete")).rejects.toThrow(/already deleted/);
  });
});
