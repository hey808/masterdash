/** Logins against a real Postgres (TEST_DATABASE_URL, disposable). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authenticate, checkPassword, hashPassword } from "./auth";
import { closeDb, db } from "./db";
import { createUser, updateUser } from "./users";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("logins (database)", () => {
  let brock = "";
  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.APP_PASSWORD = "owner-pass";
    brock = (await db().query("select id from people where lower(name) = 'brock'")).rows[0].id;
  });
  afterAll(closeDb);

  it("hashes passwords (salted) and checks them", async () => {
    const a = await hashPassword("correct horse");
    expect(a).not.toBe(await hashPassword("correct horse"));
    expect(await checkPassword("correct horse", a)).toBe(true);
    expect(await checkPassword("wrong", a)).toBe(false);
  });

  it("a sales login needs a roster person; emails are unique", async () => {
    await expect(createUser({ name: "No Person", email: "np@x.com", role: "sales", password: "longenough" }, "test")).rejects.toThrow(/roster person/);
    await createUser({ name: "Brock", email: "Brock@CFWusa.com ", role: "sales", personId: brock, password: "brock-pass-1" }, "test");
    await expect(createUser({ name: "Again", email: "brock@cfwusa.com", role: "sales", personId: brock, password: "longenough" }, "test")).rejects.toThrow(/already a login/);
  });

  it("signs in by email (any case) and the owner by password alone", async () => {
    expect(await authenticate("BROCK@cfwusa.com", "brock-pass-1")).toMatchObject({ role: "sales", personId: brock, name: "Brock", version: 1 });
    expect(await authenticate("brock@cfwusa.com", "nope")).toBeNull();
    expect(await authenticate("", "owner-pass")).toMatchObject({ userId: "owner", role: "admin" });
    expect(await authenticate("", "nope")).toBeNull();
  });

  it("a password reset or deactivation bumps the session version; off means no sign-in", async () => {
    const id = (await db().query("select id from app_users where email = 'brock@cfwusa.com'")).rows[0].id;
    await updateUser(id, { password: "brock-pass-2" }, "test");
    expect((await authenticate("brock@cfwusa.com", "brock-pass-2"))?.version).toBe(2);
    await updateUser(id, { name: "Brock C" }, "test"); // a rename doesn't sign them out
    expect((await authenticate("brock@cfwusa.com", "brock-pass-2"))?.version).toBe(2);
    await updateUser(id, { active: false }, "test");
    expect(await authenticate("brock@cfwusa.com", "brock-pass-2")).toBeNull();
  });
});
