/**
 * Sales and Operations dashboards. Everything comes from the ledger (deals),
 * the GoHighLevel calendars (appointments) and the warehouse; nothing is stored.
 */
import { db } from "./db";
import { loadCalendar, type CalEvent } from "./ghl";
import { loadPurchaseOrders, loadStock, type StockRow } from "./inventory";
import { loadCapacity } from "./capacity";
import { SETTLED_CENTS } from "./ledger/derive";
import { addDays } from "./ledger/payrun";
import { loadLedger } from "./ledger/repo";
import type { DerivedDeal } from "./ledger/types";
import { matchRoster } from "./person-match";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
const mondayOf = (d: string) => addDays(d, -((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7));
const inRange = (d: string | null, from: string, to: string) => d != null && d >= from && d <= to;
/** Appointments that took a slot and happened: not cancelled, not a no-show, not in the future. */
const ran = (e: CalEvent, today: string) => e.day <= today && e.status !== "cancelled" && e.status !== "invalid" && e.status !== "noshow";
const noShow = (e: CalEvent, today: string) => e.day <= today && e.status === "noshow";

/** The calendar can't be asked for all time; appointments look back at most a year. */
const calFrom = (from: string, today: string) => (from < addDays(today, -365) ? addDays(today, -365) : from);

/* ── Sales ───────────────────────────────────────────────────────────── */

export interface RepRow {
  name: string;
  appts: number;
  noShows: number;
  sold: number;
  closeRate: number | null;
  revenueCents: number;
  avgCents: number | null;
  financedPct: number | null;
  cancelled: number;
  commissionCents: number;
}

export interface SalesDashboard {
  from: string;
  to: string;
  apptsFrom: string;
  soldCents: number;
  sold: number;
  avgCents: number | null;
  appts: number;
  noShows: number;
  closeRate: number | null;
  financedPct: number | null;
  cancelled: number;
  cancelledCents: number;
  /** Booked sales appointments from today through the next 7 days. */
  upcomingAppts: number;
  reps: RepRow[];
  sources: Array<{ name: string; deals: number; revenueCents: number }>;
  locations: Array<{ name: string; deals: number; revenueCents: number; appts: number; closeRate: number | null }>;
  /** Last 12 weeks, oldest first, regardless of the frame. */
  weeks: Array<{ week: string; deals: number; revenueCents: number }>;
  problems: Array<{ location: string; message: string }>;
}

export async function salesDashboard(today: string, from: string, to: string): Promise<SalesDashboard> {
  const aFrom = calFrom(from, today);
  const weeksFrom = addDays(mondayOf(today), -77);
  const calStart = aFrom < weeksFrom ? aFrom : weeksFrom;
  const [deals, cal, roster] = await Promise.all([
    loadLedger(today),
    loadCalendar(`${addDays(calStart, -1)}T12:00:00Z`, `${addDays(today < to ? to : today, 8)}T12:00:00Z`),
    db().query("select id, name from people"),
  ]);
  const people = roster.rows as Array<{ id: string; name: string }>;
  const sold = deals.filter((d) => inRange(d.saleDate, from, to));
  const live = sold.filter((d) => d.stage !== "cancelled");
  const cancelled = sold.filter((d) => d.stage === "cancelled");
  const sales = cal.events.filter((e) => e.kind === "sales");
  const inWin = sales.filter((e) => inRange(e.day, aFrom, to));
  const ranWin = inWin.filter((e) => ran(e, today));

  // Appointment → roster person by the GHL user's name ("Mike CF" → Mike).
  const personOf = new Map<string, string>();
  const repOf = (e: CalEvent) => {
    if (!e.assignedTo) return "Unassigned";
    if (!personOf.has(e.assignedTo)) personOf.set(e.assignedTo, matchRoster(e.assignedTo, people).person?.name ?? e.assignedTo);
    return personOf.get(e.assignedTo)!;
  };
  // Close rate only counts sales whose appointment window we can see.
  const closable = live.filter((d) => d.saleDate >= aFrom);
  const rate = (n: number, of: number) => (of > 0 ? n / of : null);
  const financed = (ds: DerivedDeal[]) => (ds.length ? sum(ds.map((d) => d.financedPortionCents)) / Math.max(1, sum(ds.map((d) => d.priceCents))) : null);

  const names = new Set<string>([...live.map((d) => d.closer?.name ?? "Unassigned"), ...ranWin.map(repOf)]);
  const reps: RepRow[] = [...names]
    .map((name) => {
      const mine = live.filter((d) => (d.closer?.name ?? "Unassigned") === name);
      const appts = ranWin.filter((e) => repOf(e) === name).length;
      const rev = sum(mine.map((d) => d.priceCents));
      return {
        name,
        appts,
        noShows: inWin.filter((e) => noShow(e, today) && repOf(e) === name).length,
        sold: mine.length,
        closeRate: rate(mine.filter((d) => d.saleDate >= aFrom).length, appts),
        revenueCents: rev,
        avgCents: mine.length ? Math.round(rev / mine.length) : null,
        financedPct: financed(mine),
        cancelled: cancelled.filter((d) => (d.closer?.name ?? "Unassigned") === name).length,
        commissionCents: sum(mine.map((d) => d.commissionCents)),
      };
    })
    .filter((r) => r.sold > 0 || r.appts > 0)
    .sort((a, b) => b.revenueCents - a.revenueCents || b.appts - a.appts);

  const group = <K extends string>(ds: DerivedDeal[], key: (d: DerivedDeal) => K) => {
    const m = new Map<K, DerivedDeal[]>();
    for (const d of ds) m.set(key(d), [...(m.get(key(d)) ?? []), d]);
    return m;
  };
  const sources = [...group(live, (d) => (d.leadSource?.trim() || "Not set").replace(/^gohighlevel$/i, "GoHighLevel")).entries()]
    .map(([name, ds]) => ({ name, deals: ds.length, revenueCents: sum(ds.map((d) => d.priceCents)) }))
    .sort((a, b) => b.revenueCents - a.revenueCents);
  const locNames: Record<string, string> = { wilmington: "Wilmington", "myrtle-beach": "Myrtle Beach" };
  const locations = Object.entries(locNames).map(([slug, name]) => {
    const ds = live.filter((d) => d.location === slug);
    const appts = ranWin.filter((e) => e.location === slug).length;
    return { name, deals: ds.length, revenueCents: sum(ds.map((d) => d.priceCents)), appts, closeRate: rate(ds.filter((d) => d.saleDate >= aFrom).length, appts) };
  });

  const weeks = Array.from({ length: 12 }, (_, i) => addDays(weeksFrom, i * 7)).map((week) => {
    const ds = deals.filter((d) => d.stage !== "cancelled" && inRange(d.saleDate, week, addDays(week, 6)));
    return { week, deals: ds.length, revenueCents: sum(ds.map((d) => d.priceCents)) };
  });

  const soldCents = sum(live.map((d) => d.priceCents));
  return {
    from,
    to,
    apptsFrom: aFrom,
    soldCents,
    sold: live.length,
    avgCents: live.length ? Math.round(soldCents / live.length) : null,
    appts: ranWin.length,
    noShows: inWin.filter((e) => noShow(e, today)).length,
    closeRate: rate(closable.length, ranWin.length),
    financedPct: financed(live),
    cancelled: cancelled.length,
    cancelledCents: sum(cancelled.map((d) => d.priceCents)),
    upcomingAppts: sales.filter((e) => e.day >= today && e.day <= addDays(today, 7) && e.status !== "cancelled" && e.status !== "invalid").length,
    reps,
    sources,
    locations,
    weeks,
    problems: cal.problems,
  };
}

/* ── Operations ──────────────────────────────────────────────────────── */

export interface OpsDeal {
  id: string;
  number: number;
  customer: string;
  location: string;
  closer: string | null;
  scheduled: string | null;
  daysLate: number | null;
  priceCents: number;
}

export interface OpsDashboard {
  from: string;
  to: string;
  installs: number;
  installedCents: number;
  avgDaysToInstall: number | null;
  needsAttention: OpsDeal[];
  awaitingInstall: number;
  awaitingInstallCents: number;
  noDate: number;
  owedAfterInstall: number;
  owedAfterInstallCents: number;
  installers: Array<{ name: string; installs: number; revenueCents: number; avgDays: number | null; payCents: number }>;
  upcoming: Array<{ day: string; events: CalEvent[] }>;
  capacity: Array<{ name: string; weeks: Array<{ label: string; booked: number; capacity: number }>; backlogJobs: number; backlogWeeks: number | null }>;
  stockAlerts: Array<StockRow & { location: string }>;
  openPOs: Array<{ number: number; location: string; vendor: string; expectedOn: string | null; units: number; late: boolean }>;
  problems: Array<{ location: string; message: string }>;
}

export async function opsDashboard(today: string, from: string, to: string): Promise<OpsDashboard> {
  const [deals, cal, cap, wil, myr, pos] = await Promise.all([
    loadLedger(today),
    loadCalendar(`${addDays(today, -1)}T12:00:00Z`, `${addDays(today, 15)}T12:00:00Z`),
    loadCapacity(today, undefined, 2).catch(() => null),
    loadStock("wilmington", today),
    loadStock("myrtle-beach", today),
    loadPurchaseOrders(null),
  ]);
  const live = deals.filter((d) => d.stage !== "cancelled");
  const installed = live.filter((d) => inRange(d.installedOn, from, to));
  const open = live.filter((d) => !d.isInstalled && d.stage !== "closed");
  const toOps = (d: DerivedDeal): OpsDeal => ({
    id: d.id,
    number: d.number,
    customer: d.customerName,
    location: d.location,
    closer: d.closer?.name ?? null,
    scheduled: d.installScheduledOn,
    daysLate: d.installScheduledOn && d.installScheduledOn < today ? daysBetween(d.installScheduledOn, today) : null,
    priceCents: d.priceCents,
  });
  const owed = live.filter((d) => d.isInstalled && Math.max(0, d.cashDueCents) + Math.max(0, d.fundingDueCents) > SETTLED_CENTS);
  const days = (ds: DerivedDeal[]) => {
    const xs = ds.filter((d) => d.installedOn).map((d) => daysBetween(d.saleDate, d.installedOn!)).filter((n) => n >= 0);
    return xs.length ? sum(xs) / xs.length : null;
  };
  const byInstaller = new Map<string, DerivedDeal[]>();
  for (const d of installed) byInstaller.set(d.installer?.name ?? "Unassigned", [...(byInstaller.get(d.installer?.name ?? "Unassigned") ?? []), d]);

  const installEvents = cal.events.filter((e) => e.kind === "install" && e.day >= today && e.day <= addDays(today, 13) && e.status !== "cancelled" && e.status !== "invalid");
  const upcoming = [...new Set(installEvents.map((e) => e.day))].sort().map((day) => ({ day, events: installEvents.filter((e) => e.day === day) }));

  const stockAlerts = [
    ...wil.filter((r) => r.status === "short" || r.status === "order").map((r) => ({ ...r, location: "Wilmington" })),
    ...myr.filter((r) => r.status === "short" || r.status === "order").map((r) => ({ ...r, location: "Myrtle Beach" })),
  ].sort((a, b) => (a.status === b.status ? a.skuCode.localeCompare(b.skuCode) : a.status === "short" ? -1 : 1));

  return {
    from,
    to,
    installs: installed.length,
    installedCents: sum(installed.map((d) => d.priceCents)),
    avgDaysToInstall: days(installed),
    needsAttention: open.filter((d) => d.stage === "needs-attention").map(toOps).sort((a, b) => (b.daysLate ?? 0) - (a.daysLate ?? 0)),
    awaitingInstall: open.filter((d) => d.stage === "awaiting-install").length,
    awaitingInstallCents: sum(open.filter((d) => d.stage === "awaiting-install").map((d) => d.priceCents)),
    noDate: open.filter((d) => !d.installScheduledOn).length,
    owedAfterInstall: owed.length,
    owedAfterInstallCents: sum(owed.map((d) => Math.max(0, d.cashDueCents) + Math.max(0, d.fundingDueCents))),
    installers: [...byInstaller.entries()]
      .map(([name, ds]) => ({ name, installs: ds.length, revenueCents: sum(ds.map((d) => d.priceCents)), avgDays: days(ds), payCents: sum(ds.map((d) => d.installerPayCents ?? 0)) }))
      .sort((a, b) => b.installs - a.installs),
    upcoming,
    capacity: (cap?.locations ?? []).map((l) => ({
      name: l.name,
      weeks: l.install.map((w, i) => ({ label: i === 0 ? "This week" : "Next week", booked: w.booked, capacity: w.capacity })),
      backlogJobs: l.backlogJobs,
      backlogWeeks: l.backlogWeeks,
    })),
    stockAlerts,
    openPOs: pos
      .filter((p) => p.status === "ordered")
      .map((p) => ({ number: p.number, location: p.locationName, vendor: p.vendor, expectedOn: p.expectedOn, units: sum(p.lines.map((l) => l.qty)), late: p.expectedOn != null && p.expectedOn < today })),
    problems: [...cal.problems, ...(cap?.problems ?? [])].filter((p, i, a) => a.findIndex((q) => q.message === p.message) === i),
  };
}
