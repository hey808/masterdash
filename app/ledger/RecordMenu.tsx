"use client";

import { useEffect, useRef, useState } from "react";

const ITEMS = [
  { href: "/forms/sale", label: "Sales form", hint: "A new sale" },
  { href: "/forms/install", label: "Installer form", hint: "An install is done" },
  { href: "/forms/funding", label: "Record funding", hint: "The lender's money hit" },
];

/** "Record transaction" button on the ledger: opens the three forms that create ledger rows. */
export default function RecordMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div className="record-menu" ref={ref}>
      <button type="button" className="btn-primary page-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Record transaction
        <svg width="10" height="6" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <div className="record-menu-list" role="menu">
          {ITEMS.map((i) => (
            <a key={i.href} href={i.href} role="menuitem">
              <strong>{i.label}</strong>
              <span>{i.hint}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
