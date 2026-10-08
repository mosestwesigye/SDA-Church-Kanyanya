import { createHash } from "node:crypto";
import { z } from "zod";
import type { MeetingType, MinutesStatus, Prisma } from "@/generated/prisma/client";
import { AuditWriter } from "../audit/audit";
import { assertCan, type AuthContext } from "../authz/policy";
import type { Db } from "../db";
import { NotFoundError, ValidationError } from "../errors";
import { actorFrom } from "../members/service";
import { MAX_UPLOAD_BYTES, sniffType, storage } from "../storage";

export const MEETING_TYPES: Record<MeetingType, { label: string; prefix: string; title: string }> = {
  CHURCH_BOARD: { label: "Church board", prefix: "CB", title: "Church Board Meeting" },
  BUSINESS_MEETING: { label: "Business meeting", prefix: "BM", title: "Church Business Meeting" },
  ELDERS_COUNCIL: { label: "Elders’ council", prefix: "EC", title: "Elders’ Council Meeting" },
  NOMINATING_COMMITTEE: { label: "Nominating committee", prefix: "NC", title: "Nominating Committee Meeting" },
  OTHER: { label: "Other meeting", prefix: "MT", title: "Committee Meeting" },
};

export const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const ALLOWED = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", DOCX]);

const LIVE = { deletedAt: null } as const;

const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);
const text = (max: number) => z.preprocess(blank, z.string().trim().max(max).nullable().optional());
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date.");

export const minutesInput = z
  .object({
    type: z.enum(["CHURCH_BOARD", "BUSINESS_MEETING", "ELDERS_COUNCIL", "NOMINATING_COMMITTEE", "OTHER"]),
    title: z.string().trim().min(3, "Give the meeting a title.").max(160),
    heldOn: day,
    startTime: z.preprocess(blank, z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 14:30.").nullable().optional()),
    venue: text(160),
    chairperson: text(120),
    secretary: text(120),
    attendance: z.preprocess((v) => (v === "" || v === null || v === undefined ? null : Number(v)), z.number().int().min(0).max(5000).nullable().optional()),
    summary: text(5000),
    status: z.enum(["DRAFT", "APPROVED"]),
    approvedOn: z.preprocess(blank, day.nullable().optional()),
  })
  .superRefine((v, ctx) => {
    const today = new Date().toISOString().slice(0, 10);
    if (v.heldOn > today) ctx.addIssue({ code: "custom", path: ["heldOn"], message: "The meeting date can’t be in the future." });
    if (v.status === "APPROVED" && !v.approvedOn) ctx.addIssue({ code: "custom", path: ["approvedOn"], message: "Enter the date the minutes were approved." });
    if (v.approvedOn && v.approvedOn < v.heldOn) ctx.addIssue({ code: "custom", path: ["approvedOn"], message: "Minutes can’t be approved before the meeting." });
  });
export type MinutesInput = z.input<typeof minutesInput>;

function toData(v: z.output<typeof minutesInput>) {
  return {
    type: v.type,
    title: v.title,
    heldOn: new Date(`${v.heldOn}T00:00:00Z`),
    startTime: v.startTime ?? null,
    venue: v.venue ?? null,
    chairperson: v.chairperson ?? null,
    secretary: v.secretary ?? null,
    attendance: v.attendance ?? null,
    summary: v.summary ?? null,
    status: v.status as MinutesStatus,
    approvedOn: v.status === "APPROVED" && v.approvedOn ? new Date(`${v.approvedOn}T00:00:00Z`) : null,
  };
}

/** Next free reference for a type and year: CB/2026/01, CB/2026/02, … */
async function nextReference(tx: Prisma.TransactionClient, type: MeetingType, year: number) {
  const prefix = `${MEETING_TYPES[type].prefix}/${year}/`;
  const used = await tx.meetingMinutes.findMany({ where: { reference: { startsWith: prefix } }, select: { reference: true } });
  const max = used.reduce((n, r) => Math.max(n, Number(r.reference.slice(prefix.length)) || 0), 0);
  return `${prefix}${String(max + 1).padStart(2, "0")}`;
}

export type MinutesFilter = { q?: string; year?: number; type?: MeetingType };

export async function listMinutes(db: Db, ctx: AuthContext, f: MinutesFilter = {}) {
  assertCan(ctx, "minutes", "read");
  const q = f.q?.trim();
  const where: Prisma.MeetingMinutesWhereInput = {
    ...LIVE,
    ...(f.type ? { type: f.type } : {}),
    ...(f.year ? { heldOn: { gte: new Date(Date.UTC(f.year, 0, 1)), lt: new Date(Date.UTC(f.year + 1, 0, 1)) } } : {}),
    ...(q
      ? { OR: [{ reference: { contains: q, mode: "insensitive" } }, { title: { contains: q, mode: "insensitive" } }, { summary: { contains: q, mode: "insensitive" } }, { venue: { contains: q, mode: "insensitive" } }] }
      : {}),
  };
  const [rows, years] = await Promise.all([
    db.meetingMinutes.findMany({
      where,
      orderBy: [{ heldOn: "desc" }, { reference: "desc" }],
      take: 300,
      include: { files: { where: LIVE, select: { id: true } } },
    }),
    db.$queryRaw<{ y: number }[]>`SELECT DISTINCT EXTRACT(YEAR FROM "heldOn")::int AS y FROM "MeetingMinutes" WHERE "deletedAt" IS NULL ORDER BY y DESC`,
  ]);
  return { rows: rows.map(({ files, ...r }) => ({ ...r, fileCount: files.length })), years: years.map((y) => y.y) };
}

export async function getMinutes(db: Db, ctx: AuthContext, id: string) {
  assertCan(ctx, "minutes", "read");
  const m = await db.meetingMinutes.findFirst({ where: { id, ...LIVE }, include: { files: { where: LIVE, orderBy: { uploadedAt: "asc" } } } });
  if (!m) throw new NotFoundError("These minutes were not found.");
  const userIds = [...new Set([m.createdById, ...m.files.map((f) => f.uploadedById)])];
  const [users, history] = await Promise.all([
    db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
    db.minutesFile.findMany({ where: { minutesId: m.id }, select: { id: true } }).then((all) =>
      db.auditLog.findMany({
        where: { OR: [{ entity: "MeetingMinutes", entityId: m.id }, { entity: "MinutesFile", entityId: { in: all.map((f) => f.id) } }] },
        orderBy: { id: "desc" },
        take: 50,
      }),
    ),
  ]);
  const name = new Map(users.map((u) => [u.id, u.name]));
  return {
    ...m,
    createdByName: name.get(m.createdById) ?? "Unknown",
    files: m.files.map((f) => ({ ...f, uploadedByName: name.get(f.uploadedById) ?? "Unknown" })),
    history: history.map((h) => ({ id: h.id.toString(), at: h.at, actor: h.actorLabel, action: h.action, entity: h.entity, field: h.field, note: h.note })),
  };
}

export async function createMinutes(db: Db, ctx: AuthContext, input: MinutesInput) {
  assertCan(ctx, "minutes", "manage");
  const v = minutesInput.parse(input);
  const data = toData(v);
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(async (tx) => {
        const reference = await nextReference(tx, v.type, data.heldOn.getUTCFullYear());
        const m = await tx.meetingMinutes.create({ data: { ...data, reference, createdById: ctx.userId } });
        await new AuditWriter(tx, actorFrom(ctx), "UI").log({
          action: "CREATE", entity: "MeetingMinutes", entityId: m.id,
          newValue: { reference, title: m.title, heldOn: v.heldOn, status: m.status }, note: `Minutes ${reference} recorded`,
        });
        return m;
      });
    } catch (e) {
      // Two clerks saving at once can race for the same reference; try the next number.
      if (attempt < 2 && e && typeof e === "object" && "code" in e && e.code === "P2002") continue;
      throw e;
    }
  }
}

const FIELD_LABELS: Record<string, string> = {
  type: "meeting type", title: "title", heldOn: "meeting date", startTime: "start time", venue: "venue", chairperson: "chairperson",
  secretary: "secretary", attendance: "members present", summary: "key decisions", status: "status", approvedOn: "approval date",
};

const show = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v);

export async function updateMinutes(db: Db, ctx: AuthContext, id: string, input: MinutesInput) {
  assertCan(ctx, "minutes", "manage");
  const v = minutesInput.parse(input);
  const data = toData(v);
  return db.$transaction(async (tx) => {
    const before = await tx.meetingMinutes.findFirst({ where: { id, ...LIVE } });
    if (!before) throw new NotFoundError("These minutes were not found.");
    const changed = (Object.keys(data) as (keyof typeof data)[]).filter((k) => String(show(before[k]) ?? "") !== String(show(data[k]) ?? ""));
    if (changed.length === 0) return { minutes: before, changed };
    const minutes = await tx.meetingMinutes.update({ where: { id }, data });
    const audit = new AuditWriter(tx, actorFrom(ctx), "UI");
    for (const k of changed) {
      await audit.log({
        action: k === "status" && data.status === "APPROVED" ? "APPROVE" : "UPDATE", entity: "MeetingMinutes", entityId: id,
        field: k, oldValue: (show(before[k]) ?? null) as never, newValue: (show(data[k]) ?? null) as never,
        note: k === "status" && data.status === "APPROVED" ? `Minutes ${before.reference} approved` : `Changed ${FIELD_LABELS[k]}`,
      });
    }
    return { minutes, changed };
  });
}

export async function deleteMinutes(db: Db, ctx: AuthContext, id: string, reason: string) {
  assertCan(ctx, "minutes", "manage");
  if (reason.trim().length < 3) throw new ValidationError("Give a reason for removing these minutes.");
  await db.$transaction(async (tx) => {
    const m = await tx.meetingMinutes.findFirst({ where: { id, ...LIVE } });
    if (!m) throw new NotFoundError("These minutes were not found.");
    await tx.meetingMinutes.update({ where: { id }, data: { deletedAt: new Date() } });
    await new AuditWriter(tx, actorFrom(ctx), "UI").log({ action: "DELETE", entity: "MeetingMinutes", entityId: id, note: `Minutes ${m.reference} removed: ${reason.trim()}` });
  });
}

/** Check the bytes, not the name: PDFs, images and Word documents only. */
function fileType(data: Buffer, name: string): string | null {
  const sniffed = sniffType(data);
  if (sniffed) return sniffed;
  const isZip = data.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  return isZip && /\.docx$/i.test(name) && data.includes(Buffer.from("word/")) ? DOCX : null;
}

export async function addMinutesFile(db: Db, ctx: AuthContext, minutesId: string, file: { data: Buffer; name: string }) {
  assertCan(ctx, "minutes", "manage");
  const m = await db.meetingMinutes.findFirst({ where: { id: minutesId, ...LIVE } });
  if (!m) throw new NotFoundError("These minutes were not found.");
  if (file.data.length === 0) throw new ValidationError(`${file.name} is empty.`);
  if (file.data.length > MAX_UPLOAD_BYTES) throw new ValidationError(`${file.name} is larger than 4 MB. Save it as a smaller PDF or scan at a lower resolution.`);
  const type = fileType(file.data, file.name);
  if (!type || !ALLOWED.has(type)) throw new ValidationError(`${file.name} isn’t a PDF, Word document (.docx) or image.`);
  const sha256 = createHash("sha256").update(file.data).digest("hex");
  const key = await storage().put(`minutes/${m.id}`, file.name, file.data, type);
  return db.$transaction(async (tx) => {
    const f = await tx.minutesFile.create({
      data: { minutesId: m.id, fileName: file.name.slice(0, 200), storageKey: key, mimeType: type, sizeBytes: file.data.length, sha256, uploadedById: ctx.userId },
    });
    await new AuditWriter(tx, actorFrom(ctx), "UI").log({ action: "CREATE", entity: "MinutesFile", entityId: f.id, newValue: { fileName: f.fileName, sha256 }, note: `File added: ${f.fileName}` });
    return f;
  });
}

export async function removeMinutesFile(db: Db, ctx: AuthContext, fileId: string) {
  assertCan(ctx, "minutes", "manage");
  await db.$transaction(async (tx) => {
    const f = await tx.minutesFile.findFirst({ where: { id: fileId, ...LIVE } });
    if (!f) throw new NotFoundError("File not found.");
    await tx.minutesFile.update({ where: { id: fileId }, data: { deletedAt: new Date() } });
    await new AuditWriter(tx, actorFrom(ctx), "UI").log({ action: "DELETE", entity: "MinutesFile", entityId: f.id, note: `File removed: ${f.fileName}` });
  });
}

/** Authorise, fetch and log a minutes file download. */
export async function openMinutesFile(db: Db, ctx: AuthContext, fileId: string) {
  assertCan(ctx, "minutes", "read");
  const f = await db.minutesFile.findFirst({ where: { id: fileId, ...LIVE, minutes: LIVE }, include: { minutes: { select: { reference: true } } } });
  if (!f) throw new NotFoundError();
  const file = await storage().get(f.storageKey);
  if (!file) throw new NotFoundError("File missing from storage.");
  await new AuditWriter(db, actorFrom(ctx), "UI").log({ action: "EXPORT", entity: "MinutesFile", entityId: f.id, note: `Opened ${f.fileName} (${f.minutes.reference})` });
  return { meta: f, file };
}
