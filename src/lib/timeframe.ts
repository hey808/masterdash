/**
 * Time frames shared by the ledger and Home. Dates are Eastern yyyy-mm-dd;
 * weeks start Monday. A frame resolves to [from, to] (null = open-ended).
 */
export type Frame = "all" | "today" | "thisWeek" | "thisMonth" | "lastMonth" | "last30" | "last90" | "thisQuarter" | "thisYear" | "custom";

export const FRAMES: Record<Frame, string> = {
  all: "All time",
  today: "Today",
  thisWeek: "This week",
  thisMonth: "This month",
  lastMonth: "Last month",
  last30: "Last 30 days",
  last90: "Last 90 days",
  thisQuarter: "This quarter",
  thisYear: "This year",
  custom: "Custom range",
};

export const isFrame = (s: unknown): s is Frame => typeof s === "string" && Object.prototype.hasOwnProperty.call(FRAMES, s);

const shift = (d: string, days: number) => new Date(Date.parse(`${d}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const monthStart = (y: number, m: number) => new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10); // m may be <0 or >11
const isDate = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export function frameRange(f: Frame, today: string, from?: string | null, to?: string | null): [string | null, string | null] {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7)) - 1;
  switch (f) {
    case "all": return [null, null];
    case "today": return [today, today];
    case "thisWeek": return [shift(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7)), today];
    case "thisMonth": return [monthStart(y, m), today];
    case "lastMonth": return [monthStart(y, m - 1), shift(monthStart(y, m), -1)];
    case "last30": return [shift(today, -29), today];
    case "last90": return [shift(today, -89), today];
    case "thisQuarter": return [monthStart(y, m - (m % 3)), today];
    case "thisYear": return [monthStart(y, 0), today];
    case "custom": return [isDate(from) ? from : null, isDate(to) ? to : null];
  }
}
