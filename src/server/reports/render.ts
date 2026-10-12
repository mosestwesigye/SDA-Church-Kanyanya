import ExcelJS from "exceljs";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { PRIVACY_NOTICE } from "../exports/tabular";
import { CONFIDENTIAL, LETTERHEAD } from "@/lib/letterhead";
import { SDA_MARK_PNG_BASE64 } from "./logo";
import { documentSections, type Report } from "./reports";


// ───────── Excel ─────────

/** One sheet per section: summaries as two columns, tables as filtered grids. */
export async function reportXlsx(r: Report): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "SDAK Church Manager";
  wb.title = `${r.title} — ${r.subtitle}`;
  wb.subject = r.reference;
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
  const generated = r.generatedAt.toLocaleString("en-GB", { timeZone: "Africa/Kampala", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  /** Letterhead and document details at the top of every sheet; A4 print setup with a confidential footer. */
  const head = (ws: ExcelJS.Worksheet, heading: string, cols: number, note?: string) => {
    const span = Math.max(cols, 4);
    const line = (value: string, font: Partial<ExcelJS.Font>, height?: number) => {
      const row = ws.addRow([value]);
      row.font = font;
      if (height) row.height = height;
      ws.mergeCells(row.number, 1, row.number, span);
      row.getCell(1).alignment = { vertical: "middle", wrapText: true };
      return row;
    };
    const band = line(LETTERHEAD.church.toUpperCase(), { bold: true, size: 9, color: { argb: "FFFFFFFF" } }, 18);
    band.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D5D6A" } };
    line(LETTERHEAD.local, { bold: true, size: 14, color: { argb: "FF14202A" } }, 22);
    line(`${LETTERHEAD.conference} · ${LETTERHEAD.office}`, { size: 9, color: { argb: "FF424D5C" } });
    ws.addRow([]);
    line(r.title, { bold: true, size: 16 }, 24);
    line(`${r.subtitle} · ${heading}`, { size: 11, color: { argb: "FF424D5C" } });
    line(`Reference ${r.reference}  ·  Prepared by ${r.generatedBy}${r.generatedRole ? ` (${r.generatedRole})` : ""}  ·  Generated ${generated} EAT  ·  ${r.rowCount} records  ·  Confidential`, { size: 9, color: { argb: "FF424D5C" } }, 30);
    line(PRIVACY_NOTICE, { italic: true, size: 8, color: { argb: "FF737D87" } }, 30);
    if (note) line(note, { italic: true, size: 9 });
    ws.addRow([]);
    ws.pageSetup = { paperSize: 9, orientation: cols > 5 ? "landscape" : "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 } };
    ws.headerFooter = { oddFooter: `&L&8${LETTERHEAD.short} · ${CONFIDENTIAL}&C&8${r.reference}&R&8Page &P of &N` };
  };
  const headerStyle = (row: ExcelJS.Row) => {
    row.font = { bold: true, color: { argb: "FFFFFFFF" } };
    row.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D5D6A" } }));
  };

  const summaries = r.sections.filter((s) => s.summary?.length);
  if (summaries.length) {
    const ws = wb.addWorksheet(sheetName("Summary"));
    head(ws, "Summary", 2);
    for (const s of summaries) {
      ws.addRow([s.heading]).font = { bold: true, size: 12, color: { argb: "FF1D5D6A" } };
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
    head(ws, s.heading, t.columns.length, s.note);
    const hr = ws.addRow(t.columns.map((c) => c.label));
    headerStyle(hr);
    ws.views = [{ state: "frozen", ySplit: hr.number }];
    for (const row of t.rows) ws.addRow(t.columns.map((c) => xlCell(row[c.key])));
    t.columns.forEach((c, i) => (ws.getColumn(i + 1).width = c.width ?? Math.max(10, c.label.length + 4)));
    if (t.rows.length) ws.autoFilter = { from: { row: hr.number, column: 1 }, to: { row: hr.number, column: t.columns.length } };
  }
  if (!wb.worksheets.length) head(wb.addWorksheet("Report"), "No data", 4);
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
const INK3 = rgb(0.45, 0.49, 0.53);
const LINE = rgb(0.87, 0.89, 0.89);
const PRIMARY = rgb(0.114, 0.365, 0.416);
const SOFT = rgb(0.953, 0.961, 0.961);
const PRIMARY_SOFT = rgb(0.886, 0.933, 0.937);
const SIDEBAR = rgb(0.09, 0.294, 0.333);

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
  doc.setSubject(`${LETTERHEAD.short} · ${r.reference}`);
  doc.setAuthor(r.generatedBy);
  doc.setCreator("SDAK Church Manager");
  doc.setProducer("SDAK Church Manager");
  doc.setCreationDate(r.generatedAt);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ital = await doc.embedFont(StandardFonts.HelveticaOblique);
  const mono = await doc.embedFont(StandardFonts.Courier);
  const mark = await doc.embedPng(Buffer.from(SDA_MARK_PNG_BASE64, "base64"));

  // Wide tables go landscape.
  const maxCols = Math.max(0, ...r.sections.map((s) => s.table?.columns.length ?? 0));
  const size = maxCols > 5 ? { w: A4.h, h: A4.w } : A4;
  const contentW = size.w - 2 * M;
  const BOTTOM = M + 22; // room for the footer
  const generated = r.generatedAt.toLocaleString("en-GB", { timeZone: "Africa/Kampala", day: "numeric", month: "long", year: "numeric" });
  const time = r.generatedAt.toLocaleString("en-GB", { timeZone: "Africa/Kampala", hour: "2-digit", minute: "2-digit", hour12: false });

  let page!: PDFPage;
  let y = 0;
  const right = (s: string, f: PDFFont, sz: number, x: number, yy: number, color = INK) => page.drawText(safe(s), { x: x - f.widthOfTextAtSize(safe(s), sz), y: yy, size: sz, font: f, color });
  const logo = (x: number, top: number, box: number) => {
    page.drawRectangle({ x, y: top - box, width: box, height: box, color: SIDEBAR });
    const h = box * 0.62;
    const w = (h * mark.width) / mark.height;
    page.drawImage(mark, { x: x + (box - w) / 2, y: top - box + (box - h) / 2, width: w, height: h });
  };

  /** Full letterhead on the first page. */
  const letterhead = () => {
    page.drawRectangle({ x: 0, y: size.h - 6, width: size.w, height: 6, color: PRIMARY });
    const top = size.h - M + 4;
    logo(M, top, 44);
    const tx = M + 56;
    page.drawText(safe(LETTERHEAD.church.toUpperCase()), { x: tx, y: top - 11, size: 8, font: bold, color: PRIMARY });
    page.drawText(safe(LETTERHEAD.local), { x: tx, y: top - 27, size: 15, font: bold, color: INK });
    page.drawText(safe(`${LETTERHEAD.conference} · ${LETTERHEAD.office}`), { x: tx, y: top - 40, size: 8.5, font, color: INK2 });
    const rx = M + contentW;
    right("REFERENCE", bold, 6.5, rx, top - 9, INK3);
    right(r.reference, mono, 9, rx, top - 20, PRIMARY);
    right("DATE", bold, 6.5, rx, top - 32, INK3);
    right(generated, font, 9, rx, top - 43);
    y = top - 56;
    page.drawLine({ start: { x: M, y }, end: { x: M + contentW, y }, thickness: 1.4, color: INK });
    page.drawLine({ start: { x: M, y: y - 3 }, end: { x: M + contentW, y: y - 3 }, thickness: 0.5, color: INK2 });
    y -= 22;
  };
  /** Compact running header on later pages. */
  const runningHeader = () => {
    page.drawRectangle({ x: 0, y: size.h - 4, width: size.w, height: 4, color: PRIMARY });
    const top = size.h - 22;
    logo(M, top + 4, 18);
    page.drawText(safe(`${LETTERHEAD.short} · ${r.title}`), { x: M + 25, y: top - 9, size: 8.5, font: bold, color: INK });
    right(r.reference, mono, 8, M + contentW, top - 9, INK2);
    page.drawLine({ start: { x: M, y: top - 16 }, end: { x: M + contentW, y: top - 16 }, thickness: 0.5, color: LINE });
    y = top - 30;
  };
  const newPage = (first = false) => {
    page = doc.addPage([size.w, size.h]);
    if (first) letterhead();
    else runningHeader();
  };
  const ensure = (h: number) => {
    if (y - h < BOTTOM) newPage();
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

  newPage(true);
  // Title block.
  text(`${r.category} report`.toUpperCase(), { f: bold, size: 7.5, color: INK3, gap: 3 });
  text(r.title, { f: bold, size: 21, gap: 3 });
  text(r.subtitle, { size: 11, color: INK2, gap: 12 });

  // Document details strip.
  {
    const cells: [string, string, string?][] = [
      ["PREPARED BY", r.generatedBy, r.generatedRole ?? undefined],
      ["GENERATED", generated, `${time} EAT`],
      ["RECORDS", r.rowCount.toLocaleString("en-UG")],
      ["CLASSIFICATION", "Confidential", "Church administration only"],
    ];
    const h = 40;
    const cw = contentW / cells.length;
    page.drawRectangle({ x: M, y: y - h, width: contentW, height: h, color: SOFT, borderColor: LINE, borderWidth: 0.6 });
    cells.forEach(([label, value, sub], i) => {
      const x = M + i * cw + 10;
      if (i) page.drawLine({ start: { x: M + i * cw, y: y - h }, end: { x: M + i * cw, y }, thickness: 0.6, color: LINE });
      page.drawText(label, { x, y: y - 12, size: 6.5, font: bold, color: INK3 });
      page.drawText(wrap(value, bold, 9.5, cw - 20)[0] ?? "", { x, y: y - 24, size: 9.5, font: bold, color: INK });
      if (sub) page.drawText(wrap(sub, font, 7.5, cw - 20)[0] ?? "", { x, y: y - 34, size: 7.5, font, color: INK2 });
    });
    y -= h + 8;
  }
  text(PRIVACY_NOTICE, { f: ital, size: 7.5, color: INK2 });
  if (r.omitted.length) text(`Columns not shown (no access): ${r.omitted.join(", ")}.`, { f: ital, size: 7.5, color: INK2 });
  y -= 14;

  // Sections, numbered.
  /** `follow` is the space the first part of the section needs, so a heading never sits alone at a page foot. */
  const heading = (n: number, title: string, aside?: string, follow = 40) => {
    ensure(25 + follow);
    y -= 13;
    const num = String(n).padStart(2, "0");
    page.drawText(num, { x: M, y, size: 10, font: bold, color: PRIMARY });
    page.drawText(safe(title), { x: M + 20, y, size: 12.5, font: bold, color: INK });
    if (aside) right(aside, font, 8, M + contentW, y + 1, INK2);
    y -= 6;
    page.drawLine({ start: { x: M, y }, end: { x: M + contentW, y }, thickness: 0.6, color: LINE });
    y -= 6;
  };

  const { tiles: keyFigures, ordered } = documentSections(r);
  ordered.forEach((s, si) => {
    const n = si + 1;
    const noteH = s.note ? wrap(s.note, ital, 8, contentW).length * 11 + 6 : 0;
    const first = s === keyFigures ? 56 : s.summary ? Math.min(s.summary.length, 4) * 16 : 70;
    if (s.table) heading(n, s.heading, `${s.table.rows.length.toLocaleString("en-UG")} row${s.table.rows.length === 1 ? "" : "s"}`, noteH + first);
    else heading(n, s.heading, undefined, noteH + first);
    if (s.note) text(s.note, { f: ital, size: 8, color: INK2, gap: 6 });
    if (s.summary?.length) {
      if (s === keyFigures) tiles(s.summary);
      else list(s.summary);
    }
    if (s.table) drawTable(s.table);
    y -= 14;
  });

  /** Key figures as a row of boxes. */
  function tiles(items: NonNullable<Report["sections"][number]["summary"]>) {
    const h = 50;
    ensure(h + 6);
    const w = contentW / items.length;
    items.forEach((it, i) => {
      const key = /^total|at end of/i.test(it.label);
      const x = M + i * w;
      page.drawRectangle({ x, y: y - h, width: w, height: h, color: key ? PRIMARY_SOFT : rgb(1, 1, 1), borderColor: LINE, borderWidth: 0.6 });
      wrap(it.label, font, 7.5, w - 16).slice(0, 2).forEach((l, j) => page.drawText(l, { x: x + 8, y: y - 12 - j * 9, size: 7.5, font, color: INK2 }));
      page.drawText(safe(String(typeof it.value === "number" ? it.value.toLocaleString("en-UG") : it.value)), { x: x + 8, y: y - h + 9, size: 17, font: bold, color: key ? PRIMARY : INK });
    });
    y -= h + 4;
  }

  /** Label/value rows with light banding. */
  function list(items: NonNullable<Report["sections"][number]["summary"]>) {
    const colW = Math.min(contentW, 380);
    items.forEach((it, i) => {
      ensure(17);
      y -= 16;
      if (i % 2 === 0) page.drawRectangle({ x: M, y: y - 4, width: colW, height: 16, color: SOFT });
      page.drawText(wrap(it.label, font, 9.5, colW - 90)[0] ?? "", { x: M + 6, y: y + 1, size: 9.5, font, color: INK });
      right(typeof it.value === "number" ? it.value.toLocaleString("en-UG") : String(it.value), bold, 9.5, M + colW - 6, y + 1);
    });
    y -= 6;
  }

  function drawTable(t: NonNullable<Report["sections"][number]["table"]>) {
    if (!t.rows.length) {
      text("Nothing to list.", { size: 9.5, color: INK2, gap: 6 });
      return;
    }
    const NO_W = 24;
    const total = t.columns.reduce((n, c) => n + (c.width ?? 14), 0);
    const widths = t.columns.map((c) => ((c.width ?? 14) / total) * (contentW - NO_W));
    const fs = 8.5;
    const pad = 4;
    const header = () => {
      const lines = t.columns.map((c, i) => wrap(c.label.toUpperCase(), bold, 7, widths[i]! - 2 * pad));
      const h = Math.max(...lines.map((l) => l.length)) * 9 + 2 * pad + 2;
      ensure(h + 14);
      page.drawRectangle({ x: M, y: y - h, width: contentW, height: h, color: PRIMARY });
      right("NO.", bold, 7, M + NO_W - pad, y - pad - 8, rgb(1, 1, 1));
      let x = M + NO_W;
      lines.forEach((ls, i) => {
        ls.forEach((l, j) => page.drawText(l, { x: x + pad, y: y - pad - 8 - j * 9, size: 7, font: bold, color: rgb(1, 1, 1) }));
        x += widths[i]!;
      });
      y -= h;
    };
    header();
    t.rows.forEach((row, ri) => {
      const lines = t.columns.map((c, i) => wrap(row[c.key] === null || row[c.key] === undefined ? "" : String(row[c.key]), font, fs, widths[i]! - 2 * pad));
      const h = Math.max(1, ...lines.map((l) => l.length)) * (fs + 2) + 2 * pad;
      if (y - h < BOTTOM) {
        page.drawLine({ start: { x: M, y }, end: { x: M + contentW, y }, thickness: 0.5, color: LINE });
        newPage();
        header();
      }
      if (ri % 2 === 1) page.drawRectangle({ x: M, y: y - h, width: contentW, height: h, color: SOFT });
      right(String(ri + 1), font, 7.5, M + NO_W - pad, y - pad - fs + 1, INK3);
      let x = M + NO_W;
      lines.forEach((ls, i) => {
        const f = t.columns[i]!.key === "memberId" || t.columns[i]!.key === "reference" ? mono : font;
        ls.forEach((l, j) => page.drawText(l, { x: x + pad, y: y - pad - fs - j * (fs + 2) + 1, size: fs, font: f, color: INK }));
        x += widths[i]!;
      });
      y -= h;
    });
    page.drawLine({ start: { x: M, y }, end: { x: M + contentW, y }, thickness: 0.8, color: PRIMARY });
    y -= 6;
  }

  // Certification block for official returns.
  if (r.signOff && r.sections.length) {
    const h = 92;
    ensure(h + 10);
    y -= 6;
    page.drawRectangle({ x: M, y: y - h, width: contentW, height: h, borderColor: LINE, borderWidth: 0.8 });
    page.drawText("Certification", { x: M + 12, y: y - 16, size: 10, font: bold, color: INK });
    page.drawText("I certify that this report is a true record of the church register on the date shown.", { x: M + 12, y: y - 28, size: 8, font, color: INK2 });
    const colW = (contentW - 36) / 2;
    const slot = (x: number, label: string, name: string) => {
      page.drawText(safe(label.toUpperCase()), { x, y: y - 46, size: 6.5, font: bold, color: INK3 });
      page.drawLine({ start: { x, y: y - 72 }, end: { x: x + colW, y: y - 72 }, thickness: 0.6, color: INK2 });
      page.drawText(safe(name), { x, y: y - 82, size: 8, font, color: INK2 });
      right("Signature & date", font, 8, x + colW, y - 82, INK2);
    };
    slot(M + 12, `Prepared by${r.generatedRole ? ` · ${r.generatedRole}` : ""}`, r.generatedBy);
    slot(M + 24 + colW, "Verified by · Pastor / Board chair", "Name");
    y -= h;
  }
  ensure(16);
  y -= 12;
  right(`${r.reference} · End of report`, font, 7.5, M + contentW, y, INK3);

  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: M - 4 }, end: { x: size.w - M, y: M - 4 }, thickness: 0.5, color: LINE });
    p.drawText(safe(`${LETTERHEAD.short} · ${CONFIDENTIAL}`), { x: M, y: M - 16, size: 7.5, font, color: INK2 });
    const label = `Page ${i + 1} of ${pages.length}`;
    const lw = font.widthOfTextAtSize(label, 7.5);
    p.drawText(label, { x: size.w - M - lw, y: M - 16, size: 7.5, font: bold, color: INK2 });
    const ref = safe(r.reference);
    p.drawText(ref, { x: size.w - M - lw - 14 - mono.widthOfTextAtSize(ref, 7.5), y: M - 16, size: 7.5, font: mono, color: INK3 });
  });
  return doc.save();
}
