import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, canAccess, homeFor, isPublicPath, verifySession } from "./src/lib/session";

/**
 * Every page and API is private, and each role only reaches its own pages:
 *   admin      everything
 *   sales      My commissions + the sales form
 *   installer  My commissions + the installer form
 * Fails closed: with no APP_PASSWORD / SESSION_SECRET set, nobody gets in.
 * (Whether a signed-in user is still active is checked server-side in auth.ts.)
 */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();
  const isApi = pathname.startsWith("/api/");

  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    // API calls get a real error, not a redirect: fetch would follow it to the
    // sign-in page and the screen would treat that 200 as a successful save.
    if (isApi) return NextResponse.json({ error: "You've been signed out. Reload the page and sign in again." }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }

  if (!canAccess(session.role, pathname)) {
    if (isApi) return NextResponse.json({ error: "Your login doesn't have access to that." }, { status: 403 });
    const url = req.nextUrl.clone();
    url.pathname = homeFor(session.role);
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

// Logo files and app icons are public so the sign-in page can show them.
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|brand/|icon|apple-icon).*)"] };
