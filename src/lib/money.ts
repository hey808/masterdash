/**
 * Money is integer cents. Every amount the ledger stores or computes is a
 * whole number of cents; dollars exist only at the edges (import, display).
 */
export type Cents = number;

/** Round half away from zero, tolerant of float noise like 2244.9999999. */
export function roundCents(x: number): Cents {
  const r = Math.round(Math.abs(x) + 1e-7) * Math.sign(x);
  return r === 0 ? 0 : r; // no -0
}

/** Apply a rate to an amount: 15% of $7,245.00 → 108675. */
export function applyRate(amount: Cents, rate: number): Cents {
  return roundCents(amount * rate);
}

/** "$7,495.00", "7495", 7495.5, "(12.50)" → cents. Empty → null. */
export function toCents(v: string | number | null | undefined): Cents | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? roundCents(v * 100) : null;
  const s = v.trim();
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s) || s.startsWith("-");
  const digits = s.replace(/[^0-9.]/g, "");
  if (!digits || !/^\d*\.?\d*$/.test(digits)) return null;
  const [whole = "0", frac = ""] = digits.split(".");
  const cents = Number(whole || "0") * 100 + Number((frac + "00").slice(0, 2)) + (Number(frac[2] ?? "0") >= 5 ? 1 : 0);
  return neg ? -cents : cents;
}

export function sumCents(xs: Iterable<Cents>): Cents {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}

export function fmt(c: Cents | null | undefined, opts: { decimals?: 0 | 2 } = {}): string {
  if (c == null) return "—";
  const d = opts.decimals ?? 0;
  const v = Math.abs(c) / 100;
  const s = v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  return `${c < 0 ? "-" : ""}$${s}`;
}

export function fmtRate(r: number | null | undefined): string {
  if (r == null) return "—";
  const p = r * 100;
  return `${Number.isInteger(Math.round(p * 10) / 10) ? Math.round(p) : p.toFixed(1)}%`;
}
