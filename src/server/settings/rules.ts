import { DEFAULT_COMPLETENESS_RULES, type CompletenessRules } from "@/lib/completeness";
import type { DbOrTx } from "../db";

export const SETTING_PHOTO_REQUIRED = "completeness.photoRequired";

/** Current completeness rules from AppSetting (falls back to the defaults). */
export async function getCompletenessRules(db: DbOrTx): Promise<CompletenessRules> {
  const row = await db.appSetting.findUnique({ where: { key: SETTING_PHOTO_REQUIRED } });
  return {
    photoRequired: typeof row?.value === "boolean" ? row.value : DEFAULT_COMPLETENESS_RULES.photoRequired,
  };
}
