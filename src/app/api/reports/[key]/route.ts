import { getContext } from "@/server/auth/session";
import { can } from "@/server/authz/policy";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { logExport } from "@/server/exports/tabular";
import { reportPdf, reportXlsx } from "@/server/reports/render";
import { buildReport, isReportKey, parseReportParams } from "@/server/reports/reports";

/** Download a report as PDF or Excel. Every download is logged (ExportLog + audit). */
export async function POST(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!isReportKey(key)) return new Response("Unknown report", { status: 404 });
  const ctx = await getContext();
  if (!ctx) return new Response("Sign in required", { status: 401 });
  if (ctx.requires2fa && !ctx.twoFactorEnabled) return new Response("Two-step verification required", { status: 403 });
  if (!can(ctx, "report", "read") || !can(ctx, "export", "run")) return new Response("You don’t have permission to download reports.", { status: 403 });

  const form = await request.formData();
  if (form.get("ack") !== "1") return new Response("The privacy notice must be acknowledged before downloading.", { status: 400 });
  const format = form.get("format") === "pdf" ? "pdf" : "xlsx";
  const p = parseReportParams(key, Object.fromEntries(new URL(request.url).searchParams));

  let report;
  try {
    report = await buildReport(db, ctx, key, p);
  } catch (e) {
    if (e instanceof ForbiddenError) return new Response(e.message, { status: 403 });
    if (e instanceof NotFoundError) return new Response(e.message, { status: 404 });
    throw e;
  }
  await logExport(db, ctx, {
    kind: `report:${key}`,
    format,
    filters: p,
    fields: [...new Set(report.sections.flatMap((s) => s.table?.columns.map((c) => c.key) ?? []))],
    rowCount: report.rowCount,
  });
  const name = `sdak-${key}-${new Date().toISOString().slice(0, 10)}`;
  const body = format === "pdf" ? await reportPdf(report) : new Uint8Array(await reportXlsx(report));
  return new Response(body as BodyInit, {
    headers: {
      "Content-Type": format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}.${format}"`,
      "Cache-Control": "no-store",
    },
  });
}
