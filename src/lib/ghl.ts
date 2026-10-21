/**
 * GoHighLevel calendars, read-only. Sales appointments and installs for each
 * location, pulled live from the GHL API (cached for a minute).
 *
 * Location and calendar IDs are config, not secrets, so they live here. The
 * API keys (private integration tokens) come only from environment variables:
 *   GHL_WILMINGTON_TOKEN, GHL_MYRTLE_TOKEN
 * Calendars marked "do not use", deprecated, test, or setter-only are left out.
 */
const API = "https://services.leadconnectorhq.com";

export type CalKind = "sales" | "install";

export interface GhlLocation {
  slug: "wilmington" | "myrtle-beach";
  name: string;
  locationId: string;
  tokenEnv: string;
  calendars: Array<{ id: string; kind: CalKind; name: string }>;
}

export const GHL_LOCATIONS: GhlLocation[] = [
  {
    slug: "wilmington",
    name: "Wilmington",
    locationId: "RjJ7wzp3qcMC7aamhR5F",
    tokenEnv: "GHL_WILMINGTON_TOKEN",
    calendars: [
      { id: "ESLDeDswok2MtJfQaxyN", kind: "sales", name: "Water Consultation" },
      { id: "jzVHuySUuQO6G0cXlqkx", kind: "install", name: "Installer Angel" },
      { id: "MCJoKo2NQpRBVms2WaO4", kind: "install", name: "Installer Garrett" },
    ],
  },
  {
    slug: "myrtle-beach",
    name: "Myrtle Beach",
    locationId: "ospMdcsOX1WSD458jVJP",
    tokenEnv: "GHL_MYRTLE_TOKEN",
    calendars: [
      { id: "jSVTUzKH8SqhopGkzLEq", kind: "sales", name: "Water Filtration" },
      { id: "IeNXvmcLJxYqo2lbHxue", kind: "install", name: "Installer Calendar" },
    ],
  },
];

export interface CalEvent {
  id: string;
  location: GhlLocation["slug"];
  locationName: string;
  kind: CalKind;
  calendarName: string;
  title: string;
  start: string; // ISO with offset
  end: string;
  /** yyyy-mm-dd in Eastern time, for grouping by day. */
  day: string;
  status: string; // confirmed, showed, noshow, cancelled, new, invalid
  assignedTo: string | null;
  assignedUserId: string | null;
  address: string | null;
  notes: string | null;
  contactUrl: string | null;
  /** What the rep reported (from the app, not GoHighLevel); attached by attachDispositions. */
  disposition?: { outcome: "declined" | "rescheduled" | "closed"; reason: string | null; rescheduledTo: string | null; dealNumber: number | null } | null;
}

export interface CalendarResult {
  events: CalEvent[];
  /** Locations whose key is missing or whose API call failed, with why. */
  problems: Array<{ location: string; message: string }>;
}

const headers = (token: string, version: string) => ({ Authorization: `Bearer ${token}`, Version: version, Accept: "application/json" });

const etDay = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

export interface GhlUser { id: string; name: string; email: string | null }

/** GoHighLevel users for a location, by id. */
export async function userDetails(loc: GhlLocation, token: string): Promise<Map<string, GhlUser>> {
  try {
    const res = await fetch(`${API}/users/?locationId=${loc.locationId}`, { headers: headers(token, "2021-07-28"), next: { revalidate: 3600 } });
    if (!res.ok) return new Map();
    const j = (await res.json()) as { users?: Array<{ id: string; name?: string; firstName?: string; lastName?: string; email?: string }> };
    return new Map(
      (j.users ?? []).map((u) => [u.id, { id: u.id, name: (u.name || `${u.firstName ?? ""} ${u.lastName ?? ""}`).trim(), email: u.email?.trim().toLowerCase() || null }]),
    );
  } catch {
    return new Map();
  }
}

export async function users(loc: GhlLocation, token: string): Promise<Map<string, string>> {
  return new Map([...(await userDetails(loc, token)).values()].map((u) => [u.id, u.name]));
}

/** GHL titles often carry a status prefix ("CONFIRMED: …", "confirmed. …"); the status is shown separately. */
function cleanTitle(t: string): string {
  return t.replace(/^\s*(confirmed|showed|no ?show|cancell?ed|new)\s*[:.\-–]\s*/i, "").trim() || t;
}

export async function loadCalendar(fromIso: string, toIso: string): Promise<CalendarResult> {
  const start = Date.parse(fromIso);
  const end = Date.parse(toIso);
  const problems: CalendarResult["problems"] = [];
  const perLocation = await Promise.all(
    GHL_LOCATIONS.map(async (loc) => {
      const token = process.env[loc.tokenEnv];
      if (!token) {
        problems.push({ location: loc.name, message: `${loc.tokenEnv} isn't set in Vercel` });
        return [];
      }
      const names = await users(loc, token);
      const lists = await Promise.all(
        loc.calendars.map(async (cal) => {
          const url = `${API}/calendars/events?locationId=${loc.locationId}&calendarId=${cal.id}&startTime=${start}&endTime=${end}`;
          try {
            const res = await fetch(url, { headers: headers(token, "2021-04-15"), next: { revalidate: 60 } });
            if (!res.ok) {
              problems.push({ location: loc.name, message: `${cal.name}: GoHighLevel said ${res.status}${res.status === 401 ? " (check the API key)" : ""}` });
              return [];
            }
            const j = (await res.json()) as { events?: Array<Record<string, unknown>> };
            return (j.events ?? [])
              .filter((e) => !e.deleted)
              .map((e): CalEvent => {
                const startIso = String(e.startTime);
                const assigned = (e.assignedUserId as string | undefined) ?? (e.users as string[] | undefined)?.[0];
                return {
                  id: String(e.id),
                  location: loc.slug,
                  locationName: loc.name,
                  kind: cal.kind,
                  calendarName: cal.name,
                  title: cleanTitle(String(e.title ?? "Appointment")),
                  start: startIso,
                  end: String(e.endTime ?? startIso),
                  day: etDay(startIso),
                  status: String(e.appointmentStatus ?? e.appoinmentStatus ?? "confirmed").toLowerCase(),
                  assignedTo: assigned ? names.get(assigned) ?? null : null,
                  assignedUserId: assigned ?? null,
                  address: (e.address as string | undefined)?.trim() || null,
                  notes: ((e.notes ?? e.description) as string | undefined)?.trim() || null,
                  contactUrl: e.contactId ? `https://app.gohighlevel.com/v2/location/${loc.locationId}/contacts/detail/${e.contactId}` : null,
                };
              });
          } catch {
            problems.push({ location: loc.name, message: `${cal.name}: couldn't reach GoHighLevel` });
            return [];
          }
        }),
      );
      return lists.flat();
    }),
  );
  const events = perLocation.flat().sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  return { events, problems };
}

/** GoHighLevel users for a location (id → name), for matching team members to bookings. */
export async function locationUsers(slug: GhlLocation["slug"]): Promise<Array<{ id: string; name: string }>> {
  const loc = GHL_LOCATIONS.find((l) => l.slug === slug);
  const token = loc ? process.env[loc.tokenEnv] : undefined;
  if (!loc || !token) return [];
  return [...(await users(loc, token)).entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
}

export interface CalendarPerson extends GhlUser {
  /** Calendar kinds they've been booked on, with how many appointments. */
  sales: number;
  install: number;
  locations: string[];
}

/** Everyone assigned to an appointment on the sales or installer calendars in the window. */
export async function calendarPeople(fromIso: string, toIso: string): Promise<{ people: CalendarPerson[]; problems: CalendarResult["problems"] }> {
  const { events, problems } = await loadCalendar(fromIso, toIso);
  const details = new Map<string, GhlUser>();
  for (const loc of GHL_LOCATIONS) {
    const token = process.env[loc.tokenEnv];
    if (token) for (const [id, u] of await userDetails(loc, token)) if (!details.has(id) || (!details.get(id)!.email && u.email)) details.set(id, u);
  }
  const by = new Map<string, CalendarPerson>();
  for (const e of events) {
    if (!e.assignedUserId) continue;
    const u = details.get(e.assignedUserId) ?? { id: e.assignedUserId, name: e.assignedTo ?? "Unknown", email: null };
    const p = by.get(u.id) ?? { ...u, sales: 0, install: 0, locations: [] };
    p[e.kind] += 1;
    if (!p.locations.includes(e.locationName)) p.locations.push(e.locationName);
    by.set(u.id, p);
  }
  return { people: [...by.values()].sort((a, b) => b.sales + b.install - (a.sales + a.install)), problems };
}
