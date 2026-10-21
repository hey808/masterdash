import { describe, expect, it } from "vitest";
import { matchRoster } from "./person-match";

const roster = [{ name: "Mike" }, { name: "Randy" }, { name: "Tamera LeGette" }, { name: "Chris A" }, { name: "Chris B" }];
describe("matchRoster", () => {
  it("full name first", () => expect(matchRoster("Tamera LeGette", roster).person?.name).toBe("Tamera LeGette"));
  it("unique first name", () => expect(matchRoster("Randy McPherson", roster).person?.name).toBe("Randy"));
  it("ambiguous first name", () => expect(matchRoster("Chris Z", roster)).toEqual({ person: null, ambiguous: true }));
  it("no match", () => expect(matchRoster("Zed", roster)).toEqual({ person: null, ambiguous: false }));
});
