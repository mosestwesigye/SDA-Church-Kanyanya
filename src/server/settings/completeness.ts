import { computeCompleteness, type CompletenessRules } from "@/lib/completeness";
import { AuditWriter } from "../audit/audit";
import { assertCan, type AuthContext } from "../authz/policy";
import type { Db } from "../db";
import { actorFrom, COMPLETENESS_SELECT } from "../members/service";
import { getCompletenessRules, SETTING_PHOTO_REQUIRED } from "./rules";

/**
 * Recompute the stored completeness of every member under `rules`.
 * Completeness is derived data, so this writes no per-member audit rows.
 * Returns how many members' scores changed.
 */
export async function recomputeAllCompleteness(db: Db, rules: CompletenessRules, batchSize = 250): Promise<number> {
  let changed = 0;
  let cursor = 0;
  for (;;) {
    const batch = await db.member.findMany({
      where: { memberNo: { gt: cursor }, purgedAt: null },
      orderBy: { memberNo: "asc" },
      take: batchSize,
      select: { id: true, memberNo: true, completeness: true, missingFields: true, ...COMPLETENESS_SELECT },
    });
    if (batch.length === 0) return changed;
    cursor = batch[batch.length - 1].memberNo;
    const updates = batch
      .map((m) => ({ m, res: computeCompleteness({ ...m, ministryCount: m._count.ministries }, rules) }))
      .filter(({ m, res }) => m.completeness !== res.percent || m.missingFields.join() !== res.missing.join());
    if (updates.length) {
      await db.$transaction(
        updates.map(({ m, res }) => db.member.update({ where: { id: m.id }, data: { completeness: res.percent, missingFields: res.missing } })),
      );
      changed += updates.length;
    }
  }
}

/** Admin: decide whether a photo counts toward completeness. Audited; rescores every member. */
export async function setPhotoRequired(db: Db, ctx: AuthContext, photoRequired: boolean) {
  assertCan(ctx, "admin.lists", "manage");
  const before = await getCompletenessRules(db);
  if (before.photoRequired === photoRequired) return { changed: 0 };
  await db.$transaction(async (tx) => {
    await tx.appSetting.upsert({
      where: { key: SETTING_PHOTO_REQUIRED },
      create: { key: SETTING_PHOTO_REQUIRED, value: photoRequired },
      update: { value: photoRequired },
    });
    await new AuditWriter(tx, actorFrom(ctx), "UI").log({
      action: "UPDATE",
      entity: "AppSetting",
      entityId: SETTING_PHOTO_REQUIRED,
      field: "value",
      oldValue: before.photoRequired,
      newValue: photoRequired,
      note: photoRequired ? "Photo now counts toward completeness" : "Photo no longer counts toward completeness",
    });
  });
  return { changed: await recomputeAllCompleteness(db, { ...before, photoRequired }) };
}
