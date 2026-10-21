import { describe, expect, it } from "vitest";
import { makeBuckets } from "./reports";

describe("chart buckets", () => {
  it("days for a month, weeks for a quarter, months for a year", () => {
    expect(makeBuckets("2026-09-22", "2026-10-21").size).toBe("day");
    expect(makeBuckets("2026-09-22", "2026-10-21").buckets).toHaveLength(30);
    const w = makeBuckets("2026-07-24", "2026-10-21");
    expect(w.size).toBe("week");
    expect(w.buckets[0]!.start).toBe("2026-07-24"); // clipped to the period
    expect(w.buckets.at(-1)!.end).toBe("2026-10-21");
    expect(makeBuckets("2026-01-01", "2026-10-21").size).toBe("month");
  });
  it("cash charts never go finer than weeks", () => {
    const c = makeBuckets("2026-09-22", "2026-10-21", "week");
    expect(c.size).toBe("week");
    expect(c.buckets[0]!.start).toBe("2026-09-22");
    expect(c.buckets.at(-1)!.end).toBe("2026-10-21");
  });
});
