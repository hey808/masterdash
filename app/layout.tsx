import { homeFor } from "@/lib/session";
import type { Metadata } from "next";
import "./globals.css";
import { cookies } from "next/headers";
import { currentSession } from "@/lib/auth";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import Nav from "./Nav";

export const metadata: Metadata = { title: { default: "Clear Flow", template: "%s · Clear Flow" }, description: "Clear Flow Water USA operating system" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await currentSession().catch(() => null);
  // A valid cookie for a login that's since been turned off, reset or changed: show nothing but a way back in.
  const revoked = !session && !!(await verifySession(cookies().get(SESSION_COOKIE)?.value));
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@700;800&family=Inter:wght@400;500;600;700&display=swap" />
      </head>
      <body>
        <header className="topbar">
          <a href={session ? homeFor(session.role) : "/"} className="brand" aria-label="Clear Flow Water USA, home">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/shield-white.png" alt="" width={34} height={35} className="brand-shield" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/wordmark-white.png" alt="Clear Flow Water USA" width={134} height={30} className="brand-word" />
          </a>
          <Nav role={session?.role ?? null} name={session?.name ?? null} />
        </header>
        <main>
          {revoked ? (
            <section className="login">
              <h1>You&apos;ve been signed out</h1>
              <p className="muted">Your login was changed or turned off. Sign in again to continue.</p>
              <form method="post" action="/api/logout">
                <button type="submit">Sign in again</button>
              </form>
            </section>
          ) : (
            children
          )}
        </main>
      </body>
    </html>
  );
}
