import { describe, expect, it } from "vitest";
import { firstLast, normName, planInstallDates } from "./install-sync";

const ev = (title: string, day: string, status = "confirmed", location: "myrtle-beach" | "wilmington" = "myrtle-beach") => ({ kind: "install" as const, title, day, status, location });
const deal = (number: number, customer: string, scheduled: string | null, location = "myrtle-beach") => ({ id: `d${number}`, number, customer, scheduled, location });

describe("install date sync", () => {
  it("reads the customer out of the appointment title", () => {
    expect(normName("confirmed. chet bednarz — install (AquaReport)")).toBe("chet bednarz");
    expect(firstLast("John & Kim Dupree — install")).toBe("john dupree");
    expect(firstLast("Wayne Trudel (Jayden Bottle Return)")).toBe("wayne trudel");
  });
  it("takes the latest appointment that isn't cancelled, and leaves matching dates alone", () => {
    const { changes } = planInstallDates(
      [ev("Linda Griffin — install (AquaReport)", "2026-10-21"), ev("Linda Griffin — install", "2026-10-28", "cancelled"), ev("Bob Wallace — install", "2026-10-21")],
      [deal(1, "Linda Griffin", "2026-10-18"), deal(2, "Bob Wallace", "2026-10-21")],
    );
    expect(changes).toEqual([{ dealId: "d1", number: 1, customer: "Linda Griffin", from: "2026-10-18", to: "2026-10-21" }]);
  });
  it("matches first + last name only when one deal fits, and never across locations", () => {
    const { changes, unmatched } = planInstallDates(
      [ev("John & Kim Dupree — install", "2026-10-30"), ev("Chris Smith — install", "2026-10-30"), ev("Ann Lee — install", "2026-10-30", "confirmed", "wilmington")],
      [deal(3, "John Dupree", null), deal(4, "Chris & Pat Smith", null), deal(5, "Chris Smith (referral)", null), deal(6, "Ann Lee", null)],
    );
    expect(changes.map((c) => c.number)).toEqual([3]);
    expect(unmatched).toEqual(["Chris Smith — install", "Ann Lee — install"]);
  });
});
