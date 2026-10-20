/**
 * One shared login until real accounts land. Sign in once per browser; the
 * session cookie lasts a year. The cookie is an HMAC of APP_PASSWORD, so
 * changing the password signs every browser out. Edge-safe (Web Crypto).
 */
export const SESSION_COOKIE = "cf_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 365;

export async function sessionToken(password: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(password), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode("clearflow-session-v1"));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string compare. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
