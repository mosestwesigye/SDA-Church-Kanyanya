import ExcelJS from "exceljs";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { PRIVACY_NOTICE } from "../exports/tabular";
import type { Report } from "./reports";

const CHURCH = "Seventh-day Adventist Church Kanyanya";
const stamp = (r: Report) => `Generated ${r.generatedAt.toLocaleString("en-GB", { timeZone: "Africa/Kampala", dateStyle: "medium", timeStyle: "short" })} by ${r.generatedBy}`;

// ───────── Excel ─────────

/** One sheet per section: summaries as two columns, tables as filtered grids. */
export async function reportXlsx(r: Report): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "SDAK Church Manager";
  wb.created = r.generatedAt;
  const used = new Set<string>();
  const sheetName = (s: string) => {
    let base = s.replace(/[\\/?*[\]:]/g, " ").slice(0, 28).trim() || "Sheet";
    let name = base;
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base.slice(0, 26)} ${i}`;
    used.add(name.toLowerCase());
    base = name;
    return base;
  };
  const head = (ws: ExcelJS.Worksheet, heading: string, note?: string) => {
    ws.addRow([`${CHURCH} — ${r.title}`]).font = { bold: true, size: 14 };
    ws.addRow([`${r.subtitle} · ${heading}`]).font = { bold: true };
    ws.addRow([`${stamp(r)}. ${PRIVACY_NOTICE}`]).font = { italic: true, size: 9 };
    if (note) ws.addRow([note]).font = { italic: true, size: 9 };
    ws.addRow([]);
  };
  const headerStyle = (row: ExcelJS.Row) => {
    row.font = { bold: true, color: { argb: "FFFFFFFF" } };
    row.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D5D6A" } }));
  };

  const summaries = r.sections.filter((s) => s.summary?.length);
  if (summaries.length) {
    const ws = wb.addWorksheet(sheetName("Summary"));
    head(ws, "Summary");
    for (const s of summaries) {
      ws.addRow([s.heading]).font = { bold: true };
      for (const it of s.summary!) ws.addRow([it.label, it.value]);
      if (s.note) ws.addRow([s.note]).font = { italic: true, size: 9 };
      ws.addRow([]);
    }
    ws.getColumn(1).width = 40;
    ws.getColumn(2).width = 14;
  }
  for (const s of r.sections.filter((x) => x.table)) {
    const t = s.table!;
    const ws = wb.addWorksheet(sheetName(s.heading));
    head(ws, s.heading, s.note);
    const hr = ws.addRow(t.columns.map((c) => c.label));
    headerStyle(hr);
    ws.views = [{ state: "frozen", ySplit: hr.number }];
    for (const row of t.rows) ws.addRow(t.columns.map((c) => xlCell(row[c.key])));
    t.columns.forEach((c, i) => (ws.getColumn(i + 1).width = c.width ?? Math.max(10, c.label.length + 4)));
    if (t.rows.length) ws.autoFilter = { from: { row: hr.number, column: 1 }, to: { row: hr.number, column: t.columns.length } };
  }
  if (!wb.worksheets.length) head(wb.addWorksheet("Report"), "No data");
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Text cells that look like formulas are prefixed so spreadsheets never evaluate them. */
function xlCell(v: unknown): string | number {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return v;
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

// ───────── PDF ─────────

const A4 = { w: 595.28, h: 841.89 };
const M = 40;
const INK = rgb(0.08, 0.11, 0.16);
const INK2 = rgb(0.26, 0.3, 0.36);
const LINE = rgb(0.87, 0.89, 0.89);
const PRIMARY = rgb(0.114, 0.365, 0.416);
const SOFT = rgb(0.933, 0.945, 0.945);

/** Standard PDF fonts only cover WinAnsi; replace anything else so drawing never throws. */
function safe(text: string): string {
  return text
    .replace(/[→]/g, "->")
    .replace(/[   ]/g, " ")
    .normalize("NFC")
    .replace(/[^\x20-\x7e -ÿ–—‘’“”•…€]/g, "?");
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of safe(text).split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) line = next;
      else {
        if (line) out.push(line);
        // Break very long words.
        let w = word;
        while (font.widthOfTextAtSize(w, size) > width && w.length > 1) {
          let cut = w.length - 1;
          while (cut > 1 && font.widthOfTextAtSize(w.slice(0, cut), size) > width) cut--;
          out.push(w.slice(0, cut));
          w = w.slice(cut);
        }
        line = w;
      }
    }
    out.push(line);
  }
  return out;
}

/** Server-side PDF (pure JS, runs on Vercel functions without a browser). */
export async function reportPdf(r: Report): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${r.title} — ${r.subtitle}`);
  doc.setAuthor(r.generatedBy);
  doc.setCreator("SDAK Church Manager");
  doc.setProducer("SDAK Church Manager");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ital = await doc.embedFont(StandardFonts.HelveticaOblique);

  // Wide tables go landscape.
  const maxCols = Math.max(0, ...r.sections.map((s) => s.table?.columns.length ?? 0));
  const size = maxCols > 5 ? { w: A4.h, h: A4.w } : A4;
  const contentW = size.w - 2 * M;

  let page!: PDFPage;
  let y = 0;
  const newPage = () => {
    page = doc.addPage([size.w, size.h]);
    y = size.h - M;
    page.drawText(safe(`${r.title} · ${r.subtitle}`), { x: M, y: size.h - 24, size: 8, font, color: INK2 });
  };
  const ensure = (h: number) => {
    if (y - h < M + 20) newPage();
  };
  const text = (s: string, o: { f?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; x?: number; width?: number; gap?: number } = {}) => {
    const f = o.f ?? font;
    const sz = o.size ?? 10;
    for (const line of wrap(s, f, sz, o.width ?? contentW)) {
      ensure(sz + 4);
      y -= sz + 3;
      page.drawText(line, { x: o.x ?? M, y, size: sz, font: f, color: o.color ?? INK });
    }
    y -= o.gap ?? 0;
  };

  newPage();
  y -= 6;
  text(CHURCH.toUpperCase(), { f: bold, size: 9, color: PRIMARY, gap: 4 });
  text(r.title, { f: bold, size: 20, gap: 2 });
  text(r.subtitle, { size: 11, color: INK2, gap: 6 });
  text(`${stamp(r)}.`, { size: 8, color: INK2 });
  text(PRIVACY_NOTICE, { f: ital, size: 8, color: INK2, gap: 4 });
  if (r.omitted.length) text(`Columns not shown (no access): ${r.omitted.join(", ")}.`, { f: ital, size: 8, color: INK2 });
  y -= 10;

  for (const s of r.sections) {
    ensure(40);
    text(s.heading, { f: bold, size: 13, gap: 4 });
    if (s.note) text(s.note, { f: ital, size: 8.5, color: INK2, gap: 4 });
    if (s.summary?.length) {
      const colW = Math.min(contentW, 360);
      for (const it of s.summary) {
        ensure(16);
        y -= 15;
        page.drawText(safe(it.label), { x: M, y: y + 4, size: 10, font, color: INK });
        const v = safe(String(it.value));
        page.drawText(v, { x: M + colW - bold.widthOfTextAtSize(v, 10), y: y + 4, size: 10, font: bold, color: INK });
        page.drawLine({ start: { x: M, y: y }, end: { x: M + colW, y: y }, thickness: 0.5, color: LINE });
      }
      y -= 10;
    }
    if (s.table) drawTable(s.table);
    y -= 8;
  }

  function drawTable(t: NonNullable<Report["sections"][number]["table"]>) {
    if (!t.rows.length) {
      text("No members.", { size: 10, color: INK2, gap: 6 });
      return;
    }
    const total = t.columns.reduce((n, c) => n + (c.width ?? 14), 0);
    const widths = t.columns.map((c) => ((c.width ?? 14) / total) * contentW);
    const fs = 8.5;
    const pad = 4;
    const header = () => {
      const lines = t.columns.map((c, i) => wrap(c.label, bold, fs, widths[i]! - 2 * pad));
      const h = Math.max(...lines.map((l) => l.length)) * (fs + 2) + 2 * pad;
      ensure(h + 14);
      page.drawRectangle({ x: M, y: y - h, width: contentW, height: h, color: PRIMARY });
      let x = M;
      lines.forEach((ls, i) => {
        ls.forEach((l, j) => page.drawText(l, { x: x + pad, y: y - pad - fs - j * (fs + 2) + 1, size: fs, font: bold, color: rgb(1, 1, 1) }));
        x += widths[i]!;
      });
      y -= h;
    };
    header();
    t.rows.forEach((row, ri) => {
      const lines = t.columns.map((c, i) => wrap(row[c.key] === null || row[c.key] === undefined ? "" : String(row[c.key]), font, fs, widths[i]! - 2 * pad));
      const h = Math.max(1, ...lines.map((l) => l.length)) * (fs + 2) + 2 * pad;
      if (y - h < M + 20) {
        newPage();
        header();
      }
      if (ri % 2 === 1) page.drawRectangle({ x: M, y: y - h, width: contentW, height: h, color: SOFT });
      let x = M;
      lines.forEach((ls, i) => {
        ls.forEach((l, j) => page.drawText(l, { x: x + pad, y: y - pad - fs - j * (fs + 2) + 1, size: fs, font, color: INK }));
        x += widths[i]!;
      });
      y -= h;
    });
    page.drawLine({ start: { x: M, y }, end: { x: M + contentW, y }, thickness: 0.5, color: LINE });
    y -= 6;
  }

  const pages = doc.getPages();
  pages.forEach((p, i) => {
    const label = `Page ${i + 1} of ${pages.length}`;
    p.drawText(label, { x: size.w - M - font.widthOfTextAtSize(label, 8), y: 20, size: 8, font, color: INK2 });
    p.drawText("Confidential — church administration only", { x: M, y: 20, size: 8, font, color: INK2 });
  });
  return doc.save();
}
