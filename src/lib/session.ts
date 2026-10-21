/**
 * Sign-in sessions and who can open what. Edge-safe (Web Crypto only) so the
 * middleware can check every request before it reaches a page or API.
 *
 * Cookie `cf_session` = "v2.<payload>.<signature>", payload = base64url JSON
 * { u: user id ("owner" for the APP_PASSWORD login), r: role, p: person id,
 *   n: display name, sv: session version }. Signed with HMAC-SHA256 using
 * SESSION_SECRET (or, without one, a key derived from APP_PASSWORD), so
 * changing either signs every browser out. Deactivating a user or resetting
 * their password bumps their session version, which the server checks against
 * the database on each page and write (see auth.ts).
 *
 * Browsers still holding the old shared-password cookie (an HMAC of
 * APP_PASSWORD) are treated as the owner, so nobody is kicked out by the upgrade.
 */
export const SESSION_COOKIE = "cf_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 365;

export type Role = "admin" | "sales" | "installer";
export const ROLES: Record<Role, string> = { admin: "Admin", sales: "Sales rep", installer: "Installer" };

export interface Session {
  userId: string; // "owner" for the shared owner password
  role: Role;
  personId: string | null;
  name: string;
  version: number;
}

const enc = new TextEncoder();

function secret(): string | null {
  const s = process.env.SESSION_SECRET || (process.env.APP_PASSWORD ? `cf-session-key:${process.env.APP_PASSWORD}` : "");
  return s || null;
}

async function hmac(key: string, data: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
}

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

/** The pre-accounts cookie: an HMAC of APP_PASSWORD. Still accepted as the owner. */
export async function legacyToken(password: string): Promise<string> {
  const sig = await hmac(password, "clearflow-session-v1");
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string compare. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signSession(s: Session): Promise<string> {
  const key = secret();
  if (!key) throw new Error("Set APP_PASSWORD (or SESSION_SECRET) to sign sessions");
  const payload = b64url(enc.encode(JSON.stringify({ u: s.userId, r: s.role, p: s.personId, n: s.name, sv: s.version })));
  return `v2.${payload}.${b64url(await hmac(key, `v2.${payload}`))}`;
}

export async function verifySession(cookie: string | undefined | null): Promise<Session | null> {
  if (!cookie) return null;
  const key = secret();
  if (!key) return null; // fail closed
  if (cookie.startsWith("v2.")) {
    const [, payload, sig] = cookie.split(".");
    if (!payload || !sig) return null;
    const want = b64url(await hmac(key, `v2.${payload}`));
    if (!safeEqual(sig, want)) return null;
    try {
      const j = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as { u: string; r: Role; p: string | null; n: string; sv: number };
      if (!j.u || !(j.r in ROLES)) return null;
      return { userId: j.u, role: j.r, personId: j.p ?? null, name: j.n ?? "", version: Number(j.sv) || 1 };
    } catch {
      return null;
    }
  }
  const password = process.env.APP_PASSWORD;
  if (password && safeEqual(cookie, await legacyToken(password))) return { userId: "owner", role: "admin", personId: null, name: "Owner", version: 1 };
  return null;
}

/* ── Who can open what ─────────────────────────────────────────────────── */

/** Pages and APIs each role may use. Admin may use everything. */
const ALLOWED: Record<Exclude<Role, "admin">, RegExp[]> = {
  sales: [/^\/appointments(\/|$)/, /^\/api\/appointments$/, /^\/agreements(\/|$)/, /^\/api\/agreements(\/|$)/, /^\/customers(\/|$)/, /^\/api\/customers(\/|$)/, /^\/me(\/|$)/, /^\/forms\/sale(\/|$)/, /^\/api\/forms\/sale$/],
  installer: [/^\/installs(\/|$)/, /^\/api\/appointments$/, /^\/me(\/|$)/, /^\/forms\/install(\/|$)/, /^\/api\/forms\/install$/],
};

/** Paths anyone can reach, signed in or not. */
/** Customers open their agreement by its secret link: /c/<token>, /c/<token>/pdf and /api/c/<token>. */
export const isPublicPath = (p: string) => p === "/login" || p === "/api/login" || p === "/api/logout" || p.startsWith("/c/") || p.startsWith("/api/c/");

export function canAccess(role: Role, pathname: string): boolean {
  if (role === "admin") return true;
  return ALLOWED[role].some((re) => re.test(pathname));
}

/** Where each role lands after signing in (and when it opens a page it can't use). */
export const homeFor = (role: Role) => (role === "admin" ? "/" : role === "sales" ? "/appointments" : "/installs");
