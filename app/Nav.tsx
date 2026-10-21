"use client";

import { usePathname } from "next/navigation";

const LINKS = [
  ["/", "Home"],
  ["/ledger", "Ledger"],
  ["/commissions", "Commissions"],
  ["/inventory", "Inventory"],
  ["/forms", "Forms"],
  ["/activity", "Activity"],
  ["/bank", "Bank"],
  ["/reports", "Reports"],
] as const;

export default function Nav() {
  const path = usePathname();
  if (path === "/login") return null;
  return (
    <nav>
      {LINKS.map(([href, label]) => {
        const on = href === "/" ? path === "/" : path.startsWith(href);
        return (
          <a key={href} href={href} className={on ? "active" : ""} aria-current={on ? "page" : undefined}>
            {label}
          </a>
        );
      })}
    </nav>
  );
}
