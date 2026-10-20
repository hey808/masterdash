/** Apply supabase/migrations/*.sql in order, once each. Usage: npm run db:migrate */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { closeDb, db } from "../src/lib/db";

const dir = path.resolve("supabase/migrations");

async function main() {
  const pool = db();
  await pool.query("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())");
  const done = new Set((await pool.query("select name from schema_migrations")).rows.map((r) => r.name as string));
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    if (done.has(f)) continue;
    const c = await pool.connect();
    try {
      await c.query("begin");
      await c.query(readFileSync(path.join(dir, f), "utf8"));
      await c.query("insert into schema_migrations(name) values ($1)", [f]);
      await c.query("commit");
      console.log(`applied ${f}`);
    } catch (e) {
      await c.query("rollback");
      throw new Error(`${f}: ${(e as Error).message}`);
    } finally {
      c.release();
    }
  }
}

main().then(closeDb, async (e) => {
  console.error(e);
  await closeDb();
  process.exit(1);
});
