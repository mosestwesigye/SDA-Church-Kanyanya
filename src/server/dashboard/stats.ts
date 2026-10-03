import type { Prisma } from "@/generated/prisma/client";
import { can, memberScopeWhere, type AuthContext } from "../authz/policy";
import type { DbOrTx } from "../db";

/**
 * Stacked-bar order for statuses, chosen with the dataviz palette validator so
 * no two adjacent segments are hard to tell apart (incl. colour-blind vision).
 */
export const STATUS_BAR_ORDER = ["ACTIVE", "LEFT_THE_FAITH", "IRREGULAR", "SELF_TRANSFERRED", "UNDER_DISCIPLINE", "NONE", "DECEASED"] as const;

export const AGE_BANDS = [
  { key: "0–17", min: 0, max: 17 },
  { key: "18–35", min: 18, max: 35 },
  { key: "36–59", min: 36, max: 59 },
  { key: "60+", min: 60, max: 200 },
] as const;

type Count = { key: string | null; n: number };

/**
 * Dashboard figures, scoped to what the caller may see. Profile-level
 * breakdowns (status, gender, age, zone) need member.profile:read.
 */
export async function dashboardStats(db: DbOrTx, ctx: AuthContext, opts: { zoneId?: string } = {}) {
  const base: Prisma.MemberWhereInput = {
    AND: [memberScopeWhere(ctx) as Prisma.MemberWhereInput, { deletedAt: null, mergedIntoId: null, purgedAt: null }, ...(opts.zoneId ? [{ zoneId: opts.zoneId }] : [])],
  };
  const profile = can(ctx, "member.profile", "read");

  const [total, complete, nameOnly, byStatus, byGender, byZone, byMinistry, dobRows, zones, ministryCount] = await Promise.all([
    db.member.count({ where: base }),
    profile ? db.member.count({ where: { AND: [base, { completeness: 100 }] } }) : null,
    profile ? db.member.count({ where: { AND: [base, { completeness: { lte: 15 } }] } }) : null,
    profile ? db.member.groupBy({ by: ["status"], where: base, _count: true }) : [],
    profile ? db.member.groupBy({ by: ["gender"], where: base, _count: true }) : [],
    profile ? db.member.groupBy({ by: ["zoneId"], where: base, _count: true }) : [],
    db.memberMinistry.groupBy({ by: ["ministryId"], where: { member: base }, _count: { memberId: true } }),
    profile ? db.member.findMany({ where: base, select: { dobPrecision: true, dobDate: true, dobYear: true } }) : [],
    db.listItem.findMany({ where: { type: "ZONE" }, select: { id: true, label: true } }),
    db.listItem.count({ where: { type: "MINISTRY", active: true } }),
  ]);
  const ministries = await db.listItem.findMany({ where: { type: "MINISTRY" }, select: { id: true, label: true } });
  const label = (list: { id: string; label: string }[], id: string | null) => (id ? (list.find((l) => l.id === id)?.label ?? "Unknown") : null);

  // Age bands (year-only DOBs give an approximate age; unknown counted separately).
  const now = new Date();
  const age = (r: { dobPrecision: string; dobDate: Date | null; dobYear: number | null }) => {
    if (r.dobPrecision === "FULL" && r.dobDate) {
      let a = now.getUTCFullYear() - r.dobDate.getUTCFullYear();
      if (now.getUTCMonth() < r.dobDate.getUTCMonth() || (now.getUTCMonth() === r.dobDate.getUTCMonth() && now.getUTCDate() < r.dobDate.getUTCDate())) a--;
      return a;
    }
    return r.dobPrecision === "YEAR" && r.dobYear ? now.getUTCFullYear() - r.dobYear : null;
  };
  const ages = AGE_BANDS.map((b) => ({ key: b.key, n: 0 }));
  let unknownAge = 0;
  for (const r of dobRows) {
    const a = age(r);
    if (a === null) unknownAge++;
    else ages[AGE_BANDS.findIndex((b) => a >= b.min && a <= b.max)]!.n++;
  }

  const zoneCounts: Count[] = byZone.map((z) => ({ key: label(zones, z.zoneId), n: z._count })).sort((a, b) => b.n - a.n);
  const named = zoneCounts.filter((z) => z.key !== null);
  const TOP_ZONES = 7;

  return {
    total,
    complete,
    nameOnly,
    profile,
    status: STATUS_BAR_ORDER.map((s) => ({ key: s, n: byStatus.find((x) => (s === "NONE" ? x.status === null : x.status === s))?._count ?? 0 })),
    gender: [
      { key: "FEMALE", n: byGender.find((g) => g.gender === "FEMALE")?._count ?? 0 },
      { key: "MALE", n: byGender.find((g) => g.gender === "MALE")?._count ?? 0 },
      { key: "NONE", n: byGender.find((g) => g.gender === null)?._count ?? 0 },
    ],
    ages,
    unknownAge,
    zones: [
      ...named.slice(0, TOP_ZONES),
      ...(named.length > TOP_ZONES ? [{ key: "Other", n: named.slice(TOP_ZONES).reduce((s, z) => s + z.n, 0) }] : []),
      { key: "Not recorded", n: zoneCounts.find((z) => z.key === null)?.n ?? 0 },
    ],
    ministries: byMinistry.map((m) => ({ key: label(ministries, m.ministryId) ?? "Unknown", n: m._count.memberId })).sort((a, b) => b.n - a.n),
    ministryCount,
    zoneOptions: zones.sort((a, b) => a.label.localeCompare(b.label)),
  };
}

/** Days from `today` (Kampala calendar date) to the next birthday; 29 Feb counts as 28 Feb in common years. */
export function daysToBirthday(dob: Date, today: { y: number; m: number; d: number }): number {
  const target = (year: number) => {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    const m = dob.getUTCMonth();
    const d = m === 1 && dob.getUTCDate() === 29 && !leap ? 28 : dob.getUTCDate();
    return Date.UTC(year, m, d);
  };
  const t = Date.UTC(today.y, today.m, today.d);
  let next = target(today.y);
  if (next < t) next = target(today.y + 1);
  return Math.round((next - t) / 86400_000);
}

function kampalaToday() {
  const [y, m, d] = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Kampala" }).split("-").map(Number);
  return { y, m: m - 1, d };
}

/** Members with a full date of birth whose birthday falls in the next `days` days (year-only DOBs excluded). */
export async function upcomingBirthdays(db: DbOrTx, ctx: AuthContext, days = 7, limit = 8) {
  if (!can(ctx, "member.profile", "read")) return [];
  const rows = await db.member.findMany({
    where: {
      AND: [
        memberScopeWhere(ctx) as Prisma.MemberWhereInput,
        { dobPrecision: "FULL", dobDate: { not: null }, deletedAt: null, mergedIntoId: null, purgedAt: null, OR: [{ status: null }, { status: { not: "DECEASED" } }] },
      ],
    },
    select: { id: true, lastName: true, firstName: true, dobDate: true, ministries: { take: 1, select: { ministry: { select: { label: true } } } } },
  });
  const today = kampalaToday();
  return rows
    .map((m) => ({ m, d: daysToBirthday(m.dobDate!, today) }))
    .filter((x) => x.d <= days)
    .sort((a, b) => a.d - b.d || a.m.lastName.localeCompare(b.m.lastName))
    .slice(0, limit)
    .map(({ m, d }) => {
      const nextYear = today.y + (Date.UTC(today.y, m.dobDate!.getUTCMonth(), m.dobDate!.getUTCDate()) < Date.UTC(today.y, today.m, today.d) ? 1 : 0);
      return {
        id: m.id,
        name: `${m.firstName} ${m.lastName}`.trim(),
        inDays: d,
        day: m.dobDate!.getUTCDate(),
        month: m.dobDate!.toLocaleString("en-GB", { month: "short", timeZone: "UTC" }).toUpperCase(),
        turns: nextYear - m.dobDate!.getUTCFullYear(),
        ministry: m.ministries[0]?.ministry.label ?? null,
      };
    });
}

/** Recent changes for the activity feed (requires audit:read). */
export async function recentActivity(db: DbOrTx, ctx: AuthContext, limit = 5) {
  if (!can(ctx, "audit", "read")) return [];
  const rows = await db.auditLog.findMany({
    where: { action: { in: ["UPDATE", "CREATE", "MERGE", "APPROVE", "REJECT", "DELETE", "RESTORE", "PURGE"] }, entity: { in: ["Member", "StatusChangeRequest", "CorrectionRequest", "ImportBatch"] }, source: { not: "IMPORT" } },
    orderBy: { id: "desc" },
    take: 60,
  });
  // Collapse per-field rows of one change into one line.
  const seen = new Set<string>();
  const out: typeof rows = [];
  for (const r of rows) {
    const k = `${r.correlationId}:${r.memberId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
    if (out.length >= limit) break;
  }
  const members = new Map(
    (await db.member.findMany({ where: { id: { in: out.map((o) => o.memberId).filter((x): x is string => Boolean(x)) } }, select: { id: true, memberId: true, lastName: true, firstName: true } })).map((m) => [m.id, m]),
  );
  return out.map((r) => ({ ...r, id: r.id.toString(), member: r.memberId ? (members.get(r.memberId) ?? null) : null }));
}
