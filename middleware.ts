import { NextResponse, type NextRequest } from "next/server";

/**
 * Every page is private. HTTP Basic auth against APP_PASSWORD until real
 * user accounts land. Fails closed: with no APP_PASSWORD set, nobody gets in.
 */
export function middleware(req: NextRequest) {
  const expected = process.env.APP_PASSWORD;
  const header = req.headers.get("authorization") ?? "";
  if (expected && header.startsWith("Basic ")) {
    const [, pass] = atob(header.slice(6)).split(/:(.*)/s);
    if (pass === expected) return NextResponse.next();
  }
  return new NextResponse(expected ? "Sign in required" : "APP_PASSWORD is not set", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Clearflow", charset="UTF-8"' },
  });
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
