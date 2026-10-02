import ExcelJS from "exceljs";

export type Cell = string | number | boolean | Date | null;
export type SheetRows = { name: string; rows: { rowNumber: number; cells: Cell[] }[] };

/** Flatten ExcelJS cell values (rich text, hyperlinks, formulas) to primitives. */
export function cellValue(v: ExcelJS.CellValue): Cell {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === "string") return v.trim() === "" ? null : v;
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "object") {
    if ("richText" in v && Array.isArray(v.richText)) return cellValue(v.richText.map((r) => r.text).join(""));
    if ("text" in v && typeof v.text === "string") return cellValue(v.text);
    if ("formula" in v || "sharedFormula" in v || "result" in v) {
      const result = (v as { result?: ExcelJS.CellValue }).result;
      return result === undefined ? null : cellValue(result);
    }
    if ("error" in v) return null;
    return null;
  }
  return String(v);
}

/** Read every worksheet into plain rows (1-based row numbers, 1-based cells at index 1). */
export async function readWorkbook(buffer: ArrayBuffer | Buffer): Promise<{ sheets: SheetRows[]; modified: Date | null }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as ArrayBuffer);
  const modified = wb.modified instanceof Date && !isNaN(wb.modified.getTime()) ? wb.modified : null;
  const sheets = wb.worksheets.map((ws) => {
    const rows: SheetRows["rows"] = [];
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const cells: Cell[] = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        cells[col] = cellValue(cell.value);
      });
      rows.push({ rowNumber, cells });
    });
    return { name: ws.name, rows };
  });
  return { sheets, modified };
}
