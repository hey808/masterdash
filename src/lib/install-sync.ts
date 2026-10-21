/**
 * Keep the ledger's install dates in step with the GoHighLevel installer
 * calendars. An install appointment's title is the customer's name
 * ("Linda Griffin — install (AquaReport)"); it's matched to the one live deal
 * at that location with the same name. The deal's scheduled install date
 * becomes the appointment's day. If a customer has several, the latest one
 * that isn't cancelled wins (a reschedule). Installed dates are never touched:
 * those come from the installer form.
 */
import { tx } from "./db";
import { addDays } from "./ledger/payrun";
import { loadCalendar, type CalEvent } from "./ghl";

export const normName = (s: string) =>
  s
    .toLowerCase()
    .replace(/^\s*(confirmed|showed|no ?show|cancell?ed|new)\s*[:.\-–]\s*/i, "")
    .replace(/\s*[—–-]\s*install\b.*$/i, "")
    .replace(/[^a-z0-9&]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** First and last name, ignoring "(…)" notes and "& spouse": "John & Kim Dupree" → "john dupree". */
export function firstLast(s: string): string | null {
  const words = normName(s.replace(/\([^)]*\)/g, " ")).split(" ").filter((w) => w && w !== "&");
  return words.length >= 2 ? `${words[0]} ${words[words.length - 1]}` : null;
}

export interface InstallMatch {
  dealId: string;
  number: number;
  customer: string;
  from: string | null;
  to: string;
}

/** Pure: which deals' scheduled install date the calendar says to change. */
export function planInstallDates(
  events: Array<Pick<CalEvent, "kind" | "status" | "title" | "day" | "location">>,
  deals: Array<{ id: string; number: number; customer: string; location: string; scheduled: string | null }>,
): { changes: InstallMatch[]; unmatched: string[] } {
  const latest = new Map<string, { day: string; title: string }>(); // location|name → latest day
  for (const e of events) {
    if (e.kind !== "install" || e.status === "cancelled" || e.status === "invalid") continue;
    const k = `${e.location}|${normName(e.title)}`;
    const cur = latest.get(k);
    if (!cur || e.day > cur.day) latest.set(k, { day: e.day, title: e.title });
  }
  const byKey = new Map<string, typeof deals>();
  for (const d of deals) {
    const k = `${d.location}|${normName(d.customer)}`;
    byKey.set(k, [...(byKey.get(k) ?? []), d]);
  }
  // Second pass: same first + last name at the same location, when only one deal fits.
  const byFL = new Map<string, typeof deals>();
  for (const d of deals) {
    const fl = firstLast(d.customer);
    if (fl) byFL.set(`${d.location}|${fl}`, [...(byFL.get(`${d.location}|${fl}`) ?? []), d]);
  }
  const changes: InstallMatch[] = [];
  const unmatched: string[] = [];
  for (const [k, ev] of latest) {
    let ds = byKey.get(k);
    if (!ds) {
      const fl = firstLast(ev.title);
      ds = fl ? byFL.get(`${k.split("|")[0]}|${fl}`) : undefined;
    }
    if (!ds || ds.length !== 1) {
      unmatched.push(ev.title);
      continue;
    }
    const d = ds[0]!;
    if (d.scheduled !== ev.day) changes.push({ dealId: d.id, number: d.number, customer: d.customer, from: d.scheduled, to: ev.day });
  }
  return { changes, unmatched };
}

export async function syncInstallDates(today: string): Promise<{ changes: InstallMatch[]; unmatched: string[] }> {
  const cal = await loadCalendar(`${addDays(today, -150)}T12:00:00Z`, `${addDays(today, 180)}T12:00:00Z`);
  if (cal.events.length === 0) return { changes: [], unmatched: [] };
  return tx("sync:ghl-calendar", async (c) => {
    const { rows } = await c.query(
      `select d.id, d.number, d.customer_name as customer, l.slug as location, d.install_scheduled_on::text as scheduled
       from deals d join locations l on l.id = d.location_id
       where d.cancelled_at is null and d.closed_at is null and d.installed_on is null`,
    );
    const plan = planInstallDates(cal.events, rows.map((r) => ({ ...r, number: Number(r.number) })));
    for (const ch of plan.changes) {
      await c.query("update deals set install_scheduled_on = $2, updated_at = now() where id = $1 and installed_on is null", [ch.dealId, ch.to]);
    }
    return plan;
  });
}
