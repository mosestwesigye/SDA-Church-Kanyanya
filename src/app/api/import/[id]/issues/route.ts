import { getContext } from "@/server/auth/session";
import { can } from "@/server/authz/policy";
import { db } from "@/server/db";
import { downloadResponse, logExport, renderTable } from "@/server/exports/tabular";

/** Issues report for a committed import (row number, result, notes). */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx) return new Response("Sign in required", { status: 401 });
  // The notes quote original values (e.g. phone numbers), so this is a logged export.
  if (!can(ctx, "import", "run") || !can(ctx, "export", "run")) return new Response("Forbidden", { status: 403 });
  const { id } = await params;
  const rows = await db.importRow.findMany({ where: { batchId: id }, orderBy: { rowNumber: "asc" }, include: { member: { select: { memberId: true } } } });
  const table = {
    title: "Import issues",
    columns: [
      { key: "row", label: "Row" },
      { key: "action", label: "Result" },
      { key: "memberId", label: "Member ID" },
      { key: "severity", label: "Severity" },
      { key: "field", label: "Field" },
      { key: "message", label: "Message", width: 60 },
    ],
    rows: rows.flatMap((r) =>
      ((r.issues as { severity: string; field: string; message: string }[]) ?? []).map((i) => ({ row: r.rowNumber, action: r.action, memberId: r.member?.memberId ?? "", ...i })),
    ),
  };
  await logExport(db, ctx, { kind: "import-issues", format: "csv", filters: { batchId: id }, fields: table.columns.map((c) => c.key), rowCount: table.rows.length });
  return downloadResponse(await renderTable(table, "csv", { generatedBy: ctx.label }), `import-issues-${id}`, "csv");
}
