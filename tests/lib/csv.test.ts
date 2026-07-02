import { it, expect } from "vitest";
import { toCsv } from "@/lib/csv";

it("quotes fields containing commas, quotes, and newlines", () => {
  const csv = toCsv(
    ["a", "b"],
    [
      ["x,y", 'he said "hi"'],
      ["line\nbreak", null],
    ],
  );
  expect(csv).toBe('a,b\r\n"x,y","he said ""hi"""\r\n"line\nbreak",\r\n');
});
