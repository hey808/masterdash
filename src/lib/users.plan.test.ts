import { describe, expect, it } from "vitest";
import { planCalendarLogins, makePassword } from "./users";

const g = (name: string, email: string | null, sales: number, install: number) => ({ id: name, name, email, sales, install, locations: ["Wilmington"] });
const roster = [
  { id: "m", name: "Mike", email: null, roles: ["manager", "closer"] },
  { id: "a", name: "Angel", email: null, roles: ["installer"] },
  { id: "t", name: "Tamera LeGette", email: null, roles: ["closer"] },
];

describe("planCalendarLogins", () => {
  it("matches by first name, picks the role, skips strangers and existing logins", () => {
    const plan = planCalendarLogins(
      [g("Mike CF", "mike@x.com", 59, 0), g("Angel M", "angel@x.com", 0, 18), g("Tamera LaGette", "tamera@x.com", 8, 0), g("Zed", "z@x.com", 1, 0)],
      roster,
      [{ email: "tamera@x.com", personId: null }],
    );
    expect(plan.map((p) => (p.kind === "create" ? `${p.person.id}:${p.role}` : `skip:${p.ghl.name}`))).toEqual(["m:sales", "a:installer", "skip:Tamera LaGette", "skip:Zed"]);
  });
  it("makes readable passwords", () => expect(makePassword()).toMatch(/^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/));
});
