"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Link = { href: string; label: string };
type Item = Link | { label: string; links: Link[] };

const MENU: Item[] = [
  { href: "/", label: "Home" },
  { label: "Sales", links: [{ href: "/ledger", label: "Ledger" }, { href: "/commissions", label: "Commissions" }, { href: "/forms", label: "Forms" }] },
  { label: "Operations", links: [{ href: "/inventory", label: "Inventory" }, { href: "/activity", label: "Activity" }] },
  { label: "Finance", links: [{ href: "/bank", label: "Bank" }, { href: "/reports", label: "Reports" }] },
];

const isOn = (href: string, path: string) => (href === "/" ? path === "/" : path.startsWith(href));

export default function Nav() {
  const path = usePathname();
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  if (path === "/login") return null;
  return (
    <nav ref={ref} className="mainnav">
      {MENU.map((item) => {
        if ("href" in item) {
          const on = isOn(item.href, path);
          return (
            <a key={item.href} href={item.href} className={`navtop ${on ? "active" : ""}`} aria-current={on ? "page" : undefined}>
              {item.label}
            </a>
          );
        }
        const current = item.links.find((l) => isOn(l.href, path));
        const isOpen = open === item.label;
        return (
          <div
            key={item.label}
            className={`navgroup ${isOpen ? "open" : ""}`}
            onMouseEnter={() => setOpen(item.label)}
            onMouseLeave={() => setOpen((o) => (o === item.label ? null : o))}
          >
            <button
              type="button"
              className={`navtop ${current ? "active" : ""}`}
              aria-expanded={isOpen}
              aria-haspopup="true"
              onClick={() => setOpen(isOpen ? null : item.label)}
            >
              {item.label}
              {current && <span className="navcur">{current.label}</span>}
              <span className="caret" aria-hidden="true">▾</span>
            </button>
            <div className="navmenu" role="menu">
              {item.links.map((l) => {
                const on = isOn(l.href, path);
                return (
                  <a key={l.href} href={l.href} role="menuitem" className={on ? "active" : ""} aria-current={on ? "page" : undefined}>
                    {l.label}
                  </a>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );
}
