import type { Prisma, RawValueField } from "@/generated/prisma/client";
import { isBlankToken, matchListLabel } from "@/lib/normalize";
import { assertCan, memberScopeWhere, type AuthContext } from "../authz/policy";
import type { DbOrTx } from "../db";

const LIVE: Prisma.MemberWhereInput = { deletedAt: null, mergedIntoId: null, purgedAt: null };

function scoped(ctx: AuthContext, extra: Prisma.MemberWhereInput): Prisma.MemberWhereInput {
  assertCan(ctx, "cleanup", "use");
  return { AND: [memberScopeWhere(ctx) as Prisma.MemberWhereInput, LIVE, extra] };
}

export const QUICK_EDIT_SELECT = {
  id: true, memberId: true, lastName: true, firstName: true, version: true, completeness: true, missingFields: true,
  gender: true, dobPrecision: true, dobYear: true, dobDate: true, zoneId: true, phoneRaw: true, phoneE164: true, status: true,
  ministries: { select: { id: true, ministryId: true, roleId: true, ministry: { select: { label: true } }, role: { select: { label: true } } } },
} satisfies Prisma.MemberSelect;

/** Incomplete records queue (fewest missing first = quickest wins). */
export async function incompleteQueue(
  db: DbOrTx,
  ctx: AuthContext,
  opts: { missing?: string; status?: string; sort?: "fewest" | "most"; take?: number; skip?: number },
) {
  const where = scoped(ctx, {
    completeness: { lt: 100 },
    ...(opts.missing ? { missingFields: { has: opts.missing } } : {}),
    ...(opts.status === "NONE" ? { status: null } : opts.status ? { status: opts.status as never } : {}),
  });
  const [total, rows] = await Promise.all([
    db.member.count({ where }),
    db.member.findMany({
      where,
      select: QUICK_EDIT_SELECT,
      orderBy: [{ completeness: opts.sort === "most" ? "asc" : "desc" }, { lastName: "asc" }, { memberNo: "asc" }],
      take: opts.take ?? 25,
      skip: opts.skip ?? 0,
    }),
  ]);
  return { total, rows };
}

export type DuplicatePair = {
  a: string;
  b: string;
  similarity: number;
  samePhone: boolean;
  sameZone: boolean;
  sameBirthYear: boolean;
  differentBirthDate: boolean;
  reasons: string[];
};

/**
 * Suspected duplicate pairs: names ≥ 60% similar (either order) or the same
 * phone, excluding pairs marked "not a duplicate".
 */
export async function duplicatePairs(db: DbOrTx, ctx: AuthContext, limit = 200): Promise<DuplicatePair[]> {
  assertCan(ctx, "cleanup", "use");
  const rows = await db.$queryRaw<{ a: string; b: string; sim: number; same_phone: boolean; same_zone: boolean; same_year: boolean; diff_dob: boolean }[]>`
    WITH m AS (
      SELECT id, lower("lastName" || ' ' || "firstName") AS n, lower("firstName" || ' ' || "lastName") AS rn,
             "phoneE164", "zoneId", "dobYear", "dobDate"
      FROM "Member" WHERE "deletedAt" IS NULL AND "mergedIntoId" IS NULL AND "purgedAt" IS NULL
    )
    SELECT a.id AS a, b.id AS b,
           GREATEST(similarity(a.n, b.n), similarity(a.n, b.rn))::float AS sim,
           (a."phoneE164" IS NOT NULL AND a."phoneE164" = b."phoneE164") AS same_phone,
           (a."zoneId" IS NOT NULL AND a."zoneId" = b."zoneId") AS same_zone,
           (a."dobYear" IS NOT NULL AND a."dobYear" = b."dobYear") AS same_year,
           (a."dobDate" IS NOT NULL AND b."dobDate" IS NOT NULL AND a."dobDate" <> b."dobDate") AS diff_dob
    FROM m a JOIN m b ON a.id < b.id
      AND (a.n % b.n OR a.n % b.rn OR (a."phoneE164" IS NOT NULL AND a."phoneE164" = b."phoneE164"))
    WHERE (GREATEST(similarity(a.n, b.n), similarity(a.n, b.rn)) >= 0.6 OR (a."phoneE164" IS NOT NULL AND a."phoneE164" = b."phoneE164"))
      AND NOT EXISTS (SELECT 1 FROM "DuplicateDismissal" d WHERE d."memberAId" = a.id AND d."memberBId" = b.id)
    ORDER BY same_phone DESC, sim DESC
    LIMIT ${limit * 3}`;
  // Rank: same phone, then name similarity, nudged by zone/birth-year agreement;
  // two different full birth dates usually mean two different people.
  const score = (r: (typeof rows)[number]) => (r.same_phone ? 1 : 0) + r.sim + (r.same_zone ? 0.1 : 0) + (r.same_year ? 0.15 : 0) - (r.diff_dob ? 0.4 : 0);
  rows.sort((x, y) => score(y) - score(x));
  rows.length = Math.min(rows.length, limit);
  // Only pairs where both records are within the caller's scope.
  const ids = [...new Set(rows.flatMap((r) => [r.a, r.b]))];
  const visible = new Set((await db.member.findMany({ where: scoped(ctx, { id: { in: ids } }), select: { id: true } })).map((m) => m.id));
  return rows
    .filter((r) => visible.has(r.a) && visible.has(r.b))
    .map((r) => ({
      a: r.a,
      b: r.b,
      similarity: r.sim,
      samePhone: r.same_phone,
      sameZone: r.same_zone,
      sameBirthYear: r.same_year,
      differentBirthDate: r.diff_dob,
      reasons: [
        ...(r.same_phone ? ["Same phone"] : []),
        ...(r.sim >= 0.6 ? [`Name ${Math.round(r.sim * 100)}% similar`] : []),
        ...(r.same_zone ? ["Same zone"] : []),
        ...(r.same_year ? ["Same birth year"] : []),
        ...(r.diff_dob ? ["Different birth dates"] : []),
      ],
    }));
}

/** Fields whose raw values map onto a controlled list. */
export const LIST_FIELDS: Partial<Record<RawValueField, "ZONE" | "PROFESSION" | "MINISTRY" | "MINISTRY_ROLE">> = {
  ZONE: "ZONE",
  PROFESSION: "PROFESSION",
  MINISTRY: "MINISTRY",
  MINISTRY_ROLE: "MINISTRY_ROLE",
};

export type NonStandardGroup = {
  field: RawValueField;
  suggestion: { kind: "blank" } | { kind: "item"; id: string; label: string } | null;
  values: { normalized: string; examples: string[]; count: number }[];
  total: number;
};

/**
 * Unresolved non-standard values, grouped by field and by the canonical value
 * they most likely mean ("Nil / Nill / Non / None / N/A" → blank).
 */
export async function nonStandardGroups(db: DbOrTx, ctx: AuthContext): Promise<NonStandardGroup[]> {
  assertCan(ctx, "cleanup", "use");
  const raws = await db.rawValue.findMany({
    // Invalid phones have their own queue.
    where: { resolvedAt: null, field: { not: "PHONE" }, member: scoped(ctx, {}) },
    select: { field: true, rawValue: true, normalized: true },
  });
  const items = await db.listItem.findMany({ where: { active: true, mergedIntoId: null }, select: { id: true, label: true, type: true } });

  const byKey = new Map<string, { field: RawValueField; normalized: string; examples: Set<string>; count: number }>();
  for (const r of raws) {
    const k = `${r.field}:${r.normalized}`;
    const e = byKey.get(k) ?? { field: r.field, normalized: r.normalized, examples: new Set<string>(), count: 0 };
    e.examples.add(r.rawValue);
    e.count++;
    byKey.set(k, e);
  }

  const groups = new Map<string, NonStandardGroup>();
  for (const v of byKey.values()) {
    const sample = [...v.examples][0];
    const listType = LIST_FIELDS[v.field];
    let suggestion: NonStandardGroup["suggestion"] = null;
    if (isBlankToken(sample)) suggestion = { kind: "blank" };
    else if (listType) {
      const labels = items.filter((i) => i.type === listType);
      const hit = matchListLabel(sample, labels.map((l) => l.label));
      const item = hit ? labels.find((l) => l.label === hit) : undefined;
      if (item) suggestion = { kind: "item", id: item.id, label: item.label };
    }
    const gk = `${v.field}:${suggestion?.kind === "item" ? suggestion.id : (suggestion?.kind ?? `none:${v.normalized}`)}`;
    const g = groups.get(gk) ?? { field: v.field, suggestion, values: [], total: 0 };
    g.values.push({ normalized: v.normalized, examples: [...v.examples], count: v.count });
    g.total += v.count;
    groups.set(gk, g);
  }
  return [...groups.values()].sort((a, b) => (b.suggestion ? 1 : 0) - (a.suggestion ? 1 : 0) || b.total - a.total);
}

export async function invalidPhoneQueue(db: DbOrTx, ctx: AuthContext, take = 50) {
  const where = scoped(ctx, {
    OR: [
      { phoneRaw: { not: null }, phoneE164: null },
      { nextOfKinPhoneRaw: { not: null }, nextOfKinPhoneE164: null },
    ],
  });
  const [total, rows] = await Promise.all([
    db.member.count({ where }),
    db.member.findMany({
      where,
      take,
      orderBy: [{ lastName: "asc" }],
      select: { id: true, memberId: true, lastName: true, firstName: true, version: true, phoneRaw: true, phoneE164: true },
    }),
  ]);
  return { total, rows };
}

export async function flaggedQueue(db: DbOrTx, ctx: AuthContext) {
  assertCan(ctx, "cleanup", "use");
  return db.reviewFlag.findMany({
    where: { resolvedAt: null, member: scoped(ctx, {}) },
    orderBy: { createdAt: "asc" },
    include: { member: { select: { id: true, memberId: true, lastName: true, firstName: true, completeness: true } } },
  });
}

/** Team progress toward the clean-up target, and who fixed records this week. */
export async function cleanupProgress(db: DbOrTx) {
  const live = { deletedAt: null, mergedIntoId: null, purgedAt: null };
  const [total, complete, target, week] = await Promise.all([
    db.member.count({ where: live }),
    db.member.count({ where: { ...live, completeness: 100 } }),
    db.cleanupTarget.findFirst({ orderBy: { createdAt: "desc" } }),
    db.auditLog.findMany({
      where: { at: { gte: new Date(Date.now() - 7 * 86400_000) }, memberId: { not: null }, source: { in: ["UI", "MERGE"] }, action: { in: ["UPDATE", "CREATE", "MERGE"] }, actorUserId: { not: null } },
      select: { memberId: true, actorLabel: true },
    }),
  ]);
  const fixers = new Map<string, Set<string>>();
  for (const w of week) {
    const s = fixers.get(w.actorLabel) ?? new Set<string>();
    s.add(w.memberId!);
    fixers.set(w.actorLabel, s);
  }
  const year = new Date().getUTCFullYear();
  return {
    total,
    complete,
    percent: total ? Math.round((complete / total) * 100) : 0,
    targetPercent: target?.targetPercent ?? 60,
    dueDate: target?.dueDate ?? new Date(Date.UTC(year, 11, 31)),
    weekRecords: new Set(week.map((w) => w.memberId)).size,
    topFixers: [...fixers.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 3).map(([name, s]) => ({ name, count: s.size })),
  };
}
