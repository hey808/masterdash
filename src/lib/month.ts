/** Month grids: 6 Monday-start weeks covering a month (Eastern dates). */
import { addDays } from "./ledger/payrun";

const mondayOf = (d: string) => addDays(d, -((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7));

export const monthOf = (d: string) => d.slice(0, 7);
export function shiftMonth(m: string, n: number): string {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}
export function monthGrid(m: string): string[] {
  const start = mondayOf(`${m}-01`);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}
/** A UTC window that safely covers the grid's Eastern days. */
export const gridWindow = (days: string[]): [string, string] => [`${addDays(days[0]!, -1)}T12:00:00Z`, `${addDays(days[days.length - 1]!, 1)}T12:00:00Z`];
export const monthLabel = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
