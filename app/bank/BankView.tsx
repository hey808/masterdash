"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";
import { sortTxns, type BankSort } from "@/lib/bank-export";
import type { AccountBalance, BankCategory, BankTxn, ImportResult } from "@/lib/bank";
import { shortDate } from "@/lib/dates";
import { fmt, sumCents } from "@/lib/money";
import Modal from "../Modal";

type Filter = "review" | "all" | "in" | "out";
const FILTERS: Record<Filter, string> = { review: "Needs a look", all: "All", in: "Money in", out: "Money out" };

/** A sensible default for "apply to every line containing…": the payee or merchant as the bank writes it. */
function suggestPattern(t: BankTxn): string {
  const zelle = /^(.*? PAYMENT ID)/.exec(t.description);
  if (zelle) return zelle[1]!;
  const up = t.description.toUpperCase();
  if (t.merchant && up.includes(t.merchant.toUpperCase())) return t.merchant.toUpperCase();
  const words = t.description.split(" ").filter((w) => !/\d/.test(w) || /^[A-Z]+\d*$/.test(w)).slice(0, 3).join(" ");
  return (words || t.description).slice(0, 40);
}

export default function BankView({ txns, categories, balances }: { txns: BankTxn[]; categories: BankCategory[]; balances: AccountBalance[] }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState<Filter>(txns.some((t) => t.needsReview) ? "review" : "all");
  const [cat, setCat] = useState<string>("");
  const [q, setQ] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const [sort, setSort] = useState<BankSort>("date-desc");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [editing, setEditing] = useState<BankTxn | null>(null);
  const close = useCallback(() => setEditing(null), []);
  const catName = useMemo(() => new Map(categories.map((c) => [c.slug, c.name])), [categories]);

  const rows = sortTxns(
    txns.filter(
      (t) =>
        (filter === "all" || (filter === "review" ? t.needsReview : filter === "in" ? t.amountCents > 0 : t.amountCents < 0)) &&
        (!cat || t.category === cat) &&
        (!q || t.description.toUpperCase().includes(q.toUpperCase())),
    ),
    sort,
  );
  const reviewCount = txns.filter((t) => t.needsReview).length;

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setFlash(null);
    const lines: string[] = [];
    for (const f of Array.from(files)) {
      try {
        const res = await fetch("/api/bank/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName: f.name, text: await f.text() }) });
        const b = (await res.json().catch(() => ({}))) as Partial<ImportResult> & { error?: string };
        if (!res.ok) lines.push(`${f.name}: ${b.error ?? "couldn't import"}`);
        else lines.push(`${f.name}: ${b.added} new line${b.added === 1 ? "" : "s"}${b.skipped ? `, ${b.skipped} already here` : ""}${b.needsReview ? `, ${b.needsReview} to check` : ""}.`);
      } catch {
        lines.push(`${f.name}: couldn't reach the server.`);
      }
    }
    setBusy(false);
    setResult(lines.join(" "));
    if (fileRef.current) fileRef.current.value = "";
    router.refresh();
  }

  async function looksRight(ids: string[]) {
    setBusy(true);
    const res = await fetch("/api/bank/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) }).catch(() => null);
    setBusy(false);
    if (!res?.ok) setFlash("Couldn't save. Try again.");
    router.refresh();
  }

  return (
    <>
      <div className="run-totals">
        {balances.map((b) => (
          <div key={b.accountId} className="stat">
            <div className="label">{b.name}</div>
            <div className="value">{b.balanceCents == null ? "—" : fmt(b.balanceCents, { decimals: 2 })}</div>
          </div>
        ))}
        <div className={`stat ${reviewCount ? "due" : "paid"}`}>
          <div className="label">Needs a look</div>
          <div className="value">{reviewCount}</div>
        </div>
        <div className="stat">
          <div className="label">Statements through</div>
          <div className="value">{(() => { const last = balances.map((b) => b.lastOn).filter((d): d is string => !!d).sort().at(-1); return last ? shortDate(last) : "—"; })()}</div>
        </div>
      </div>

      <div className="table-bar">
        <label className="btn-primary file-btn">
          {busy ? "Importing…" : "Import Truist CSV"}
          <input ref={fileRef} type="file" accept=".csv,text/csv" multiple disabled={busy} onChange={(e) => upload(e.target.files)} hidden />
        </label>
        <nav className="segmented" aria-label="Show">
          {(Object.keys(FILTERS) as Filter[]).map((f) => (
            <button key={f} type="button" className={f === filter ? "on" : ""} aria-pressed={f === filter} onClick={() => setFilter(f)}>
              {FILTERS[f]}{f === "review" && reviewCount ? ` (${reviewCount})` : ""}
            </button>
          ))}
        </nav>
        <select aria-label="Category" value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
        </select>
        <input type="search" placeholder="Search description" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        <div className="bank-export">
          <button type="button" className="btn-outline" aria-expanded={exportOpen} onClick={() => setExportOpen((o) => !o)}>Export CSV</button>
          {exportOpen && (
            <div className="bank-export-pop" role="dialog" aria-label="Export transactions">
              <p className="muted small">Downloads what&apos;s showing ({FILTERS[filter].toLowerCase()}{cat ? `, ${catName.get(cat)}` : ""}{q ? `, “${q}”` : ""}). Leave the dates blank for everything.</p>
              <div className="bank-export-dates">
                <label>From<input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></label>
                <label>To<input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></label>
              </div>
              <a
                className="btn-primary"
                href={`/bank/export?${new URLSearchParams({ filter, sort, ...(cat ? { category: cat } : {}), ...(q ? { q } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) })}`}
                onClick={() => setExportOpen(false)}
              >
                Download CSV
              </a>
            </div>
          )}
        </div>
        {filter === "review" && rows.length > 0 && (
          <button type="button" className="btn-outline" disabled={busy} onClick={() => looksRight(rows.map((r) => r.id))}>
            All {rows.length} look right
          </button>
        )}
      </div>
      {result && <p className="hint block">{result} <button type="button" className="linkbtn" onClick={() => setResult(null)}>Dismiss</button></p>}
      {flash && <p className="flash" role="alert">{flash}</p>}

      {txns.length === 0 ? (
        <p className="empty">No bank activity yet. Export a CSV from Truist (Accounts → Download) and import it here. Overlapping statements are fine; lines already here are skipped.</p>
      ) : (
        <div className="tablewrap">
          <table className="bank">
            <thead>
              <tr>
                <th aria-sort={sort === "date-desc" ? "descending" : sort === "date-asc" ? "ascending" : "none"}>
                  <button type="button" className="th-sort" onClick={() => setSort(sort === "date-desc" ? "date-asc" : "date-desc")} title="Sort by date">
                    Posted <span aria-hidden="true">{sort === "date-desc" ? "▼" : sort === "date-asc" ? "▲" : ""}</span>
                  </button>
                </th>
                <th>Description</th>
                <th>Category</th>
                <th className="num" aria-sort={sort === "size-desc" ? "descending" : sort === "size-asc" ? "ascending" : "none"}>
                  <button type="button" className="th-sort" onClick={() => setSort(sort === "size-desc" ? "size-asc" : sort === "size-asc" ? "date-desc" : "size-desc")} title="Sort by size: largest first, smallest first, then back to by date">
                    Amount <span aria-hidden="true">{sort === "size-desc" ? "▼" : sort === "size-asc" ? "▲" : ""}</span>
                  </button>
                </th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className={t.needsReview ? "review" : ""}>
                  <td className="muted nowrap">{shortDate(t.postedOn)}</td>
                  <td className="desc" title={t.description}>
                    {t.description}
                    {t.note && <span className="act-detail">{t.note}</span>}
                  </td>
                  <td>
                    <button type="button" className={`catbtn k-${t.kind}`} onClick={() => setEditing(t)} title="Change category">
                      {catName.get(t.category) ?? t.category}
                    </button>
                  </td>
                  <td className={`num strong ${t.amountCents > 0 ? "in" : ""}`}>{fmt(t.amountCents, { decimals: 2 })}</td>
                  <td>
                    {t.needsReview && (
                      <button type="button" className="linkbtn" disabled={busy} onClick={() => looksRight([t.id])}>Looks right</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>{rows.length} lines</td>
                <td className="num strong">{fmt(sumCents(rows.map((r) => r.amountCents)), { decimals: 2 })}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {editing && <CategoryModal txn={editing} categories={categories} onClose={close} onDone={(msg) => { setEditing(null); setResult(msg); router.refresh(); }} />}
    </>
  );
}

function CategoryModal({ txn, categories, onClose, onDone }: { txn: BankTxn; categories: BankCategory[]; onClose: () => void; onDone: (msg: string) => void }) {
  const [category, setCategory] = useState(txn.category);
  // Each check goes to someone different, so don't spread one check's category to all of them by default.
  const [all, setAll] = useState(!/^Check #/i.test(txn.description));
  const [pattern, setPattern] = useState(suggestPattern(txn));
  const [note, setNote] = useState(txn.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/bank/transactions/${txn.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, rulePattern: all ? pattern : null, note: note || null }),
      });
      const b = (await res.json().catch(() => ({}))) as { updated?: number; error?: string };
      if (!res.ok) return setError(b.error ?? "Couldn't save.");
      onDone(all && (b.updated ?? 1) > 1 ? `Saved. ${b.updated} lines now say ${categories.find((c) => c.slug === category)?.name}, and future imports will too.` : "Saved.");
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Category" onClose={onClose} width={560}>
      <form className="pay-form" onSubmit={submit}>
        <p className="bank-line"><strong>{fmt(txn.amountCents, { decimals: 2 })}</strong> · {shortDate(txn.postedOn)}<br />{txn.description}</p>
        <label>Category
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Same for every {txn.amountCents < 0 ? "payment" : "deposit"} containing
        </label>
        {all && <input aria-label="Text to match" value={pattern} onChange={(e) => setPattern(e.target.value)} />}
        <label>Note<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional, e.g. who check #1168 was to" /></label>
        {error && <p className="flash">{error}</p>}
        <div className="products-actions">
          <button type="submit" className="btn-primary" disabled={busy}>Save</button>
        </div>
      </form>
    </Modal>
  );
}
