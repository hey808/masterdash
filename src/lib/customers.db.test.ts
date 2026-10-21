/** Customer profiles against a real Postgres (TEST_DATABASE_URL). GoHighLevel isn't reachable in tests, so the calendar part is empty. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db } from "./db";
import { listCustomers, loadCustomer } from "./customers";

const url = process.env.TEST_DATABASE_URL;
const TODAY = "2026-10-21";

describe.skipIf(!url)("customers (database)", () => {
  let deal: { id: string; closer_id: string; customer_name: string };
  let otherRep = "";
  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    delete process.env.GHL_WILMINGTON_TOKEN;
    delete process.env.GHL_MYRTLE_TOKEN;
    deal = (await db().query("select id, closer_id, customer_name from deals where closer_id is not null and installed_on is not null and cancelled_at is null order by number limit 1")).rows[0];
    otherRep = (await db().query("select id from people where id <> $1 and 'closer' = any(roles) limit 1", [deal.closer_id])).rows[0].id;
  });
  afterAll(closeDb);

  it("the office sees every customer; a rep only theirs", async () => {
    const all = await listCustomers({ role: "admin", personId: null }, TODAY);
    const mine = await listCustomers({ role: "sales", personId: deal.closer_id }, TODAY);
    expect(all.length).toBeGreaterThan(mine.length);
    expect(mine.some((r) => r.key === deal.id)).toBe(true);
  });

  it("a profile has the deal, equipment and a timeline with the sale and install", async () => {
    const p = (await loadCustomer(deal.id, { role: "admin", personId: null }, TODAY))!;
    expect(p.name).toBe(deal.customer_name);
    expect(p.deal?.id).toBe(deal.id);
    const kinds = p.timeline.map((t) => t.kind);
    expect(kinds).toContain("sale");
    expect(kinds).toContain("installed");
    expect(p.full).toBe(true);
  });

  it("another rep can't open it, and reps don't get office figures", async () => {
    expect(await loadCustomer(deal.id, { role: "sales", personId: otherRep }, TODAY)).toBeNull();
    const own = (await loadCustomer(deal.id, { role: "sales", personId: deal.closer_id }, TODAY))!;
    expect(own.deal?.netProfitCents).toBeNull();
    expect(own.timeline.some((t) => t.kind === "payout")).toBe(false);
  });

  it("junk keys find nothing", async () => {
    expect(await loadCustomer("nope", { role: "admin", personId: null }, TODAY)).toBeNull();
    expect(await loadCustomer("a-nope", { role: "admin", personId: null }, TODAY)).toBeNull();
  });
});
