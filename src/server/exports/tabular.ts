import ExcelJS from "exceljs";
import { AuditWriter } from "../audit/audit";
import { assertCan, type AuthContext } from "../authz/policy";
import type { Db } from "../db";
import { actorFrom } from "../members/service";

export type Table = { title: string; columns: { key: string; label: string; width?: number }[]; rows: Record<string, unknown>[] };
export type ExportFormat = "xlsx" | "csv";

const NOTICE =
  "Contains personal data protected by Uganda's Data Protection and Privacy Act, 2019. For church administration only; store securely and delete when no longer needed.";

function cell(v: unknown): string | number {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return typeof v === "number" ? v : String(v);
}

/** Spreadsheet-safe CSV (guards against formula injection). */
function csvCell(v: unknown): string {
  let s = String(cell(v));
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function renderTable(t: Table, format: ExportFormat, meta: { generatedBy: string }): Promise<Buffer> {
  if (format === "csv") {
    const lines = [t.columns.map((c) => csvCell(c.label)).join(","), ...t.rows.map((r) => t.columns.map((c) => csvCell(r[c.key])).join(","))];
    return Buffer.from("﻿" + lines.join("\r\n"), "utf8");
  }
  const wb = new ExcelJS.Workbook();
  wb.creator = "SDAK Church Manager";
  wb.created = new Date();
  const ws = wb.addWorksheet(t.title.slice(0, 31), { views: [{ state: "frozen", ySplit: 4 }] });
  ws.addRow([`SDA Church Kanyanya — ${t.title}`]).font = { bold: true, size: 14 };
  ws.addRow([`Generated ${new Date().toLocaleString("en-GB", { timeZone: "Africa/Kampala" })} by ${meta.generatedBy}. ${NOTICE}`]).font = { italic: true, size: 9 };
  ws.addRow([]);
  const header = ws.addRow(t.columns.map((c) => c.label));
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D5D6A" } }));
  for (const r of t.rows) ws.addRow(t.columns.map((c) => cell(r[c.key])));
  t.columns.forEach((c, i) => (ws.getColumn(i + 1).width = c.width ?? Math.min(40, Math.max(10, c.label.length + 4))));
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: t.columns.length } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Log an export in ExportLog and the audit trail (Data Protection: exports are logged). */
export async function logExport(db: Db, ctx: AuthContext, e: { kind: string; format: string; filters: unknown; fields: string[]; rowCount: number }) {
  assertCan(ctx, "export", "run");
  await db.$transaction(async (tx) => {
    const log = await tx.exportLog.create({
      data: { userId: ctx.userId, kind: e.kind, format: e.format, filters: (e.filters ?? {}) as object, fields: e.fields, rowCount: e.rowCount, noticeShown: true },
    });
    await new AuditWriter(tx, actorFrom(ctx), "UI").log({
      action: "EXPORT",
      entity: "ExportLog",
      entityId: log.id,
      newValue: { kind: e.kind, format: e.format, rows: e.rowCount, fields: e.fields },
    });
  });
}

export function downloadResponse(buf: Buffer, name: string, format: ExportFormat): Response {
  const type = format === "csv" ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="${name}.${format}"`,
      "Cache-Control": "no-store",
    },
  });
}
