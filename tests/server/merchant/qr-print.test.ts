import { describe, it, expect } from "vitest";
import { qrFileName, qrStandeePdf } from "@/server/merchant/qr-print";

const RAW =
  "00020101021128660011ph.ppmi.p2m0111PARTNERBANK0208123456780308MERCHID01520400005303608" +
  "5802PH5909HEYPAY CAFE6005DAVAO6304ABCD";

function pdfText(input: Parameters<typeof qrStandeePdf>[0]): string {
  return qrStandeePdf(input).toString("latin1");
}

describe("qrStandeePdf", () => {
  it("writes a cross-reference table that points at each object", () => {
    const pdf = pdfText({ raw: RAW, businessName: "HeyPay Cafe", city: "Davao" });
    const xrefAt = Number(/startxref\n(\d+)/.exec(pdf)![1]);
    expect(pdf.slice(xrefAt, xrefAt + 4)).toBe("xref");
    const offsets = [...pdf.slice(xrefAt).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) =>
      Number(m[1]),
    );
    expect(offsets).toHaveLength(5);
    offsets.forEach((offset, i) =>
      expect(pdf.slice(offset)).toMatch(new RegExp(`^${i + 1} 0 obj`)),
    );
    expect(pdf).toContain("(DAVAO) Tj");
  });

  it("keeps a long name to two lines, and the PDF's text escaped", () => {
    const pdf = pdfText({
      raw: RAW,
      businessName: "Aling Nena's (Original) Sari-Sari Store and Carinderia ng Barangay San Roque",
    });
    const lines = [...pdf.matchAll(/\/F1 (\d+) Tf [\d.]+ [\d.]+ Td \((.*?)\) Tj/g)];
    const nameLines = lines.filter(([, , text]) => /Aling|Store|Carinderia|\.\.\./.test(text!));
    expect(nameLines.length).toBeLessThanOrEqual(2);
    expect(pdf).toContain("\\(Original\\)");
  });

  it("encodes accented letters the font can show, and replaces what it can't", () => {
    const pdf = pdfText({ raw: RAW, businessName: "Niña’s Café ☕" });
    expect(pdf).toContain("(Ni\\361a\\222s Caf\\351 ?) Tj");
  });
});

describe("qrFileName", () => {
  it("names the file after the shop", () => {
    expect(qrFileName("Aling Nena's Sari-Sari")).toBe("aling-nenas-sari-sari-qr");
    expect(qrFileName("Café Niño")).toBe("cafe-nino-qr");
    expect(qrFileName("☕☕")).toBe("heypay-qr");
  });
});
