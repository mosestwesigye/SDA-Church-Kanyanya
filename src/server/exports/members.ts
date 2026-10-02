import { formatDob } from "@/lib/dob";
import { GENDER_LABELS, MARITAL_LABELS, NOT_RECORDED, STATUS_META, type StatusKey } from "@/lib/labels";
import { assertCan, selectableGroups, type AuthContext } from "../authz/policy";
import type { Db } from "../db";
import { listMembers, type DirectoryQuery } from "../members/directory";
import type { Table } from "./tabular";

const MAX_ROWS = 5000;

// Projected member rows are loosely typed (fields vary by permission).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

/** Every exportable column and the field group it needs. */
const EXPORT_COLUMNS: { key: string; label: string; group: string; get: (m: Row) => unknown }[] = [
  { key: "status", label: "Membership status", group: "member.profile", get: (m) => (m.status ? STATUS_META[m.status as StatusKey].label : NOT_RECORDED.label) },
  { key: "gender", label: "Gender", group: "member.profile", get: (m) => (m.gender ? GENDER_LABELS[m.gender as "MALE" | "FEMALE"] : "") },
  { key: "dob", label: "Date of birth", group: "member.profile", get: (m) => formatDob(m.dobPrecision, m.dobDate, m.dobYear) ?? "" },
  { key: "yearJoined", label: "Year joined", group: "member.profile", get: (m) => m.yearJoined },
  { key: "zone", label: "Zone", group: "member.profile", get: (m) => m.zone?.label },
  { key: "phone", label: "Phone", group: "member.contact", get: (m) => m.phoneRaw },
  { key: "email", label: "Email", group: "member.contact", get: (m) => m.email },
  { key: "ministry", label: "Ministries · roles", group: "member", get: (m) => (m.ministries ?? []).map((l: Row) => `${l.ministry?.label} · ${l.role?.label}`).join("; ") },
  { key: "profession", label: "Profession", group: "member.profile", get: (m) => m.profession?.label },
  { key: "completeness", label: "Profile completeness %", group: "member.profile", get: (m) => m.completeness },
  { key: "marital", label: "Marital status", group: "member.sensitive", get: (m) => (m.maritalStatus ? MARITAL_LABELS[m.maritalStatus as keyof typeof MARITAL_LABELS] : "") },
  { key: "spouse", label: "Spouse", group: "member.sensitive", get: (m) => (m.spouse ? `${m.spouse.lastName}, ${m.spouse.firstName} (${m.spouse.memberId})` : m.spouseName) },
  { key: "nextOfKin", label: "Next of kin", group: "member.sensitive", get: (m) => m.nextOfKinName },
  { key: "nextOfKinPhone", label: "Next of kin phone", group: "member.sensitive", get: (m) => m.nextOfKinPhoneRaw },
  { key: "updated", label: "Last updated", group: "member", get: (m) => m.updatedAt },
];

/**
 * Build the member export table. Restricted columns are dropped entirely
 * (never exported as blanks), and rows come from the same scoped query as
 * the directory.
 */
export async function buildMemberExport(db: Db, ctx: AuthContext, query: DirectoryQuery, opts: { ids?: string[]; columns?: string[] }): Promise<Table> {
  assertCan(ctx, "export", "run");
  const groups = new Set<string>(selectableGroups(ctx));
  const wanted = opts.columns?.length ? new Set(opts.columns.flatMap((c) => (c === "nextOfKin" ? ["nextOfKin", "nextOfKinPhone"] : c === "marital" ? ["marital", "spouse"] : [c]))) : null;
  const cols = EXPORT_COLUMNS.filter((c) => groups.has(c.group) && (!wanted || wanted.has(c.key)));
  const { rows } = await listMembers(db, ctx, { ...query, page: 1 }, { take: MAX_ROWS, ids: opts.ids });
  return {
    title: "Members",
    columns: [{ key: "memberId", label: "Member ID", width: 13 }, { key: "lastName", label: "Last name", width: 18 }, { key: "firstName", label: "First name", width: 18 }, ...cols.map((c) => ({ key: c.key, label: c.label }))],
    rows: rows.map((r) => {
      const m = r as unknown as Record<string, unknown>;
      const out: Record<string, unknown> = { memberId: r.memberId, lastName: r.lastName, firstName: r.firstName };
      for (const c of cols) out[c.key] = (r.restricted as string[]).includes(c.group) ? "" : c.get(m);
      return out;
    }),
  };
}
