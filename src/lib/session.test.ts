import { beforeAll, describe, expect, it } from "vitest";
import { canAccess, homeFor, legacyToken, signSession, verifySession } from "./session";

describe("sessions", () => {
  beforeAll(() => {
    process.env.APP_PASSWORD = "owner-pass";
    delete process.env.SESSION_SECRET;
  });

  it("signs and verifies, and rejects anything tampered with", async () => {
    const c = await signSession({ userId: "u1", role: "sales", personId: "p1", name: "Brock", version: 3 });
    expect(await verifySession(c)).toEqual({ userId: "u1", role: "sales", personId: "p1", name: "Brock", version: 3 });
    const [v, payload, sig] = c.split(".");
    const forged = Buffer.from(JSON.stringify({ u: "u1", r: "admin", p: "p1", n: "Brock", sv: 3 })).toString("base64url");
    expect(await verifySession(`${v}.${forged}.${sig}`)).toBeNull();
    expect(await verifySession(`${v}.${payload}.${sig!.slice(0, -2)}xx`)).toBeNull();
    expect(await verifySession("garbage")).toBeNull();
  });

  it("changing APP_PASSWORD signs everyone out", async () => {
    const c = await signSession({ userId: "u1", role: "installer", personId: "p2", name: "Angel", version: 1 });
    process.env.APP_PASSWORD = "rotated";
    expect(await verifySession(c)).toBeNull();
    process.env.APP_PASSWORD = "owner-pass";
  });

  it("keeps browsers on the old shared-password cookie signed in as the owner", async () => {
    expect(await verifySession(await legacyToken("owner-pass"))).toMatchObject({ userId: "owner", role: "admin" });
    expect(await verifySession(await legacyToken("wrong"))).toBeNull();
  });

  it("each role only reaches its own pages and APIs", () => {
    expect(canAccess("admin", "/ledger")).toBe(true);
    for (const p of ["/me", "/forms/sale", "/api/forms/sale", "/appointments", "/api/appointments"]) expect(canAccess("sales", p)).toBe(true);
    for (const p of ["/", "/ledger", "/commissions", "/forms/install", "/api/forms/install", "/api/deals/x", "/api/payouts", "/team", "/api/users", "/bank", "/calendar", "/forms/payout", "/mex"]) {
      expect(canAccess("sales", p)).toBe(false);
    }
    for (const p of ["/me", "/forms/install", "/api/forms/install"]) expect(canAccess("installer", p)).toBe(true);
    for (const p of ["/forms/sale", "/api/forms/sale", "/appointments", "/api/appointments", "/ledger", "/api/payments/x"]) expect(canAccess("installer", p)).toBe(false);
    expect(homeFor("sales")).toBe("/appointments");
    expect(homeFor("admin")).toBe("/");
  });
});
