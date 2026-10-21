/**
 * Appointment slot capacity and utilization, per location and week.
 *
 *   capacity  = sum of each active team member's weekly slots (or that week's override)
 *   booked    = GoHighLevel appointments on that location's sales / installer calendars
 *               that week, not cancelled or invalid (no-shows used the slot, so they count)
 *   utilization = booked / capacity
 *
 * The ads call is about sales appointments, but checks installs first: if sold jobs
 * are already weeks behind the installers, more appointments only make the wait longer.
 */
import { z } from "zod";
import { db, tx } from "./db";
import { loadCalendar, type CalEvent, type GhlLocation } from "./ghl";
import { EditError } from "./ledger/edit";
import { addDays } from "./ledger/payrun";

export type CapRole = "sales" | "install";
const COUNTS = (e: CalEvent) => e.status !== "cancelled" && e.status !== "invalid";

/* ── The ads call (pure) ─────────────────────────────────────────────── */

export type AdsLevel = "push-hard" | "push" | "steady" | "hold" | "pull";

export interface AdsCall {
  level: AdsLevel;
  /** More booked sales appointments needed to reach the target this week. */
  needed: number;
  /** needed × cost per booked appointment, when that cost is known. */
  spendCents: number | null;
  headline: string;
  why: string;
}

export function adsCall(i: {
  salesCapacity: number;
  salesBooked: number;
  targetPct: number;
  /** Sold jobs not installed yet, divided by weekly install capacity. Null = no installers set up. */
  installBacklogWeeks: number | null;
  costPerApptCents: number | null;
}): AdsCall {
  const util = i.salesCapacity > 0 ? i.salesBooked / i.salesCapacity : 0;
  const pct = Math.round(util * 100);
  const targetCount = Math.ceil((i.salesCapacity * i.targetPct) / 100);
  const needed = Math.max(0, targetCount - i.salesBooked);
  const spend = (n: number) => (i.costPerApptCents != null ? n * i.costPerApptCents : null);
  const backlog = i.installBacklogWeeks;

  if (i.salesCapacity === 0) {
    return { level: "hold", needed: 0, spendCents: null, headline: "No sales capacity set", why: "Add salespeople and their weekly appointment slots below." };
  }
  if (backlog != null && backlog > 4) {
    return {
      level: "pull",
      needed: 0,
      spendCents: 0,
      headline: "Pull back ads",
      why: `Installs are ${backlog.toFixed(1)} weeks behind. More sales now only lengthens the wait; add install capacity first.`,
    };
  }
  if (backlog != null && backlog > 3 && needed > 0) {
    return {
      level: "hold",
      needed,
      spendCents: 0,
      headline: "Hold ads steady",
      why: `Sales is at ${pct}% with ${needed} open to target, but installs are ${backlog.toFixed(1)} weeks behind. Don't add spend until that's under 3 weeks.`,
    };
  }
  if (util > 1.1) {
    return { level: "pull", needed: 0, spendCents: 0, headline: "Overbooked: pull back ads", why: `Sales is at ${pct}% of capacity. Add closers or move appointments before buying more.` };
  }
  if (needed === 0) {
    return { level: "steady", needed: 0, spendCents: 0, headline: "On target: keep ads steady", why: `Sales is at ${pct}%, at or above the ${i.targetPct}% target.` };
  }
  const hard = pct < i.targetPct - 25;
  return {
    level: hard ? "push-hard" : "push",
    needed,
    spendCents: spend(needed),
    headline: hard ? "Push ads hard" : "Push ads",
    why: `Sales is at ${pct}% of capacity. ${needed} more booked appointment${needed === 1 ? "" : "s"} reach${needed === 1 ? "es" : ""} the ${i.targetPct}% target.`,
  };
}

/* ── Loading ─────────────────────────────────────────────────────────── */

export interface Member {
  id: string;
  personId: string;
  personName: string;
  role: CapRole;
  weeklySlots: number;
  ghlUserId: string | null;
  active: boolean;
  /** Per week shown: slots that week and appointments booked under their GHL user. */
  weeks: Array<{ week: string; slots: number; override: boolean; booked: number }>;
}

export interface RoleWeek {
  week: string;
  capacity: number;
  booked: number;
  /** Bookings on this location's calendars not matched to an active member. */
  unmatched: number;
}

export interface LocationCapacity {
  slug: GhlLocation["slug"];
  name: string;
  locationId: string;
  targetPct: number;
  costPerApptCents: number | null;
  members: Member[];
  sales: RoleWeek[];
  install: RoleWeek[];
  /** Sold, not installed, not cancelled. */
  backlogJobs: number;
  backlogWeeks: number | null;
  ads: AdsCall[]; // per week
}

const mondayOf = (d: string) => addDays(d, -((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7));

export async function loadCapacity(today: string, firstWeek = mondayOf(today), weeksCount = 4): Promise<{ weeks: string[]; locations: LocationCapacity[]; problems: Array<{ location: string; message: string }> }> {
  const weeks = Array.from({ length: weeksCount }, (_, i) => addDays(firstWeek, i * 7));
  const end = addDays(weeks[weeks.length - 1]!, 7);
  const [locRows, memberRows, overrideRows, settingRows, backlogRows, cal] = await Promise.all([
    db().query("select id, slug, name from locations where active order by name"),
    db()
      .query(
        `select m.id, m.location_id, m.person_id, p.name as person_name, m.role, m.weekly_slots, m.ghl_user_id, m.active
         from capacity_members m join people p on p.id = m.person_id order by m.role desc, m.active desc, p.name`,
      )
      .catch(missing),
    db().query("select member_id, week_start::text as week_start, slots from capacity_overrides where week_start >= $1 and week_start < $2", [weeks[0], end]).catch(missing),
    db().query("select location_id, target_pct, cost_per_appt_cents from capacity_settings").catch(missing),
    db().query("select location_id, count(*)::int as n from deals where installed_on is null and cancelled_at is null group by location_id"),
    loadCalendar(`${addDays(weeks[0]!, -1)}T12:00:00Z`, `${end}T12:00:00Z`),
  ]);
  const overrides = new Map(overrideRows.rows.map((r) => [`${r.member_id}:${r.week_start}`, Number(r.slots)]));
  const weekOf = (day: string) => weeks.find((w) => day >= w && day < addDays(w, 7)) ?? null;

  const locations: LocationCapacity[] = locRows.rows
    .filter((l) => l.slug === "wilmington" || l.slug === "myrtle-beach")
    .map((l) => {
      const slug = l.slug as GhlLocation["slug"];
      const setting = settingRows.rows.find((s) => s.location_id === l.id);
      const evs = cal.events.filter((e) => e.location === slug && COUNTS(e));
      const members: Member[] = memberRows.rows
        .filter((m) => m.location_id === l.id)
        .map((m) => ({
          id: m.id,
          personId: m.person_id,
          personName: m.person_name,
          role: m.role,
          weeklySlots: Number(m.weekly_slots),
          ghlUserId: m.ghl_user_id,
          active: m.active,
          weeks: weeks.map((w) => {
            const o = overrides.get(`${m.id}:${w}`);
            return {
              week: w,
              slots: m.active ? (o ?? Number(m.weekly_slots)) : 0,
              override: o != null,
              booked: m.ghl_user_id ? evs.filter((e) => e.kind === (m.role === "sales" ? "sales" : "install") && e.assignedUserId === m.ghl_user_id && weekOf(e.day) === w).length : 0,
            };
          }),
        }));
      const roleWeeks = (role: CapRole): RoleWeek[] =>
        weeks.map((w, i) => {
          const ms = members.filter((m) => m.role === role && m.active);
          const inWeek = evs.filter((e) => e.kind === role && weekOf(e.day) === w);
          const matched = new Set(ms.map((m) => m.ghlUserId).filter(Boolean));
          return {
            week: w,
            capacity: ms.reduce((s, m) => s + m.weeks[i]!.slots, 0),
            booked: inWeek.length,
            unmatched: inWeek.filter((e) => !e.assignedUserId || !matched.has(e.assignedUserId)).length,
          };
        });
      const sales = roleWeeks("sales");
      const install = roleWeeks("install");
      const backlogJobs = Number(backlogRows.rows.find((b) => b.location_id === l.id)?.n ?? 0);
      const installCap = install[0]!.capacity;
      const backlogWeeks = installCap > 0 ? backlogJobs / installCap : null;
      const targetPct = Number(setting?.target_pct ?? 85);
      const costPerApptCents = setting?.cost_per_appt_cents == null ? null : Number(setting.cost_per_appt_cents);
      return {
        slug,
        name: l.name,
        locationId: l.id,
        targetPct,
        costPerApptCents,
        members,
        sales,
        install,
        backlogJobs,
        backlogWeeks,
        ads: sales.map((s) => adsCall({ salesCapacity: s.capacity, salesBooked: s.booked, targetPct, installBacklogWeeks: backlogWeeks, costPerApptCents })),
      };
    });
  return { weeks, locations, problems: cal.problems };
}

/** Before the capacity tables exist, read as empty. */
function missing(e: unknown): { rows: never[] } {
  if ((e as { code?: string }).code === "42P01") return { rows: [] };
  throw e;
}

/* ── Writes ──────────────────────────────────────────────────────────── */

const uuid = z.string().uuid();
const slots = z.number().int().min(0, "Slots can't be negative").max(200, "That's a lot of slots");
const first = (e: z.ZodError) => e.issues[0]?.message ?? "Check the form";

export const CapacityAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("addMember"), location: z.string().regex(/^[a-z0-9-]+$/), personId: uuid, role: z.enum(["sales", "install"]), weeklySlots: slots, ghlUserId: z.string().max(64).nullable().optional() }),
  z.object({ action: z.literal("updateMember"), id: uuid, weeklySlots: slots.optional(), ghlUserId: z.string().max(64).nullable().optional(), active: z.boolean().optional() }),
  z.object({ action: z.literal("setWeek"), id: uuid, week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), slots: slots.nullable(), note: z.string().max(200).nullable().optional() }),
  z.object({ action: z.literal("settings"), location: z.string().regex(/^[a-z0-9-]+$/), targetPct: z.number().int().min(10).max(150), costPerApptCents: z.number().int().min(0).max(10_000_000).nullable() }),
]);

export async function capacityAction(input: unknown, actor = "web:capacity"): Promise<{ ok: true }> {
  const p = CapacityAction.safeParse(input);
  if (!p.success) throw new EditError(first(p.error), 400);
  const v = p.data;
  await tx(actor, async (c) => {
    const locId = async (slug: string) => {
      const r = (await c.query("select id from locations where slug = $1", [slug])).rows[0];
      if (!r) throw new EditError("Unknown location.", 400);
      return r.id as string;
    };
    switch (v.action) {
      case "addMember": {
        const loc = await locId(v.location);
        await c.query(
          `insert into capacity_members (location_id, person_id, role, weekly_slots, ghl_user_id) values ($1,$2,$3,$4,$5)
           on conflict (location_id, person_id, role) do update set weekly_slots = excluded.weekly_slots, ghl_user_id = coalesce(excluded.ghl_user_id, capacity_members.ghl_user_id), active = true, updated_at = now()`,
          [loc, v.personId, v.role, v.weeklySlots, v.ghlUserId || null],
        );
        break;
      }
      case "updateMember": {
        const r = await c.query(
          `update capacity_members set weekly_slots = coalesce($2, weekly_slots),
             ghl_user_id = case when $3::boolean then $4 else ghl_user_id end, active = coalesce($5, active), updated_at = now()
           where id = $1`,
          [v.id, v.weeklySlots ?? null, v.ghlUserId !== undefined, v.ghlUserId || null, v.active ?? null],
        );
        if (!r.rowCount) throw new EditError("That team member no longer exists.", 404);
        break;
      }
      case "setWeek": {
        if (new Date(`${v.week}T12:00:00Z`).getUTCDay() !== 1) throw new EditError("Weeks start on Monday.", 400);
        if (v.slots == null) await c.query("delete from capacity_overrides where member_id = $1 and week_start = $2", [v.id, v.week]);
        else
          await c.query(
            `insert into capacity_overrides (member_id, week_start, slots, note) values ($1,$2,$3,$4)
             on conflict (member_id, week_start) do update set slots = excluded.slots, note = excluded.note`,
            [v.id, v.week, v.slots, v.note ?? null],
          );
        break;
      }
      case "settings": {
        const loc = await locId(v.location);
        await c.query(
          `insert into capacity_settings (location_id, target_pct, cost_per_appt_cents) values ($1,$2,$3)
           on conflict (location_id) do update set target_pct = excluded.target_pct, cost_per_appt_cents = excluded.cost_per_appt_cents, updated_at = now()`,
          [loc, v.targetPct, v.costPerApptCents],
        );
        break;
      }
    }
  });
  return { ok: true };
}
