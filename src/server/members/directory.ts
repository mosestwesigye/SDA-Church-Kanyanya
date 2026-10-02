import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { can, memberScopeWhere, memberSelect, projectMember, type AuthContext } from "../authz/policy";
import type { DbOrTx } from "../db";

export const PAGE_SIZE = 25;

const csv = z
  .string()
  .optional()
  .transform((v) => (v ? v.split(",").filter(Boolean) : []));

/** Directory query, parsed from URL search params (also used by saved views and export). */
export const directoryQuerySchema = z.object({
  q: z.string().trim().max(80).optional().default(""),
  status: csv, // ACTIVE,… or NONE for "not recorded"
  ministry: csv,
  zone: csv, // list ids or NONE
  gender: z.enum(["MALE", "FEMALE", "NONE"]).optional(),
  marital: csv,
  profile: z.enum(["complete", "incomplete", "nameonly"]).optional(),
  flagged: z.enum(["1"]).optional(),
  deleted: z.enum(["1"]).optional(),
  sort: z.enum(["name", "id", "completeness", "updated"]).optional().default("name"),
  dir: z.enum(["asc", "desc"]).optional().default("asc"),
  page: z.coerce.number().int().min(1).optional().default(1),
});
export type DirectoryQuery = z.infer<typeof directoryQuerySchema>;

export function parseDirectoryQuery(sp: Record<string, string | string[] | undefined>): DirectoryQuery {
  const flat = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : v]));
  const r = directoryQuerySchema.safeParse(flat);
  return r.success ? r.data : directoryQuerySchema.parse({});
}

/** Serialise a query back to a search string (drops defaults). */
export function toSearch(q: Partial<DirectoryQuery>, extra: Record<string, string | undefined> = {}): string {
  const p = new URLSearchParams();
  const put = (k: string, v: unknown) => {
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) return;
    p.set(k, Array.isArray(v) ? v.join(",") : String(v));
  };
  put("q", q.q);
  put("status", q.status);
  put("ministry", q.ministry);
  put("zone", q.zone);
  put("gender", q.gender);
  put("marital", q.marital);
  put("profile", q.profile);
  put("flagged", q.flagged);
  put("deleted", q.deleted);
  if (q.sort && q.sort !== "name") put("sort", q.sort);
  if (q.dir && q.dir !== "asc") put("dir", q.dir);
  if (q.page && q.page > 1) put("page", q.page);
  for (const [k, v] of Object.entries(extra)) put(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Prisma where for a directory query, respecting scope and field-level permissions. */
export function directoryWhere(ctx: AuthContext, q: DirectoryQuery): Prisma.MemberWhereInput {
  const and: Prisma.MemberWhereInput[] = [memberScopeWhere(ctx) as Prisma.MemberWhereInput, { mergedIntoId: null, purgedAt: null }];
  const profile = can(ctx, "member.profile", "read");
  const contact = can(ctx, "member.contact", "read");
  const sensitive = can(ctx, "member.sensitive", "read");

  and.push(q.deleted && can(ctx, "member", "restore") ? { deletedAt: { not: null } } : { deletedAt: null });

  const text = q.q.trim();
  if (text) {
    const idMatch = text.toUpperCase().replace(/\s+/g, "").match(/^(?:SDAK\/?)?M?(\d{1,6})$/);
    const digits = text.replace(/\D/g, "");
    const or: Prisma.MemberWhereInput[] = [];
    if (idMatch) or.push({ memberNo: Number(idMatch[1]) });
    if (contact && digits.length >= 6) {
      const tail = digits.replace(/^(256|0)/, "");
      or.push({ phoneE164: { contains: tail } }, { phoneRaw: { contains: text } });
    }
    const tokens = text.split(/[\s,]+/).filter((t) => /[a-z]/i.test(t));
    if (tokens.length) {
      or.push({
        AND: tokens.map((t) => ({
          OR: [{ lastName: { contains: t, mode: "insensitive" as const } }, { firstName: { contains: t, mode: "insensitive" as const } }],
        })),
      });
    }
    and.push(or.length ? { OR: or } : { id: "__none__" });
  }

  if (profile) {
    if (q.status.length) {
      const named = q.status.filter((s) => s !== "NONE") as Prisma.EnumMembershipStatusFilter["in"];
      and.push({ OR: [...(named?.length ? [{ status: { in: named } }] : []), ...(q.status.includes("NONE") ? [{ status: null }] : [])] });
    }
    if (q.zone.length) {
      const ids = q.zone.filter((z) => z !== "NONE");
      and.push({ OR: [...(ids.length ? [{ zoneId: { in: ids } }] : []), ...(q.zone.includes("NONE") ? [{ zoneId: null }] : [])] });
    }
    if (q.gender) and.push({ gender: q.gender === "NONE" ? null : q.gender });
    if (q.profile === "complete") and.push({ completeness: 100 });
    if (q.profile === "incomplete") and.push({ completeness: { lt: 100 } });
    if (q.profile === "nameonly") and.push({ completeness: { lte: 15 } });
  }
  if (sensitive && q.marital.length) {
    const named = q.marital.filter((m) => m !== "NONE") as Prisma.EnumMaritalStatusNullableFilter["in"];
    and.push({ OR: [...(named?.length ? [{ maritalStatus: { in: named } }] : []), ...(q.marital.includes("NONE") ? [{ maritalStatus: null }] : [])] });
  }
  if (q.ministry.length) and.push({ ministries: { some: { ministryId: { in: q.ministry } } } });
  if (q.flagged && can(ctx, "cleanup", "use")) and.push({ reviewFlags: { some: { resolvedAt: null } } });
  return { AND: and };
}

function orderBy(ctx: AuthContext, q: DirectoryQuery): Prisma.MemberOrderByWithRelationInput[] {
  const dir = q.dir;
  switch (q.sort) {
    case "id":
      return [{ memberNo: dir }];
    case "completeness":
      return can(ctx, "member.profile", "read") ? [{ completeness: dir }, { lastName: "asc" }] : [{ lastName: dir }];
    case "updated":
      return [{ updatedAt: dir }];
    default:
      return [{ lastName: dir }, { firstName: dir }, { memberNo: "asc" }];
  }
}

export type DirectoryRow = ReturnType<typeof projectMember<Record<string, unknown> & { id: string }>> & {
  memberId: string;
  lastName: string;
  firstName: string;
};

export async function listMembers(db: DbOrTx, ctx: AuthContext, q: DirectoryQuery, opts: { take?: number; ids?: string[] } = {}) {
  const where = directoryWhere(ctx, q);
  if (opts.ids) (where.AND as Prisma.MemberWhereInput[]).push({ id: { in: opts.ids } });
  const take = opts.take ?? PAGE_SIZE;
  const skip = opts.take ? 0 : (q.page - 1) * PAGE_SIZE;
  const [total, rows] = await Promise.all([
    db.member.count({ where }),
    db.member.findMany({ where, select: memberSelect(ctx) as Prisma.MemberSelect, orderBy: orderBy(ctx, q), skip, take }),
  ]);
  return {
    total,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    rows: rows.map((r) => projectMember(ctx, r as unknown as { id: string; ministries: { ministryId: string }[] } & Record<string, unknown>)) as unknown as DirectoryRow[],
  };
}

export async function countWhere(db: DbOrTx, ctx: AuthContext, q: Partial<DirectoryQuery>): Promise<number> {
  return db.member.count({ where: directoryWhere(ctx, { ...directoryQuerySchema.parse({}), ...q }) });
}
