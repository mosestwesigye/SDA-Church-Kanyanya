import { z } from "zod";
import type { MembershipStatus, Prisma } from "@/generated/prisma/client";
import { formatDob } from "@/lib/dob";
import { NOT_RECORDED, STATUS_META, type StatusKey } from "@/lib/labels";
import { assertCan, can, memberScopeWhere, type AuthContext } from "../authz/policy";
import { dashboardStats, STATUS_BAR_ORDER } from "../dashboard/stats";
import type { DbOrTx } from "../db";
import { ForbiddenError } from "../errors";
import { directoryQuerySchema, listMembers, type DirectoryRow } from "../members/directory";
import { ministryRoster } from "../ministries/service";
import type { Table } from "../exports/tabular";

/** Hard cap on rows in one report (the whole register is ~1,050). */
export const REPORT_MAX_ROWS = 5000;

export type ReportKey = "quarterly" | "status" | "ministry-roster" | "zones" | "birthdays";

export const REPORTS: Record<ReportKey, { title: string; description: string; needsProfile: boolean }> = {
  quarterly: { title: "Clerk’s quarterly report", description: "Membership at the start and end of a quarter, gains and losses by type, and the register breakdown.", needsProfile: true },
  status: { title: "Membership by status", description: "Counts per membership status with the member list under each.", needsProfile: true },
  "ministry-roster": { title: "Ministry roster", description: "Members of one ministry with their roles and contacts.", needsProfile: false },
  zones: { title: "Zone lists", description: "Members grouped by zone, for zone leaders and visitation.", needsProfile: true },
  birthdays: { title: "Birthday list", description: "Members with a full date of birth whose birthday falls in a month.", needsProfile: true },
};

export const REPORT_KEYS = Object.keys(REPORTS) as ReportKey[];
export const isReportKey = (k: string): k is ReportKey => k in REPORTS;

/** Statuses that count as "on the church books" for the quarterly totals. Not recorded counts as on the books. */
const ON_BOOKS: (MembershipStatus | null)[] = ["ACTIVE", "IRREGULAR", "UNDER_DISCIPLINE", null];
const onBooks = (s: MembershipStatus | null) => ON_BOOKS.includes(s);

export type ReportSection = {
  heading: string;
  note?: string;
  /** Key figures shown as a definition list (and a two-column sheet in Excel). */
  summary?: { label: string; value: string | number }[];
  table?: Table;
};

export type Report = {
  key: ReportKey;
  title: string;
  subtitle: string;
  generatedAt: Date;
  generatedBy: string;
  sections: ReportSection[];
  rowCount: number;
  /** Columns left out because the viewer may not read them. */
  omitted: string[];
};

// ───────── Parameters ─────────

const now = () => new Date();
const currentQuarter = () => Math.floor(now().getUTCMonth() / 3) + 1;

const paramSchemas = {
  quarterly: z.object({
    year: z.coerce.number().int().min(2000).max(2100).catch(() => now().getUTCFullYear()),
    quarter: z.coerce.number().int().min(1).max(4).catch(currentQuarter),
  }),
  status: z.object({ status: z.string().optional().catch(undefined), zone: z.string().optional().catch(undefined) }),
  "ministry-roster": z.object({ ministry: z.string().optional().catch(undefined) }),
  zones: z.object({ zone: z.string().optional().catch(undefined) }),
  birthdays: z.object({ month: z.coerce.number().int().min(1).max(12).catch(() => now().getUTCMonth() + 1) }),
};

export type ReportParams = { [K in ReportKey]: z.infer<(typeof paramSchemas)[K]> };

export function parseReportParams<K extends ReportKey>(key: K, sp: Record<string, string | string[] | undefined>): ReportParams[K] {
  const flat = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]).filter(([, v]) => v !== "" && v !== undefined));
  return paramSchemas[key].parse(flat) as ReportParams[K];
}

// ───────── Shared member columns ─────────

// Projected rows are loosely typed (fields vary by permission).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

type Col = { key: string; label: string; width?: number; group: string; get: (m: Row) => unknown };

const COLS: Record<string, Col> = {
  memberId: { key: "memberId", label: "Member ID", width: 12, group: "member", get: (m) => m.memberId },
  name: { key: "name", label: "Name", width: 28, group: "member", get: (m) => `${m.lastName}, ${m.firstName}` },
  status: { key: "status", label: "Status", width: 16, group: "member.profile", get: (m) => (m.status ? STATUS_META[m.status as StatusKey].label : NOT_RECORDED.label) },
  zone: { key: "zone", label: "Zone", width: 16, group: "member.profile", get: (m) => m.zone?.label ?? "" },
  phone: { key: "phone", label: "Phone", width: 16, group: "member.contact", get: (m) => m.phoneRaw ?? "" },
  dob: { key: "dob", label: "Date of birth", width: 14, group: "member.profile", get: (m) => formatDob(m.dobPrecision, m.dobDate, m.dobYear) ?? "" },
  ministry: { key: "ministry", label: "Ministries", width: 26, group: "member", get: (m) => (m.ministries ?? []).map((l: Row) => l.ministry?.label).filter(Boolean).join(", ") },
};

/** Keep only the columns the viewer may read; report the others as omitted. */
function columnsFor(ctx: AuthContext, keys: string[], omitted: Set<string>): Col[] {
  return keys
    .map((k) => COLS[k]!)
    .filter((c) => {
      const ok = c.group === "member" || can(ctx, c.group as "member.profile", "read");
      if (!ok) omitted.add(c.label);
      return ok;
    });
}

function toTable(title: string, cols: Col[], rows: Row[], extra: Col[] = []): Table {
  const all = [...cols, ...extra];
  return {
    title,
    columns: all.map((c) => ({ key: c.key, label: c.label, width: c.width })),
    rows: rows.map((m) => Object.fromEntries(all.map((c) => [c.key, (m.restricted as string[] | undefined)?.includes(c.group) ? "" : c.get(m)]))),
  };
}

async function members(db: DbOrTx, ctx: AuthContext, q: Partial<z.input<typeof directoryQuerySchema>>): Promise<DirectoryRow[]> {
  const { rows } = await listMembers(db, ctx, directoryQuerySchema.parse(q), { take: REPORT_MAX_ROWS });
  return rows;
}

const statusLabel = (s: string) => (s === "NONE" ? NOT_RECORDED.label : STATUS_META[s as StatusKey].label);
const fmtDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

// ───────── Builders ─────────

export function quarterRange(year: number, quarter: number) {
  const start = new Date(Date.UTC(year, (quarter - 1) * 3, 1));
  const end = new Date(Date.UTC(year, quarter * 3, 0)); // last day of the quarter
  return { start, end };
}

/** Movement of one event: +1 if it put a member on the books, -1 if it took them off, 0 otherwise. */
function movement(e: { fromStatus: MembershipStatus | null; toStatus: MembershipStatus | null }): number {
  if (!e.toStatus) return 0;
  const before = onBooks(e.fromStatus);
  const after = onBooks(e.toStatus);
  return before === after ? 0 : after ? 1 : -1;
}

const EVENT_LABELS: Record<string, string> = {
  BAPTISM: "Baptism",
  PROFESSION_OF_FAITH: "Profession of faith",
  TRANSFER_IN: "Transfer in",
  RESTORATION: "Restoration",
  TRANSFER_OUT: "Transfer out",
  DEATH: "Death",
  DISCIPLINE: "Discipline",
  STATUS_CHANGE: "Other status change",
};

async function quarterly(db: DbOrTx, ctx: AuthContext, p: ReportParams["quarterly"], omitted: Set<string>): Promise<Omit<Report, "generatedAt" | "generatedBy" | "key" | "omitted">> {
  const { start, end } = quarterRange(p.year, p.quarter);
  const endExclusive = new Date(end.getTime() + 86400_000);
  const live: Prisma.MemberWhereInput = { AND: [memberScopeWhere(ctx) as Prisma.MemberWhereInput, { deletedAt: null, mergedIntoId: null, purgedAt: null }] };

  // Members on the books at the start of day `t`: today's status, undoing movement on or after `t`.
  const onBooksAt = async (t: Date) => {
    const [groups, later] = await Promise.all([
      db.member.groupBy({ by: ["status"], where: { AND: [live, { createdAt: { lt: t } }] }, _count: true }),
      db.membershipEvent.findMany({ where: { member: { AND: [live, { createdAt: { lt: t } }] }, occurredOn: { gte: t }, toStatus: { not: null } }, select: { fromStatus: true, toStatus: true } }),
    ]);
    return groups.filter((g) => onBooks(g.status)).reduce((n, g) => n + g._count, 0) - later.reduce((n, e) => n + movement(e), 0);
  };

  const [opening, closing, within, stats] = await Promise.all([
    onBooksAt(start),
    onBooksAt(endExclusive),
    db.membershipEvent.findMany({
      where: { member: live, occurredOn: { gte: start, lt: endExclusive }, toStatus: { not: null } },
      select: { type: true, occurredOn: true, fromStatus: true, toStatus: true, member: { select: { memberId: true, lastName: true, firstName: true } } },
      orderBy: { occurredOn: "asc" },
    }),
    dashboardStats(db, ctx),
  ]);
  const gains = within.filter((e) => movement(e) > 0);
  const losses = within.filter((e) => movement(e) < 0);
  // Whatever the status changes don't explain is records entered (or removed) in the quarter.
  const added = closing - opening - gains.length + losses.length;

  const tally = (list: typeof within) => {
    const m = new Map<string, number>();
    for (const e of list) m.set(EVENT_LABELS[e.type] ?? e.type, (m.get(EVENT_LABELS[e.type] ?? e.type) ?? 0) + 1);
    return [...m].map(([label, value]) => ({ label, value }));
  };
  const cols = columnsFor(ctx, ["memberId", "name"], omitted);
  const movementRows = within.map((e) => ({
    ...e.member,
    date: fmtDate(e.occurredOn!),
    type: EVENT_LABELS[e.type] ?? e.type,
    change: `${e.fromStatus ? statusLabel(e.fromStatus) : NOT_RECORDED.label} → ${statusLabel(e.toStatus!)}`,
    direction: movement(e) > 0 ? "Gain" : movement(e) < 0 ? "Loss" : "—",
  }));
  const extra: Col[] = [
    { key: "date", label: "Date", width: 13, group: "member", get: (m) => m.date },
    { key: "type", label: "Type", width: 18, group: "member", get: (m) => m.type },
    { key: "change", label: "Status change", width: 30, group: "member", get: (m) => m.change },
    { key: "direction", label: "Gain / loss", width: 10, group: "member", get: (m) => m.direction },
  ];

  const pct = (n: number) => (stats.total ? `${n} (${Math.round((n / stats.total) * 100)}%)` : String(n));
  return {
    title: REPORTS.quarterly.title,
    subtitle: `Q${p.quarter} ${p.year} · ${fmtDate(start)} – ${fmtDate(end)}`,
    rowCount: movementRows.length,
    sections: [
      {
        heading: "Membership",
        note: "“On the books” means Active, Irregular, Under discipline or status not recorded. Figures are derived from approved status changes; records entered in the quarter count from the day they were added.",
        summary: [
          { label: "Membership at start of quarter", value: opening },
          { label: "Gains", value: gains.length },
          { label: "Losses", value: losses.length },
          { label: "Records added to the register (net)", value: added },
          { label: "Membership at end of quarter", value: closing },
        ],
      },
      { heading: "Gains by type", summary: gains.length ? tally(gains) : [{ label: "None recorded", value: 0 }] },
      { heading: "Losses by type", summary: losses.length ? tally(losses) : [{ label: "None recorded", value: 0 }] },
      { heading: "Status changes in the quarter", table: toTable("Status changes", cols, movementRows, extra) },
      {
        heading: "Register today",
        note: `Snapshot of the whole register as of ${fmtDate(now())}.`,
        summary: [
          ...stats.status.map((s) => ({ label: statusLabel(s.key), value: s.n })),
          { label: "Female", value: pct(stats.gender[0]!.n) },
          { label: "Male", value: pct(stats.gender[1]!.n) },
          { label: "Gender not recorded", value: stats.gender[2]!.n },
          ...stats.ages.map((a) => ({ label: `Aged ${a.key}`, value: a.n })),
          { label: "Age unknown", value: stats.unknownAge },
          { label: "Complete profiles", value: stats.complete ?? 0 },
        ],
      },
    ],
  };
}

async function byStatus(db: DbOrTx, ctx: AuthContext, p: ReportParams["status"], omitted: Set<string>) {
  const statuses = p.status ? [p.status] : [...STATUS_BAR_ORDER];
  const rows = await members(db, ctx, { status: statuses.join(","), zone: p.zone });
  const cols = columnsFor(ctx, ["memberId", "name", "zone", "phone", "ministry"], omitted);
  const zoneLabel = p.zone ? ((await db.listItem.findUnique({ where: { id: p.zone } }))?.label ?? "Unknown zone") : null;
  const groups = statuses.map((s) => ({ s, list: rows.filter((r) => (r.status ?? "NONE") === s) }));
  return {
    title: REPORTS.status.title,
    subtitle: [p.status ? statusLabel(p.status) : "All statuses", zoneLabel].filter(Boolean).join(" · "),
    rowCount: rows.length,
    sections: [
      { heading: "Summary", summary: [...groups.map((g) => ({ label: statusLabel(g.s), value: g.list.length })), { label: "Total", value: rows.length }] },
      ...groups.filter((g) => g.list.length).map((g) => ({ heading: `${statusLabel(g.s)} (${g.list.length})`, table: toTable(statusLabel(g.s), cols, g.list) })),
    ],
  };
}

async function roster(db: DbOrTx, ctx: AuthContext, p: ReportParams["ministry-roster"], omitted: Set<string>) {
  if (!p.ministry) return { title: REPORTS["ministry-roster"].title, subtitle: "Choose a ministry", rowCount: 0, sections: [] };
  const { ministry, roster } = await ministryRoster(db, ctx, p.ministry);
  const cols = columnsFor(ctx, ["memberId", "name", "phone", "zone", "status"], omitted);
  const rows = roster.map((r) => ({ ...r.member, role: r.role }));
  const role: Col = { key: "role", label: "Role", width: 16, group: "member", get: (m) => m.role };
  const roles = new Map<string, number>();
  for (const r of roster) roles.set(r.role, (roles.get(r.role) ?? 0) + 1);
  return {
    title: `${ministry.label} roster`,
    subtitle: `${roster.length} member${roster.length === 1 ? "" : "s"}`,
    rowCount: rows.length,
    sections: [
      { heading: "Roles", summary: [...roles].map(([label, value]) => ({ label, value })) },
      { heading: "Members", table: toTable(`${ministry.label} roster`, [cols[0]!, cols[1]!, role, ...cols.slice(2)], rows) },
    ],
  };
}

async function zones(db: DbOrTx, ctx: AuthContext, p: ReportParams["zones"], omitted: Set<string>) {
  const rows = await members(db, ctx, { zone: p.zone });
  const cols = columnsFor(ctx, ["memberId", "name", "phone", "status", "ministry"], omitted);
  const order = (await db.listItem.findMany({ where: { type: "ZONE" }, orderBy: [{ sortOrder: "asc" }, { label: "asc" }] })).map((z) => z.label);
  const byZone = new Map<string, DirectoryRow[]>();
  for (const r of rows) {
    const z = (r as Row).zone?.label ?? NOT_RECORDED.label;
    byZone.set(z, [...(byZone.get(z) ?? []), r]);
  }
  const keys = [...byZone.keys()].sort((a, b) => (a === NOT_RECORDED.label ? 1 : b === NOT_RECORDED.label ? -1 : order.indexOf(a) - order.indexOf(b)));
  return {
    title: REPORTS.zones.title,
    subtitle: p.zone ? (keys[0] ?? "No members") : `${keys.length} zones`,
    rowCount: rows.length,
    sections: [
      { heading: "Summary", summary: [...keys.map((k) => ({ label: k, value: byZone.get(k)!.length })), { label: "Total", value: rows.length }] },
      ...keys.map((k) => ({ heading: `${k} (${byZone.get(k)!.length})`, table: toTable(k, cols, byZone.get(k)!) })),
    ],
  };
}

async function birthdays(db: DbOrTx, ctx: AuthContext, p: ReportParams["birthdays"], omitted: Set<string>) {
  const rows = (await members(db, ctx, {}))
    .filter((r) => (r as Row).dobPrecision === "FULL" && (r as Row).dobDate && (r as Row).status !== "DECEASED")
    .filter((r) => ((r as Row).dobDate as Date).getUTCMonth() + 1 === p.month)
    .sort((a, b) => ((a as Row).dobDate as Date).getUTCDate() - ((b as Row).dobDate as Date).getUTCDate() || a.lastName.localeCompare(b.lastName));
  const year = now().getUTCFullYear();
  const cols = columnsFor(ctx, ["memberId", "name", "phone", "zone", "ministry"], omitted);
  const extra: Col[] = [
    { key: "day", label: "Day", width: 8, group: "member", get: (m) => (m.dobDate as Date).getUTCDate() },
    { key: "turns", label: "Turns", width: 8, group: "member", get: (m) => year - (m.dobDate as Date).getUTCFullYear() },
  ];
  const monthName = new Date(Date.UTC(2000, p.month - 1, 1)).toLocaleString("en-GB", { month: "long", timeZone: "UTC" });
  return {
    title: REPORTS.birthdays.title,
    subtitle: `${monthName} ${year} · ${rows.length} birthday${rows.length === 1 ? "" : "s"}`,
    rowCount: rows.length,
    sections: [{ heading: monthName, note: "Members with only a year of birth are not listed.", table: { ...toTable(`Birthdays ${monthName}`, [], rows, [extra[0]!, ...cols, extra[1]!]) } }],
  };
}

/**
 * Build a report for the caller. Rows come from scoped, projected member
 * queries, so a Ministry Head only ever sees their ministries' members and
 * columns from field groups the caller may not read are dropped.
 */
export async function buildReport<K extends ReportKey>(db: DbOrTx, ctx: AuthContext, key: K, params: ReportParams[K]): Promise<Report> {
  assertCan(ctx, "report", "read");
  if (REPORTS[key].needsProfile && !can(ctx, "member.profile", "read")) throw new ForbiddenError("This report needs access to member profiles.");
  const omitted = new Set<string>();
  const body =
    key === "quarterly"
      ? await quarterly(db, ctx, params as ReportParams["quarterly"], omitted)
      : key === "status"
        ? await byStatus(db, ctx, params as ReportParams["status"], omitted)
        : key === "ministry-roster"
          ? await roster(db, ctx, params as ReportParams["ministry-roster"], omitted)
          : key === "zones"
            ? await zones(db, ctx, params as ReportParams["zones"], omitted)
            : await birthdays(db, ctx, params as ReportParams["birthdays"], omitted);
  return { key, ...body, generatedAt: now(), generatedBy: ctx.label, omitted: [...omitted] };
}

/** Reports the caller may open (for the reports index). */
export function availableReports(ctx: AuthContext): ReportKey[] {
  if (!can(ctx, "report", "read")) return [];
  return REPORT_KEYS.filter((k) => !REPORTS[k].needsProfile || can(ctx, "member.profile", "read"));
}
