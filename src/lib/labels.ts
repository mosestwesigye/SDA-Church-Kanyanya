export const STATUS_META = {
  ACTIVE: { label: "Active", color: "var(--status-active)" },
  IRREGULAR: { label: "Irregular", color: "var(--status-irregular)" },
  SELF_TRANSFERRED: { label: "Self Transferred", color: "var(--status-transferred)" },
  UNDER_DISCIPLINE: { label: "Under Discipline", color: "var(--status-discipline)" },
  DECEASED: { label: "Deceased", color: "var(--status-deceased)" },
  LEFT_THE_FAITH: { label: "Left the Faith", color: "var(--status-left)" },
} as const;
export type StatusKey = keyof typeof STATUS_META;
export const STATUS_KEYS = Object.keys(STATUS_META) as StatusKey[];
export const NOT_RECORDED = { label: "Not recorded", color: "var(--status-unknown)" };

export const MARITAL_LABELS = {
  SINGLE: "Single",
  MARRIED: "Married",
  SEPARATED: "Separated",
  COHABITING: "Cohabiting",
  WIDOWED: "Widowed",
} as const;
export type MaritalKey = keyof typeof MARITAL_LABELS;

export const GENDER_LABELS = { MALE: "Male", FEMALE: "Female" } as const;
export const GENDER_SHORT = { MALE: "M", FEMALE: "F" } as const;

export function initials(first?: string | null, last?: string | null): string {
  return `${(first ?? "").trim()[0] ?? ""}${(last ?? "").trim()[0] ?? ""}`.toUpperCase() || "?";
}

export function fullName(m: { lastName: string; firstName: string }): string {
  return [m.lastName, m.firstName].filter(Boolean).join(", ");
}

export function formatDateTime(d: Date | string): string {
  return new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Kampala" });
}

export function formatDate(d: Date | string): string {
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Kampala" });
}
