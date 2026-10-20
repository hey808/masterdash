import type { Metadata } from "next";
import "./globals.css";
import Nav from "./Nav";

export const metadata: Metadata = { title: "Clearflow", description: "Clear Flow Water USA operating system" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@700;800&family=Inter:wght@400;500;600&display=swap" />
      </head>
      <body>
        <header className="topbar">
          <span className="brand">CLEAR FLOW</span>
          <Nav />
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
