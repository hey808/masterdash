/** Customer agreements against a real Postgres (TEST_DATABASE_URL). */
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agreementPdf } from "./agreement-pdf";
import { createAgreement, loadAgreement, loadAgreementByToken, signAgreement, signedContent, voidAgreement } from "./agreements";
import { closeDb, db } from "./db";

const url = process.env.TEST_DATABASE_URL;
// A real (tiny) PNG: 1×1 pixel.
const SIG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

describe.skipIf(!url)("customer agreements (database)", () => {
  let rep = "";
  let made: { id: string; token: string; number: string };
  const base = () => ({
    repId: rep, location: "myrtle-beach", firstName: "Test", lastName: "Buyer", address: "1 Ocean Blvd", city: "Myrtle Beach", state: "SC", zip: "29577",
    phone: "(843) 555-0100", email: "buyer@example.com", hardness: "12 gpg", systems: ["Water Softener", "Reverse Osmosis"], soapPackage: "standard",
    maintenancePlan: true, priceCents: 749500, depositCents: 50000, depositMethod: "check", installDate: "2026-11-02", notes: "6 bags of salt",
  });

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    rep = (await db().query("select id from people where name = 'Brock'")).rows[0].id;
  });
  afterAll(closeDb);

  it("creates a numbered agreement with a secret link and a terms snapshot", async () => {
    made = await createAgreement(base(), "test");
    expect(made.number).toMatch(/^[A-Z2-9]{8}$/);
    expect(made.token.length).toBeGreaterThanOrEqual(30);
    const a = (await loadAgreement(made.id))!;
    expect(a.status).toBe("sent");
    expect(a.repInitials).toBe("B");
    expect(a.termsText).toContain("Three-Day Right to Cancel");
    expect(a.equipment).toEqual(["Water Softener", "Reverse Osmosis"]);
  });

  it("refuses deposit plus financing above the price", async () => {
    await expect(createAgreement({ ...base(), financedCents: 700000, depositCents: 100000, lender: "ISPC" }, "test")).rejects.toThrow(/more than the price/);
  });

  it("won't sign without a signature or consent", async () => {
    const input = { firstName: "Test", lastName: "Buyer", phone: "(843) 555-0100", initials: "tb", signature: SIG, consent: true };
    await expect(signAgreement(made.token, { ...input, signature: "nope" }, { ip: null, userAgent: null })).rejects.toThrow(/signature/);
    await expect(signAgreement(made.token, { ...input, consent: false }, { ip: null, userAgent: null })).rejects.toThrow(/electronically/);
  });

  it("signs: contact fixes kept, price untouchable, audit trail and hash recorded", async () => {
    const a = await signAgreement(
      made.token,
      { firstName: "Testy", lastName: "Buyer", phone: "(843) 555-0199", email: "new@example.com", initials: "tb", signature: SIG, consent: true, priceCents: 1 },
      { ip: "203.0.113.9", userAgent: "vitest" },
    );
    expect(a.status).toBe("signed");
    expect(a.firstName).toBe("Testy");
    expect(a.priceCents).toBe(749500);
    expect(a.customerInitials).toBe("TB");
    expect(a.signedIp).toBe("203.0.113.9");
    expect(a.signedHash).toBe(createHash("sha256").update(signedContent(a)).digest("hex"));
  });

  it("can't be signed twice, and the signed PDF renders", async () => {
    await expect(signAgreement(made.token, { firstName: "X", lastName: "Y", phone: "8435550100", initials: "XY", signature: SIG, consent: true }, { ip: null, userAgent: null })).rejects.toThrow(/already signed/);
    const pdf = await agreementPdf((await loadAgreementByToken(made.token))!);
    expect(Buffer.from(pdf).subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("a cancelled agreement can't be signed", async () => {
    const b = await createAgreement(base(), "test");
    await voidAgreement(b.id, "wrong price", "test");
    await expect(signAgreement(b.token, { firstName: "T", lastName: "B", phone: "8435550100", initials: "TB", signature: SIG, consent: true }, { ip: null, userAgent: null })).rejects.toThrow(/cancelled/);
  });

  it("an unknown or malformed link finds nothing", async () => {
    expect(await loadAgreementByToken("x")).toBeNull();
    expect(await loadAgreementByToken("A".repeat(32))).toBeNull();
  });
});
