/**
 * Import a Mission Control ledger export and prove it landed intact.
 *
 *   npm run import:mc-csv -- <file.csv> [--as-of 2026-10-20] [--replace] [--dry-run]
 *
 * 1. Parse + plan (pure, src/import/mission-control-csv.ts)
 * 2. Write everything in ONE transaction, audit actor "import:mission-control-csv"
 * 3. Read the deals back through the same derive() the app uses and compare
 *    every money figure to what Mission Control exported, row by row
 * 4. Any mismatch over 1 cent rolls the whole import back
 *
 * Writes reports/import-<batch>.json and prints a summary.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type pg from "pg";
import { closeDb, tx } from "../src/lib/db";
import { derive } from "../src/lib/ledger/derive";
import { loadDeals } from "../src/lib/ledger/repo";
import { totals } from "../src/lib/ledger/rollups";
import type { DerivedDeal } from "../src/lib/ledger/types";
import { fmt } from "../src/lib/money";
import { mcMoneyOrNull, parseMcCsv, planImport, RECONCILE_FIELDS, type McRow, type PlannedDeal } from "../src/import/mission-control-csv";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const flag = (n: string) => args.includes(`--${n}`);
const asOf = args[args.indexOf("--as-of") + 1] && args.includes("--as-of") ? args[args.indexOf("--as-of") + 1]! : new Date().toISOString().slice(0, 10);
if (!file) {
  console.error("usage: import-mc-csv <file.csv> [--as-of yyyy-mm-dd] [--replace] [--dry-run]");
  process.exit(2);
}
const SOURCE = "mission-control-csv";

async function main() {
  const rows = parseMcCsv(readFileSync(file!, "utf8"));
  const fileName = path.basename(file!);

  const result = await tx(`import:${SOURCE}`, async (c) => {
    // Idempotency: one batch per file unless --replace.
    const prior = await c.query("select id from import_batches where source = $1 and file_name = $2", [SOURCE, fileName]);
    if (prior.rowCount) {
      if (!flag("replace")) throw new Error(`${fileName} was already imported (batch ${prior.rows[0].id}). Use --replace to re-import it.`);
      for (const b of prior.rows) {
        await c.query("delete from deals where import_batch_id = $1", [b.id]);
        await c.query("delete from import_batches where id = $1", [b.id]);
      }
    }

    // Reference data → lookups.
    const costs = (await c.query("select sku_code, effective_from::text as d, unit_cost_cents from sku_costs order by effective_from")).rows as Array<{ sku_code: string; d: string; unit_cost_cents: number }>;
    const costOn = (sku: string, date: string) => {
      const hits = costs.filter((x) => x.sku_code === sku && x.d <= date);
      return hits.length ? hits[hits.length - 1]!.unit_cost_cents : null;
    };
    const plan = planImport(rows, { costOn, managerName: "Mike" });
    const blocking = plan.issues.filter((i) => i.severity === "error");

    const batch = (await c.query("insert into import_batches(source, file_name, row_count) values ($1,$2,$3) returning id, imported_at", [SOURCE, fileName, rows.length])).rows[0] as { id: string; imported_at: Date };

    const locations = new Map((await c.query("select slug, id from locations")).rows.map((r) => [r.slug as string, r.id as string]));
    const personId = await upsertPeople(c, plan.people);
    const lenderId = await upsertLenders(c, plan.lenders);
    const planByRow = new Map<number, PlannedDeal>();

    for (const d of plan.deals) {
      planByRow.set(d.sourceRow, d);
      const pid = (n: string | null) => (n ? personId.get(n.toLowerCase()) ?? null : null);
      const { rows: [ins] } = await c.query(
        `insert into deals (location_id, customer_name, customer_address, sale_date, lead_source, external_ref,
           closer_id, manager_id, setter_id, canvasser_id, installer_id,
           price_cents, cash_portion_cents, financed_portion_cents, split_exception, lender_id,
           comp_plan_id, lender_rate, commission_rate, commission_rate_source, manager_rate, setter_rate, canvasser_rate,
           admin_fee_cents, extras_cents, installer_pay_cents,
           loan_interest_override_cents, card_fee_override_cents, funding_expected_override_cents, cogs_override_cents, override_reason,
           install_scheduled_on, installed_on, closed_at, note, import_batch_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,(comp_plan_on($4::date)).id,$17,$18,$19,$20,$21,$22,
                 $23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35)
         returning id`,
        [
          locations.get(d.locationSlug), d.customerName, d.customerAddress, d.saleDate, d.leadSource, d.externalRef,
          pid(d.closer), pid(d.manager), pid(d.setter), pid(d.canvasser), pid(d.installer),
          d.priceCents, d.cashPortionCents, d.financedPortionCents, d.splitException, d.lender ? lenderId.get(d.lender) : null,
          d.lenderRate, d.commissionRate, d.commissionRateSource, d.managerRate, d.setterRate, d.canvasserRate,
          d.adminFeeCents, d.extrasCents, d.installerPayCents,
          d.loanInterestOverrideCents, d.cardFeeOverrideCents, d.fundingExpectedOverrideCents, d.cogsOverrideCents, d.overrideReason,
          d.installScheduledOn, d.installedOn, d.closed ? batch.imported_at : null, d.note, batch.id,
        ],
      );
      const dealId = ins.id as string;
      for (const [i, l] of d.lines.entries()) {
        await c.query("insert into deal_lines (deal_id, sku_code, qty, unit_cost_cents, sort) values ($1,$2,$3,$4,$5)", [dealId, l.skuCode, l.qty, l.unitCostCents, i]);
      }
      for (const p of d.payments) {
        await c.query(
          "insert into payments (deal_id, source, method, amount_cents, fee_cents, note, import_batch_id) values ($1,$2,$3,$4,$5,$6,$7)",
          [dealId, p.source, p.method, p.amountCents, p.feeCents, "Total collected per Mission Control export (date unknown)", batch.id],
        );
      }
      for (const p of d.payouts) {
        await c.query(
          "insert into payouts (deal_id, person_id, kind, amount_cents, note, import_batch_id) values ($1,$2,$3,$4,$5,$6)",
          [dealId, pid(p.person), p.kind, p.amountCents, "Marked paid in Mission Control export (date unknown)", batch.id],
        );
      }
      (d as PlannedDeal & { dealId?: string }).dealId = dealId;
    }

    // Read back through the app's own path and reconcile row by row.
    const stored = new Map((await loadDeals(c)).map((x) => [x.id, x]));
    const mismatches: Array<{ row: number; customer: string; field: string; mc: number | null; ours: number | null; diff: number | null }> = [];
    const derived: DerivedDeal[] = [];
    rows.forEach((r: McRow, i) => {
      const d = planByRow.get(i + 2) as (PlannedDeal & { dealId?: string }) | undefined;
      if (!d?.dealId) return;
      const x = derive(stored.get(d.dealId)!, asOf);
      derived.push(x);
      const pinned = new Set(plan.pins.filter((p) => p.sourceRow === i + 2).flatMap((p) => [p.field, ...p.affects]));
      for (const [col, key] of RECONCILE_FIELDS) {
        if (pinned.has(col)) continue;
        const mc = mcMoneyOrNull(r[col]);
        const ours = x[key] as number | null;
        if (mc == null && ours == null) continue;
        if (mc == null || ours == null || Math.abs(mc - ours) > 0) {
          mismatches.push({ row: i + 2, customer: d.customerName, field: col, mc, ours, diff: mc != null && ours != null ? ours - mc : null });
        }
      }
    });
    const hard = mismatches.filter((m) => m.diff == null || Math.abs(m.diff) > 1);
    const csvTotal = (col: string) => rows.reduce((s, r) => s + (mcMoneyOrNull(r[col as keyof McRow]) ?? 0), 0);
    const ourTotal = (key: keyof DerivedDeal) => derived.reduce((s, x) => s + ((x[key] as number | null) ?? 0), 0);
    const control = RECONCILE_FIELDS.map(([col, key]) => ({ field: col, missionControl: csvTotal(col), ours: ourTotal(key), diff: ourTotal(key) - csvTotal(col) }));

    const report = {
      batchId: batch.id,
      file: fileName,
      asOf,
      rowsRead: rows.length,
      dealsImported: plan.deals.length,
      blockingIssues: blocking,
      issues: plan.issues,
      controlTotals: control,
      missionControlPins: plan.pins,
      centRounding: mismatches.filter((m) => m.diff != null && Math.abs(m.diff) <= 1),
      mismatches: hard,
      ledger: totals(derived, asOf),
    };
    await c.query("update import_batches set report = $2 where id = $1", [batch.id, report]);

    if (blocking.length || hard.length) {
      const e = new Error(`Import rolled back: ${blocking.length} blocking issue(s), ${hard.length} mismatch(es) over 1 cent`);
      (e as Error & { report?: unknown }).report = report;
      throw e;
    }
    if (flag("dry-run")) {
      const e = new Error("Dry run: rolled back on purpose");
      (e as Error & { report?: unknown }).report = report;
      throw e;
    }
    return report;
  }).catch((e: Error & { report?: unknown }) => {
    if (e.report) {
      writeReport(e.report as { batchId: string });
      if (/^Dry run/.test(e.message)) {
        console.log(e.message);
        return e.report as ReturnType<typeof Object>;
      }
    }
    throw e;
  });

  writeReport(result as { batchId: string });
  summarize(result as Parameters<typeof summarize>[0]);
}

async function upsertPeople(c: pg.PoolClient, people: Array<{ name: string; roles: string[] }>) {
  const ids = new Map<string, string>();
  for (const p of people) {
    const { rows } = await c.query(
      `insert into people (name, roles) values ($1, $2)
       on conflict ((lower(name))) do update set roles = (select array(select distinct unnest(people.roles || excluded.roles)))
       returning id`,
      [p.name, p.roles],
    );
    ids.set(p.name.toLowerCase(), rows[0].id);
  }
  return ids;
}

async function upsertLenders(c: pg.PoolClient, names: string[]) {
  const ids = new Map<string, string>();
  for (const n of names) {
    const { rows } = await c.query(
      "insert into lenders (name) values ($1) on conflict (name) do update set name = excluded.name returning id",
      [n],
    );
    ids.set(n, rows[0].id);
  }
  return ids;
}

function writeReport(report: { batchId: string }) {
  mkdirSync("reports", { recursive: true });
  const p = path.join("reports", `import-${report.batchId}.json`);
  writeFileSync(p, JSON.stringify(report, null, 2));
  console.log(`report: ${p}`);
}

function summarize(r: {
  rowsRead: number; dealsImported: number; issues: Array<{ severity: string; message: string }>;
  controlTotals: Array<{ field: string; missionControl: number; ours: number; diff: number }>;
  centRounding: unknown[]; mismatches: unknown[];
  missionControlPins: Array<{ customer: string; field: string; missionControl: number; formula: number }>;
}) {
  console.log(`\n${r.dealsImported}/${r.rowsRead} deals imported`);
  console.log("\nControl totals (Mission Control vs new ledger):");
  for (const t of r.controlTotals) {
    console.log(`  ${t.field.padEnd(20)} ${fmt(t.missionControl, { decimals: 2 }).padStart(14)} ${fmt(t.ours, { decimals: 2 }).padStart(14)}   diff ${t.diff}¢`);
  }
  console.log(`\nHand-pinned in Mission Control (not carried over; formula used instead):`);
  for (const p of r.missionControlPins) {
    console.log(`  ${p.customer.padEnd(22)} ${p.field.padEnd(20)} MC ${fmt(p.missionControl, { decimals: 2 }).padStart(11)}  formula ${fmt(p.formula, { decimals: 2 }).padStart(11)}`);
  }
  console.log(`\n${r.mismatches.length} mismatches over 1 cent; ${r.centRounding.length} one-cent rounding differences`);
  const bySeverity = r.issues.reduce<Record<string, number>>((m, i) => ((m[i.severity] = (m[i.severity] ?? 0) + 1), m), {});
  console.log("issues:", bySeverity);
}

main().then(closeDb, async (e) => {
  console.error(e.message ?? e);
  await closeDb();
  process.exit(1);
});
