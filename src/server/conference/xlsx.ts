import ExcelJS from "exceljs";
import { LETTERHEAD } from "@/lib/letterhead";
import { quarterWord, type ConferenceReturnView } from "./service";

const dmy = (d: Date | null) => (d ? d.toLocaleDateString("en-GB", { timeZone: "UTC" }) : "__________________");

/**
 * The church's row in the layout of the Central Uganda Conference form
 * (“Secretary's Statistical Report - Quarterly”), columns 1 to 16b, ready to
 * send or paste into the district sheet.
 */
export async function conferenceFormXlsx(r: ConferenceReturnView): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "SDAK Church Manager";
  wb.title = `Secretary's Statistical Report — ${r.label}`;
  const ws = wb.addWorksheet("Statistical report", {
    pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 } },
  });
  const v = (k: string) => r.lines.find((l) => l.key === k)?.value ?? null;

  // Columns B..S as on the Conference form.
  const cols = [
    { code: "1", label: "District", width: 20 },
    { code: "2a", label: "Churches", width: 16 },
    { code: "2b", label: "Companies", width: 12 },
    { code: "3a", label: "Church Attendance 7th Sabbath Count", width: 11 },
    { code: "3b", label: "Church Attendance 2nd Sabbath Count", width: 11 },
    { code: "3c", label: "Church Membership At Beginning Of Quarter", width: 12 },
    { code: "4a", label: "Baptism", width: 9 },
    { code: "4b", label: "Profession Of Faith", width: 10 },
    { code: "4c", label: "Letters Received", width: 9 },
    { code: "4d", label: "Adjust-ments", width: 9 },
    { code: "5a", label: "Letters Granted", width: 9 },
    { code: "5b", label: "Death", width: 8 },
    { code: "5c", label: "Apostasies", width: 10 },
    { code: "5d", label: "Missing", width: 9 },
    { code: "5e", label: "Adjust-ments", width: 9 },
    { code: "6", label: "Church Membership At End Of Quarter", width: 12 },
    { code: "16a", label: "Church Attendance 2nd Sabbath Count", width: 11 },
    { code: "16b", label: "Church Attendance 7th Sabbath Count", width: 11 },
  ];
  ws.getColumn(1).width = 2;
  cols.forEach((c, i) => (ws.getColumn(i + 2).width = c.width));
  const first = 2;
  const lastCol = first + cols.length - 1;

  const title = (row: number, text: string, size: number, bold = true) => {
    ws.mergeCells(row, first, row, lastCol);
    const cell = ws.getCell(row, first);
    cell.value = text;
    cell.font = { bold, size };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  };
  title(2, "CENTRAL UGANDA CONFERENCE", 14);
  title(3, "Secretary's Statistical Report - Quarterly", 12);
  ws.mergeCells(5, first, 5, lastCol);
  ws.getCell(5, first).value = `District Reporting :  ${LETTERHEAD.district.toUpperCase()}          Submitted by Pastor:  ${(r.pastorName ?? "________________").toUpperCase()}          Quarter  ${quarterWord(r.period.quarter)}  ${r.period.year}`;
  ws.getCell(5, first).font = { bold: true, size: 11 };
  ws.mergeCells(7, first, 7, lastCol);
  ws.getCell(7, first).value = `Date Sent: ${dmy(r.dateSent)}                    Date Received ${dmy(r.dateReceived)}`;
  ws.getCell(7, first).font = { size: 11 };

  const thin = { style: "thin" as const, color: { argb: "FF000000" } };
  const box = { top: thin, left: thin, bottom: thin, right: thin };

  // Row 9: line numbers. Row 10: group headings. Row 11: column headings.
  cols.forEach((c, i) => {
    const code = ws.getCell(9, first + i);
    code.value = c.code;
    code.font = { bold: true };
    code.alignment = { horizontal: "center" };
    code.border = box;
    const head = ws.getCell(11, first + i);
    head.value = c.label;
    head.font = { bold: true, size: 9 };
    head.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    head.border = box;
    ws.getCell(10, first + i).border = box;
  });
  const group = (from: number, to: number, text: string) => {
    ws.mergeCells(10, first + from, 10, first + to);
    const c = ws.getCell(10, first + from);
    c.value = text;
    c.font = { bold: true, size: 9 };
    c.alignment = { horizontal: "center", vertical: "middle" };
    c.border = box;
  };
  group(6, 9, "Members Added During Quarter");
  group(10, 14, "Members Dropped During Quarter");
  ws.getRow(11).height = 48;

  const data = [
    LETTERHEAD.district.toUpperCase(),
    "KANYANYA",
    "",
    v("att7"),
    v("att2"),
    v("opening"),
    v("baptism"),
    v("profession"),
    v("lettersIn"),
    v("adjustIn"),
    v("lettersOut"),
    v("death"),
    v("apostasy"),
    v("missing"),
    v("adjustOut"),
    r.closing,
    null, // 16a — left blank
    null, // 16b — left blank
  ];
  data.forEach((value, i) => {
    const c = ws.getCell(12, first + i);
    c.value = value === null ? null : value;
    c.border = box;
    c.alignment = { horizontal: i < 3 ? "left" : "center" };
    if (i < 2) c.font = { bold: true };
  });
  ws.getRow(12).height = 20;

  const overrides = r.lines.filter((l) => l.override);
  let row = 14;
  if (overrides.length) {
    ws.getCell(row++, first).value = "Notes (figures entered by the church clerk):";
    ws.getCell(row - 1, first).font = { bold: true, size: 9 };
    for (const l of overrides) {
      ws.mergeCells(row, first, row, lastCol);
      ws.getCell(row, first).value = `${l.code} ${l.label}: ${l.override!.value} — ${l.override!.reason}`;
      ws.getCell(row, first).font = { size: 9 };
      row++;
    }
  }
  ws.headerFooter = { oddFooter: `&L&8${LETTERHEAD.short} · ${r.label}&R&8Prepared with SDAK Church Manager` };
  return Buffer.from(await wb.xlsx.writeBuffer());
}
