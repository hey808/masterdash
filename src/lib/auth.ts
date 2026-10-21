/**
 * Server-side sign-in: passwords, the current user, and the active check.
 * Node only (scrypt + database). The edge middleware only verifies the cookie
 * signature; this file also confirms the user is still active and hasn't been
 * signed out (session version) on every page load and every write.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { promisify } from "node:util";
import { db } from "./db";
import { SESSION_COOKIE, safeEqual, type Role, type Session, verifySession } from "./session";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number }) => Promise<Buffer>;
const N = 16384;

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw.normalize("NFKC"), salt, 32, { N, r: 8, p: 1 });
  return `scrypt$${N}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function checkPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, n, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !n || !salt || !hash) return false;
  const want = Buffer.from(hash, "base64");
  const got = await scrypt(pw.normalize("NFKC"), Buffer.from(salt, "base64"), want.length, { N: Number(n), r: 8, p: 1 });
  return got.length === want.length && timingSafeEqual(got, want);
}

/** Email + password, or (email left blank) the owner password. Null = wrong. */
export async function authenticate(email: string, password: string): Promise<Session | null> {
  const e = email.trim().toLowerCase();
  if (!e) {
    const owner = process.env.APP_PASSWORD;
    return owner && safeEqual(password, owner) ? { userId: "owner", role: "admin", personId: null, name: "Owner", version: 1 } : null;
  }
  const { rows } = await db().query(
    "select id, role, person_id, name, session_version, password_hash, active from app_users where email = $1",
    [e],
  );
  const u = rows[0];
  // Always run a hash check so a missing email takes as long as a wrong password.
  const ok = await checkPassword(password, u?.password_hash ?? "scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");
  if (!u || !ok || !u.active) return null;
  await db().query("update app_users set last_login_at = now() where id = $1", [u.id]);
  return { userId: u.id, role: u.role as Role, personId: u.person_id, name: u.name, version: Number(u.session_version) };
}

/** The signed-in user for this request, if the cookie is valid and the user is still active. */
export async function currentSession(): Promise<Session | null> {
  const s = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  if (!s) return null;
  if (s.userId === "owner") return s;
  try {
    const { rows } = await db().query("select active, session_version, role, person_id, name from app_users where id = $1", [s.userId]);
    const u = rows[0];
    if (!u || !u.active || Number(u.session_version) !== s.version) return null;
    return { ...s, role: u.role, personId: u.person_id, name: u.name };
  } catch (e) {
    // Before the logins table exists only the owner can be signed in.
    if ((e as { code?: string }).code === "42P01") return null;
    throw e;
  }
}
