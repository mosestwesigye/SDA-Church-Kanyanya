import { z } from "zod";
import type { MembershipStatus, Prisma } from "@/generated/prisma/client";
import { REQUIRED_FIELD_LABELS } from "@/lib/completeness";
import { formatDob } from "@/lib/dob";
import { NOT_RECORDED, STATUS_META, type StatusKey } from "@/lib/labels";
import type { Resource } from "../authz/catalog";
import { assertCan, can, memberScopeWhere, type AuthContext } from "../authz/policy";
import { dashboardStats, STATUS_BAR_ORDER } from "../dashboard/stats";
import type { DbOrTx } from "../db";
import { ForbiddenError } from "../errors";
import { KINDS, relationLabel } from "../households/service";
import { MEETING_TYPES } from "../minutes/service";
import { directoryQuerySchema, listMembers, type DirectoryRow } from "../members/directory";
import { ministryRoster } from "../ministries/service";
import type { Table } from "../exports/tabular";

/** Hard cap on rows in one report (the whole register is ~1,050). */
export const REPORT_MAX_ROWS = 5000;

export type ReportKey =
  | "quarterly" | "overview" | "movements" | "status" | "age-groups" | "ministry-roster" | "zones" | "families" | "birthdays" | "data-quality" | "minutes";

export const REPORTS: Record<ReportKey, { title: string; description: string; needsProfile: boolean; needs?: [Resource, string][] }> = {
  quarterly: { title: "Clerk’s quarterly report", description: "Membership at the start and end of a quarter, gains and losses by type, and the register breakdown.", needsProfile: true },
  overview: { title: "Membership overview", description: "The register at a glance: status, gender, age, zones and ministries, with percentages.", needsProfile: true },
  movements: { title: "Membership changes", description: "Baptisms, professions of faith, transfers, deaths and other status changes between two dates.", needsProfile: true },
  status: { title: "Membership by status", description: "Counts per membership status with the member list under each.", needsProfile: true },
  "age-groups": { title: "Age groups", description: "Members by department age group — Adventurers, Pathfinders, Youth, Adults and Senior citizens.", needsProfile: true },
  "ministry-roster": { title: "Ministry roster", description: "Members of one ministry with their roles and contacts.", needsProfile: false },
  zones: { title: "Zone lists", description: "Members grouped by zone, for zone leaders and visitation.", needsProfile: true },
  families: { title: "Families & cells", description: "Every family and cell with its head or leader and members.", needsProfile: true, needs: [["household", "read"], ["member.sensitive", "read"]] },
  birthdays: { title: "Birthday list", description: "Members with a full date of birth whose birthday falls in a month.", needsProfile: true },
  "data-quality": { title: "Records needing attention", description: "Incomplete member records and the details each one is missing, for the clean-up team.", needsProfile: true },
  minutes: { title: "Board minutes register", description: "Minutes recorded for a year: references, dates, approval status and files.", needsProfile: false, needs: [["minutes", "read"]] },
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
  overview: z.object({ zone: z.string().optional().catch(undefined) }),
  movements: z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).catch(() => `${now().getUTCFullYear()}-01-01`),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).catch(() => now().toISOString().slice(0, 10)),
    type: z.string().optional().catch(undefined),
  }),
  "age-groups": z.object({ group: z.string().optional().catch(undefined), zone: z.string().optional().catch(undefined) }),
  families: z.object({}),
  "data-quality": z.object({ zone: z.string().optional().catch(undefined), below: z.coerce.number().int().min(1).max(100).catch(100) }),
  minutes: z.object({ year: z.coerce.number().int().min(2000).max(2100).catch(() => now().getUTCFullYear()) }),
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

// ───────── More reports ─────────

const share = (n: number, total: number) => (total ? `${n.toLocaleString("en-UG")} (${Math.round((n / total) * 100)}%)` : "0");

function ageOf(m: Row, at = now()): number | null {
  if (m.dobPrecision === "FULL" && m.dobDate) {
    const d = m.dobDate as Date;
    let a = at.getUTCFullYear() - d.getUTCFullYear();
    if (at.getUTCMonth() < d.getUTCMonth() || (at.getUTCMonth() === d.getUTCMonth() && at.getUTCDate() < d.getUTCDate())) a--;
    return a;
  }
  return m.dobPrecision === "YEAR" && m.dobYear ? at.getUTCFullYear() - m.dobYear : null;
}

const liveWhere = (ctx: AuthContext, zone?: string): Prisma.MemberWhereInput => ({
  AND: [
    memberScopeWhere(ctx) as Prisma.MemberWhereInput,
    { deletedAt: null, mergedIntoId: null, purgedAt: null },
    ...(zone ? [{ zoneId: zone === "NONE" ? null : zone }] : []),
  ],
});

async function overview(db: DbOrTx, ctx: AuthContext, p: ReportParams["overview"]) {
  const zoneId = p.zone && p.zone !== "NONE" ? p.zone : undefined;
  const where = liveWhere(ctx, p.zone);
  const [stats, byZone, zoneItems, joined] = await Promise.all([
    dashboardStats(db, ctx, { zoneId }),
    db.member.groupBy({ by: ["zoneId"], where, _count: true }),
    db.listItem.findMany({ where: { type: "ZONE" }, select: { id: true, label: true } }),
    db.member.groupBy({ by: ["yearJoined"], where: { AND: [where, { yearJoined: { gte: now().getUTCFullYear() - 4 } }] }, _count: true }),
  ]);
  const total = p.zone === "NONE" ? byZone.reduce((n, z) => n + z._count, 0) : stats.total;
  const zoneLabel = p.zone ? (p.zone === "NONE" ? "Zone not recorded" : (zoneItems.find((z) => z.id === p.zone)?.label ?? "Unknown zone")) : null;
  const zones = byZone
    .map((z) => ({ label: z.zoneId ? (zoneItems.find((i) => i.id === z.zoneId)?.label ?? "Unknown") : NOT_RECORDED.label, value: z._count }))
    .sort((a, b) => (a.label === NOT_RECORDED.label ? 1 : b.label === NOT_RECORDED.label ? -1 : b.value - a.value));
  return {
    title: REPORTS.overview.title,
    subtitle: [zoneLabel ?? "Whole register", `${total.toLocaleString("en-UG")} members`].join(" · "),
    rowCount: total,
    sections: [
      {
        heading: "Register",
        summary: [
          { label: "Members on the register", value: total },
          { label: "Complete profiles", value: share(stats.complete ?? 0, total) },
          { label: "Only name and ID recorded", value: share(stats.nameOnly ?? 0, total) },
          { label: "Ministries with members", value: stats.ministries.length },
        ],
      },
      { heading: "Membership status", summary: stats.status.map((x) => ({ label: statusLabel(x.key), value: share(x.n, total) })) },
      {
        heading: "Gender",
        summary: [
          { label: "Female", value: share(stats.gender[0]!.n, total) },
          { label: "Male", value: share(stats.gender[1]!.n, total) },
          { label: "Not recorded", value: share(stats.gender[2]!.n, total) },
        ],
      },
      { heading: "Age", note: "Members with only a year of birth are counted by that year.", summary: [...stats.ages.map((a) => ({ label: `Aged ${a.key}`, value: share(a.n, total) })), { label: "Age unknown", value: share(stats.unknownAge, total) }] },
      ...(zoneLabel ? [] : [{ heading: "Zones", summary: zones.map((z) => ({ label: z.label, value: share(z.value, total) })) }]),
      { heading: "Ministries", note: "A member can serve in more than one ministry.", summary: stats.ministries.map((m) => ({ label: m.key, value: m.n })) },
      {
        heading: "Year joined (last five years)",
        summary: joined.length
          ? joined.sort((a, b) => (b.yearJoined ?? 0) - (a.yearJoined ?? 0)).map((j) => ({ label: String(j.yearJoined), value: j._count }))
          : [{ label: "None recorded", value: 0 }],
      },
    ],
  };
}

const MOVEMENT_TYPES = ["BAPTISM", "PROFESSION_OF_FAITH", "TRANSFER_IN", "TRANSFER_OUT", "DEATH", "DISCIPLINE", "RESTORATION", "STATUS_CHANGE"] as const;
export const MOVEMENT_TYPE_LABELS = Object.fromEntries(MOVEMENT_TYPES.map((t) => [t, EVENT_LABELS[t]!])) as Record<(typeof MOVEMENT_TYPES)[number], string>;

async function movements(db: DbOrTx, ctx: AuthContext, p: ReportParams["movements"], omitted: Set<string>) {
  let from = new Date(`${p.from}T00:00:00Z`);
  let to = new Date(`${p.to}T00:00:00Z`);
  if (from > to) [from, to] = [to, from];
  const type = p.type && (MOVEMENT_TYPES as readonly string[]).includes(p.type) ? (p.type as (typeof MOVEMENT_TYPES)[number]) : undefined;
  const events = await db.membershipEvent.findMany({
    where: { member: liveWhere(ctx), occurredOn: { gte: from, lt: new Date(to.getTime() + 86400_000) }, type: type ? type : { in: [...MOVEMENT_TYPES] } },
    select: { type: true, occurredOn: true, fromStatus: true, toStatus: true, title: true, member: { select: { memberId: true, lastName: true, firstName: true } } },
    orderBy: [{ occurredOn: "asc" }, { createdAt: "asc" }],
    take: REPORT_MAX_ROWS,
  });
  const cols = columnsFor(ctx, ["memberId", "name"], omitted);
  const rows = events.map((e) => ({
    ...e.member,
    date: fmtDate(e.occurredOn!),
    type: EVENT_LABELS[e.type] ?? e.type,
    change: e.toStatus ? `${e.fromStatus ? statusLabel(e.fromStatus) : NOT_RECORDED.label} → ${statusLabel(e.toStatus)}` : e.title,
    direction: movement(e) > 0 ? "Gain" : movement(e) < 0 ? "Loss" : "—",
  }));
  const tally = new Map<string, number>();
  for (const r of rows) tally.set(r.type, (tally.get(r.type) ?? 0) + 1);
  const gains = rows.filter((r) => r.direction === "Gain").length;
  const losses = rows.filter((r) => r.direction === "Loss").length;
  const extra: Col[] = [
    { key: "date", label: "Date", width: 13, group: "member", get: (m) => m.date },
    { key: "type", label: "Type", width: 18, group: "member", get: (m) => m.type },
    { key: "change", label: "Change", width: 30, group: "member", get: (m) => m.change },
    { key: "direction", label: "Gain / loss", width: 10, group: "member", get: (m) => m.direction },
  ];
  return {
    title: REPORTS.movements.title,
    subtitle: `${fmtDate(from)} – ${fmtDate(to)}${type ? ` · ${EVENT_LABELS[type]}` : ""}`,
    rowCount: rows.length,
    sections: [
      { heading: "Summary", summary: [{ label: "Changes recorded", value: rows.length }, { label: "Gains to membership", value: gains }, { label: "Losses from membership", value: losses }, { label: "Net change", value: gains - losses }] },
      { heading: "By type", summary: tally.size ? [...tally].map(([label, value]) => ({ label, value })) : [{ label: "None recorded", value: 0 }] },
      { heading: "Changes", table: toTable("Membership changes", [extra[0]!, ...cols, extra[1]!, extra[2]!, extra[3]!], rows) },
    ],
  };
}

export const AGE_GROUPS = [
  { key: "children", label: "Children (0–3)", min: 0, max: 3 },
  { key: "adventurers", label: "Adventurers (4–9)", min: 4, max: 9 },
  { key: "pathfinders", label: "Pathfinders (10–15)", min: 10, max: 15 },
  { key: "youth", label: "Youth & Ambassadors (16–35)", min: 16, max: 35 },
  { key: "adults", label: "Adults (36–59)", min: 36, max: 59 },
  { key: "seniors", label: "Senior citizens (60+)", min: 60, max: 200 },
] as const;

async function ageGroups(db: DbOrTx, ctx: AuthContext, p: ReportParams["age-groups"], omitted: Set<string>) {
  const groups = p.group ? AGE_GROUPS.filter((g) => g.key === p.group) : AGE_GROUPS;
  const rows = (await members(db, ctx, { zone: p.zone }))
    .filter((r) => (r as Row).status !== "DECEASED")
    .map((r) => ({ ...(r as Row), age: ageOf(r as Row) }));
  const unknown = rows.filter((r) => r.age === null).length;
  const cols = columnsFor(ctx, ["memberId", "name", "phone", "zone", "ministry"], omitted);
  const extra: Col[] = [
    { key: "age", label: "Age", width: 6, group: "member.profile", get: (m) => m.age },
    { key: "gender", label: "Gender", width: 9, group: "member.profile", get: (m) => (m.gender === "FEMALE" ? "Female" : m.gender === "MALE" ? "Male" : "") },
  ];
  const sorted = (list: Row[]) => list.sort((a, b) => a.age - b.age || a.lastName.localeCompare(b.lastName));
  const lists = groups.map((g) => ({ g, list: sorted(rows.filter((r) => r.age !== null && r.age >= g.min && r.age <= g.max)) }));
  const listed = lists.reduce((n, l) => n + l.list.length, 0);
  return {
    title: REPORTS["age-groups"].title,
    subtitle: [p.group ? groups[0]?.label : "All age groups", `${listed} member${listed === 1 ? "" : "s"}`].join(" · "),
    rowCount: lists.reduce((n, l) => n + l.list.length, 0),
    sections: [
      {
        heading: "Summary",
        note: "Age is worked out today from the date of birth; members with only a year of birth use that year. Deceased members are left out.",
        summary: [...lists.map((l) => ({ label: l.g.label, value: l.list.length })), ...(p.group ? [] : [{ label: "Age unknown", value: unknown }])],
      },
      ...lists.filter((l) => l.list.length).map((l) => ({ heading: `${l.g.label} — ${l.list.length}`, table: toTable(l.g.label, [cols[0]!, cols[1]!, extra[0]!, extra[1]!, ...cols.slice(2)], l.list) })),
    ],
  };
}

async function families(db: DbOrTx, ctx: AuthContext, omitted: Set<string>) {
  const scope = liveWhere(ctx);
  const households = await db.household.findMany({
    where: { members: { some: { member: scope } } },
    orderBy: [{ kind: "asc" }, { name: "asc" }],
    include: {
      members: {
        where: { member: scope },
        include: { member: { select: { memberId: true, lastName: true, firstName: true, phoneRaw: true, zone: { select: { label: true } } } } },
      },
    },
  });
  const order: Record<string, number> = { HEAD: 0, SPOUSE: 1, CHILD: 2, DEPENDANT: 3, OTHER: 4 };
  const cols = columnsFor(ctx, ["memberId", "name", "phone", "zone"], omitted);
  const relation: Col = { key: "relation", label: "Role", width: 20, group: "member", get: (m) => m.relation };
  const placed = households.reduce((n, h) => n + h.members.length, 0);
  return {
    title: REPORTS.families.title,
    subtitle: `${households.filter((h) => h.kind === "FAMILY").length} families · ${households.filter((h) => h.kind === "CELL").length} cells · ${placed} members`,
    rowCount: placed,
    sections: [
      {
        heading: "Summary",
        summary: [
          { label: "Families", value: households.filter((h) => h.kind === "FAMILY").length },
          { label: "Cells", value: households.filter((h) => h.kind === "CELL").length },
          { label: "Members placed", value: placed },
          { label: "Without a head or leader", value: households.filter((h) => !h.members.some((m) => m.relation === "HEAD")).length },
        ],
      },
      ...households.map((h) => ({
        heading: `${KINDS[h.kind].title}: ${h.name} — ${h.members.length}`,
        table: toTable(
          h.name,
          [cols[0]!, cols[1]!, relation, ...cols.slice(2)],
          h.members.sort((a, b) => order[a.relation]! - order[b.relation]! || a.member.lastName.localeCompare(b.member.lastName)).map((m) => ({ ...m.member, relation: relationLabel(h.kind, m.relation) })),
        ),
      })),
    ],
  };
}

async function dataQuality(db: DbOrTx, ctx: AuthContext, p: ReportParams["data-quality"], omitted: Set<string>) {
  const pctOf = (r: DirectoryRow) => ((r as Row).completeness ?? 0) as number;
  const incomplete = await members(db, ctx, { zone: p.zone, profile: "incomplete" });
  const rows = incomplete.filter((r) => pctOf(r) < p.below).sort((a, b) => pctOf(a) - pctOf(b) || a.lastName.localeCompare(b.lastName));
  const all = await db.member.count({ where: liveWhere(ctx, p.zone) });
  const missing = new Map<string, number>();
  for (const r of rows) for (const f of ((r as Row).missingFields ?? []) as string[]) missing.set(f, (missing.get(f) ?? 0) + 1);
  const label = (f: string) => REQUIRED_FIELD_LABELS[f as keyof typeof REQUIRED_FIELD_LABELS] ?? f;
  const cols = columnsFor(ctx, ["memberId", "name", "zone", "phone"], omitted);
  const extra: Col[] = [
    { key: "completeness", label: "Complete", width: 9, group: "member.profile", get: (m) => `${m.completeness ?? 0}%` },
    { key: "missing", label: "Missing", width: 48, group: "member.profile", get: (m) => ((m.missingFields ?? []) as string[]).map(label).join(", ") },
  ];
  const bands = [[0, 15, "Only name and ID (0–15%)"], [16, 49, "Mostly missing (16–49%)"], [50, 79, "Partly complete (50–79%)"], [80, 99, "Nearly complete (80–99%)"]] as const;
  return {
    title: REPORTS["data-quality"].title,
    subtitle: `${rows.length.toLocaleString("en-UG")} of ${all.toLocaleString("en-UG")} records${p.below < 100 ? ` below ${p.below}% complete` : " incomplete"}`,
    rowCount: rows.length,
    sections: [
      {
        heading: "How complete the records are",
        summary: [
          { label: "Records in scope", value: all },
          { label: "Complete (100%)", value: share(all - incomplete.length, all) },
          ...bands.map(([lo, hi, l]) => ({ label: l, value: incomplete.filter((r) => pctOf(r) >= lo && pctOf(r) <= hi).length })),
        ],
      },
      { heading: "Most often missing", note: "Among the records listed below.", summary: [...missing].sort((a, b) => b[1] - a[1]).map(([f, n]) => ({ label: label(f), value: share(n, rows.length) })) },
      { heading: "Records to complete", note: "Least complete first. Open Data clean-up to fill these in quickly.", table: toTable("Records needing attention", cols, rows, extra) },
    ],
  };
}

async function minutesRegister(db: DbOrTx, ctx: AuthContext, p: ReportParams["minutes"]) {
  assertCan(ctx, "minutes", "read");
  const list = await db.meetingMinutes.findMany({
    where: { deletedAt: null, heldOn: { gte: new Date(Date.UTC(p.year, 0, 1)), lt: new Date(Date.UTC(p.year + 1, 0, 1)) } },
    orderBy: [{ heldOn: "asc" }, { reference: "asc" }],
    include: { files: { where: { deletedAt: null }, select: { id: true } } },
  });
  const approved = list.filter((m) => m.status === "APPROVED").length;
  const byType = new Map<string, number>();
  for (const m of list) byType.set(MEETING_TYPES[m.type].label, (byType.get(MEETING_TYPES[m.type].label) ?? 0) + 1);
  return {
    title: REPORTS.minutes.title,
    subtitle: `${p.year} · ${list.length} meeting${list.length === 1 ? "" : "s"}`,
    rowCount: list.length,
    sections: [
      {
        heading: "Summary",
        summary: [
          { label: "Meetings recorded", value: list.length },
          { label: "Minutes approved", value: approved },
          { label: "Awaiting approval", value: list.length - approved },
          { label: "Without a file", value: list.filter((m) => m.files.length === 0).length },
          ...[...byType].map(([label, value]) => ({ label, value })),
        ],
      },
      {
        heading: "Register",
        table: {
          title: `Minutes ${p.year}`,
          columns: [
            { key: "reference", label: "Reference", width: 14 },
            { key: "date", label: "Meeting date", width: 14 },
            { key: "title", label: "Meeting", width: 32 },
            { key: "chair", label: "Chairperson", width: 20 },
            { key: "status", label: "Status", width: 16 },
            { key: "approvedOn", label: "Approved", width: 14 },
            { key: "files", label: "Files", width: 7 },
          ],
          rows: list.map((m) => ({
            reference: m.reference,
            date: fmtDate(m.heldOn),
            title: m.title,
            chair: m.chairperson ?? "",
            status: m.status === "APPROVED" ? "Approved" : "Awaiting approval",
            approvedOn: m.approvedOn ? fmtDate(m.approvedOn) : "",
            files: m.files.length,
          })),
        },
      },
    ],
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
  for (const [resource, action] of REPORTS[key].needs ?? []) {
    if (!can(ctx, resource, action)) throw new ForbiddenError("You don’t have access to this report.");
  }
  const builders: { [R in ReportKey]: (p: ReportParams[R]) => Promise<Omit<Report, "generatedAt" | "generatedBy" | "key" | "omitted">> } = {
    quarterly: (p) => quarterly(db, ctx, p, omitted),
    overview: (p) => overview(db, ctx, p),
    movements: (p) => movements(db, ctx, p, omitted),
    status: (p) => byStatus(db, ctx, p, omitted),
    "age-groups": (p) => ageGroups(db, ctx, p, omitted),
    "ministry-roster": (p) => roster(db, ctx, p, omitted),
    zones: (p) => zones(db, ctx, p, omitted),
    families: () => families(db, ctx, omitted),
    birthdays: (p) => birthdays(db, ctx, p, omitted),
    "data-quality": (p) => dataQuality(db, ctx, p, omitted),
    minutes: (p) => minutesRegister(db, ctx, p),
  };
  const body = await (builders[key] as (p: ReportParams[K]) => ReturnType<(typeof builders)["quarterly"]>)(params);
  return { key, ...body, generatedAt: now(), generatedBy: ctx.label, omitted: [...omitted] };
}

/** Reports the caller may open (for the reports index). */
export function availableReports(ctx: AuthContext): ReportKey[] {
  if (!can(ctx, "report", "read")) return [];
  return REPORT_KEYS.filter(
    (k) => (!REPORTS[k].needsProfile || can(ctx, "member.profile", "read")) && (REPORTS[k].needs ?? []).every(([r, a]) => can(ctx, r, a)),
  );
}
