import { db } from "@/server/db";

/** Controlled-list options for the member form. */
export async function formOptions() {
  const items = await db.listItem.findMany({
    where: { active: true, mergedIntoId: null },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    select: { id: true, label: true, type: true },
  });
  const of = (t: string) => items.filter((i) => i.type === t).map(({ id, label }) => ({ id, label }));
  return { zones: of("ZONE"), professions: of("PROFESSION"), ministries: of("MINISTRY"), roles: of("MINISTRY_ROLE") };
}
