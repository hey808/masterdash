/** Monday-start weeks in Eastern dates (yyyy-mm-dd). */
import { addDays } from "./ledger/payrun";

export const mondayOf = (d: string) => addDays(d, -((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7));
export const weekDays = (monday: string) => Array.from({ length: 7 }, (_, i) => addDays(monday, i));
/** A UTC window that safely covers those Eastern days (events are then grouped by their Eastern day). */
export const weekWindow = (monday: string): [string, string] => [`${addDays(monday, -1)}T12:00:00Z`, `${addDays(monday, 7)}T12:00:00Z`];
