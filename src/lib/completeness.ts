/**
 * Profile completeness = filled required fields ÷ required fields.
 * Email is optional and never counts. Spouse only counts when married.
 * A year-only date of birth counts as missing "Full date of birth"
 * (matches the design's completeness card).
 */

export type CompletenessInput = {
  lastName?: string | null;
  firstName?: string | null;
  gender?: string | null;
  dobPrecision?: string | null;
  yearJoined?: number | null;
  photoKey?: string | null;
  zoneId?: string | null;
  phoneE164?: string | null;
  status?: string | null;
  maritalStatus?: string | null;
  spouseMemberId?: string | null;
  spouseName?: string | null;
  nextOfKinName?: string | null;
  nextOfKinPhoneE164?: string | null;
  professionId?: string | null;
  ministryCount?: number;
};

export const REQUIRED_FIELD_LABELS = {
  lastName: "Last name",
  firstName: "First name",
  gender: "Gender",
  dob: "Full date of birth",
  yearJoined: "Year joined",
  photo: "Photo",
  zone: "Zone",
  phone: "Phone",
  status: "Membership status",
  maritalStatus: "Marital status",
  spouse: "Spouse",
  nextOfKinName: "Next of kin",
  nextOfKinPhone: "Next of kin phone",
  profession: "Profession",
  ministry: "Ministry",
} as const;

export type RequiredField = keyof typeof REQUIRED_FIELD_LABELS;

const filled = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== "";

export function computeCompleteness(m: CompletenessInput): { percent: number; missing: RequiredField[] } {
  const checks: [RequiredField, boolean][] = [
    ["lastName", filled(m.lastName)],
    ["firstName", filled(m.firstName)],
    ["gender", filled(m.gender)],
    ["dob", m.dobPrecision === "FULL"],
    ["yearJoined", filled(m.yearJoined)],
    ["photo", filled(m.photoKey)],
    ["zone", filled(m.zoneId)],
    ["phone", filled(m.phoneE164)],
    ["status", filled(m.status)],
    ["maritalStatus", filled(m.maritalStatus)],
    ["nextOfKinName", filled(m.nextOfKinName)],
    ["nextOfKinPhone", filled(m.nextOfKinPhoneE164)],
    ["profession", filled(m.professionId)],
    ["ministry", (m.ministryCount ?? 0) > 0],
  ];
  if (m.maritalStatus === "MARRIED") {
    checks.push(["spouse", filled(m.spouseMemberId) || filled(m.spouseName)]);
  }
  const missing = checks.filter(([, ok]) => !ok).map(([k]) => k);
  const percent = Math.round(((checks.length - missing.length) / checks.length) * 100);
  return { percent, missing };
}
