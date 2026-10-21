import { NextResponse, type NextRequest } from "next/server";
import { authenticate } from "@/lib/auth";
import { SESSION_COOKIE, SESSION_MAX_AGE, homeFor, signSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const email = String(form.get("email") ?? "");
  const given = String(form.get("password") ?? "");
  const rawNext = String(form.get("next") ?? "");

  if (!process.env.APP_PASSWORD && !process.env.SESSION_SECRET) return back(req, "unset", email, rawNext);
  const session = given ? await authenticate(email, given) : null;
  if (!session) {
    await new Promise((r) => setTimeout(r, 400)); // slow down guessing
    return back(req, "wrong", email, rawNext);
  }

  // Only follow ?next= to a page this role can open; otherwise land on their home.
  const next = safeNext(rawNext, req.url) ?? homeFor(session.role);
  const res = NextResponse.redirect(new URL(next, req.url), 303);
  res.cookies.set(SESSION_COOKIE, await signSession(session), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}

function back(req: NextRequest, error: string, email: string, next: string) {
  const u = new URL("/login", req.url);
  u.searchParams.set("error", error);
  if (email) u.searchParams.set("email", email);
  if (next && next !== "/") u.searchParams.set("next", next);
  return NextResponse.redirect(u, 303);
}

/** Only same-site paths: "/\\evil.com" and "//evil.com" both resolve off-site, so check the resolved origin. */
function safeNext(raw: string, base: string): string | null {
  if (!raw || !raw.startsWith("/") || raw.includes("\\")) return null;
  try {
    const u = new URL(raw, base);
    return u.origin === new URL(base).origin ? u.pathname + u.search : null;
  } catch {
    return null;
  }
}
