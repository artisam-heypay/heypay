import { describe, expect, it } from "vitest";
import { formatDay, formatDayTime } from "@/lib/dates";

// Some ICU versions put a narrow no-break space before AM/PM.
const plain = (s: string) => s.replace(/\s/g, " ");

describe("dates", () => {
  it("reads in Philippine time, whatever zone the server runs in", () => {
    // 01:37 UTC is 9:37 AM in Manila.
    expect(plain(formatDayTime("2026-10-16T01:37:00Z"))).toBe("Oct 16, 9:37 AM");
  });

  it("puts a payment made after midnight in Manila on that day", () => {
    // 17:30 UTC on Oct 15 is 1:30 AM on Oct 16 in Manila.
    expect(formatDay("2026-10-15T17:30:00Z")).toBe("Oct 16, 2026");
    expect(formatDay(new Date("2026-10-15T15:59:00Z"))).toBe("Oct 15, 2026");
  });
});
