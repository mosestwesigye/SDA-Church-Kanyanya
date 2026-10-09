import type { HouseholdKind, HouseholdRelation } from "@/generated/prisma/enums";

/** Families and cells: names, paths and the roles used in each. Shared by server and browser code. */
export const KINDS: Record<HouseholdKind, { one: string; title: string; plural: string; path: string }> = {
  FAMILY: { one: "family", title: "Family", plural: "Families", path: "/families" },
  CELL: { one: "cell", title: "Cell", plural: "Cells", path: "/cells" },
};

/** Roles offered in each kind of group, in display order. */
export const RELATIONS_BY_KIND: Record<HouseholdKind, HouseholdRelation[]> = {
  FAMILY: ["HEAD", "SPOUSE", "CHILD", "DEPENDANT", "OTHER"],
  CELL: ["HEAD", "OTHER"],
};

export const FAMILY_LABELS: Record<HouseholdRelation, string> = {
  HEAD: "Husband / head of family",
  SPOUSE: "Wife / spouse",
  CHILD: "Child",
  DEPENDANT: "Dependant",
  OTHER: "Other relative",
};
export const CELL_LABELS: Record<HouseholdRelation, string> = { ...FAMILY_LABELS, HEAD: "Cell leader", OTHER: "Cell member" };

export const relationLabel = (kind: HouseholdKind, r: HouseholdRelation) => (kind === "CELL" ? CELL_LABELS : FAMILY_LABELS)[r];

/** Generic labels where the kind isn't known. */
export const RELATION_LABELS: Record<HouseholdRelation, string> = { ...FAMILY_LABELS, HEAD: "Head / leader" };

/** "Mr and Mrs Twesigye Moses" from the husband's names (surname first, as written in Uganda). */
export function suggestFamilyName(head?: { lastName: string; firstName: string } | null, spouse?: { lastName: string; firstName: string } | null) {
  if (head && spouse) return `Mr and Mrs ${head.lastName} ${head.firstName}`;
  if (head) return `${head.lastName} ${head.firstName} family`;
  if (spouse) return `${spouse.lastName} ${spouse.firstName} family`;
  return "";
}
