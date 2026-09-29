#!/usr/bin/env tsx
/**
 * Renders an alpha testing guide (docs/testing-guides/week-N/*.md) to a
 * HeyPay-branded PDF next to it, with headless Chromium.
 *
 * The markdown is the source; the PDF is what testers get. A few conventions
 * in the markdown get their own styling:
 *   - `> **Testnet only** ...` and other blockquotes render as callout boxes.
 *   - `- [ ]` list items render as tick boxes.
 *   - `**SCREENSHOT:** name.png` renders as a screenshot tag.
 *   - a line with only `<div class="page-break"></div>` starts a new page.
 *
 * Usage:
 *   pnpm docs:guide docs/testing-guides/week-1/basic.md
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { marked } from "marked";

// Colors and fonts from BRAND.md.
const STYLES = `
@page { size: A4; margin: 16mm 15mm 18mm; }
:root {
  --primary: #00bcd4; --primary-container: #b2ebf2; --on-primary-container: #002024;
  --secondary: #ff9800; --secondary-container: #ffe0b2; --on-secondary-container: #e65100;
  --background: #fcf9f8; --on-surface: #1d1b1a; --on-surface-variant: #4e4643;
  --surface-low: #f6f3f2; --outline-variant: #d2c5c1; --error: #ba1a1a;
}
* { box-sizing: border-box; }
html { background: #fff; }
body { font-family: Inter, system-ui, sans-serif; font-size: 10.5pt; line-height: 1.5;
  color: var(--on-surface); margin: 0; }
h1, h2, h3, h4 { font-family: Lexend, Inter, sans-serif; line-height: 1.25; break-after: avoid; }
h1 { font-size: 24pt; color: var(--primary); margin: 0 0 6pt; }
h2 { font-size: 15pt; margin: 18pt 0 6pt; padding-bottom: 4pt; border-bottom: 2px solid var(--primary-container); }
h3 { font-size: 12pt; margin: 14pt 0 4pt; color: var(--on-primary-container); }
a { color: #0097a7; }
/* Cover-page calls to action are written as **[Label](url)**. */
strong > a { display: inline-block; margin: 4pt 2pt; padding: 6pt 14pt; border-radius: 999px;
  background: var(--primary); color: #fff; text-decoration: none; font-family: Lexend, Inter, sans-serif; }
code { font-family: ui-monospace, Menlo, monospace; font-size: 9.5pt; background: var(--surface-low);
  padding: 0 3px; border-radius: 3px; }
table { border-collapse: collapse; width: 100%; margin: 6pt 0 10pt; font-size: 9.5pt; break-inside: avoid; }
th, td { border: 1px solid var(--outline-variant); padding: 4pt 6pt; text-align: left; vertical-align: top; }
th { background: var(--surface-low); font-family: Lexend, Inter, sans-serif; font-weight: 600; }
blockquote { margin: 8pt 0; padding: 8pt 12pt; border-left: 4px solid var(--primary);
  background: #eefafc; border-radius: 6px; break-inside: avoid; }
blockquote p { margin: 2pt 0; }
ul, ol { padding-left: 18pt; }
li { margin: 2pt 0; }
li.task { list-style: none; margin-left: -16pt; }
li.task input { width: 11pt; height: 11pt; margin: 0 6pt 0 0; vertical-align: -1pt; }
.shot { display: inline-block; font-size: 8.5pt; font-weight: 600; letter-spacing: .04em;
  color: var(--on-secondary-container); background: var(--secondary-container);
  border-radius: 4px; padding: 1pt 6pt; }
.page-break { break-after: page; }
hr { border: 0; border-top: 1px solid var(--outline-variant); margin: 14pt 0; }
.card { break-inside: avoid-page; }
img { display: block; max-width: 78%; max-height: 95mm; margin: 6pt 0 8pt; border: 1px solid var(--outline-variant);
  border-radius: 8px; box-shadow: 0 2px 8px rgba(0, 188, 212, 0.12); }
`;

async function render(): Promise<void> {
  const arg = process.argv[2];
  if (!arg || !arg.endsWith(".md")) throw new Error("usage: pnpm docs:guide <guide.md>");
  const input = resolve(arg);
  if (!existsSync(input)) throw new Error(`${input} does not exist`);
  const output = input.replace(/\.md$/, ".pdf");

  const markdown = readFileSync(input, "utf8");
  const body = (await marked.parse(markdown, { gfm: true }))
    .replace(
      /<li><input (checked="" )?disabled="" type="checkbox">/g,
      '<li class="task"><input type="checkbox">',
    )
    .replace(
      /<strong>SCREENSHOT:<\/strong>\s*([^<\s,]+),?/g,
      '<span class="shot">SCREENSHOT · $1</span>',
    );
  // setContent has no base URL, so inline local images (paths relative to the guide).
  const mime: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
  };
  const withImages = body.replace(/<img src="(?!https?:|data:)([^"]+)"/g, (_, src: string) => {
    const file = join(dirname(input), decodeURIComponent(src));
    const data = readFileSync(file).toString("base64");
    return `<img src="data:${mime[extname(file).toLowerCase()] ?? "image/png"};base64,${data}"`;
  });
  const title = /^#\s+(.+)$/m.exec(markdown)?.[1] ?? "HeyPay testing guide";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Lexend:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${STYLES}</style></head><body>${withImages}</body></html>`;

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.pdf({
      path: output,
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: `<div style="font-family:Helvetica,Arial,sans-serif;font-size:8px;color:#807673;width:100%;padding:0 15mm;display:flex;justify-content:space-between"><span>${title}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
    });
  } finally {
    await browser.close();
  }
  console.log(`wrote ${output}`);
}

render().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
