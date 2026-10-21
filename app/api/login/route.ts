import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, SESSION_MAX_AGE, safeEqual, sessionToken } from "@/lib/session";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const given = String(form.get("password") ?? "");
  const rawNext = String(form.get("next") ?? "/");
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";
  const password = process.env.APP_PASSWORD;

  if (!password || !safeEqual(await sessionToken(given), await sessionToken(password))) {
    const back = new URL("/login", req.url);
    back.searchParams.set("error", password ? "wrong" : "unset");
    if (next !== "/") back.searchParams.set("next", next);
    return NextResponse.redirect(back, 303);
  }

  const res = NextResponse.redirect(new URL(next, req.url), 303);
  res.cookies.set(SESSION_COOKIE, await sessionToken(password), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
