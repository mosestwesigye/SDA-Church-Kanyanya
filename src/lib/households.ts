import type { HouseholdKind, HouseholdRelation } from "@/generated/prisma/enums";

/** Families and cells: names, paths and the roles used in each. Shared by server and browser code. */
export const KINDS: Record<HouseholdKind, { one: string; title: string; plural: string; path: string }> = {
  FAMILY: { one: "family", title: "Family", plural: "Families", path: "/families" },
  CELL: { one: "cell", title: "Cell", plural: "Cells", path: "/cells" },
};

/** Families and cells work the same way: a leader and members. */
export const RELATIONS_BY_KIND: Record<HouseholdKind, HouseholdRelation[]> = {
  FAMILY: ["HEAD", "OTHER"],
  CELL: ["HEAD", "OTHER"],
};

// Spouse, child and dependant are older roles kept only so historical rows still read sensibly.
const OLD_ROLES = { SPOUSE: "Member", CHILD: "Member", DEPENDANT: "Member" };
export const FAMILY_LABELS: Record<HouseholdRelation, string> = { HEAD: "Family leader", OTHER: "Family member", ...OLD_ROLES };
export const CELL_LABELS: Record<HouseholdRelation, string> = { HEAD: "Cell leader", OTHER: "Cell member", ...OLD_ROLES };

export const relationLabel = (kind: HouseholdKind, r: HouseholdRelation) => (kind === "CELL" ? CELL_LABELS : FAMILY_LABELS)[r];

/** Generic labels where the kind isn't known. */
export const RELATION_LABELS: Record<HouseholdRelation, string> = { HEAD: "Leader", OTHER: "Member", ...OLD_ROLES };
