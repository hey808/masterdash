import pg from "pg";

// bigint (cents, deal numbers) → number. Safe: cents stay far below 2^53.
pg.types.setTypeParser(20, (v) => Number(v));
// numeric (rates) → number.
pg.types.setTypeParser(1700, (v) => Number(v));
// date → keep as yyyy-mm-dd string; no timezone shifting.
pg.types.setTypeParser(1082, (v) => v);

let pool: pg.Pool | null = null;

/** DATABASE_URL, or POSTGRES_URL as synced by the Supabase ↔ Vercel integration. */
export function databaseUrl(): string | undefined {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL;
}

export function db(): pg.Pool {
  if (!pool) {
    const raw = databaseUrl();
    if (!raw) throw new Error("DATABASE_URL is not set");
    const url = new URL(raw);
    const local = ["localhost", "127.0.0.1"].includes(url.hostname);
    // Supabase's pooler presents a certificate not in Node's default CA store.
    // Keep TLS on, skip chain verification; drop sslmode so pg doesn't override this.
    url.searchParams.delete("sslmode");
    url.searchParams.delete("supa");
    url.searchParams.delete("pgbouncer");
    pool = new pg.Pool({ connectionString: url.toString(), max: 5, ssl: local ? undefined : { rejectUnauthorized: false } });
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
