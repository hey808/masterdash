import type { Metadata } from "next";
import "./globals.css";
import Nav from "./Nav";

export const metadata: Metadata = { title: { default: "Clear Flow", template: "%s · Clear Flow" }, description: "Clear Flow Water USA operating system" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@700;800&family=Inter:wght@400;500;600;700&display=swap" />
      </head>
      <body>
        <header className="topbar">
          <a href="/" className="brand" aria-label="Clear Flow Water USA, home">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/shield-white.png" alt="" width={34} height={35} className="brand-shield" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/wordmark-white.png" alt="Clear Flow Water USA" width={134} height={30} className="brand-word" />
          </a>
          <Nav />
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
