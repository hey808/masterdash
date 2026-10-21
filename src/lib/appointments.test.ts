import { describe, expect, it } from "vitest";
import { customerFromTitle, formatPhone } from "./appointments";

describe("sales appointments", () => {
  it("reads the customer out of the title", () => {
    expect(customerFromTitle("confirmed. todd leggens — demo (AquaReport)")).toBe("todd leggens");
    expect(customerFromTitle("Jimmy Serio Water Test & Consultation")).toBe("Jimmy Serio");
  });
  it("formats US phone numbers", () => {
    expect(formatPhone("+19105550142")).toBe("(910) 555-0142");
    expect(formatPhone("555-0142")).toBe("555-0142");
    expect(formatPhone(null)).toBeNull();
  });
});
