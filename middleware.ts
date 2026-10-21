import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, safeEqual, sessionToken } from "./src/lib/session";

/**
 * Every page is private. A browser that signed in once carries a year-long
 * session cookie and goes straight through. Fails closed: with no
 * APP_PASSWORD set, nobody gets in.
 */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === "/login" || pathname === "/api/login") return NextResponse.next();

  const password = process.env.APP_PASSWORD;
  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  if (password && cookie && safeEqual(cookie, await sessionToken(password))) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

// Logo files and app icons are public so the sign-in page can show them.
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|brand/|icon|apple-icon).*)"] };
