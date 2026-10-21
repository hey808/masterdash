import { describe, expect, it } from "vitest";
import { splitAddress, splitName, systemsFromProducts } from "./agreement-prefill";

describe("agreement prefill", () => {
  it("splits names", () => {
    expect(splitName("Paul & Paris Crane")).toEqual({ first: "Paul & Paris", last: "Crane" });
    expect(splitName("Wayne Trudel (Jayden Bottle Return)")).toEqual({ first: "Wayne", last: "Trudel" });
    expect(splitName("Tanner")).toEqual({ first: "Tanner", last: "" });
  });
  it("splits addresses", () => {
    expect(splitAddress("162 Waterhall Dr., Murrells Inlet, SC 29576")).toEqual({ address: "162 Waterhall Dr.", city: "Murrells Inlet", state: "SC", zip: "29576" });
    expect(splitAddress("4546 Highway 319, Aynor, SC, 29511")).toEqual({ address: "4546 Highway 319", city: "Aynor", state: "SC", zip: "29511" });
    expect(splitAddress("1631 SC-544 Conway, SC")).toEqual({ address: "1631 SC-544", city: "Conway", state: "SC", zip: "" });
    expect(splitAddress("525 Ambrosia Loop Myrtle Beach, SC 29579")).toEqual({ address: "525 Ambrosia Loop", city: "Myrtle Beach", state: "SC", zip: "29579" });
    expect(splitAddress("12 Ocean Dr North Myrtle Beach, SC 29582")).toEqual({ address: "12 Ocean Dr", city: "North Myrtle Beach", state: "SC", zip: "29582" });
  });
  it("guesses systems from products", () => {
    expect(systemsFromProducts(["Aquonyx Diamond filter/softener combo", "Reverse osmosis (4 stage)", "UV light"])).toEqual(["Water Softener", "Reverse Osmosis", "Whole House Filter", "UV System"]);
  });
});
