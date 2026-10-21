/**
 * Mission Control ledger export (CSV, 50 columns) → ledger records.
 *
 * Pure: no database. The script in scripts/import-mc-csv.ts loads the
 * reference data, calls planImport(), writes the plan in one transaction,
 * then reads the deals back through derive() and checks every row against
 * the numbers Mission Control exported.
 *
 * What the export cannot tell us, and how it is handled:
 *   - payment and payout dates: imported as dated-unknown totals tied to the batch
 *   - who received a manager override: the manager on the roster (Mike)
 *   - a typed number that disagrees with the formula: kept as an explicit
 *     override with the reason recorded, and listed in the report
 */
import { parse } from "csv-parse/sync";
import { z } from "zod";
import { roundCents, toCents, type Cents } from "../lib/money";

export const MC_COLUMNS = [
  "Period", "Customer", "Address", "Market", "Closer", "Setter", "Canvasser", "Source", "Sale date", "Products",
  "Price", "Cash portion", "Cash collected", "Card fee", "Cash due", "Financed", "Lender", "Lender %", "Loan interest",
  "Funded", "Funding due", "Total in", "Balance", "Revenue after fees", "Extras", "Admin fee", "Commission base", "Rate",
  "Commission", "Commission paid", "Manager override", "Override paid", "Setter %", "Setter commission", "Setter paid",
  "Canvasser %", "Canvasser commission", "Canvasser paid", "Install date", "Installed", "Installer", "Installer pay",
  "Installer paid", "COGs", "Net profit", "Margin", "Bank override", "Status", "Done", "Note",
] as const;
export type McRow = Record<(typeof MC_COLUMNS)[number], string>;

const MARKET_TO_LOCATION: Record<string, string> = { wilmington: "wilmington", "myrtle beach": "myrtle-beach", myrtle: "myrtle-beach" };

export interface ImportContext {
  /** Unit cost in cents for a SKU on a date, or null if the SKU is unknown. */
  costOn(sku: string, date: string): Cents | null;
  managerName: string;
}

export interface PlannedDeal {
  sourceRow: number;
  locationSlug: string;
  customerName: string;
  customerAddress: string | null;
  saleDate: string;
  leadSource: string | null;
  externalRef: string | null;
  closer: string | null;
  manager: string | null;
  setter: string | null;
  canvasser: string | null;
  installer: string | null;
  priceCents: Cents;
  cashPortionCents: Cents;
  financedPortionCents: Cents;
  splitException: string | null;
  lender: string | null;
  lenderRate: number;
  commissionRate: number;
  commissionRateSource: "plan" | "override";
  managerRate: number;
  setterRate: number;
  canvasserRate: number;
  adminFeeCents: Cents;
  extrasCents: Cents;
  installerPayCents: Cents | null;
  loanInterestOverrideCents: Cents | null;
  cardFeeOverrideCents: Cents | null;
  fundingExpectedOverrideCents: Cents | null;
  cogsOverrideCents: Cents | null;
  overrideReason: string | null;
  installScheduledOn: string | null;
  installedOn: string | null;
  closed: boolean;
  note: string | null;
  lines: Array<{ skuCode: string; qty: number; unitCostCents: Cents }>;
  payments: Array<{ source: "customer" | "lender"; method: string; amountCents: Cents; feeCents: Cents }>;
  payouts: Array<{ kind: "closer" | "override" | "setter" | "canvasser" | "installer"; person: string | null; amountCents: Cents }>;
}

export interface ImportIssue {
  sourceRow: number;
  customer: string;
  severity: "error" | "warning" | "info";
  message: string;
}

/**
 * A number Mission Control showed that its own formula, applied to its own
 * inputs on the same row, does not produce: someone pinned it by hand.
 * Pins are derived values, so they are reported, not carried over.
 */
export interface McPin {
  sourceRow: number;
  customer: string;
  field: string;
  missionControl: Cents;
  formula: Cents;
  /** Fields on this row whose Mission Control value depends on the pin. */
  affects: string[];
}

export interface ImportPlan {
  deals: PlannedDeal[];
  people: Array<{ name: string; roles: string[] }>;
  lenders: string[];
  issues: ImportIssue[];
  pins: McPin[];
}

/** Find hand-pinned derived values by re-running Mission Control's formulas on the row's own inputs. */
export function findPins(r: McRow, sourceRow: number): McPin[] {
  const m = (c: keyof McRow) => money(r[c]);
  const customer = (r.Customer ?? "").trim();
  const out: McPin[] = [];
  const revFormula = m("Price") - m("Loan interest") - m("Card fee");
  if (m("Revenue after fees") !== revFormula) {
    out.push({ sourceRow, customer, field: "Revenue after fees", missionControl: m("Revenue after fees"), formula: revFormula,
      affects: ["Commission base", "Commission", "Manager override", "Setter commission", "Net profit"] });
  }
  const balFormula = m("Price") - m("Total in");
  if (m("Balance") !== balFormula) {
    out.push({ sourceRow, customer, field: "Balance", missionControl: m("Balance"), formula: balFormula, affects: [] });
  }
  const np = moneyOrNull(r["Net profit"]);
  if (np != null) {
    const npFormula = m("Revenue after fees") - m("Extras") - m("Commission") - m("Manager override") - m("Setter commission")
      - m("Canvasser commission") - m("COGs") - m("Installer pay");
    if (np !== npFormula) out.push({ sourceRow, customer, field: "Net profit", missionControl: np, formula: npFormula, affects: [] });
  }
  return out;
}

const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const yes = (v: string | undefined) => (v ?? "").trim().toLowerCase() === "yes";
const blank = (v: string | undefined) => !v || !v.trim();
const text = (v: string | undefined) => (blank(v) ? null : v!.trim());
const money = (v: string | undefined): Cents => toCents((v ?? "").replace(/\(adjusted\)/i, "")) ?? 0;
const moneyOrNull = (v: string | undefined): Cents | null => toCents((v ?? "").replace(/\(adjusted\)/i, ""));
/** "10% (adjusted)" → { rate: 0.1, adjusted: true } */
function pct(v: string | undefined): { rate: number; adjusted: boolean } {
  const s = (v ?? "").trim();
  const m = s.match(/(-?\d+(?:\.\d+)?)\s*%/);
  return { rate: m ? Number(m[1]) / 100 : 0, adjusted: /adjusted/i.test(s) };
}
const dollars = (c: Cents) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function parseMcCsv(csv: string): McRow[] {
  const records = parse(csv, { columns: true, skip_empty_lines: true, bom: true, relax_column_count: false }) as McRow[];
  const header = Object.keys(records[0] ?? {});
  const missing = MC_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) throw new Error(`Not a Mission Control ledger export. Missing columns: ${missing.join(", ")}`);
  return records;
}

const DateSchema = z.string().regex(dateRe);

export function planImport(rows: McRow[], ctx: ImportContext): ImportPlan {
  const issues: ImportIssue[] = [];
  const people = new Map<string, Set<string>>();
  const lenders = new Set<string>();
  const addPerson = (name: string | null, role: string) => {
    if (!name) return;
    const key = name.trim();
    people.set(key, (people.get(key) ?? new Set()).add(role));
  };
  const deals: PlannedDeal[] = [];
  const pins: McPin[] = [];

  rows.forEach((r, i) => {
    const sourceRow = i + 2; // header is row 1
    const customer = (r.Customer ?? "").trim();
    const issue = (severity: ImportIssue["severity"], message: string) => issues.push({ sourceRow, customer, severity, message });

    if (!customer) return issue("error", "No customer name; row skipped");
    for (const p of findPins(r, sourceRow)) {
      pins.push(p);
      issue("warning", `Mission Control showed ${p.field} ${dollars(p.missionControl)} but its own formula gives ${dollars(p.formula)}; using the formula`);
    }
    const location = MARKET_TO_LOCATION[(r.Market ?? "").trim().toLowerCase()];
    if (!location) return issue("error", `Unknown market "${r.Market}"; row skipped`);
    if (!DateSchema.safeParse(r["Sale date"]).success) return issue("error", `Bad sale date "${r["Sale date"]}"; row skipped`);
    const saleDate = r["Sale date"];
    const installDate = DateSchema.safeParse(r["Install date"]).success ? r["Install date"] : null;

    const priceCents = money(r.Price);
    const cashPortionCents = money(r["Cash portion"]);
    const financedPortionCents = money(r.Financed);
    const splitDiff = priceCents - cashPortionCents - financedPortionCents;
    const splitException = splitDiff !== 0 ? `Imported from Mission Control: cash + financed is off from price by ${dollars(splitDiff)}` : null;
    if (splitException) issue("warning", splitException);

    const reasons: string[] = [];

    // Lender and its fee.
    let lender = text(r.Lender);
    const lp = pct(r["Lender %"]);
    if (financedPortionCents > 0 && !lender) {
      lender = "Unknown lender";
      issue("warning", "Financed with no lender named; set to \"Unknown lender\"");
    }
    if (lender) lenders.add(lender);
    const loanInterestCsv = money(r["Loan interest"]);
    const loanInterestCalc = roundCents(financedPortionCents * lp.rate);
    let loanInterestOverrideCents: Cents | null = null;
    if (loanInterestCsv !== loanInterestCalc) {
      loanInterestOverrideCents = loanInterestCsv;
      reasons.push(`loan interest typed in Mission Control (${dollars(loanInterestCsv)} vs ${dollars(loanInterestCalc)} calculated)`);
    }
    if (financedPortionCents > 0 && lp.rate === 0 && loanInterestCsv === 0) issue("warning", "Financed deal with a 0% lender fee");

    // Payments in (totals only; the export carries no dates).
    const cashCollectedCents = money(r["Cash collected"]);
    const fundedCents = money(r.Funded);
    const cardFeeCents = money(r["Card fee"]);
    const payments: PlannedDeal["payments"] = [];
    const cardFeeOverrideCents: Cents | null = null;
    if (cashCollectedCents !== 0) {
      payments.push({ source: "customer", method: "unknown", amountCents: cashCollectedCents, feeCents: cardFeeCents > 0 ? cardFeeCents : 0 });
    } else if (cardFeeCents > 0) {
      // Mission Control projected a card fee before any payment. Not a real cost: card fees come from card payments.
      issue("info", `Mission Control projected a ${dollars(cardFeeCents)} card fee with nothing collected; left out`);
    }
    if (fundedCents !== 0) payments.push({ source: "lender", method: "lender", amountCents: fundedCents, feeCents: 0 });

    // Funding expected: Mission Control's figure is Funding due + Funded.
    const fundingExpectedCsv = money(r["Funding due"]) + fundedCents;
    const fundingExpectedCalc = Math.max(0, financedPortionCents - (loanInterestOverrideCents ?? loanInterestCalc));
    let fundingExpectedOverrideCents: Cents | null = null;
    if (financedPortionCents > 0 && fundingExpectedCsv !== fundingExpectedCalc) {
      fundingExpectedOverrideCents = Math.max(0, fundingExpectedCsv);
      reasons.push(`funding expected pinned in Mission Control (${dollars(fundingExpectedCsv)} vs ${dollars(fundingExpectedCalc)} calculated)`);
      issue("warning", `Funding expected pinned at ${dollars(fundingExpectedCsv)}; formula says ${dollars(fundingExpectedCalc)}`);
    }

    // Commission.
    const rate = pct(r.Rate);
    if (rate.rate >= 0.5) issue("warning", `Commission rate of ${Math.round(rate.rate * 100)}% looks wrong`);
    const baseCents = money(r["Commission base"]);
    const overrideCents = money(r["Manager override"]);
    const closer = text(r.Closer);
    const manager = overrideCents > 0 ? ctx.managerName : null;
    const managerRate = overrideCents > 0 && baseCents > 0 ? Math.round((overrideCents / baseCents) * 10_000) / 10_000 : 0;
    const setter = text(r.Setter);
    const canvasser = text(r.Canvasser);
    addPerson(closer, "closer");
    addPerson(manager, "manager");
    addPerson(setter, "setter");
    addPerson(canvasser, "canvasser");
    const installer = text(r.Installer);
    addPerson(installer, "installer");

    // Products and cost of goods. Lines snapshot the cost in force on the sale date.
    const lines: PlannedDeal["lines"] = [];
    for (const code of (r.Products ?? "").split("+").map((x) => x.trim().toUpperCase()).filter(Boolean)) {
      const cost = ctx.costOn(code, saleDate);
      if (cost == null) {
        issue("warning", `Unknown product "${code}" left off the deal`);
        continue;
      }
      const same = lines.find((l) => l.skuCode === code);
      if (same) same.qty += 1;
      else lines.push({ skuCode: code, qty: 1, unitCostCents: cost });
    }
    const cogsCsv = moneyOrNull(r.COGs);
    const cogsLines = lines.length ? lines.reduce((s, l) => s + l.qty * l.unitCostCents, 0) : null;
    let cogsOverrideCents: Cents | null = null;
    if (cogsCsv != null && cogsCsv !== cogsLines) {
      cogsOverrideCents = cogsCsv;
      reasons.push(lines.length ? `cost of goods typed in Mission Control (${dollars(cogsCsv)} vs ${dollars(cogsLines!)} from the SKUs)` : `cost of goods ${dollars(cogsCsv)} with no products listed`);
    }
    if (!lines.length) issue("warning", "No products on the deal");

    const installerPayCents = moneyOrNull(r["Installer pay"]);
    if (installerPayCents == null) issue("info", "No installer pay");

    // Payouts already made.
    const payouts: PlannedDeal["payouts"] = [];
    const paid = (flag: string, kind: PlannedDeal["payouts"][number]["kind"], person: string | null, amount: Cents) => {
      if (yes(r[flag as keyof McRow]) && amount !== 0) payouts.push({ kind, person, amountCents: amount });
    };
    paid("Commission paid", "closer", closer, money(r.Commission));
    paid("Override paid", "override", manager, overrideCents);
    paid("Setter paid", "setter", setter, money(r["Setter commission"]));
    paid("Canvasser paid", "canvasser", canvasser, money(r["Canvasser commission"]));
    paid("Installer paid", "installer", installer, installerPayCents ?? 0);

    const installed = yes(r.Installed);
    if (installed && !installDate) issue("error", "Marked installed with no install date; left as not installed");
    const ref = (r.Note ?? "").match(/AquaReport contract\s*…?\s*([A-Za-z0-9]+)/);

    deals.push({
      sourceRow,
      locationSlug: location,
      customerName: customer,
      customerAddress: text(r.Address),
      saleDate,
      leadSource: text(r.Source),
      externalRef: ref ? `aquareport:${ref[1]}` : null,
      closer,
      manager,
      setter,
      canvasser,
      installer,
      priceCents,
      cashPortionCents,
      financedPortionCents,
      splitException,
      lender,
      lenderRate: lp.rate,
      commissionRate: rate.rate,
      commissionRateSource: rate.adjusted ? "override" : "plan",
      managerRate,
      setterRate: setter ? pct(r["Setter %"]).rate : 0,
      canvasserRate: canvasser ? pct(r["Canvasser %"]).rate : 0,
      adminFeeCents: money(r["Admin fee"]),
      extrasCents: money(r.Extras),
      installerPayCents,
      loanInterestOverrideCents,
      cardFeeOverrideCents,
      fundingExpectedOverrideCents,
      cogsOverrideCents,
      overrideReason: reasons.length || rate.adjusted
        ? ["Imported from Mission Control", ...(rate.adjusted ? ["commission rate adjusted by hand"] : []), ...reasons].join("; ")
        : null,
      installScheduledOn: installDate,
      installedOn: installed && installDate ? installDate : null,
      closed: yes(r.Done),
      note: text(r.Note),
      lines,
      payments,
      payouts,
    });
  });

  if (deals.some((d) => d.manager)) {
    issues.push({ sourceRow: 0, customer: "", severity: "info", message: `Manager overrides assigned to ${ctx.managerName}; the export does not name who received them` });
  }

  return {
    deals,
    people: [...people.entries()].map(([name, roles]) => ({ name, roles: [...roles] })),
    lenders: [...lenders],
    issues,
    pins,
  };
}

/** The Mission Control figures each imported deal must reproduce. */
export const RECONCILE_FIELDS = [
  ["Price", "priceCents"],
  ["Loan interest", "loanInterestCents"],
  ["Card fee", "cardFeeCents"],
  ["Revenue after fees", "netRevenueCents"],
  ["Cash due", "cashDueCents"],
  ["Funding due", "fundingDueCents"],
  ["Total in", "collectedCents"],
  ["Balance", "balanceCents"],
  ["Commission base", "commissionBaseCents"],
  ["Commission", "commissionCents"],
  ["Manager override", "managerOverrideCents"],
  ["Setter commission", "setterCommissionCents"],
  ["COGs", "cogsCents"],
  ["Net profit", "netProfitCents"],
] as const;

export { money as mcMoney, moneyOrNull as mcMoneyOrNull };
