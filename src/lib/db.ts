import pg from "pg";

// bigint (cents, deal numbers) → number. Safe: cents stay far below 2^53.
pg.types.setTypeParser(20, (v) => Number(v));
// numeric (rates) → number.
pg.types.setTypeParser(1700, (v) => Number(v));
// date → keep as yyyy-mm-dd string; no timezone shifting.
pg.types.setTypeParser(1082, (v) => v);

let pool: pg.Pool | null = null;

export function db(): pg.Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    pool = new pg.Pool({ connectionString: url, max: 5 });
  }
  return pool;
}

/** Run fn in a transaction, stamping the audit actor for every write inside it. */
export async function tx<T>(actor: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await db().connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.actor', $1, true)", [actor]);
    const out = await fn(c);
    await c.query("commit");
    return out;
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = null;
}
