import { createHash } from "node:crypto";
import type { Prisma, RawValueField } from "@/generated/prisma/client";
import { normalizeValue } from "@/lib/normalize";
import { AuditWriter, type Actor } from "../audit/audit";
import type { Db, Tx } from "../db";
import { refreshCompleteness } from "../members/service";
import { getCompletenessRules } from "../settings/rules";
import { computeCompleteness, type CompletenessRules } from "@/lib/completeness";
import { detectColumns, extractRecords, type ColumnMap, type RawRecord } from "./columns";
import { normalizeRow, type Issue, type Lookups, type NormalizedRow } from "./normalize-row";
import { readWorkbook, type SheetRows } from "./read-xlsx";
import { ValidationError } from "../errors";

export async function loadLookups(db: Db | Tx): Promise<Lookups> {
  const items = await db.listItem.findMany({ where: { active: true, mergedIntoId: null }, select: { id: true, type: true, label: true }, orderBy: { sortOrder: "asc" } });
  const lists: Lookups["lists"] = { ZONE: [], MINISTRY: [], MINISTRY_ROLE: [], PROFESSION: [] };
  for (const i of items) lists[i.type].push({ id: i.id, label: i.label });
  const maps = await db.valueMapping.findMany();
  const mappings = new Map<string, string | null>(maps.map((m) => [`${m.field}:${m.normalized}`, m.meansBlank ? null : m.listItemId]));
  return { lists, mappings };
}

export type PreparedRow = { rowNumber: number; raw: RawRecord; normalized: NormalizedRow };

export type PreparedImport = {
  fileName: string;
  fileHash: string;
  sheetName: string;
  headerRow: number;
  columnMap: ColumnMap;
  headers: Record<number, string>;
  rows: PreparedRow[];
  agesAsOf: string;
  summary: { rows: number; errors: number; warnings: number; withIssues: number; skipped: number };
};

export function hashFile(buf: ArrayBuffer | Buffer): string {
  return createHash("sha256").update(Buffer.from(buf as ArrayBuffer)).digest("hex");
}

/** Pick the sheet with the most recognisable header row. */
function pickSheet(sheets: SheetRows[], preferred?: string) {
  const candidates = sheets
    .filter((s) => !preferred || s.name === preferred)
    .map((s) => ({ sheet: s, det: detectColumns(s) }))
    .filter((c) => c.det)
    .sort((a, b) => Object.keys(b.det!.map).length - Object.keys(a.det!.map).length || b.sheet.rows.length - a.sheet.rows.length);
  return candidates[0] ?? null;
}

/** Cross-row checks: repeated IDs (error) and likely duplicates (warning). */
function crossRowChecks(rows: PreparedRow[]) {
  const byNo = new Map<number, number>();
  const byPhone = new Map<string, number>();
  const byName = new Map<string, number>();
  for (const r of rows) {
    const n = r.normalized;
    if (n.skip) continue;
    if (n.memberNo !== null) {
      const first = byNo.get(n.memberNo);
      if (first) n.issues.push({ field: "memberId", severity: "error", message: `Member ID repeats row ${first}` });
      else byNo.set(n.memberNo, r.rowNumber);
    }
    const phone = n.columns.phoneE164;
    if (phone) {
      const first = byPhone.get(phone);
      if (first) n.issues.push({ field: "phone", severity: "warning", message: `Same phone as row ${first} — possible duplicate` });
      else byPhone.set(phone, r.rowNumber);
    }
    const name = normalizeValue(`${n.columns.lastName} ${n.columns.firstName}`);
    if (name.length > 3) {
      const first = byName.get(name);
      if (first) n.issues.push({ field: "name", severity: "warning", message: `Same name as row ${first} — possible duplicate` });
      else byName.set(name, r.rowNumber);
    }
  }
}

/** Parse + validate a register file. Pure with respect to the database apart from reading lookups. */
export async function prepareImport(
  db: Db,
  file: { name: string; data: ArrayBuffer | Buffer },
  opts: { sheetName?: string; headerRow?: number; columnMap?: ColumnMap; now?: Date; agesAsOf?: Date } = {},
): Promise<PreparedImport> {
  const { sheets, modified } = await readWorkbook(file.data);
  const now = opts.now ?? new Date();
  // Ages ("12yrs") are counted back from when the register was last saved.
  const agesAsOf = opts.agesAsOf ?? (modified && modified < now ? modified : now);
  const sheet = opts.sheetName ? sheets.find((s) => s.name === opts.sheetName) : pickSheet(sheets)?.sheet;
  if (!sheet) throw new ValidationError(opts.sheetName ? `Sheet “${opts.sheetName}” not found.` : "Could not find a header row with Member ID / Last Name / First Name columns.");
  const det = detectColumns(sheet);
  const headerRow = opts.headerRow ?? det?.headerRow;
  if (!headerRow) throw new ValidationError("Could not find the header row. Choose it on the mapping step.");
  const columnMap = opts.columnMap ?? det?.map ?? {};
  if (columnMap.lastName === undefined && columnMap.firstName === undefined) throw new ValidationError("Map at least the Last name or First name column.");
  const lookups = await loadLookups(db);
  const rows = extractRecords(sheet, headerRow, columnMap).map(({ rowNumber, raw }) => ({
    rowNumber,
    raw,
    normalized: normalizeRow(raw, lookups, now, agesAsOf),
  }));
  crossRowChecks(rows);
  const count = (s: Issue["severity"]) => rows.filter((r) => r.normalized.issues.some((i) => i.severity === s)).length;
  return {
    fileName: file.name,
    fileHash: hashFile(file.data),
    sheetName: sheet.name,
    headerRow,
    columnMap,
    headers: headersOf(sheet, headerRow),
    rows,
    agesAsOf: agesAsOf.toISOString().slice(0, 10),
    summary: {
      rows: rows.length,
      errors: count("error"),
      warnings: count("warning"),
      withIssues: rows.filter((r) => r.normalized.issues.length > 0).length,
      skipped: rows.filter((r) => r.normalized.skip).length,
    },
  };
}

function headersOf(sheet: SheetRows, headerRow: number): Record<number, string> {
  const row = sheet.rows.find((r) => r.rowNumber === headerRow);
  const out: Record<number, string> = {};
  row?.cells.forEach((c, i) => {
    if (c !== null && c !== undefined && String(c).trim()) out[i] = String(c).trim();
  });
  return out;
}

/** Sheets in a workbook with their detected header row and column mapping (wizard step 2). */
export async function describeWorkbook(data: ArrayBuffer | Buffer) {
  const { sheets, modified } = await readWorkbook(data);
  return {
    modified,
    sheets: sheets.map((s) => {
      const det = detectColumns(s);
      return {
        name: s.name,
        rowCount: s.rows.length,
        headerRow: det?.headerRow ?? null,
        detected: det?.map ?? {},
        headers: det ? det.headers : {},
        /** First rows, for choosing a header row by hand. */
        preview: s.rows.slice(0, 8).map((r) => ({ rowNumber: r.rowNumber, cells: r.cells.slice(0, 20).map((c) => (c instanceof Date ? c.toISOString().slice(0, 10) : c === null || c === undefined ? "" : String(c).slice(0, 40))) })),
      };
    }),
  };
}

export type RowPreview = { rowNumber: number; action: "CREATE" | "UPDATE" | "UNCHANGED" | "SKIP" | "ERROR"; changes: string[] };

/**
 * Dry run: what committing would do to each row, without writing anything.
 * Mirrors commitRow's matching and fill-gaps rules.
 */
export async function previewActions(db: Db, prepared: PreparedImport): Promise<RowPreview[]> {
  const nos = prepared.rows.map((r) => r.normalized.memberNo).filter((n): n is number => n !== null);
  const existing = new Map(
    (await db.member.findMany({ where: { memberNo: { in: nos } }, include: { ministries: true } })).map((m) => [m.memberNo, m]),
  );
  return prepared.rows.map((row) => {
    const n = row.normalized;
    if (n.skip) return { rowNumber: row.rowNumber, action: "SKIP", changes: [] };
    if (n.issues.some((i) => i.severity === "error" && i.field === "memberId")) return { rowNumber: row.rowNumber, action: "ERROR", changes: [] };
    const m = n.memberNo !== null ? existing.get(n.memberNo) : undefined;
    if (!m) return { rowNumber: row.rowNumber, action: "CREATE", changes: [] };
    if (m.purgedAt || m.mergedIntoId) return { rowNumber: row.rowNumber, action: "SKIP", changes: [] };
    const { data } = gapFill(m as unknown as Record<string, unknown>, toDbColumns(n.columns));
    const have = new Set(m.ministries.map((l) => `${l.ministryId}:${l.roleId}`));
    const links = n.ministries.filter((l) => !have.has(`${l.ministryId}:${l.roleId}`)).length;
    const changes = [...Object.keys(data).filter((k) => !k.endsWith("Raw")), ...(links ? ["ministry"] : [])];
    return { rowNumber: row.rowNumber, action: changes.length ? "UPDATE" : "UNCHANGED", changes };
  });
}

/** Which Member column a raw value belongs to (to skip raw values for fields already filled). */
const RAW_FIELD_COLUMN: Record<RawValueField, string> = {
  GENDER: "gender", DOB: "dobDate", YEAR_JOINED: "yearJoined", ZONE: "zoneId", PHONE: "phoneE164",
  EMAIL: "email", STATUS: "status", MARITAL: "maritalStatus", SPOUSE: "spouseName",
  NEXT_OF_KIN: "nextOfKinName", PROFESSION: "professionId", MINISTRY: "ministries", MINISTRY_ROLE: "ministries",
};

const empty = (v: unknown) => v === null || v === undefined || v === "";

function toDbColumns(c: NormalizedRow["columns"]) {
  return { ...c, dobDate: c.dobDate ? new Date(`${c.dobDate}T00:00:00Z`) : null };
}

/**
 * Fill-gaps update: only columns that are empty in the database are written,
 * so re-running an import never overwrites a clerk's corrections.
 */
function gapFill(existing: Record<string, unknown>, incoming: ReturnType<typeof toDbColumns>) {
  const data: Record<string, unknown> = {};
  const kept: string[] = [];
  for (const [k, v] of Object.entries(incoming)) {
    if (k === "dobPrecision" || k === "dobDate" || k === "dobYear" || k === "phoneRaw" || k === "nextOfKinPhoneRaw") continue;
    if (empty(v)) continue;
    if (empty(existing[k])) data[k] = v;
    else if (JSON.stringify(existing[k]) !== JSON.stringify(v)) kept.push(k);
  }
  if (data.phoneE164) data.phoneRaw = incoming.phoneRaw;
  if (data.nextOfKinPhoneE164) data.nextOfKinPhoneRaw = incoming.nextOfKinPhoneRaw;
  if (empty(existing.phoneRaw) && !data.phoneRaw && incoming.phoneRaw) data.phoneRaw = incoming.phoneRaw;
  // DOB: fill when unknown, or upgrade a year-only DOB to a full date in the same year.
  const rank = { UNKNOWN: 0, YEAR: 1, FULL: 2 } as const;
  const cur = existing.dobPrecision as keyof typeof rank;
  if (rank[incoming.dobPrecision] > rank[cur] && (cur === "UNKNOWN" || existing.dobYear === incoming.dobYear)) {
    data.dobPrecision = incoming.dobPrecision;
    data.dobDate = incoming.dobDate;
    data.dobYear = incoming.dobYear;
  }
  return { data, kept };
}

export type CommitTotals = { created: number; updated: number; unchanged: number; skipped: number; errors: number };

const ACTION_TOTAL: Record<string, keyof CommitTotals> = { CREATE: "created", UPDATE: "updated", UNCHANGED: "unchanged", SKIP: "skipped", ERROR: "errors" };

/**
 * Write a prepared import. Idempotent: rows are matched on Member ID (or, for
 * rows without an ID, on the same file + row number from an earlier run), and
 * existing records only have empty fields filled.
 *
 * Resumable: every row is logged in ImportRow as it is written, so a run that
 * stops (deadline reached, timeout, lost connection) continues where it left
 * off when called again with the same batchId. Pass `deadline` (epoch ms) to
 * stop cleanly before a serverless time limit; the result says whether all
 * rows are done.
 */
export async function commitImport(db: Db, actor: Actor, prepared: PreparedImport, opts: { chunkSize?: number; batchId?: string; deadline?: number } = {}) {
  const batchData = {
    fileName: prepared.fileName,
    fileHash: prepared.fileHash,
    sheetName: prepared.sheetName,
    headerRow: prepared.headerRow,
    columnMap: prepared.columnMap as Prisma.InputJsonValue,
  };
  let batch = opts.batchId
    ? await db.importBatch.findUniqueOrThrow({ where: { id: opts.batchId } })
    : await db.importBatch.create({ data: { ...batchData, status: "VALIDATED", createdById: actor.userId } });
  if (batch.status === "COMMITTED") throw new ValidationError("This import was already committed.");
  if (opts.batchId) batch = await db.importBatch.update({ where: { id: batch.id }, data: { ...batchData, status: "VALIDATED" } });

  const done = new Set((await db.importRow.findMany({ where: { batchId: batch.id }, select: { rowNumber: true } })).map((r) => r.rowNumber));
  const rules = await getCompletenessRules(db);
  const chunkSize = opts.chunkSize ?? 25;

  // Rows that carry a Member ID go first, so rows without one are issued
  // numbers above every ID in the file and can never take a number the file uses.
  const ordered = [
    ...prepared.rows.filter((r) => r.normalized.memberNo !== null),
    ...prepared.rows.filter((r) => r.normalized.memberNo === null),
  ].filter((r) => !done.has(r.rowNumber));

  let processed = 0;
  for (let i = 0; i < ordered.length; i += chunkSize) {
    // Always write at least one chunk per call so every round makes progress.
    if (i > 0 && opts.deadline && Date.now() > opts.deadline) break;
    const chunk = ordered.slice(i, i + chunkSize);
    await db.$transaction(
      async (tx) => {
        const audit = new AuditWriter(tx, actor, "IMPORT", batch.id);
        for (const row of chunk) await commitRow(tx, audit, prepared, batch.id, row, rules);
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
    processed += chunk.length;
  }

  const total = prepared.rows.length;
  const recorded = await db.importRow.groupBy({ by: ["action"], where: { batchId: batch.id }, _count: true });
  const totals: CommitTotals = { created: 0, updated: 0, unchanged: 0, skipped: 0, errors: 0 };
  for (const r of recorded) if (r.action) totals[ACTION_TOTAL[r.action]!] += r._count;
  const written = recorded.reduce((n, r) => n + r._count, 0);
  const complete = written >= total;

  const saved = await db.importBatch.update({
    where: { id: batch.id },
    data: complete
      ? { status: "COMMITTED", committedAt: new Date(), totals: totals as Prisma.InputJsonValue }
      : { totals: { ...totals, inProgress: true, written, total } as Prisma.InputJsonValue },
  });
  return { ...saved, done: complete, processed, written, total, totals };
}

async function commitRow(
  tx: Tx,
  audit: AuditWriter,
  prepared: PreparedImport,
  batchId: string,
  row: PreparedRow,
  rules: CompletenessRules,
): Promise<keyof CommitTotals> {
  const n = row.normalized;
  const where = `${prepared.fileName}, row ${row.rowNumber}`;
  const issues = [...n.issues];
  const record = async (action: "CREATE" | "UPDATE" | "UNCHANGED" | "SKIP" | "ERROR", memberId: string | null) => {
    await tx.importRow.create({
      data: {
        batchId,
        rowNumber: row.rowNumber,
        raw: JSON.parse(JSON.stringify(row.raw)) as Prisma.InputJsonValue,
        normalized: JSON.parse(JSON.stringify(n.columns)) as Prisma.InputJsonValue,
        issues: issues as unknown as Prisma.InputJsonValue,
        action,
        memberId,
      },
    });
  };

  if (n.skip) {
    await record("SKIP", null);
    return "skipped";
  }
  if (n.issues.some((i) => i.severity === "error" && i.field === "memberId")) {
    await record("ERROR", null);
    return "errors";
  }

  // Match: by member number, else by this file+row from a previous run.
  let existing = n.memberNo !== null ? await tx.member.findUnique({ where: { memberNo: n.memberNo }, include: { ministries: true } }) : null;
  if (!existing && n.memberNo === null) {
    const prior = await tx.importRow.findFirst({
      where: { rowNumber: row.rowNumber, memberId: { not: null }, batch: { fileHash: prepared.fileHash } },
      select: { memberId: true },
    });
    let matchId = prior?.memberId ?? null;
    if (!matchId) {
      // A re-saved / corrected register: match on exact name, but only against
      // members that an earlier import created from a row without an ID, and
      // only when the match is unique.
      const hits = await tx.$queryRaw<{ id: string }[]>`
        SELECT DISTINCT m.id FROM "Member" m
        JOIN "ImportRow" r ON r."memberId" = m.id AND r.action = 'CREATE' AND NOT (r.raw ? 'memberId')
        WHERE lower(m."lastName") = lower(${n.columns.lastName}) AND lower(m."firstName") = lower(${n.columns.firstName})
          AND m."mergedIntoId" IS NULL AND m."purgedAt" IS NULL`;
      if (hits.length === 1) matchId = hits[0].id;
    }
    if (matchId) existing = await tx.member.findUnique({ where: { id: matchId }, include: { ministries: true } });
  }

  const cols = toDbColumns(n.columns);

  if (!existing) {
    // New record: completeness is computed here instead of re-reading the row (saves two round trips).
    const score = computeCompleteness({ ...cols, photoKey: null, spouseMemberId: null, ministryCount: new Set(n.ministries.map((l) => l.ministryId)).size }, rules);
    const m = await tx.member.create({
      data: {
        ...(n.memberNo !== null ? { memberNo: n.memberNo } : {}),
        ...cols,
        completeness: score.percent,
        missingFields: score.missing,
        ministries: n.ministries.length ? { createMany: { data: n.ministries, skipDuplicates: true } } : undefined,
      },
    });
    if (n.rawValues.length) {
      await tx.rawValue.createMany({
        data: n.rawValues.map((r) => ({ memberId: m.id, field: r.field, rawValue: r.rawValue, normalized: normalizeValue(r.rawValue) })),
        skipDuplicates: true,
      });
    }
    await audit.log({ action: "CREATE", entity: "Member", entityId: m.id, memberId: m.id, newValue: { memberId: m.memberId, ...n.columns }, note: where });
    await record("CREATE", m.id);
    return "created";
  }

  if (existing.purgedAt || existing.mergedIntoId) {
    issues.push({ field: "memberId", severity: "info", message: existing.purgedAt ? "Record was purged; not re-imported" : "Record was merged into another; not re-imported" });
    await record("SKIP", existing.id);
    return "skipped";
  }

  const { data, kept } = gapFill(existing as unknown as Record<string, unknown>, cols);
  for (const k of kept) issues.push({ field: k, severity: "info", message: `Kept the value already in the system for ${k}` });

  const have = new Set(existing.ministries.map((l) => `${l.ministryId}:${l.roleId}`));
  const newLinks = n.ministries.filter((l) => !have.has(`${l.ministryId}:${l.roleId}`));

  const rawToAdd = n.rawValues.filter((r) => {
    const col = RAW_FIELD_COLUMN[r.field];
    if (col === "ministries") return existing.ministries.length === 0;
    return empty((existing as unknown as Record<string, unknown>)[col]) && empty(data[col]);
  });
  const rawCreated = rawToAdd.length
    ? await tx.rawValue.createMany({
        data: rawToAdd.map((r) => ({ memberId: existing.id, field: r.field, rawValue: r.rawValue, normalized: normalizeValue(r.rawValue) })),
        skipDuplicates: true,
      })
    : { count: 0 };

  if (Object.keys(data).length === 0 && newLinks.length === 0) {
    const touched = rawCreated.count > 0;
    await record(touched ? "UPDATE" : "UNCHANGED", existing.id);
    return touched ? "updated" : "unchanged";
  }

  if (Object.keys(data).length) {
    await audit.logChanges("Member", existing.id, existing as unknown as Record<string, unknown>, data, { memberId: existing.id, note: where });
    await tx.member.update({ where: { id: existing.id }, data: { ...(data as Prisma.MemberUpdateInput), version: { increment: 1 } } });
  }
  for (const l of newLinks) {
    const link = await tx.memberMinistry.create({ data: { memberId: existing.id, ...l }, include: { ministry: true, role: true } });
    await audit.log({ action: "CREATE", entity: "MemberMinistry", entityId: link.id, memberId: existing.id, field: "ministry", newValue: `${link.ministry.label} · ${link.role.label}`, note: where });
  }
  await refreshCompleteness(tx, existing.id, rules);
  await record("UPDATE", existing.id);
  return "updated";
}
