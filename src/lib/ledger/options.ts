import { db } from "../db";

/** Choices for the ledger's dropdowns. */
export interface LedgerOptions {
  locations: Array<{ slug: string; name: string; active: boolean }>;
  people: Array<{ id: string; name: string; roles: string[] }>;
  lenders: string[];
  skus: Array<{ code: string; name: string }>;
}

export async function loadOptions(): Promise<LedgerOptions> {
  const [loc, ppl, len, sku] = await Promise.all([
    db().query("select slug, name, active from locations order by active desc, name"),
    db().query("select id, name, roles from people where active order by name"),
    db().query("select name from lenders where active order by name"),
    db().query("select code, name from skus where active order by code"),
  ]);
  return {
    locations: loc.rows,
    people: ppl.rows,
    lenders: len.rows.map((r) => r.name as string),
    skus: sku.rows,
  };
}
