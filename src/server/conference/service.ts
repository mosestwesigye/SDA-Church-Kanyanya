import { z } from "zod";
import { Prisma, type MembershipStatus } from "@/generated/prisma/client";
import { AuditWriter } from "../audit/audit";
import { assertCan, memberScopeWhere, type AuthContext } from "../authz/policy";
import type { Db, DbOrTx } from "../db";
import { ConflictError, ValidationError } from "../errors";
import { actorFrom } from "../members/service";

/**
 * Central Uganda Conference — Secretary's Statistical Report (quarterly).
 * One row per church; Kanyanya has no companies. Figures come from the
 * register (membership events in the quarter, Sabbath attendance) and the
 * clerk can replace any of them with a manual figure and a reason. The closing
 * membership is always opening + added − dropped, so the row balances.
 */

/** Statuses the Conference counts as membership ("on the books"). */
export const CONFERENCE_BOOKS: readonly MembershipStatus[] = ["ACTIVE", "IRREGULAR", "UNDER_DISCIPLINE", "DORMANT"];
const onBooks = (s: MembershipStatus | null) => s !== null && CONFERENCE_BOOKS.includes(s);

export type LineKey = "att7" | "att2" | "opening" | "baptism" | "profession" | "lettersIn" | "adjustIn" | "lettersOut" | "death" | "apostasy" | "missing" | "adjustOut";

export const LINES: { key: LineKey; code: string; label: string; group: "attendance" | "membership" | "added" | "dropped"; source: string }[] = [
  { key: "att7", code: "3a", label: "Church attendance — 7th Sabbath count", group: "attendance", source: "Head count entered for the 7th Sabbath of the quarter" },
  { key: "att2", code: "3b", label: "Church attendance — 2nd Sabbath count", group: "attendance", source: "Head count entered for the 2nd Sabbath of the quarter" },
  { key: "opening", code: "3c", label: "Church membership at beginning of quarter", group: "membership", source: "Last quarter’s closing figure (or the register when there is none)" },
  { key: "baptism", code: "4a", label: "Baptism", group: "added", source: "Baptisms recorded in the quarter" },
  { key: "profession", code: "4b", label: "Profession of faith", group: "added", source: "Professions of faith recorded in the quarter" },
  { key: "lettersIn", code: "4c", label: "Letters received", group: "added", source: "Transfers in recorded in the quarter" },
  { key: "adjustIn", code: "4d", label: "Adjustments (added)", group: "added", source: "Manual only" },
  { key: "lettersOut", code: "5a", label: "Letters granted", group: "dropped", source: "Transfers out recorded in the quarter" },
  { key: "death", code: "5b", label: "Death", group: "dropped", source: "Deaths recorded in the quarter" },
  { key: "apostasy", code: "5c", label: "Apostasies", group: "dropped", source: "Members changed to Left the Faith in the quarter" },
  { key: "missing", code: "5d", label: "Missing", group: "dropped", source: "Members changed to Missing in the quarter" },
  { key: "adjustOut", code: "5e", label: "Adjustments (dropped)", group: "dropped", source: "Manual only" },
];
export const LINE_KEYS = LINES.map((l) => l.key);

const QUARTER_WORDS = ["ONE", "TWO", "THREE", "FOUR"] as const;
export const quarterWord = (q: number) => QUARTER_WORDS[q - 1] ?? String(q);

export const periodSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  quarter: z.coerce.number().int().min(1).max(4),
});
export type Period = z.infer<typeof periodSchema>;

export function quarterBounds({ year, quarter }: Period) {
  const start = new Date(Date.UTC(year, (quarter - 1) * 3, 1));
  const end = new Date(Date.UTC(year, quarter * 3, 1)); // exclusive
  return { start, end, last: new Date(end.getTime() - 86400_000) };
}

/** Every Sabbath (Saturday) in the quarter, as YYYY-MM-DD. */
export function sabbathsOf(p: Period): string[] {
  const { start, end } = quarterBounds(p);
  const d = new Date(start);
  d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7));
  const out: string[] = [];
  for (; d < end; d.setUTCDate(d.getUTCDate() + 7)) out.push(d.toISOString().slice(0, 10));
  return out;
}

export const previousPeriod = ({ year, quarter }: Period): Period => (quarter === 1 ? { year: year - 1, quarter: 4 } : { year, quarter: quarter - 1 });

type Override = { value: number; reason: string; by?: string; at?: string };
type Overrides = Partial<Record<LineKey, Override>>;

export type ReturnLine = (typeof LINES)[number] & { computed: number | null; override: Override | null; value: number | null; count?: number };

export type DetailRow = { memberId: string; id: string; name: string; date: string; note: string };

const liveMember = (ctx: AuthContext): Prisma.MemberWhereInput => ({
  AND: [memberScopeWhere(ctx) as Prisma.MemberWhereInput, { deletedAt: null, mergedIntoId: null }],
});

/** Event filters behind each register-derived line. */
const EVENT_LINES: Partial<Record<LineKey, Prisma.MembershipEventWhereInput>> = {
  baptism: { type: "BAPTISM" },
  profession: { type: "PROFESSION_OF_FAITH" },
  lettersIn: { type: "TRANSFER_IN" },
  lettersOut: { type: "TRANSFER_OUT" },
  death: { type: "DEATH" },
  apostasy: { toStatus: "LEFT_THE_FAITH", NOT: { fromStatus: "LEFT_THE_FAITH" } },
  missing: { toStatus: "MISSING", NOT: { fromStatus: "MISSING" } },
};

/**
 * Members on the Conference books at the start of day `t`: today's books, undoing status changes
 * dated on or after `t`. Record creation dates are ignored because the register was imported in
 * one go; members who joined later have a dated joining change (baptism, transfer in…).
 */
async function booksAt(db: DbOrTx, ctx: AuthContext, t: Date) {
  const live = { AND: [liveMember(ctx), { purgedAt: null }] } satisfies Prisma.MemberWhereInput;
  const [groups, later] = await Promise.all([
    db.member.groupBy({ by: ["status"], where: live, _count: true }),
    db.membershipEvent.findMany({ where: { member: live, occurredOn: { gte: t }, toStatus: { not: null } }, select: { fromStatus: true, toStatus: true } }),
  ]);
  const now = groups.filter((g) => onBooks(g.status)).reduce((n, g) => n + g._count, 0);
  const undo = later.reduce((n, e) => n + (onBooks(e.toStatus) ? 1 : 0) - (onBooks(e.fromStatus) ? 1 : 0), 0);
  return now - undo;
}

type Frozen = { lines: Record<LineKey, number | null>; closing: number };

/** The return for one quarter: register figures, the clerk's overrides and the balance. */
export async function getConferenceReturn(db: DbOrTx, ctx: AuthContext, period: Period) {
  assertCan(ctx, "conference_return", "read");
  const p = periodSchema.parse(period);
  const { start, end, last } = quarterBounds(p);
  const sabbaths = sabbathsOf(p);
  const prev = previousPeriod(p);

  const [saved, prevSaved, attendance, counts, opening, registerClosing, pastor] = await Promise.all([
    db.conferenceReturn.findUnique({ where: { year_quarter: { year: p.year, quarter: p.quarter } } }),
    db.conferenceReturn.findUnique({ where: { year_quarter: { year: prev.year, quarter: prev.quarter } } }),
    db.sabbathAttendance.findMany({ where: { sabbath: { gte: start, lt: end } }, orderBy: { sabbath: "asc" } }),
    Promise.all(
      Object.entries(EVENT_LINES).map(async ([key, where]) => [key, await db.membershipEvent.count({ where: { ...where, member: liveMember(ctx), occurredOn: { gte: start, lt: end } } })] as const),
    ),
    booksAt(db, ctx, start),
    booksAt(db, ctx, end),
    db.user.findFirst({ where: { active: true, roles: { some: { role: { key: "PASTOR" } } } }, select: { name: true }, orderBy: { createdAt: "asc" } }),
  ]);

  const count = Object.fromEntries(counts) as Partial<Record<LineKey, number>>;
  const att = new Map(attendance.map((a) => [a.sabbath.toISOString().slice(0, 10), a.count]));
  const prevClosing = prevSaved?.state === "SENT" ? ((prevSaved.figures as Frozen | null)?.closing ?? null) : null;

  const computed: Record<LineKey, number | null> = {
    att7: sabbaths[6] ? (att.get(sabbaths[6]) ?? null) : null,
    att2: sabbaths[1] ? (att.get(sabbaths[1]) ?? null) : null,
    opening: prevClosing ?? opening,
    baptism: count.baptism ?? 0,
    profession: count.profession ?? 0,
    lettersIn: count.lettersIn ?? 0,
    adjustIn: 0,
    lettersOut: count.lettersOut ?? 0,
    death: count.death ?? 0,
    apostasy: count.apostasy ?? 0,
    missing: count.missing ?? 0,
    adjustOut: 0,
  };
  const overrides = ((saved?.overrides ?? {}) as Overrides) ?? {};
  const frozen = saved?.state === "SENT" ? (saved.figures as Frozen | null) : null;

  const lines: ReturnLine[] = LINES.map((l) => {
    const override = overrides[l.key] ?? null;
    const value = frozen ? (frozen.lines[l.key] ?? null) : override ? override.value : computed[l.key];
    return { ...l, computed: computed[l.key], override, value };
  });
  const v = (k: LineKey) => lines.find((l) => l.key === k)!.value ?? 0;
  const added = v("baptism") + v("profession") + v("lettersIn") + v("adjustIn");
  const dropped = v("lettersOut") + v("death") + v("apostasy") + v("missing") + v("adjustOut");
  const closing = frozen ? frozen.closing : v("opening") + added - dropped;

  const problems: string[] = [];
  if (lines.find((l) => l.key === "att7")!.value === null) problems.push(sabbaths[6] ? `Enter the head count for the 7th Sabbath (${fmt(sabbaths[6])}) or type the figure in 3a.` : "This quarter has fewer than seven Sabbaths; type the 7th Sabbath figure in 3a.");
  if (lines.find((l) => l.key === "att2")!.value === null) problems.push(`Enter the head count for the 2nd Sabbath (${fmt(sabbaths[1]!)}) or type the figure in 3b.`);
  if (closing < 0) problems.push("Membership at the end of the quarter can’t be negative.");

  return {
    period: p,
    label: `Quarter ${quarterWord(p.quarter)} ${p.year}`,
    range: { start, last },
    state: saved?.state ?? "DRAFT",
    dateSent: saved?.dateSent ?? null,
    dateReceived: saved?.dateReceived ?? null,
    pastorName: saved?.pastorName ?? pastor?.name ?? null,
    openingFrom: prevClosing !== null ? ("previous" as const) : ("register" as const),
    sabbaths: sabbaths.map((d, i) => ({ date: d, n: i + 1, count: att.get(d) ?? null, upcoming: new Date(`${d}T00:00:00Z`).getTime() > Date.now() })),
    lines,
    added,
    dropped,
    closing,
    /** What the register says is on the Conference books at quarter end, for comparison. */
    registerClosing,
    registerOpening: opening,
    problems,
    updatedAt: saved?.updatedAt ?? null,
  };
}
export type ConferenceReturnView = Awaited<ReturnType<typeof getConferenceReturn>>;

const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** Members behind a register figure (for checking the numbers). */
export async function returnDetail(db: DbOrTx, ctx: AuthContext, period: Period, key: LineKey): Promise<DetailRow[]> {
  assertCan(ctx, "conference_return", "read");
  assertCan(ctx, "member", "read");
  const where = EVENT_LINES[key];
  if (!where) return [];
  const { start, end } = quarterBounds(periodSchema.parse(period));
  const events = await db.membershipEvent.findMany({
    where: { ...where, member: liveMember(ctx), occurredOn: { gte: start, lt: end } },
    select: { occurredOn: true, title: true, member: { select: { id: true, memberId: true, lastName: true, firstName: true } } },
    orderBy: { occurredOn: "asc" },
    take: 500,
  });
  return events.map((e) => ({
    id: e.member.id,
    memberId: e.member.memberId,
    name: `${e.member.lastName}, ${e.member.firstName}`,
    date: e.occurredOn ? fmt(e.occurredOn.toISOString().slice(0, 10)) : "",
    note: e.title,
  }));
}

async function draftFor(tx: Prisma.TransactionClient, p: Period) {
  const r = await tx.conferenceReturn.upsert({ where: { year_quarter: { year: p.year, quarter: p.quarter } }, create: { year: p.year, quarter: p.quarter }, update: {} });
  if (r.state === "SENT") throw new ConflictError("This return has been sent. Reopen it to make changes.");
  return r;
}

const overrideInput = z.object({
  key: z.enum(LINE_KEYS as [LineKey, ...LineKey[]]),
  value: z.preprocess((v) => (v === "" || v === null || v === undefined ? null : Number(v)), z.number().int("Use a whole number.").min(0, "Use 0 or more.").max(100000).nullable()),
  reason: z.string().trim().max(300).optional(),
});

/** Replace a register figure with the clerk's own (value null goes back to the register figure). */
export async function setReturnFigure(db: Db, ctx: AuthContext, period: Period, input: z.input<typeof overrideInput>) {
  assertCan(ctx, "conference_return", "manage");
  const p = periodSchema.parse(period);
  const v = overrideInput.parse(input);
  if (v.value !== null && !v.reason) throw new ValidationError("Give a reason for the manual figure.", { reason: "Required" });
  await db.$transaction(async (tx) => {
    const r = await draftFor(tx, p);
    const overrides = { ...((r.overrides ?? {}) as Overrides) };
    const before = overrides[v.key]?.value ?? null;
    if (v.value === null) delete overrides[v.key];
    else overrides[v.key] = { value: v.value, reason: v.reason!, by: ctx.label, at: new Date().toISOString() };
    await tx.conferenceReturn.update({ where: { id: r.id }, data: { overrides: overrides as Prisma.InputJsonValue, updatedById: ctx.userId } });
    const line = LINES.find((l) => l.key === v.key)!;
    await new AuditWriter(tx, actorFrom(ctx), "UI").log({
      action: "UPDATE", entity: "ConferenceReturn", entityId: r.id, field: `${line.code} ${line.label}`,
      oldValue: before, newValue: v.value, note: v.value === null ? "Back to the register figure" : v.reason,
    });
  });
}

const attendanceInput = z.object({
  sabbath: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  count: z.preprocess((v) => (v === "" || v === null || v === undefined ? null : Number(v)), z.number().int("Use a whole number.").min(0).max(100000).nullable()),
});

/** Record (or clear) the head count for one Sabbath. */
export async function setSabbathAttendance(db: Db, ctx: AuthContext, input: z.input<typeof attendanceInput>) {
  assertCan(ctx, "conference_return", "manage");
  const v = attendanceInput.parse(input);
  const day = new Date(`${v.sabbath}T00:00:00Z`);
  if (Number.isNaN(day.getTime()) || day.getUTCDay() !== 6) throw new ValidationError("Attendance is recorded for Sabbaths (Saturdays) only.");
  if (day.getTime() > Date.now() + 86400_000) throw new ValidationError("That Sabbath hasn’t happened yet.");
  await db.$transaction(async (tx) => {
    const before = await tx.sabbathAttendance.findUnique({ where: { sabbath: day } });
    if (v.count === null) {
      if (before) await tx.sabbathAttendance.delete({ where: { id: before.id } });
    } else {
      await tx.sabbathAttendance.upsert({ where: { sabbath: day }, create: { sabbath: day, count: v.count, recordedById: ctx.userId }, update: { count: v.count, recordedById: ctx.userId } });
    }
    await new AuditWriter(tx, actorFrom(ctx), "UI").log({
      action: "UPDATE", entity: "SabbathAttendance", entityId: v.sabbath, field: "count", oldValue: before?.count ?? null, newValue: v.count,
    });
  });
}

const sendInput = z.object({
  dateSent: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date sent."),
  pastorName: z.string().trim().min(2, "Name the pastor submitting the report.").max(120),
});

/** Freeze the figures and record when the return went to the Conference. */
export async function markReturnSent(db: Db, ctx: AuthContext, period: Period, input: z.input<typeof sendInput>) {
  assertCan(ctx, "conference_return", "manage");
  const p = periodSchema.parse(period);
  const v = sendInput.parse(input);
  const view = await getConferenceReturn(db, ctx, p);
  if (view.state === "SENT") throw new ConflictError("This return was already marked as sent.");
  if (view.problems.length) throw new ValidationError(view.problems[0]!);
  const frozen: Frozen = { lines: Object.fromEntries(view.lines.map((l) => [l.key, l.value])) as Record<LineKey, number | null>, closing: view.closing };
  await db.$transaction(async (tx) => {
    const r = await draftFor(tx, p);
    await tx.conferenceReturn.update({
      where: { id: r.id },
      data: { state: "SENT", figures: frozen as unknown as Prisma.InputJsonValue, dateSent: new Date(`${v.dateSent}T00:00:00Z`), pastorName: v.pastorName, sentById: ctx.userId, updatedById: ctx.userId },
    });
    await new AuditWriter(tx, actorFrom(ctx), "UI").log({
      action: "UPDATE", entity: "ConferenceReturn", entityId: r.id, field: "state", oldValue: "DRAFT", newValue: "SENT",
      note: `${view.label}: membership ${frozen.lines.opening} → ${frozen.closing}, sent ${v.dateSent}`,
    });
  });
}

/** Correct a return after it was sent (the frozen figures are discarded; the audit log keeps them). */
export async function reopenReturn(db: Db, ctx: AuthContext, period: Period, reason: string) {
  assertCan(ctx, "conference_return", "manage");
  const p = periodSchema.parse(period);
  if (!reason.trim()) throw new ValidationError("Say why the return is being reopened.");
  await db.$transaction(async (tx) => {
    const r = await tx.conferenceReturn.findUnique({ where: { year_quarter: { year: p.year, quarter: p.quarter } } });
    if (!r || r.state !== "SENT") throw new ConflictError("This return hasn’t been sent.");
    await tx.conferenceReturn.update({ where: { id: r.id }, data: { state: "DRAFT", figures: Prisma.DbNull, updatedById: ctx.userId } });
    await new AuditWriter(tx, actorFrom(ctx), "UI").log({
      action: "UPDATE", entity: "ConferenceReturn", entityId: r.id, field: "state", oldValue: "SENT", newValue: "DRAFT",
      note: `${reason.trim().slice(0, 250)} (sent figures: ${JSON.stringify(r.figures)})`.slice(0, 1000),
    });
  });
}

/** When the Conference acknowledged receipt. */
export async function setDateReceived(db: Db, ctx: AuthContext, period: Period, date: string | null) {
  assertCan(ctx, "conference_return", "manage");
  const p = periodSchema.parse(period);
  if (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ValidationError("Choose a date.");
  const r = await db.conferenceReturn.findUnique({ where: { year_quarter: { year: p.year, quarter: p.quarter } } });
  if (!r || r.state !== "SENT") throw new ConflictError("Mark the return as sent first.");
  await db.conferenceReturn.update({ where: { id: r.id }, data: { dateReceived: date ? new Date(`${date}T00:00:00Z`) : null, updatedById: ctx.userId } });
}
