/**
 * Today's sales appointments for the sales form: each one with the customer's
 * details from GoHighLevel, so the rep picks the appointment they're at and the
 * form fills itself in.
 */
import { z } from "zod";
import { db, tx } from "./db";
import { EditError } from "./ledger/edit";
import { GHL_LOCATIONS, loadCalendar, type CalEvent, type GhlLocation } from "./ghl";
import { addDays } from "./ledger/payrun";
import { matchRoster } from "./person-match";
import type { Disposition, Outcome } from "./appointment-types";
export { DECLINE_REASONS, type Disposition, type Outcome } from "./appointment-types";

const API = "https://services.leadconnectorhq.com";

export interface SaleAppointment {
  id: string;
  location: GhlLocation["slug"];
  locationName: string;
  start: string;
  end: string;
  status: string;
  repPersonId: string | null;
  repName: string | null;
  customerName: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  leadSource: string | null;
  contactId: string | null;
  contactUrl: string | null;
  /** Set when a sale has already been entered from this appointment. */
  soldDealNumber: number | null;
  disposition: Disposition | null;
}


/** "(910) 555-0142" from "+19105550142"; anything else as given. */
export function formatPhone(p: string | null | undefined): string | null {
  if (!p) return null;
  const d = p.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : p;
}

/** The customer out of a title like "confirmed. todd leggens — demo (AquaReport)". */
export function customerFromTitle(t: string): string {
  return (
    t
      .replace(/^\s*(confirmed|showed|no ?show|cancell?ed|new)\s*[:.\-–]\s*/i, "")
      .replace(/\s*[—–-]\s*(demo|consult|consultation|appointment|water test|install)\b.*$/i, "")
      .replace(/\s+water test.*$/i, "")
      .trim() || t
  );
}

/** "Meeting Location: 1631 SC-544 Conway, SC" → "1631 SC-544 Conway, SC". */
/** Also drops a place label in front of a street number ("Clear Flow Conway: 1631 SC-544 …"). */
const cleanAddress = (a: string | null) =>
  a
    ?.replace(/^\s*(meeting location|location|address)\s*:\s*/i, "")
    .replace(/^[^:\d]{2,40}:\s*(?=\d)/, "")
    .trim() || null;
const title = (s: string) => s.replace(/\b([a-z])([a-z']*)/g, (_, a: string, b: string) => a.toUpperCase() + b);

interface Contact {
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  address1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  source?: string;
  attributionSource?: { utmSource?: string; sessionSource?: string; medium?: string };
}

async function contact(loc: GhlLocation, id: string): Promise<Contact | null> {
  const token = process.env[loc.tokenEnv];
  if (!token) return null;
  try {
    const res = await fetch(`${API}/contacts/${id}`, { headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28", Accept: "application/json" }, next: { revalidate: 60 } });
    if (!res.ok) return null;
    return ((await res.json()) as { contact?: Contact }).contact ?? null;
  } catch {
    return null;
  }
}

const sourceOf = (c: Contact | null): string | null => {
  const a = c?.attributionSource;
  const s = c?.source || a?.utmSource || a?.sessionSource || null;
  // GoHighLevel's own labels for how a contact got in ("CRM UI", "API", imports) aren't lead sources.
  if (!s || /^(crm ui|crm|manual|api|import|csv|zapier|integration|workflow)$/i.test(s.trim())) return null;
  if (/facebook|fb|meta|instagram/i.test(s)) return "Meta";
  if (/google/i.test(s)) return "Google Ads";
  if (/referr/i.test(s)) return "Referral";
  return s;
};

/**
 * Sales appointments on `day` (Eastern). With a personId, only that rep's
 * (matched by their GoHighLevel user's name, e.g. "Mike CF" is Mike).
 */
export async function salesAppointments(day: string, personId: string | null): Promise<{ appointments: SaleAppointment[]; problems: Array<{ location: string; message: string }> }> {
  const [cal, people, sold, disp] = await Promise.all([
    loadCalendar(`${addDays(day, -1)}T12:00:00Z`, `${addDays(day, 1)}T12:00:00Z`),
    db().query("select id, name from people where active"),
    db()
      .query(`select fs.payload ->> 'appointmentId' as appt, d.number from form_submissions fs join deals d on d.id = fs.deal_id where fs.kind = 'sale' and fs.payload ? 'appointmentId'`)
      .catch(() => ({ rows: [] as Array<{ appt: string; number: number }> })),
    db()
      .query(
        `select ad.appointment_id, ad.outcome, ad.reason, ad.note, ad.rescheduled_to::text, ad.updated_at, d.number
         from appointment_dispositions ad left join deals d on d.id = ad.deal_id where ad.appointment_day between $1::date - 1 and $1::date + 1`,
        [day],
      )
      .catch(() => ({ rows: [] as Array<Record<string, unknown>> })), // before the table exists
  ]);
  const dispBy = new Map(
    disp.rows.map((r) => [
      String(r.appointment_id),
      {
        outcome: r.outcome as Outcome,
        reason: (r.reason as string) ?? null,
        note: (r.note as string) ?? null,
        rescheduledTo: (r.rescheduled_to as string) ?? null,
        dealNumber: r.number == null ? null : Number(r.number),
        at: new Date(r.updated_at as string).toISOString(),
      } satisfies Disposition,
    ]),
  );
  const roster = people.rows as Array<{ id: string; name: string }>;
  const soldBy = new Map(sold.rows.map((r) => [r.appt as string, Number(r.number)]));
  const evs = cal.events.filter((e: CalEvent) => e.kind === "sales" && e.day === day && e.status !== "cancelled" && e.status !== "invalid");
  const withRep = evs.map((e) => ({ e, rep: e.assignedTo ? matchRoster(e.assignedTo, roster).person : null }));
  const mine = personId ? withRep.filter((x) => x.rep?.id === personId) : withRep;

  const appointments = await Promise.all(
    mine.map(async ({ e, rep }): Promise<SaleAppointment> => {
      const loc = GHL_LOCATIONS.find((l) => l.slug === e.location)!;
      const contactId = e.contactUrl?.split("/").pop() ?? null;
      const c = contactId ? await contact(loc, contactId) : null;
      const name = [c?.firstName, c?.lastName].filter(Boolean).join(" ").trim();
      const street = c?.address1 ? [c.address1, c.city, [c.state, c.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ") : null;
      return {
        id: e.id,
        location: e.location,
        locationName: e.locationName,
        start: e.start,
        end: e.end,
        status: e.status,
        repPersonId: rep?.id ?? null,
        repName: rep?.name ?? e.assignedTo,
        customerName: name ? title(name) : title(customerFromTitle(e.title)),
        address: street ?? cleanAddress(e.address),
        phone: formatPhone(c?.phone),
        email: c?.email?.trim() || null,
        leadSource: sourceOf(c),
        contactId,
        contactUrl: e.contactUrl,
        soldDealNumber: soldBy.get(e.id) ?? dispBy.get(e.id)?.dealNumber ?? null,
        disposition: dispBy.get(e.id) ?? null,
      };
    }),
  );
  appointments.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  return { appointments, problems: cal.problems };
}

/* ── Dispositions ────────────────────────────────────────────────────── */

export const DispositionInput = z.object({
  appointmentId: z.string().min(1).max(64),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  outcome: z.enum(["declined", "rescheduled"]),
  reason: z.string().trim().max(120).optional().nullable(),
  note: z.string().trim().max(1000).optional().nullable(),
  rescheduledTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});

/**
 * Declined or rescheduled, as the rep reports it. A rep can only disposition
 * their own appointments; a closed one (a sale) can't be changed here.
 * (Closed is recorded by the sales form, with the deal.)
 */
export async function recordDisposition(input: unknown, who: { personId: string | null; isAdmin: boolean; actor: string }): Promise<{ ok: true }> {
  const p = DispositionInput.safeParse(input);
  if (!p.success) throw new EditError(p.error.issues[0]?.message ?? "Check the form", 400);
  const v = p.data;
  if (v.outcome === "rescheduled" && v.rescheduledTo && v.rescheduledTo < v.day) throw new EditError("The new date can't be before the appointment.", 400);
  const { appointments } = await salesAppointments(v.day, who.isAdmin ? null : who.personId);
  const a = appointments.find((x) => x.id === v.appointmentId);
  if (!a) throw new EditError(who.isAdmin ? "That appointment isn't on the calendar that day." : "That appointment isn't on your calendar that day.", 404);
  if (a.disposition?.outcome === "closed" || a.soldDealNumber != null) throw new EditError("This appointment already has a sale on it.", 409);
  await tx(who.actor, async (c) => {
    const loc = (await c.query("select id from locations where slug = $1", [a.location])).rows[0];
    await c.query(
      `insert into appointment_dispositions (appointment_id, location_id, person_id, appointment_day, customer_name, contact_id, outcome, reason, note, rescheduled_to, recorded_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       on conflict (appointment_id) do update set outcome = excluded.outcome, reason = excluded.reason, note = excluded.note,
         rescheduled_to = excluded.rescheduled_to, recorded_by = excluded.recorded_by, updated_at = now()`,
      [a.id, loc?.id ?? null, a.repPersonId, v.day, a.customerName, a.contactId, v.outcome, v.outcome === "declined" ? v.reason || null : null, v.note || null, v.outcome === "rescheduled" ? v.rescheduledTo || null : null, who.actor],
    );
  });
  return { ok: true };
}
