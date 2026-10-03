import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { AuditWriter } from "../audit/audit";
import { assertCan, type AuthContext } from "../authz/policy";
import type { Db } from "../db";
import { NotFoundError, ValidationError } from "../errors";
import { actorFrom } from "../members/service";
import { storage } from "../storage";
import { IMPORT_FIELDS, type ColumnMap } from "./columns";
import { commitImport, describeWorkbook, hashFile, prepareImport, previewActions } from "./register-import";

const MAX_BYTES = 10 * 1024 * 1024;

async function readStored(key: string): Promise<Buffer> {
  const f = await storage().get(key);
  if (!f) throw new NotFoundError("The uploaded file is no longer available. Upload it again.");
  if (Buffer.isBuffer(f.data)) return f.data;
  return Buffer.from(await new Response(f.data as ReadableStream).arrayBuffer());
}

async function loadBatch(db: Db, ctx: AuthContext, batchId: string) {
  assertCan(ctx, "import", "run");
  const batch = await db.importBatch.findUnique({ where: { id: batchId } });
  if (!batch || !batch.storageKey) throw new NotFoundError("Import not found.");
  return batch;
}

/** Step 1: upload. The workbook is kept in private storage for the next steps. */
export async function startImport(db: Db, ctx: AuthContext, file: { name: string; data: Buffer }) {
  assertCan(ctx, "import", "run");
  if (file.data.length === 0) throw new ValidationError("The file is empty.");
  if (file.data.length > MAX_BYTES) throw new ValidationError("The file is larger than 10 MB.");
  // .xlsx files are ZIP archives ("PK\x03\x04").
  if (!file.data.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    throw new ValidationError("Upload an Excel workbook (.xlsx). Older .xls files must be saved as .xlsx first.");
  }
  let described;
  try {
    described = await describeWorkbook(file.data);
  } catch {
    throw new ValidationError("This file couldn’t be read as an Excel workbook.");
  }
  const best = [...described.sheets].sort((a, b) => Object.keys(b.detected).length - Object.keys(a.detected).length || b.rowCount - a.rowCount)[0];
  const key = await storage().put("imports", file.name, file.data, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const batch = await db.importBatch.create({
    data: {
      fileName: file.name.slice(0, 200),
      fileHash: hashFile(file.data),
      storageKey: key,
      sheetName: best?.name ?? "",
      headerRow: best?.headerRow ?? 1,
      columnMap: (best?.detected ?? {}) as Prisma.InputJsonValue,
      status: "UPLOADED",
      createdById: ctx.userId,
    },
  });
  await new AuditWriter(db, actorFrom(ctx), "IMPORT").log({ action: "CREATE", entity: "ImportBatch", entityId: batch.id, newValue: { file: batch.fileName } });
  const previous = await db.importBatch.findFirst({ where: { fileHash: batch.fileHash, status: "COMMITTED", id: { not: batch.id } }, orderBy: { committedAt: "desc" } });
  return { batch, previouslyCommitted: previous };
}

/** Step 2 data: sheets, detected headers, current mapping. */
export async function describeBatch(db: Db, ctx: AuthContext, batchId: string) {
  const batch = await loadBatch(db, ctx, batchId);
  const wb = await describeWorkbook(await readStored(batch.storageKey!));
  return { batch, workbook: wb };
}

export const mappingSchema = z.object({
  sheetName: z.string().min(1),
  headerRow: z.number().int().min(1).max(50),
  columnMap: z.partialRecord(z.enum(IMPORT_FIELDS), z.number().int().min(1).max(200)),
});

export async function saveMapping(db: Db, ctx: AuthContext, batchId: string, input: z.input<typeof mappingSchema>) {
  const batch = await loadBatch(db, ctx, batchId);
  if (batch.status === "COMMITTED") throw new ValidationError("This import was already committed.");
  const m = mappingSchema.parse(input);
  const cols = Object.values(m.columnMap);
  if (new Set(cols).size !== cols.length) throw new ValidationError("Each spreadsheet column can be used for only one field.");
  if (m.columnMap.lastName === undefined && m.columnMap.firstName === undefined) throw new ValidationError("Map the Last name or First name column.");
  return db.importBatch.update({ where: { id: batch.id }, data: { sheetName: m.sheetName, headerRow: m.headerRow, columnMap: m.columnMap as Prisma.InputJsonValue, status: "UPLOADED" } });
}

/** Step 3: validate and preview (nothing is written to members). */
export async function validateBatch(db: Db, ctx: AuthContext, batchId: string) {
  const batch = await loadBatch(db, ctx, batchId);
  const prepared = await prepareImport(db, { name: batch.fileName, data: await readStored(batch.storageKey!) }, {
    sheetName: batch.sheetName,
    headerRow: batch.headerRow,
    columnMap: batch.columnMap as ColumnMap,
  });
  const preview = await previewActions(db, prepared);
  const actions = preview.reduce<Record<string, number>>((acc, p) => ((acc[p.action] = (acc[p.action] ?? 0) + 1), acc), {});
  if (batch.status !== "COMMITTED") {
    // Keep the "partly imported" progress marker if a commit already started.
    const prev = (batch.totals ?? {}) as Record<string, unknown>;
    const progress = prev.inProgress ? { inProgress: true, written: prev.written, total: prev.total } : {};
    await db.importBatch.update({ where: { id: batch.id }, data: { status: "VALIDATED", totals: { preview: actions, ...prepared.summary, ...progress } as Prisma.InputJsonValue } });
  }
  return { batch, prepared, preview, actions };
}

/** Step 4: commit. Idempotent across re-runs of the same register. */
export async function commitBatch(db: Db, ctx: AuthContext, batchId: string) {
  const { batch, prepared } = await validateBatch(db, ctx, batchId);
  if (batch.status === "COMMITTED") throw new ValidationError("This import was already committed.");
  const blocking = prepared.rows.filter((r) => r.normalized.issues.some((i) => i.severity === "error") && !r.normalized.skip).length;
  if (blocking) throw new ValidationError(`${blocking} row${blocking === 1 ? " has" : "s have"} errors. Fix them in the spreadsheet and upload it again, or they will be skipped.`);
  return commitImport(db, actorFrom(ctx), prepared, { batchId: batch.id });
}

/** Commit even with row errors (those rows are logged as errors and skipped). */
export async function commitBatchSkippingErrors(db: Db, ctx: AuthContext, batchId: string) {
  const { batch, prepared } = await validateBatch(db, ctx, batchId);
  if (batch.status === "COMMITTED") throw new ValidationError("This import was already committed.");
  return commitImport(db, actorFrom(ctx), prepared, { batchId: batch.id });
}

/**
 * Commit in rounds that fit a serverless time limit. Each call writes rows
 * for about `budgetMs`, then returns progress; call again until `done`.
 * A batch that stopped part-way (e.g. timed out) continues where it left off.
 */
export async function commitStep(db: Db, ctx: AuthContext, batchId: string, opts: { skipErrors: boolean; budgetMs?: number }) {
  const started = Date.now();
  const batch = await loadBatch(db, ctx, batchId);
  if (batch.status === "COMMITTED") {
    const n = await db.importRow.count({ where: { batchId } });
    return { done: true, written: n, total: n };
  }
  const prepared = await prepareImport(db, { name: batch.fileName, data: await readStored(batch.storageKey!) }, {
    sheetName: batch.sheetName,
    headerRow: batch.headerRow,
    columnMap: batch.columnMap as ColumnMap,
  });
  if (!opts.skipErrors) {
    const blocking = prepared.rows.filter((r) => r.normalized.issues.some((i) => i.severity === "error") && !r.normalized.skip).length;
    if (blocking) throw new ValidationError(`${blocking} row${blocking === 1 ? " has" : "s have"} errors. Fix them in the spreadsheet and upload it again, or they will be skipped.`);
  }
  const res = await commitImport(db, actorFrom(ctx), prepared, { batchId: batch.id, deadline: started + (opts.budgetMs ?? 40_000) });
  return { done: res.done, written: res.written, total: res.total };
}

/** Rows already written for a batch that hasn't finished (0 when not started). */
export async function writtenRows(db: Db, batchId: string) {
  return db.importRow.count({ where: { batchId } });
}
