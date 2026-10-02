import type { StatusKey } from "@/lib/labels";

/** Serializable directory row sent to the client. `null` + group in `restricted` = hidden by permission. */
export type DirRow = {
  id: string;
  memberId: string;
  lastName: string;
  firstName: string;
  status: StatusKey | null;
  gender: "MALE" | "FEMALE" | null;
  dob: string | null;
  zone: string | null;
  phone: string | null;
  email: string | null;
  ministry: string | null;
  completeness: number | null;
  marital: string | null;
  yearJoined: number | null;
  profession: string | null;
  nextOfKin: string | null;
  updatedAt: string;
  deleted: boolean;
  flagged: boolean;
  restricted: string[];
};

export type ColumnKey =
  | "status" | "gender" | "dob" | "zone" | "phone" | "ministry" | "completeness"
  | "marital" | "yearJoined" | "profession" | "email" | "nextOfKin" | "updated";

export const COLUMNS: { key: ColumnKey; label: string; group: "member" | "member.profile" | "member.contact" | "member.sensitive" }[] = [
  { key: "status", label: "Status", group: "member.profile" },
  { key: "gender", label: "Gender", group: "member.profile" },
  { key: "dob", label: "Date of birth", group: "member.profile" },
  { key: "zone", label: "Zone", group: "member.profile" },
  { key: "phone", label: "Phone", group: "member.contact" },
  { key: "ministry", label: "Ministry · role", group: "member" },
  { key: "completeness", label: "Profile completeness", group: "member.profile" },
  { key: "marital", label: "Marital status", group: "member.sensitive" },
  { key: "yearJoined", label: "Year joined", group: "member.profile" },
  { key: "profession", label: "Profession", group: "member.profile" },
  { key: "email", label: "Email", group: "member.contact" },
  { key: "nextOfKin", label: "Next of kin", group: "member.sensitive" },
  { key: "updated", label: "Last updated", group: "member" },
];

export const DEFAULT_COLUMNS: ColumnKey[] = ["status", "gender", "dob", "zone", "phone", "ministry", "completeness"];

export type Option = { id: string; label: string };
