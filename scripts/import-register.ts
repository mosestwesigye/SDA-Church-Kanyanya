/**
 * Import the clerk's Excel register.
 *
 *   pnpm import:register data/register.xlsx            # validate + commit
 *   pnpm import:register data/register.xlsx --dry-run  # validate only
 *   --ages-as-of=2025-01-01  date ages like "12yrs" were written (default: the
 *                            workbook's last-saved date)
 *
 * Writes an issues report (CSV) next to the file. Safe to re-run: existing
 * members are matched by Member ID and only empty fields are filled.
 * The register contains personal data — keep it in data/ (git-ignored).
 */
import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { SYSTEM_ACTOR } from "@/server/audit/audit";
import { createDbClient } from "@/server/db";
import { commitImport, prepareImport } from "@/server/import/register-import";
import { ensureReferenceData } from "@/server/setup/reference-data";

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) {
    console.error("Usage: pnpm import:register <file.xlsx> [--dry-run]");
    process.exit(1);
  }
  const dryRun = args.includes("--dry-run");
  const asOfArg = args.find((a) => a.startsWith("--ages-as-of="))?.split("=")[1];
  const agesAsOf = asOfArg ? new Date(`${asOfArg}T00:00:00Z`) : undefined;
  if (agesAsOf && isNaN(agesAsOf.getTime())) throw new Error(`Bad --ages-as-of date: ${asOfArg}`);
  const db = createDbClient();
  try {
    await ensureReferenceData(db);
    const data = await readFile(file);
    const prepared = await prepareImport(db, { name: basename(file), data }, { agesAsOf });
    console.log(`Sheet "${prepared.sheetName}", header row ${prepared.headerRow}`);
    console.log("Columns:", Object.entries(prepared.columnMap).map(([f, c]) => `${f}←${prepared.headers[c!]}`).join(", "));
    console.log(`Ages converted to birth years as of ${prepared.agesAsOf}`);
    console.log("Summary:", prepared.summary);

    const byMessage = new Map<string, number>();
    for (const r of prepared.rows) for (const i of r.normalized.issues) {
      const k = `${i.severity} · ${i.field} · ${i.message.replace(/"[^"]*"/g, '"…"').replace(/row \d+/g, "row N").replace(/year \d{4}/g, "year YYYY")}`;
      byMessage.set(k, (byMessage.get(k) ?? 0) + 1);
    }
    console.log("\nIssue types:");
    for (const [k, v] of [...byMessage].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`);

    const csv = ["row,severity,field,message", ...prepared.rows.flatMap((r) =>
      r.normalized.issues.map((i) => [r.rowNumber, i.severity, i.field, `"${i.message.replace(/"/g, '""')}"`].join(",")),
    )].join("\n");
    const reportPath = file.replace(/\.xlsx?$/i, "") + ".issues.csv";
    await writeFile(reportPath, csv);
    console.log(`\nIssues report: ${reportPath}`);

    if (dryRun) return;
    const started = Date.now();
    const batch = await commitImport(db, { ...SYSTEM_ACTOR, label: "System import" }, prepared);
    console.log(`\nCommitted batch ${batch.id} in ${((Date.now() - started) / 1000).toFixed(1)}s:`, batch.totals);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
