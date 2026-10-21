/**
 * Match a GoHighLevel user's name to one roster person: same full name, else
 * the only roster person with that first name (GHL "Mike CF" is roster "Mike").
 */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();

export type MatchResult<T> = { person: T } | { person: null; ambiguous: boolean };

export function matchRoster<T extends { name: string }>(ghlName: string, roster: T[]): MatchResult<T> {
  const full = norm(ghlName);
  const exact = roster.find((r) => norm(r.name) === full);
  if (exact) return { person: exact };
  const firstName = full.split(" ")[0] ?? "";
  if (!firstName) return { person: null, ambiguous: false };
  const same = roster.filter((r) => norm(r.name).split(" ")[0] === firstName);
  if (same.length === 1) return { person: same[0]! };
  return { person: null, ambiguous: same.length > 1 };
}
