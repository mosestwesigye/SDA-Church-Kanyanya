import { z } from "zod";
import type { MembershipStatus, Prisma } from "@/generated/prisma/client";
import { assertCan, can, memberScopeWhere, type AuthContext } from "../authz/policy";
import type { Db, DbOrTx } from "../db";
import { ForbiddenError, ValidationError } from "../errors";
import { canChangeStatus, createStatusRequest } from "../workflows/status";
import { directoryQuerySchema, listMembers, type DirectoryRow } from "./directory";
import { dormantWhere } from "./register";
import { updateMember } from "./service";

/**
 * Dormant members: everyone outside the active register (no status yet, self
 * transferred, under discipline, left the faith, deceased). The clerk works
 * through them here; once Active or Irregular they count again.
 */
export const DORMANT_TABS = [
  { key: "all", label: "All dormant", statuses: ["NONE", "DORMANT", "SELF_TRANSFERRED", "UNDER_DISCIPLINE", "LEFT_THE_FAITH"] },
  { key: "none", label: "Not recorded", statuses: ["NONE"] },
  { key: "dormant", label: "Dormant", statuses: ["DORMANT"] },
  { key: "self", label: "Self transferred", statuses: ["SELF_TRANSFERRED"] },
  { key: "discipline", label: "Under discipline", statuses: ["UNDER_DISCIPLINE"] },
  { key: "left", label: "Left the faith", statuses: ["LEFT_THE_FAITH"] },
  { key: "deceased", label: "Deceased", statuses: ["DECEASED"] },
] as const;
export type DormantTab = (typeof DORMANT_TABS)[number]["key"];

function assertView(ctx: AuthContext) {
  assertCan(ctx, "member", "read");
  if (!can(ctx, "member.profile", "read")) throw new ForbiddenError("The dormant list needs access to member status.");
}

const live = (ctx: AuthContext): Prisma.MemberWhereInput => ({
  AND: [memberScopeWhere(ctx) as Prisma.MemberWhereInput, { deletedAt: null, mergedIntoId: null, purgedAt: null }, dormantWhere],
});

/** Counts per tab (the "all" tab leaves out the deceased). */
export async function dormantCounts(db: DbOrTx, ctx: AuthContext): Promise<Record<DormantTab, number>> {
  assertView(ctx);
  const groups = await db.member.groupBy({ by: ["status"], where: live(ctx), _count: true });
  const n = (s: string) => groups.find((g) => (s === "NONE" ? g.status === null : g.status === s))?._count ?? 0;
  return Object.fromEntries(DORMANT_TABS.map((t) => [t.key, t.statuses.reduce((sum, s) => sum + n(s), 0)])) as Record<DormantTab, number>;
}

export async function listDormant(db: DbOrTx, ctx: AuthContext, p: { tab?: string; q?: string; zone?: string; page?: number }) {
  assertView(ctx);
  const tab = DORMANT_TABS.find((t) => t.key === p.tab) ?? DORMANT_TABS[0];
  const q = directoryQuerySchema.parse({ q: p.q ?? "", status: tab.statuses.join(","), zone: p.zone || undefined, page: p.page ?? 1 });
  const { total, pages, rows } = await listMembers(db, ctx, q);
  const pending = await db.statusChangeRequest.findMany({ where: { state: "PENDING", memberId: { in: rows.map((r) => r.id) } }, select: { memberId: true, toStatus: true } });
  return {
    tab: tab.key as DormantTab,
    total,
    pages,
    page: q.page,
    rows: rows.map((r) => ({ ...(r as DirectoryRow & Record<string, unknown>), pendingTo: pending.find((x) => x.memberId === r.id)?.toStatus ?? null })),
  };
}

const activeStatus = z.enum(["ACTIVE", "IRREGULAR"]);

/**
 * Move dormant members to Active or Irregular. A first status is recorded
 * through the member service; an existing status is changed through the
 * status workflow (restoration for members under discipline), which applies
 * at once and writes the member's history. The deceased, and members with an
 * unfinished request from before, are skipped.
 */
export async function activateMembers(db: Db, ctx: AuthContext, ids: string[], statusInput: string) {
  const status = activeStatus.parse(statusInput);
  if (ids.length === 0) throw new ValidationError("Choose at least one member.");
  if (ids.length > 200) throw new ValidationError("Update at most 200 members at a time.");
  const found = await db.member.findMany({
    where: { AND: [live(ctx), { id: { in: ids } }] },
    select: { id: true, status: true, statusRequests: { where: { state: "PENDING" }, select: { id: true } } },
  });
  if (found.some((m) => m.status !== null && m.status !== "DECEASED") && !canChangeStatus(ctx)) throw new ForbiddenError("You can’t change membership status.");
  const effectiveDate = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Kampala" });
  let done = 0;
  let skipped = ids.length - found.length;
  for (const m of found) {
    if (m.status === "DECEASED" || m.statusRequests.length > 0) {
      skipped++;
    } else if (m.status === null) {
      await updateMember(db, ctx, m.id, { status }, { note: "Status recorded from the dormant list" });
      done++;
    } else {
      const restoration = (m.status as MembershipStatus) === "UNDER_DISCIPLINE" && status === "ACTIVE";
      await createStatusRequest(db, ctx, {
        memberId: m.id,
        type: restoration ? "RESTORATION" : "STATUS_UPDATE",
        ...(restoration ? {} : { toStatus: status }),
        reason: "Status updated from the dormant list",
        effectiveDate,
      });
      done++;
    }
  }
  return { done, skipped };
}
