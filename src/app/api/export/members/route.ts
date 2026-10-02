import { getContext } from "@/server/auth/session";
import { can } from "@/server/authz/policy";
import { db } from "@/server/db";
import { buildMemberExport } from "@/server/exports/members";
import { downloadResponse, logExport, renderTable } from "@/server/exports/tabular";
import { parseDirectoryQuery } from "@/server/members/directory";

export async function POST(request: Request) {
  const ctx = await getContext();
  if (!ctx) return new Response("Sign in required", { status: 401 });
  if (ctx.requires2fa && !ctx.twoFactorEnabled) return new Response("Two-step verification required", { status: 403 });
  if (!can(ctx, "export", "run")) return new Response("You don’t have permission to export.", { status: 403 });

  const form = await request.formData();
  if (form.get("ack") !== "1") return new Response("The privacy notice must be acknowledged before exporting.", { status: 400 });
  const format = form.get("format") === "csv" ? "csv" : "xlsx";
  const ids = form.getAll("ids").map(String).filter(Boolean);
  const columns = String(form.get("columns") ?? "").split(",").filter(Boolean);
  const query = parseDirectoryQuery(Object.fromEntries(new URL(request.url).searchParams));

  const table = await buildMemberExport(db, ctx, query, { ids: ids.length ? ids : undefined, columns });
  await logExport(db, ctx, {
    kind: "members",
    format,
    filters: { query, ids: ids.length || undefined },
    fields: table.columns.map((c) => c.key),
    rowCount: table.rows.length,
  });
  const buf = await renderTable(table, format, { generatedBy: ctx.label });
  return downloadResponse(buf, `sdak-members-${new Date().toISOString().slice(0, 10)}`, format);
}
