/**
 * Financial statements and Home metrics, from the Deal Ledger plus bank activity.
 *
 * Income statement (accrual where the ledger knows, cash where only the bank does):
 *   revenue, fees, equipment cost, installer pay, extras and commissions come from the
 *   ledger in the INSTALL month. Everything else comes from categorized bank lines in
 *   the month they posted. Bank lines for costs the ledger already books (equipment
 *   purchases, commissions paid, installer pay) are left off so nothing counts twice.
 *
 * Cash flow (direct method): every bank line by posted month, opening and closing to
 * the bank's own balance, so it always ties out.
 *
 * Balance sheet (today): bank balance, receivables, shelf inventory, what we owe on
 * installed deals, deposits on jobs not installed. Equity is the balancing figure.
 */
import { accountBalances, loadCategories, loadTransactions, openingBalance, type BankCategory, type BankTxn } from "./bank";
import { loadStock } from "./inventory";
import { addDays } from "./ledger/payrun";
import { loadLedger } from "./ledger/repo";
import type { DerivedDeal } from "./ledger/types";
import { sumCents } from "./money";

const SETTLED = 50;
const live = (rows: DerivedDeal[]) => rows.filter((r) => r.stage !== "cancelled");
const month = (d: string) => d.slice(0, 7);

/** yyyy-mm months from `from` through `to`, inclusive. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number) as [number, number];
  const [ty, tm] = to.split("-").map(Number) as [number, number];
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

export interface StatementLine {
  key: string;
  label: string;
  /** Cents per month (same order as `months`), then the total. */
  values: number[];
  total: number;
  /** Visual role: a subtotal row, a section heading, an indented detail row, or a memo. */
  style?: "heading" | "subtotal" | "grand" | "detail" | "memo";
  /** Where the number comes from, for the hover note. */
  source?: string;
  flag?: string;
}

function line(key: string, label: string, values: number[], opts: Omit<StatementLine, "key" | "label" | "values" | "total"> = {}): StatementLine {
  return { key, label, values, total: sumCents(values), ...opts };
}
const heading = (key: string, label: string, n: number): StatementLine => ({ key, label, values: new Array(n).fill(0), total: 0, style: "heading" });
const sumLines = (n: number, ls: StatementLine[]) => Array.from({ length: n }, (_, i) => sumCents(ls.map((l) => l.values[i] ?? 0)));
const neg = (v: number[]) => v.map((x) => -x);

function byMonth<T>(items: T[], months: string[], when: (t: T) => string | null, amount: (t: T) => number): number[] {
  const idx = new Map(months.map((m, i) => [m, i]));
  const out = new Array(months.length).fill(0) as number[];
  for (const t of items) {
    const d = when(t);
    if (!d) continue;
    const i = idx.get(month(d));
    if (i != null) out[i] = (out[i] ?? 0) + amount(t);
  }
  return out;
}

export interface Statements {
  months: string[];
  /** Last day the bank data covers; the current month is partial up to here. */
  bankThrough: string | null;
  bankFrom: string | null;
  income: StatementLine[];
  cashFlow: StatementLine[];
  balance: { asOf: string; lines: StatementLine[]; flags: string[] };
  flags: string[];
}

export async function buildStatements(today: string): Promise<Statements> {
  const [deals, txns, cats, balances] = await Promise.all([loadLedger(today), loadTransactions(), loadCategories(), accountBalances(today)]);
  const bankFrom = balances.map((b) => b.firstOn).filter(Boolean).sort()[0] ?? null;
  const bankThrough = balances.map((b) => b.lastOn).filter(Boolean).sort().at(-1) ?? null;
  // Statements start where the bank data starts: before that we know revenue but not expenses.
  const first = bankFrom ? `${month(bankFrom)}-01` : `${month(today)}-01`;
  const months = monthsBetween(first, today);
  const n = months.length;
  const add = (...ls: StatementLine[]) => sumLines(n, ls);
  const flags: string[] = [];

  /* ── Income statement ── */
  const installed = live(deals).filter((d) => d.isInstalled);
  const inst = <T extends number | null>(pick: (d: DerivedDeal) => T) => byMonth(installed, months, (d) => d.installedOn, (d) => pick(d) ?? 0);
  const revenue = line("revenue", "Installed sales", inst((d) => d.priceCents), { style: "detail", source: "Ledger: price of deals installed that month" });
  const fees = line("fees", "Lender and card fees", neg(inst((d) => d.feesCents)), { style: "detail", source: "Ledger" });
  const netRevenue = line("netRevenue", "Net revenue", add(revenue, fees), { style: "subtotal" });

  const uncosted = installed.filter((d) => d.cogsCents == null && months.includes(month(d.installedOn!)));
  const noInstallerPay = installed.filter((d) => d.installerPayCents == null && months.includes(month(d.installedOn!)));
  const equipment = line("equipment", "Equipment", neg(inst((d) => d.cogsCents)), {
    style: "detail", source: "Ledger: product cost on installed deals",
    flag: uncosted.length ? `${uncosted.length} installed deal${uncosted.length === 1 ? " has" : "s have"} no products, so no equipment cost` : undefined,
  });
  const installerPay = line("installerPay", "Installer pay", neg(inst((d) => d.installerPayCents)), {
    style: "detail", source: "Ledger",
    flag: noInstallerPay.length ? `${noInstallerPay.length} installed deal${noInstallerPay.length === 1 ? " has" : "s have"} no installer pay` : undefined,
  });
  const extras = line("extras", "Extras", neg(inst((d) => d.extrasCents)), { style: "detail", source: "Ledger" });

  const catOf = new Map(cats.map((c) => [c.slug, c]));
  const bankLine = (c: BankCategory, list: BankTxn[], sign = 1) =>
    line(`bank:${c.slug}`, c.name, byMonth(list.filter((t) => t.category === c.slug), months, (t) => t.postedOn, (t) => sign * t.amountCents), {
      style: "detail", source: "Bank",
    });
  const supplies = cats.filter((c) => c.kind === "cogs").map((c) => bankLine(c, txns));
  const grossProfit = line("grossProfit", "Gross profit", add(netRevenue, equipment, installerPay, extras, ...supplies), { style: "subtotal" });

  const commissions = line("commissions", "Sales commissions", neg(inst((d) => d.salesCompCents)), { style: "detail", source: "Ledger: closer, override and setter pay on installed deals" });
  const opexCats = cats.filter((c) => c.kind === "opex");
  const opex = opexCats.map((c) => bankLine(c, txns)).filter((l) => l.values.some((v) => v !== 0));
  const uncatOut = line("uncatOut", "Uncategorized", byMonth(txns.filter((t) => t.kind === "uncategorized" && t.amountCents < 0), months, (t) => t.postedOn, (t) => t.amountCents), { style: "detail", source: "Bank" });
  const opexAll = [commissions, ...opex, ...(uncatOut.total ? [uncatOut] : [])];
  const totalOpex = line("opexTotal", "Total operating expenses", add(...opexAll), { style: "subtotal" });
  const operatingIncome = line("operatingIncome", "Operating income", add(grossProfit, totalOpex), { style: "subtotal" });

  const otherIncome = line("otherIncome", "Other income", byMonth(txns.filter((t) => t.kind === "other_income" || (t.kind === "uncategorized" && t.amountCents > 0)), months, (t) => t.postedOn, (t) => t.amountCents), { style: "detail", source: "Bank" });
  const netIncome = line("netIncome", "Net income", add(operatingIncome, otherIncome), { style: "grand" });

  const income: StatementLine[] = [
    heading("h-rev", "Revenue", n), revenue, fees, netRevenue,
    heading("h-cogs", "Cost of sales", n), equipment, installerPay, ...(extras.total ? [extras] : []), ...supplies, grossProfit,
    heading("h-opex", "Operating expenses", n), ...opexAll, totalOpex, operatingIncome,
    ...(otherIncome.total ? [otherIncome] : []), netIncome,
  ];
  const draws = cats.filter((c) => c.kind === "financing").map((c) => bankLine(c, txns)).filter((l) => l.total !== 0).map((l) => ({ ...l, style: "memo" as const }));
  if (draws.length) income.push(heading("h-memo", "Not expenses (paid from the bank, shown for reference)", n), ...draws);

  const card = txns.filter((t) => t.category === "card_payments");
  if (card.length) flags.push("Credit card payments are expensed when paid. The charges on the cards aren't imported, so their categories (and anything still owed) are unknown.");
  const reviewCount = txns.filter((t) => t.needsReview).length;
  if (reviewCount) flags.push(`${reviewCount} bank lines are categorized by guess and still need a look on the Bank tab.`);

  /* ── Cash flow ── */
  const flowLine = (c: BankCategory) => line(`cf:${c.slug}`, c.name, byMonth(txns.filter((t) => t.category === c.slug), months, (t) => t.postedOn, (t) => t.amountCents), { style: "detail" });
  const opening: number[] = [];
  const closing: number[] = [];
  for (const m of months) {
    const monthEnd = lastDayOf(m) < today ? lastDayOf(m) : today;
    const ends = await accountBalances(monthEnd);
    let o = 0;
    let cl = 0;
    for (const b of balances) {
      o += (await openingBalance(b.accountId, `${m}-01`)) ?? 0;
      cl += ends.find((x) => x.accountId === b.accountId)?.balanceCents ?? 0;
    }
    opening.push(o);
    closing.push(cl);
  }
  const group = (kinds: BankCategory["kind"][]) => cats.filter((c) => kinds.includes(c.kind)).map(flowLine).filter((l) => l.values.some((v) => v !== 0));
  const opIn = group(["income", "other_income"]);
  const opOut = group(["ledger", "cogs", "opex", "uncategorized"]);
  const fin = group(["financing"]);
  const xfer = group(["transfer"]);
  const netOp = line("cf-netop", "Net cash from operations", add(...opIn, ...opOut), { style: "subtotal" });
  const netFin = line("cf-netfin", "Net cash from financing", add(...fin), { style: "subtotal" });
  const netX = line("cf-netx", "Net transfers", add(...xfer), { style: "subtotal" });
  const change = line("cf-change", "Net change in cash", add(netOp, netFin, netX), { style: "subtotal" });
  const openL: StatementLine = { key: "cf-open", label: "Cash at start", values: opening, total: opening[0] ?? 0, style: "subtotal" };
  const computedClose = opening.map((o, i) => o + (change.values[i] ?? 0));
  const closeL: StatementLine = { key: "cf-close", label: "Cash at end", values: computedClose, total: computedClose.at(-1) ?? 0, style: "grand" };
  const bankClose: StatementLine = { key: "cf-bank", label: "Bank's own balance", values: closing, total: closing.at(-1) ?? 0, style: "memo" };
  const off = computedClose.some((c, i) => c !== closing[i]);
  if (off) flags.push("Cash flow doesn't tie to the bank balance for at least one month; a statement may be missing lines.");
  const cashFlow: StatementLine[] = [
    openL,
    heading("cf-h-op", "Operating", n), ...opIn, ...opOut, netOp,
    heading("cf-h-fin", "Financing", n), ...fin, netFin,
    ...(xfer.length ? [heading("cf-h-x", "Between accounts", n), ...xfer, netX] : []),
    change, closeL, bankClose,
  ];

  /* ── Balance sheet (today) ── */
  const balance = await buildBalanceSheet(today, deals, txns, balances);

  return { months, bankThrough, bankFrom, income, cashFlow, balance, flags };
}

function lastDayOf(m: string): string {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, mo, 0));
  return d.toISOString().slice(0, 10);
}

async function buildBalanceSheet(asOf: string, deals: DerivedDeal[], txns: BankTxn[], balances: Awaited<ReturnType<typeof accountBalances>>) {
  const one = (key: string, label: string, v: number, opts: Omit<StatementLine, "key" | "label" | "values" | "total"> = {}): StatementLine => ({ key, label, values: [v], total: v, ...opts });
  const flags: string[] = [];
  const l = live(deals);

  const cash = balances.map((b) => one(`cash:${b.last4}`, b.name, b.balanceCents ?? 0, { style: "detail", source: b.asOf ? `Bank balance on ${b.asOf}` : "No statement yet" }));
  const arCustomer = sumCents(l.filter((d) => d.isInstalled && d.cashDueCents > SETTLED).map((d) => d.cashDueCents));
  const arLender = sumCents(l.filter((d) => d.isInstalled && d.fundingDueCents > SETTLED).map((d) => d.fundingDueCents));
  const stock = await loadStock(null, asOf);
  const shelf = sumCents(stock.map((s) => s.valueCents));
  const negatives = stock.filter((s) => s.onHand < 0).length;

  // Money moved to accounts we haven't imported.
  const outTo = txns.filter((t) => t.category === "transfers");
  const netOut = -sumCents(outTo.map((t) => t.amountCents));
  if (netOut > 0) flags.push(`${fmtUsd(netOut)} was moved out to other accounts (Truist ****9623 and others). Those balances aren't imported, so cash here is only what's left in the imported account.`);
  if (negatives) flags.push(`Shelf counts haven't been entered for ${negatives} product${negatives === 1 ? "" : "s"}, so inventory shows $0. Bank shows ${fmtUsd(-sumCents(txns.filter((t) => t.category === "inventory").map((t) => t.amountCents)))} of equipment bought since ${txns.map((t) => t.postedOn).sort()[0] ?? "the first statement"}.`);
  flags.push("Credit card balances and loan balances aren't tracked yet, so liabilities are understated.");

  const assets = [
    ...cash,
    one("ar-c", "Receivable from customers", arCustomer, { style: "detail", source: "Installed deals, customer balance" }),
    one("ar-l", "Receivable from lenders", arLender, { style: "detail", source: "Installed deals, funding still due" }),
    one("inv", "Inventory on the shelf", shelf, { style: "detail", source: "Inventory tab, at current cost" }),
  ];
  const totalAssets = one("assets", "Total assets", sumCents(assets.map((a) => a.total)), { style: "subtotal" });

  const installedOpen = (kinds: string[]) =>
    sumCents(l.filter((d) => d.isInstalled).flatMap((d) => d.payoutPositions.filter((p) => kinds.includes(p.kind) && p.openCents > SETTLED).map((p) => p.openCents)));
  const commOwed = installedOpen(["closer", "override", "setter", "canvasser"]);
  const instOwed = installedOpen(["installer"]);
  const deposits = sumCents(l.filter((d) => !d.isInstalled).map((d) => d.collectedCents));
  const liabilities = [
    one("l-comm", "Commissions owed", commOwed, { style: "detail", source: "Earned on installed deals, not yet paid" }),
    one("l-inst", "Installer pay owed", instOwed, { style: "detail", source: "Installed deals, not yet paid" }),
    one("l-dep", "Customer deposits", deposits, { style: "detail", source: "Money collected on jobs not installed yet" }),
  ];
  const totalLiab = one("liab", "Total liabilities", sumCents(liabilities.map((x) => x.total)), { style: "subtotal" });
  const equity = one("equity", "Owners' equity", totalAssets.total - totalLiab.total, { style: "subtotal", source: "Assets minus liabilities" });

  return {
    asOf,
    lines: [
      { key: "h-a", label: "Assets", values: [0], total: 0, style: "heading" } as StatementLine, ...assets, totalAssets,
      { key: "h-l", label: "Liabilities", values: [0], total: 0, style: "heading" } as StatementLine, ...liabilities, totalLiab,
      { key: "h-e", label: "Equity", values: [0], total: 0, style: "heading" } as StatementLine, equity,
      one("le", "Total liabilities and equity", totalLiab.total + equity.total, { style: "grand" }),
    ],
    flags,
  };
}

function fmtUsd(c: number) {
  return `$${Math.round(c / 100).toLocaleString("en-US")}`;
}

/* ── Home ──────────────────────────────────────────────────────────── */

export interface PersonStat {
  name: string;
  deals: number;
  revenueCents: number;
  avgCents: number;
}

export interface HomeMetrics {
  from: string;
  to: string;
  revenueCents: number;
  installs: number;
  soldCents: number;
  sold: number;
  collectedCents: number;
  receivableCents: number;
  receivableDeals: number;
  expensesCents: number;
  bankThrough: string | null;
  reps: PersonStat[];
  installers: PersonStat[];
}

export async function homeMetrics(today: string, days: number): Promise<HomeMetrics> {
  const from = addDays(today, -(days - 1));
  const [deals, txns, balances] = await Promise.all([loadLedger(today), loadTransactions({ from, to: today }), accountBalances(today)]);
  const l = live(deals);
  const inWin = (d: string | null) => d != null && d >= from && d <= today;

  const installed = l.filter((d) => inWin(d.installedOn));
  const sold = l.filter((d) => inWin(d.saleDate));
  const ar = l.filter((d) => d.isInstalled && Math.max(0, d.cashDueCents) + Math.max(0, d.fundingDueCents) > SETTLED);

  const rank = (rows: DerivedDeal[], who: (d: DerivedDeal) => string | null): PersonStat[] => {
    const m = new Map<string, { deals: number; rev: number }>();
    for (const d of rows) {
      const k = who(d) ?? "Unassigned";
      const e = m.get(k) ?? { deals: 0, rev: 0 };
      e.deals++;
      e.rev += d.priceCents;
      m.set(k, e);
    }
    return [...m.entries()]
      .map(([name, e]) => ({ name, deals: e.deals, revenueCents: e.rev, avgCents: Math.round(e.rev / e.deals) }))
      .sort((a, b) => b.revenueCents - a.revenueCents || b.deals - a.deals);
  };

  // Business spending: everything out of the bank except loans, owner draws and moves between our accounts.
  const spendKinds = new Set(["ledger", "cogs", "opex", "uncategorized"]);
  return {
    from,
    to: today,
    revenueCents: sumCents(installed.map((d) => d.priceCents)),
    installs: installed.length,
    soldCents: sumCents(sold.map((d) => d.priceCents)),
    sold: sold.length,
    collectedCents: sumCents(txns.filter((t) => t.kind === "income").map((t) => t.amountCents)),
    receivableCents: sumCents(ar.map((d) => Math.max(0, d.cashDueCents) + Math.max(0, d.fundingDueCents))),
    receivableDeals: ar.length,
    expensesCents: -sumCents(txns.filter((t) => spendKinds.has(t.kind) && t.amountCents < 0).map((t) => t.amountCents)),
    bankThrough: balances.map((b) => b.lastOn).filter(Boolean).sort().at(-1) ?? null,
    reps: rank(sold, (d) => d.closer?.name ?? null),
    installers: rank(installed, (d) => d.installer?.name ?? null),
  };
}

