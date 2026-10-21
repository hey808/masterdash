"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Link = { href: string; label: string };
/** A group with an href: clicking the label opens that page; hovering shows the menu. */
type Item = Link | { label: string; href?: string; links: Link[] };

const ADMIN_MENU: Item[] = [
  { href: "/", label: "Home" },
  { label: "Sales", href: "/sales", links: [{ href: "/sales", label: "Dashboard" }, { href: "/ledger", label: "Ledger" }, { href: "/appointments", label: "Appointments" }, { href: "/customers", label: "Customers" }, { href: "/forms", label: "Forms" }, { href: "/commissions", label: "Commissions" }] },
  { label: "Operations", href: "/operations", links: [{ href: "/operations", label: "Dashboard" }, { href: "/calendar", label: "Calendar" }, { href: "/inventory", label: "Inventory" }, { href: "/capacity", label: "Capacity" }, { href: "/activity", label: "Activity" }, { href: "/installs", label: "Installs" }] },
  { label: "Finance", href: "/reports", links: [{ href: "/bank", label: "Bank" }, { href: "/reports", label: "Reports" }] },
];
const SALES_MENU: Item[] = [{ href: "/appointments", label: "Appointments" }, { href: "/customers", label: "Customers" }, { href: "/me", label: "My commissions" }, { href: "/forms/sale", label: "Sales form" }];
const INSTALLER_MENU: Item[] = [{ href: "/installs", label: "Installs" }, { href: "/me", label: "My commissions" }, { href: "/forms/install", label: "Installer form" }];

const isOn = (href: string, path: string) => (href === "/" ? path === "/" : path.startsWith(href));

export default function Nav({ role, name }: { role: "admin" | "sales" | "installer" | null; name: string | null }) {
  const path = usePathname();
  const [open, setOpen] = useState<string | null>(null);
  // Phones: a hamburger opens the whole menu as a sidebar.
  const [drawer, setDrawer] = useState(false);
  useEffect(() => setDrawer(false), [path]);
  useEffect(() => {
    if (!drawer) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    document.addEventListener("keydown", esc);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", esc);
      document.body.style.overflow = prev;
    };
  }, [drawer]);
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

  // The customer's signing page never shows the app menu, even on a signed-in rep's phone.
  if (path === "/login" || path.startsWith("/c/") || !role) return null;
  const MENU = role === "admin" ? ADMIN_MENU : role === "sales" ? SALES_MENU : INSTALLER_MENU;
  const userOpen = open === "__user";
  return (
    <nav ref={ref} className="mainnav">
      <button type="button" className="nav-burger" aria-label="Menu" aria-expanded={drawer} aria-controls="nav-drawer" onClick={() => setDrawer(true)}>
        <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><path d="M3 6h16M3 11h16M3 16h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
      </button>
      {drawer && (
        <div className="nav-drawer-wrap" onClick={() => setDrawer(false)}>
          <aside id="nav-drawer" className="nav-drawer" role="dialog" aria-modal="true" aria-label="Menu" onClick={(e) => e.stopPropagation()}>
            <div className="nav-drawer-head">
              <span className="avatar" aria-hidden="true">{(name ?? "?").trim().charAt(0).toUpperCase()}</span>
              <span className="nd-name">{name}</span>
              <button type="button" className="nd-close" aria-label="Close menu" onClick={() => setDrawer(false)}>×</button>
            </div>
            <div className="nd-body">
              {MENU.map((item) =>
                "links" in item ? (
                  <div key={item.label} className="nd-group">
                    <div className="nd-group-label">{item.label}</div>
                    {item.links.map((l) => (
                      <a key={l.href} href={l.href} className={isOn(l.href, path) ? "on" : ""} aria-current={isOn(l.href, path) ? "page" : undefined}>{l.label}</a>
                    ))}
                  </div>
                ) : (
                  <a key={item.href} href={item.href} className={`nd-top ${isOn(item.href, path) ? "on" : ""}`} aria-current={isOn(item.href, path) ? "page" : undefined}>{item.label}</a>
                ),
              )}
              {role === "admin" && (
                <div className="nd-group">
                  <div className="nd-group-label">Account</div>
                  <a href="/team" className={path.startsWith("/team") ? "on" : ""}>Team logins</a>
                  <a href="/me" className={path.startsWith("/me") ? "on" : ""}>See as a rep</a>
                </div>
              )}
            </div>
            <form method="post" action="/api/logout" className="nd-foot">
              <button type="submit" className="nd-signout">Sign out</button>
            </form>
          </aside>
        </div>
      )}
      {MENU.map((item) => {
        if (!("links" in item)) {
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
            {item.href ? (
              <a href={item.href} className={`navtop ${current ? "active" : ""}`} aria-haspopup="true" aria-expanded={isOpen} onFocus={() => setOpen(item.label)}>
                {item.label}
                <span className="caret" aria-hidden="true">▾</span>
              </a>
            ) : (
              <button
                type="button"
                className={`navtop ${current ? "active" : ""}`}
                aria-expanded={isOpen}
                aria-haspopup="true"
                onClick={() => setOpen(isOpen ? null : item.label)}
              >
                {item.label}
                <span className="caret" aria-hidden="true">▾</span>
              </button>
            )}
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
      <div className={`navgroup navuser ${userOpen ? "open" : ""}`}>
        <button type="button" className="navtop" aria-expanded={userOpen} aria-haspopup="true" onClick={() => setOpen(userOpen ? null : "__user")}>
          <span className="avatar" aria-hidden="true">{(name ?? "?").trim().charAt(0).toUpperCase()}</span>
          <span className="navuser-name">{name}</span>
          <span className="caret" aria-hidden="true">▾</span>
        </button>
        <div className="navmenu right" role="menu">
          {role === "admin" && <a href="/team" role="menuitem" className={path.startsWith("/team") ? "active" : ""}>Team logins</a>}
          {role === "admin" && <a href="/me" role="menuitem" className={path.startsWith("/me") ? "active" : ""}>See as a rep</a>}
          <form method="post" action="/api/logout">
            <button type="submit" role="menuitem" className="menu-btn">Sign out</button>
          </form>
        </div>
      </div>
    </nav>
  );
}
