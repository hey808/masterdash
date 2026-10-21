/**
 * Team logins (admin only). Reps and installers are tied to a roster person;
 * that's how their commissions and their forms are scoped to them.
 */
import { z } from "zod";
import { randomInt } from "node:crypto";
import { hashPassword } from "./auth";
import type { CalendarPerson } from "./ghl";
import { matchRoster } from "./person-match";
import { db, tx } from "./db";
import { EditError } from "./ledger/edit";
import type { Role } from "./session";

export interface AppUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  personId: string | null;
  personName: string | null;
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export async function listUsers(): Promise<AppUser[]> {
  try {
    const { rows } = await db().query(
      `select u.id, u.email, u.name, u.role, u.person_id as "personId", p.name as "personName", u.active,
              u.last_login_at as "lastLoginAt", u.created_at as "createdAt"
       from app_users u left join people p on p.id = u.person_id
       order by u.active desc, case u.role when 'admin' then 0 when 'sales' then 1 else 2 end, u.name`,
    );
    return rows.map((r) => ({ ...r, lastLoginAt: r.lastLoginAt ? new Date(r.lastLoginAt).toISOString() : null, createdAt: new Date(r.createdAt).toISOString() }));
  } catch (e) {
    if ((e as { code?: string }).code === "42P01") return [];
    throw e;
  }
}

const role = z.enum(["admin", "sales", "installer"]);
const password = z.string().min(8, "Password must be at least 8 characters").max(200);
const first = (e: z.ZodError) => e.issues[0]?.message ?? "Check the form";

export const NewUser = z
  .object({
    name: z.string().trim().min(2, "Name is required").max(120),
    email: z.string().trim().toLowerCase().email("That email doesn't look right").max(200),
    role,
    personId: z.string().uuid().nullable().optional(),
    password,
  })
  .refine((v) => v.role === "admin" || !!v.personId, { message: "Pick which roster person this login is for", path: ["personId"] });

const UNIQUE = (e: unknown) => (e as { code?: string }).code === "23505";

export async function createUser(input: unknown, actor: string): Promise<{ id: string }> {
  const p = NewUser.safeParse(input);
  if (!p.success) throw new EditError(first(p.error), 400);
  const v = p.data;
  const hash = await hashPassword(v.password);
  try {
    return await tx(actor, async (c) => {
      const { rows } = await c.query(
        "insert into app_users (email, name, role, person_id, password_hash) values ($1,$2,$3,$4,$5) returning id",
        [v.email, v.name, v.role, v.role === "admin" ? (v.personId ?? null) : v.personId, hash],
      );
      return { id: rows[0].id as string };
    });
  } catch (e) {
    if (UNIQUE(e)) throw new EditError("There's already a login with that email.", 409);
    throw e;
  }
}

export const UserPatch = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  email: z.string().trim().toLowerCase().email("That email doesn't look right").max(200).optional(),
  role: role.optional(),
  personId: z.string().uuid().nullable().optional(),
  active: z.boolean().optional(),
  password: password.optional(),
});

/** Changing the role, deactivating or resetting the password signs that user out everywhere. */
export async function updateUser(id: string, input: unknown, actor: string): Promise<void> {
  if (!z.string().uuid().safeParse(id).success) throw new EditError("Unknown login.", 404);
  const p = UserPatch.safeParse(input);
  if (!p.success) throw new EditError(first(p.error), 400);
  const v = p.data;
  const hash = v.password ? await hashPassword(v.password) : null;
  try {
    await tx(actor, async (c) => {
      const cur = (await c.query("select role, person_id from app_users where id = $1 for update", [id])).rows[0];
      if (!cur) throw new EditError("Unknown login.", 404);
      const nextRole = v.role ?? cur.role;
      const nextPerson = v.personId !== undefined ? v.personId : cur.person_id;
      if (nextRole !== "admin" && !nextPerson) throw new EditError("Sales and installer logins need a roster person.", 400);
      const signOut = v.role !== undefined && v.role !== cur.role || v.active === false || !!hash || (v.personId !== undefined && v.personId !== cur.person_id);
      await c.query(
        `update app_users set
           name = coalesce($2, name), email = coalesce($3, email), role = $4, person_id = $5,
           active = coalesce($6, active), password_hash = coalesce($7, password_hash),
           session_version = session_version + $8, updated_at = now()
         where id = $1`,
        [id, v.name ?? null, v.email ?? null, nextRole, nextPerson, v.active ?? null, hash, signOut ? 1 : 0],
      );
    });
  } catch (e) {
    if (UNIQUE(e)) throw new EditError("There's already a login with that email.", 409);
    throw e;
  }
}

/* ── Logins for everyone on the GoHighLevel calendars ─────────────────── */

/** 12 characters, no look-alikes, grouped for reading out over the phone. */
export function makePassword(): string {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 12 }, () => chars[randomInt(chars.length)]).join("").replace(/(.{4})(?=.)/g, "$1-");
}

export interface Roster { id: string; name: string; email: string | null; roles: string[] }
export type LoginPlan =
  | { kind: "create"; ghl: CalendarPerson; person: Roster; role: "sales" | "installer"; email: string }
  | { kind: "skip"; ghl: CalendarPerson; reason: string };

/**
 * Match each calendar person to one roster person: same full name, else the
 * one roster person with the same first name (GHL has "Mike CF", the roster "Mike").
 * Role: installer when they're only on installer calendars or the roster says
 * installer; otherwise sales. Skips anyone already holding a login.
 */
export function planCalendarLogins(people: CalendarPerson[], roster: Roster[], existing: Array<{ email: string; personId: string | null }>): LoginPlan[] {
  const emails = new Set(existing.map((e) => e.email.toLowerCase()));
  const persons = new Set(existing.map((e) => e.personId).filter(Boolean));
  const taken = new Set<string>();
  return people.map((g): LoginPlan => {
    const m = matchRoster(g.name, roster);
    if (!m.person && m.ambiguous) return { kind: "skip", ghl: g, reason: `More than one roster person named ${g.name.split(" ")[0]}; add this login by hand` };
    const person = m.person;
    if (!person) return { kind: "skip", ghl: g, reason: "Not on the roster" };
    const email = (g.email ?? person.email ?? "").toLowerCase();
    if (!email) return { kind: "skip", ghl: g, reason: "No email in GoHighLevel" };
    if (persons.has(person.id) || taken.has(person.id)) return { kind: "skip", ghl: g, reason: `${person.name} already has a login` };
    if (emails.has(email)) return { kind: "skip", ghl: g, reason: `${email} already has a login` };
    taken.add(person.id);
    const role = person.roles.includes("installer") || (g.install > 0 && g.sales === 0) ? "installer" : "sales";
    return { kind: "create", ghl: g, person, role, email };
  });
}

export interface CreatedLogin { name: string; email: string; role: "sales" | "installer"; password: string }

export async function createCalendarLogins(people: CalendarPerson[], actor: string): Promise<{ created: CreatedLogin[]; skipped: Array<{ name: string; reason: string }> }> {
  const [roster, existing] = await Promise.all([
    db().query("select id, name, email, roles from people where active"),
    db().query(`select email, person_id as "personId" from app_users`),
  ]);
  const plan = planCalendarLogins(people, roster.rows as Roster[], existing.rows);
  const created: CreatedLogin[] = [];
  const skipped = plan.filter((p) => p.kind === "skip").map((p) => ({ name: p.ghl.name, reason: (p as { reason: string }).reason }));
  for (const p of plan) {
    if (p.kind !== "create") continue;
    const password = makePassword();
    try {
      await createUser({ name: p.person.name, email: p.email, role: p.role, personId: p.person.id, password }, actor);
      created.push({ name: p.person.name, email: p.email, role: p.role, password });
    } catch (e) {
      skipped.push({ name: p.person.name, reason: e instanceof EditError ? e.message : "Couldn't create this one" });
    }
  }
  return { created, skipped };
}
