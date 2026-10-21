/** Shared with the browser: no server imports here. */
export type Outcome = "declined" | "rescheduled" | "closed" | "completed" | "incomplete";
export type ApptKind = "sales" | "install";
export interface Disposition {
  outcome: Outcome;
  reason: string | null;
  note: string | null;
  rescheduledTo: string | null;
  dealNumber: number | null;
  at: string;
}

export const DECLINE_REASONS = ["Price", "Spouse / decision maker not there", "Financing denied", "Wants to think about it", "Not interested", "Other"] as const;
export const INCOMPLETE_REASONS = ["Customer not home", "Missing parts", "Site / plumbing issue", "Customer cancelled", "Ran out of time", "Other"] as const;

const shortDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

/** "Declined: Price", "Rescheduled to Sat, Oct 24", "Closed · deal #128", "Installed", "Not completed: Missing parts". */
export function outcomeLabel(d: { outcome: Outcome; reason: string | null; rescheduledTo: string | null; dealNumber: number | null }): string {
  switch (d.outcome) {
    case "closed":
      return `Closed${d.dealNumber != null ? ` · deal #${d.dealNumber}` : ""}`;
    case "completed":
      return `Installed${d.dealNumber != null ? ` · deal #${d.dealNumber}` : ""}`;
    case "rescheduled":
      return `Rescheduled${d.rescheduledTo ? ` to ${shortDay(d.rescheduledTo)}` : ""}`;
    case "incomplete":
      return `Not completed${d.reason ? `: ${d.reason}` : ""}`;
    case "declined":
      return `Declined${d.reason ? `: ${d.reason}` : ""}`;
  }
}
