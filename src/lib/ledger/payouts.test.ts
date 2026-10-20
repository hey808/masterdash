import { describe, expect, it } from "vitest";
import { derive } from "./derive";
import { byPerson, payoutLines } from "./payouts";
import type { Deal } from "./types";

const brock = { id: "b", name: "Brock" };
const mike = { id: "m", name: "Mike" };
const angel = { id: "a", name: "Angel" };

const base: Deal = {
  id: "d1", number: 1001, version: 1, location: "wilmington", customerName: "A", customerAddress: null, saleDate: "2026-10-01",
  leadSource: null, externalRef: null, closer: brock, manager: mike, setter: null, canvasser: null, installer: angel,
  priceCents: 749500, cashPortionCents: 749500, financedPortionCents: 0, splitException: null, lender: null, lenderRate: 0,
  commissionRate: 0.15, commissionRateSource: "plan", managerRate: 0.03, setterRate: 0, canvasserRate: 0,
  adminFeeCents: 25000, extrasCents: 0, installerPayCents: 125000, loanInterestOverrideCents: null, cardFeeOverrideCents: null,
  fundingExpectedOverrideCents: null, cogsOverrideCents: null, overrideReason: null, installScheduledOn: "2026-10-05",
  installedOn: "2026-10-05", cancelledAt: null, closedAt: null, note: null, lines: [], payments: [], payouts: [],
};
const paidIn = { source: "customer" as const, method: "check", amountCents: 749500, feeCents: 0, receivedOn: "2026-10-05" };

describe("commissions payable", () => {
  it("payable once installed and paid in full; waiting with a reason until then", () => {
    const waiting = payoutLines([derive(base, "2026-10-20")]);
    expect(waiting.find((l) => l.kind === "closer")!.status).toBe("waiting");
    expect(waiting.find((l) => l.kind === "closer")!.waitingOn).toMatch(/customer owes/);
    expect(waiting.find((l) => l.kind === "installer")!.status).toBe("waiting"); // installed, but money not in

    const paid = payoutLines([derive({ ...base, payments: [paidIn] }, "2026-10-20")]);
    expect(paid.find((l) => l.kind === "closer")!.status).toBe("payable");
  });

  it("a paid line drops out of what's owed but stays in paid to date", () => {
    const d = derive({ ...base, payments: [paidIn], payouts: [{ kind: "closer", personId: "b", amountCents: 108675, paidOn: "2026-10-10" }] }, "2026-10-20");
    const [brockRow] = byPerson(payoutLines([d])).filter((p) => p.person === "Brock");
    expect(brockRow!.payableNowCents).toBe(0);
    expect(brockRow!.paidCents).toBe(108675);
  });

  it("groups by person and sorts by what is payable now", () => {
    const people = byPerson(payoutLines([derive({ ...base, payments: [paidIn] }, "2026-10-20")]));
    expect(people.map((p) => p.person)).toEqual(["Angel", "Brock", "Mike"]);
    expect(people[0]!.payableNowCents).toBe(125000);
  });

  it("cancelled deals owe nothing", () => {
    expect(payoutLines([derive({ ...base, cancelledAt: "2026-10-02T00:00:00Z" }, "2026-10-20")])).toHaveLength(0);
  });
});
