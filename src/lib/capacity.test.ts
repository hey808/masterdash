import { describe, expect, it } from "vitest";
import { adsCall } from "./capacity";

const base = { salesCapacity: 40, salesBooked: 20, targetPct: 85, installBacklogWeeks: 1, costPerApptCents: 12_000 };

describe("adsCall", () => {
  it("holds with no capacity set", () => expect(adsCall({ ...base, salesCapacity: 0 }).level).toBe("hold"));
  it("pushes hard when far under target, with spend", () => {
    const a = adsCall(base); // 50% vs 85%: target 34, need 14
    expect(a.level).toBe("push-hard");
    expect(a.needed).toBe(14);
    expect(a.spendCents).toBe(14 * 12_000);
  });
  it("pushes when a little under", () => expect(adsCall({ ...base, salesBooked: 30 }).level).toBe("push"));
  it("steady at target", () => expect(adsCall({ ...base, salesBooked: 34 }).level).toBe("steady"));
  it("pulls when overbooked", () => expect(adsCall({ ...base, salesBooked: 45 }).level).toBe("pull"));
  it("holds when installs are 3+ weeks behind", () => expect(adsCall({ ...base, installBacklogWeeks: 3.5 }).level).toBe("hold"));
  it("pulls when installs are 4+ weeks behind", () => expect(adsCall({ ...base, installBacklogWeeks: 5 }).level).toBe("pull"));
  it("no spend without a cost", () => expect(adsCall({ ...base, costPerApptCents: null }).spendCents).toBeNull());
});
