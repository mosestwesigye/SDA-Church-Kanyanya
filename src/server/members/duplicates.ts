import type { Prisma } from "@/generated/prisma/client";
import { normalizeUgPhone } from "@/lib/phone";
import { can, memberScopeWhere, type AuthContext } from "../authz/policy";
import type { DbOrTx } from "../db";

export type DuplicateCandidate = {
  id: string;
  memberId: string;
  lastName: string;
  firstName: string;
  zone: string | null;
  similarity: number;
  samePhone: boolean;
  reasons: string[];
};

/** Name similarity at or above this counts as a likely duplicate. */
export const STRONG_SIMILARITY = 0.7;

/**
 * Members that look like the person being entered: trigram similarity on
 * the full name (both name orders, because the register sometimes swaps
 * first and last names) and exact phone matches. Scoped to what the caller
 * may see.
 */
export async function findDuplicateCandidates(
  db: DbOrTx,
  ctx: AuthContext,
  input: { lastName?: string; firstName?: string; phone?: string | null; excludeId?: string },
  limit = 5,
): Promise<DuplicateCandidate[]> {
  const last = (input.lastName ?? "").trim().toLowerCase();
  const first = (input.firstName ?? "").trim().toLowerCase();
  const name = `${last} ${first}`.trim();
  const swapped = `${first} ${last}`.trim();
  const phone = can(ctx, "member.contact", "read") ? normalizeUgPhone(input.phone)?.e164 ?? null : null;
  if (name.length < 4 && !phone) return [];

  const hits = await db.$queryRaw<{ id: string; sim: number; same_phone: boolean }[]>`
    SELECT id,
           GREATEST(similarity(lower("lastName" || ' ' || "firstName"), ${name}),
                    similarity(lower("lastName" || ' ' || "firstName"), ${swapped}))::float AS sim,
           (${phone}::text IS NOT NULL AND "phoneE164" = ${phone}::text) AS same_phone
    FROM "Member"
    WHERE "purgedAt" IS NULL AND "mergedIntoId" IS NULL AND "deletedAt" IS NULL
      AND id <> ${input.excludeId ?? ""}
      AND ((${name.length >= 4} AND lower("lastName" || ' ' || "firstName") % ${name})
        OR (${name.length >= 4} AND lower("lastName" || ' ' || "firstName") % ${swapped})
        OR (${phone}::text IS NOT NULL AND "phoneE164" = ${phone}::text))
    ORDER BY same_phone DESC, sim DESC
    LIMIT 25`;
  if (hits.length === 0) return [];

  const visible = await db.member.findMany({
    where: { AND: [memberScopeWhere(ctx) as Prisma.MemberWhereInput, { id: { in: hits.map((h) => h.id) } }] },
    select: { id: true, memberId: true, lastName: true, firstName: true, zone: can(ctx, "member.profile", "read") ? { select: { label: true } } : false },
  });
  const byId = new Map(visible.map((v) => [v.id, v]));
  return hits
    .filter((h) => byId.has(h.id) && (h.same_phone || h.sim >= 0.45))
    .slice(0, limit)
    .map((h) => {
      const v = byId.get(h.id)!;
      const reasons = [...(h.same_phone ? ["Same phone"] : []), ...(h.sim >= 0.45 ? [`Name ${Math.round(h.sim * 100)}% similar`] : [])];
      return {
        id: v.id,
        memberId: v.memberId,
        lastName: v.lastName,
        firstName: v.firstName,
        zone: (v as { zone?: { label: string } | null }).zone?.label ?? null,
        similarity: h.sim,
        samePhone: h.same_phone,
        reasons,
      };
    });
}

export function isStrongDuplicate(c: DuplicateCandidate) {
  return c.samePhone || c.similarity >= STRONG_SIMILARITY;
}
