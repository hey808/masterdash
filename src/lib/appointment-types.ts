/** Shared with the browser: no server imports here. */
export type Outcome = "declined" | "rescheduled" | "closed";
export interface Disposition {
  outcome: Outcome;
  reason: string | null;
  note: string | null;
  rescheduledTo: string | null;
  dealNumber: number | null;
  at: string;
}

export const DECLINE_REASONS = ["Price", "Spouse / decision maker not there", "Financing denied", "Wants to think about it", "Not interested", "Other"] as const;
