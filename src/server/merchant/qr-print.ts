import "server-only";
import QRCode from "qrcode";

// The merchant's QR Ph code as files to print: a PNG of the code alone, and an
// A5 standee PDF ("Scan to pay", the shop's name, the code). The PDF is written
// by hand, with the code drawn as vector squares and text in the built-in
// Helvetica-Bold, so it needs no PDF library or fonts on the server.

const QR_OPTIONS = { errorCorrectionLevel: "M" } as const;

/** A PNG of the code, large enough to print sharp at any standee size. */
export function qrPng(raw: string): Promise<Buffer> {
  return QRCode.toBuffer(raw, { ...QR_OPTIONS, type: "png", margin: 2, width: 1024 });
}

/** A file name for the downloads: "aling-nenas-sari-sari-qr". */
export function qrFileName(businessName: string): string {
  const slug = businessName
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return `${slug || "heypay"}-qr`;
}

// Helvetica-Bold advance widths (1/1000 em) for character codes 32–126, from
// the font's standard metrics. Used to centre and wrap text.
// prettier-ignore
const BOLD_WIDTHS = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, // space–/
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, // 0–?
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, // @–O
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, // P–_
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, // `–o
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,      // p–~
];
// Characters outside that range are mostly accented letters; this is close.
const OTHER_WIDTH = 600;

// The few typographic characters a shop name may hold that WinAnsiEncoding
// keeps outside Latin-1.
const WIN_ANSI_EXTRA: Record<string, number> = {
  "‘": 0x91,
  "’": 0x92,
  "“": 0x93,
  "”": 0x94,
  "–": 0x96,
  "—": 0x97,
};

/** Each character as a WinAnsi code; anything the font can't show becomes "?". */
function winAnsiCodes(text: string): number[] {
  return [...text].map((ch) => {
    const code = ch.codePointAt(0)!;
    if ((code >= 32 && code <= 126) || (code >= 160 && code <= 255)) return code;
    return WIN_ANSI_EXTRA[ch] ?? 63;
  });
}

function textWidth(text: string, size: number): number {
  const units = winAnsiCodes(text).reduce(
    (sum, code) => sum + (code >= 32 && code <= 126 ? BOLD_WIDTHS[code - 32]! : OTHER_WIDTH),
    0,
  );
  return (units * size) / 1000;
}

/** A PDF string literal: printable ASCII as is, the rest as octal escapes. */
function pdfString(text: string): string {
  const body = winAnsiCodes(text)
    .map((code) => {
      if (code === 0x28 || code === 0x29 || code === 0x5c) return `\\${String.fromCharCode(code)}`;
      if (code >= 32 && code <= 126) return String.fromCharCode(code);
      return `\\${code.toString(8).padStart(3, "0")}`;
    })
    .join("");
  return `(${body})`;
}

/** Breaks `text` into lines no wider than `maxWidth`, splitting a word only if it must. */
function wrap(text: string, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (textWidth(candidate, size) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = "";
    // A word wider than the line on its own is cut where it has to be.
    let rest = word;
    while (textWidth(rest, size) > maxWidth) {
      let cut = rest.length - 1;
      while (cut > 1 && textWidth(rest.slice(0, cut), size) > maxWidth) cut--;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    line = rest;
  }
  if (line) lines.push(line);
  return lines;
}

/** The largest size from `sizes` at which `text` fits in `maxLines`; else the smallest, cut short. */
function fit(text: string, sizes: number[], maxWidth: number, maxLines: number) {
  for (const size of sizes) {
    const lines = wrap(text, size, maxWidth);
    if (lines.length <= maxLines) return { size, lines };
  }
  const size = sizes[sizes.length - 1]!;
  const lines = wrap(text, size, maxWidth).slice(0, maxLines);
  let last = lines[maxLines - 1]!;
  while (last.length > 1 && textWidth(`${last}...`, size) > maxWidth) last = last.slice(0, -1);
  lines[maxLines - 1] = `${last}...`;
  return { size, lines };
}

type Rgb = [number, number, number];
const INK: Rgb = [0.114, 0.106, 0.102]; // on-surface #1d1b1a
const MUTED: Rgb = [0.306, 0.275, 0.263]; // on-surface-variant #4e4643
const TEAL: Rgb = [0, 0.408, 0.455]; // #006874, dark enough to print and read

const rgb = ([r, g, b]: Rgb) => `${r} ${g} ${b} rg`;
const num = (n: number) => Number(n.toFixed(2)).toString();

/** A5, in points. */
const PAGE = { width: 419.53, height: 595.28 };

function centredText(text: string, size: number, y: number, color: Rgb): string {
  const x = (PAGE.width - textWidth(text, size)) / 2;
  return `BT ${rgb(color)} /F1 ${num(size)} Tf ${num(x)} ${num(y)} Td ${pdfString(text)} Tj ET`;
}

/** The code's dark squares, one rectangle per run of them in a row. */
function qrSquares(raw: string, x: number, y: number, side: number): string {
  const { modules } = QRCode.create(raw, QR_OPTIONS);
  const quiet = 2;
  const cell = side / (modules.size + quiet * 2);
  const top = y + side;
  // Each row reaches a little into the one below, so no hairline shows between
  // rows where a renderer anti-aliases the shared edge.
  const overlap = cell * 0.05;
  const rects: string[] = [];
  for (let row = 0; row < modules.size; row++) {
    let col = 0;
    while (col < modules.size) {
      if (!modules.get(row, col)) {
        col++;
        continue;
      }
      const start = col;
      while (col < modules.size && modules.get(row, col)) col++;
      rects.push(
        `${num(x + (start + quiet) * cell)} ${num(top - (row + quiet + 1) * cell - overlap)} ${num(
          (col - start) * cell,
        )} ${num(cell + overlap)} re`,
      );
    }
  }
  return `${rgb([0, 0, 0])}\n${rects.join("\n")}\nf`;
}

/** An A5 counter standee: "Scan to pay", the shop's name and city, and the code. */
export function qrStandeePdf(input: {
  raw: string;
  businessName: string;
  city?: string | null;
}): Buffer {
  const { width, height } = PAGE;
  const qrSide = 280;
  const qrX = (width - qrSide) / 2;
  const qrY = 128;

  const name = fit(input.businessName.trim() || "HeyPay merchant", [24, 21, 18, 15], 340, 2);
  const nameTop = 478;
  const nameLines = name.lines.map((line, i) =>
    centredText(line, name.size, nameTop - i * name.size * 1.2, INK),
  );
  const nameBottom = nameTop - (name.lines.length - 1) * name.size * 1.2;

  const content = [
    // Brand band across the top, and a light frame to cut along.
    `${rgb(TEAL)} 0 ${num(height - 14)} ${num(width)} 14 re f`,
    `0.82 0.77 0.76 RG 0.75 w 18 18 ${num(width - 36)} ${num(height - 50)} re S`,
    centredText("SCAN TO PAY", 30, 520, TEAL),
    ...nameLines,
    input.city ? centredText(input.city.toUpperCase(), 11, nameBottom - 20, MUTED) : "",
    qrSquares(input.raw, qrX, qrY, qrSide),
    centredText("Pay with HeyPay or any QRPH app", 12, 96, MUTED),
    centredText("HeyPay", 16, 56, TEAL),
  ]
    .filter(Boolean)
    .join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(width)} ${num(height)}] ` +
      "/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
  ];

  // Every byte above is ASCII, so string offsets are byte offsets.
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}
