import type { Cell, SheetRows } from "./read-xlsx";

export const IMPORT_FIELDS = [
  "memberId", "lastName", "firstName", "gender", "dob", "yearJoined", "zone", "phone",
  "email", "status", "marital", "spouse", "nextOfKin", "profession", "ministry", "role",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
  memberId: "Member ID", lastName: "Last name", firstName: "First name", gender: "Gender",
  dob: "Date of birth", yearJoined: "Year joined", zone: "Physical address / zone",
  phone: "Phone", email: "Email", status: "Membership status", marital: "Marital status",
  spouse: "Spouse", nextOfKin: "Next of kin", profession: "Profession", ministry: "Ministry",
  role: "Role",
};

/** Header text (normalised) → field. Covers the clerk's register headings. */
const HEADER_ALIASES: Record<string, ImportField> = {
  memberid: "memberId", id: "memberId", memberno: "memberId",
  lastname: "lastName", surname: "lastName",
  firstname: "firstName", othernames: "firstName", givenname: "firstName",
  gender: "gender", sex: "gender",
  dateofbirth: "dob", dob: "dob", birthdate: "dob",
  yearjoinedchurch: "yearJoined", yearjoined: "yearJoined",
  physicaladdress: "zone", address: "zone", zone: "zone", residence: "zone",
  contact: "phone", phone: "phone", telephone: "phone", phonenumber: "phone", mobile: "phone",
  email: "email", emailaddress: "email",
  membership: "status", membershipstatus: "status", status: "status",
  marital: "marital", maritalstatus: "marital",
  nameofwifehusband: "spouse", spouse: "spouse", spousename: "spouse",
  nextofkin: "nextOfKin", nok: "nextOfKin",
  profession: "profession", occupation: "profession",
  ministry: "ministry", department: "ministry",
  role: "role",
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

export type ColumnMap = Partial<Record<ImportField, number>>;

/** Find the header row (first row with ≥4 recognised headings) in the first 15 rows. */
export function detectColumns(sheet: SheetRows): { headerRow: number; map: ColumnMap; headers: Record<number, string> } | null {
  for (const row of sheet.rows.slice(0, 15)) {
    const map: ColumnMap = {};
    const headers: Record<number, string> = {};
    row.cells.forEach((c, col) => {
      if (typeof c !== "string") return;
      headers[col] = c.trim();
      const field = HEADER_ALIASES[norm(c)];
      if (field && map[field] === undefined) map[field] = col;
    });
    if (Object.keys(map).length >= 4) return { headerRow: row.rowNumber, map, headers };
  }
  return null;
}

export type RawRecord = Partial<Record<ImportField, Cell>>;

export function extractRecords(sheet: SheetRows, headerRow: number, map: ColumnMap): { rowNumber: number; raw: RawRecord }[] {
  const out: { rowNumber: number; raw: RawRecord }[] = [];
  for (const row of sheet.rows) {
    if (row.rowNumber <= headerRow) continue;
    const raw: RawRecord = {};
    for (const [field, col] of Object.entries(map) as [ImportField, number][]) {
      const v = row.cells[col] ?? null;
      if (v !== null) raw[field] = v;
    }
    // Ignore blank rows and pre-numbered template rows that hold only an ID.
    const keys = Object.keys(raw);
    if (keys.length === 0 || (keys.length === 1 && keys[0] === "memberId")) continue;
    out.push({ rowNumber: row.rowNumber, raw });
  }
  return out;
}
