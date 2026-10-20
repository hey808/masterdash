"use client";

import { usePathname } from "next/navigation";

const LINKS = [
  ["/ledger", "Ledger"],
  ["/commissions", "Commissions"],
] as const;

export default function Nav() {
  const path = usePathname();
  if (path === "/login") return null;
  return (
    <nav>
      {LINKS.map(([href, label]) => (
        <a key={href} href={href} className={path.startsWith(href) ? "active" : ""} aria-current={path.startsWith(href) ? "page" : undefined}>
          {label}
        </a>
      ))}
    </nav>
  );
}
