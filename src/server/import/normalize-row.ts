import type { RawValueField } from "@/generated/prisma/client";
import { parseDob } from "@/lib/dob";
import { isBlankToken, matchListLabel, normalizeValue, titleCaseName } from "@/lib/normalize";
import { normalizeUgPhone } from "@/lib/phone";
import type { RawRecord } from "./columns";
import type { Cell } from "./read-xlsx";

export type Issue = { field: string; severity: "error" | "warning" | "info"; message: string };

/** Controlled-list lookups the normaliser needs (label → id, plus mappings). */
export type Lookups = {
  lists: Record<"ZONE" | "MINISTRY" | "MINISTRY_ROLE" | "PROFESSION", { id: string; label: string }[]>;
  /** `${field}:${normalized}` → list item id, or null meaning "blank". */
  mappings: Map<string, string | null>;
};

export type NormalizedRow = {
  memberNo: number | null;
  columns: {
    lastName: string;
    firstName: string;
    gender: "MALE" | "FEMALE" | null;
    dobPrecision: "FULL" | "YEAR" | "UNKNOWN";
    dobDate: string | null;
    dobYear: number | null;
    yearJoined: number | null;
    zoneId: string | null;
    phoneRaw: string | null;
    phoneE164: string | null;
    email: string | null;
    status: "ACTIVE" | "IRREGULAR" | "SELF_TRANSFERRED" | "UNDER_DISCIPLINE" | "DECEASED" | "LEFT_THE_FAITH" | null;
    maritalStatus: "SINGLE" | "MARRIED" | "SEPARATED" | "COHABITING" | "WIDOWED" | null;
    spouseName: string | null;
    nextOfKinName: string | null;
    nextOfKinPhoneRaw: string | null;
    nextOfKinPhoneE164: string | null;
    professionId: string | null;
  };
  ministries: { ministryId: string; roleId: string }[];
  rawValues: { field: RawValueField; rawValue: string }[];
  issues: Issue[];
  /** Row can't be imported at all (no ID and no name). */
  skip: boolean;
};

const text = (c: Cell | undefined): string | null => {
  if (c === null || c === undefined) return null;
  const s = (c instanceof Date ? c.toISOString().slice(0, 10) : String(c)).replace(/\s+/g, " ").trim();
  return s === "" ? null : s;
};

/** Fix ALL-CAPS / all-lower names; leave mixed-case names as typed. */
function cleanName(s: string | null): string {
  if (!s) return "";
  const t = s.replace(/\s+/g, " ").trim();
  return t === t.toUpperCase() || t === t.toLowerCase() ? titleCaseName(t) : t;
}

const STATUS: Record<string, NormalizedRow["columns"]["status"]> = {
  active: "ACTIVE", irregular: "IRREGULAR", inactive: "IRREGULAR",
  selftransferred: "SELF_TRANSFERRED", transferred: "SELF_TRANSFERRED", selftransfered: "SELF_TRANSFERRED",
  underdiscipline: "UNDER_DISCIPLINE", discipline: "UNDER_DISCIPLINE", censured: "UNDER_DISCIPLINE",
  deceased: "DECEASED", dead: "DECEASED", late: "DECEASED",
  leftthefaith: "LEFT_THE_FAITH", apostasy: "LEFT_THE_FAITH", missing: "LEFT_THE_FAITH",
};

const MARITAL: Record<string, NormalizedRow["columns"]["maritalStatus"]> = {
  single: "SINGLE", married: "MARRIED", separated: "SEPARATED", divorced: "SEPARATED",
  cohabiting: "COHABITING", cohabitating: "COHABITING", widow: "WIDOWED", widower: "WIDOWED", widowed: "WIDOWED",
};

const GENDER: Record<string, "MALE" | "FEMALE"> = { male: "MALE", m: "MALE", female: "FEMALE", f: "FEMALE" };

export function parseMemberNo(v: string | null): number | null {
  if (!v) return null;
  const m = v.toUpperCase().replace(/\s+/g, "").match(/^SDAK\/?M?(\d{1,6})$/) ?? v.match(/^(\d{1,6})$/);
  return m ? Number(m[1]) : null;
}

/** Split "Name: 0772…" / "Contact: 0703…" / "Name (0772…)" into name + phone. */
export function splitNameAndPhone(s: string): { name: string | null; phoneText: string | null } {
  const phones = s.match(/\+?\d[\d\s-]{7,}\d/g);
  const name = s
    .replace(/\+?\d[\d\s-]{7,}\d/g, " ")
    .replace(/\b(contact|tel|phone|mob(ile)?)\b\.?/gi, " ")
    .replace(/[():;/&,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return {
    name: name && !isBlankToken(name) && /[a-z]/i.test(name) ? name : null,
    phoneText: phones ? phones.join(" / ") : null,
  };
}

export function normalizeRow(raw: RawRecord, lookups: Lookups, now: Date = new Date(), agesAsOf: Date = now): NormalizedRow {
  const issues: Issue[] = [];
  const rawValues: NormalizedRow["rawValues"] = [];
  const keepRaw = (field: RawValueField, value: string, message: string, severity: Issue["severity"] = "warning") => {
    rawValues.push({ field, rawValue: value });
    issues.push({ field, severity, message });
  };

  const matchList = (
    type: keyof Lookups["lists"],
    field: RawValueField,
    value: string | null,
  ): { id: string | null; blank: boolean } => {
    if (!value) return { id: null, blank: true };
    const mapped = lookups.mappings.get(`${field}:${normalizeValue(value)}`);
    if (mapped !== undefined) return { id: mapped, blank: mapped === null };
    if (isBlankToken(value)) return { id: null, blank: true };
    const list = lookups.lists[type];
    const label = matchListLabel(value, list.map((i) => i.label));
    const item = label ? list.find((i) => i.label === label) : undefined;
    return { id: item?.id ?? null, blank: false };
  };

  // ── Identification
  const idText = text(raw.memberId);
  const memberNo = parseMemberNo(idText);
  if (idText && memberNo === null) issues.push({ field: "memberId", severity: "error", message: `Unrecognised member ID "${idText}"` });
  if (!idText) issues.push({ field: "memberId", severity: "warning", message: "No member ID — a new one will be issued" });

  const lastName = cleanName(text(raw.lastName));
  const firstName = cleanName(text(raw.firstName));
  const skip = !lastName && !firstName;
  if (skip) issues.push({ field: "name", severity: "error", message: "Row has no name" });
  else if (!lastName || !firstName) issues.push({ field: "name", severity: "warning", message: "Only one name recorded" });

  const genderText = text(raw.gender);
  const gender = genderText ? (GENDER[normalizeValue(genderText)] ?? null) : null;
  if (genderText && !gender) keepRaw("GENDER", genderText, `Unknown gender "${genderText}"`);

  // ── Dates
  const dob = parseDob(raw.dob ?? null, now, agesAsOf);
  if (raw.dob !== undefined && raw.dob !== null && dob.precision === "UNKNOWN") {
    keepRaw("DOB", text(raw.dob)!, `Could not read date of birth "${text(raw.dob)}"`);
  } else if (dob.note) {
    keepRaw("DOB", text(raw.dob)!, `${dob.note}; stored as year ${dob.year}`, "info");
  }

  let yearJoined: number | null = null;
  const yjText = text(raw.yearJoined);
  if (yjText) {
    const y = Number(yjText.match(/\d{4}/)?.[0]);
    if (y >= 1900 && y <= now.getUTCFullYear()) yearJoined = y;
    else keepRaw("YEAR_JOINED", yjText, `Could not read year joined "${yjText}"`);
  }

  // ── Contact
  const zoneText = text(raw.zone);
  const zone = matchList("ZONE", "ZONE", zoneText);
  if (zoneText && !zone.id && !zone.blank) keepRaw("ZONE", zoneText, `"${zoneText}" is not in the zone list`);

  const phoneText = text(raw.phone);
  const phone = normalizeUgPhone(phoneText);
  if (phone && !phone.valid) keepRaw("PHONE", phone.raw, `Phone "${phone.raw}" is not a valid Ugandan number`);
  if (phone?.extra.length) issues.push({ field: "phone", severity: "info", message: `Extra number(s) not imported: ${phone.extra.join(", ")}` });

  const emailText = text(raw.email);
  let email: string | null = null;
  if (emailText && !isBlankToken(emailText)) {
    const e = emailText.replace(/^mailto:/i, "").trim().toLowerCase();
    if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e)) email = e;
    else keepRaw("EMAIL", emailText, `Email "${emailText}" looks invalid`);
  }

  // ── Status
  const statusText = text(raw.status);
  const status = statusText ? (STATUS[normalizeValue(statusText)] ?? null) : null;
  if (statusText && !status && !isBlankToken(statusText)) keepRaw("STATUS", statusText, `Unknown membership status "${statusText}"`);

  const maritalText = text(raw.marital);
  const maritalStatus = maritalText ? (MARITAL[normalizeValue(maritalText)] ?? null) : null;
  if (maritalText && !maritalStatus && !isBlankToken(maritalText)) keepRaw("MARITAL", maritalText, `Unknown marital status "${maritalText}"`);

  let spouseName: string | null = null;
  const spouseText = text(raw.spouse);
  if (spouseText && !isBlankToken(spouseText)) {
    if (/^(deceased|late|dead)$/i.test(spouseText)) {
      keepRaw("SPOUSE", spouseText, "Spouse recorded as deceased", "info");
    } else if (/\d/.test(spouseText)) {
      const { name } = splitNameAndPhone(spouseText);
      spouseName = name ? cleanName(name) : null;
      keepRaw("SPOUSE", spouseText, "Spouse entry contained a phone number", "info");
    } else {
      spouseName = cleanName(spouseText);
    }
  }

  let nextOfKinName: string | null = null;
  let nokPhone: ReturnType<typeof normalizeUgPhone> = null;
  const nokText = text(raw.nextOfKin);
  if (nokText && !isBlankToken(nokText)) {
    const { name, phoneText: nokPhoneText } = splitNameAndPhone(nokText);
    nextOfKinName = name ? cleanName(name) : null;
    nokPhone = normalizeUgPhone(nokPhoneText);
    if (nokPhone && !nokPhone.valid) keepRaw("NEXT_OF_KIN", nokText, `Next of kin phone "${nokPhone.raw}" is not valid`);
    if (!nextOfKinName && !nokPhone?.valid) keepRaw("NEXT_OF_KIN", nokText, `Could not read next of kin "${nokText}"`);
  }

  // ── Service
  const profText = text(raw.profession);
  const profession = matchList("PROFESSION", "PROFESSION", profText);
  if (profText && !profession.id && !profession.blank) keepRaw("PROFESSION", profText, `"${profText}" is not in the profession list`);

  const ministries: NormalizedRow["ministries"] = [];
  const minText = text(raw.ministry);
  const roleText = text(raw.role);
  const ministry = matchList("MINISTRY", "MINISTRY", minText);
  if (minText && !ministry.id && !ministry.blank) keepRaw("MINISTRY", minText, `"${minText}" is not in the ministry list`);
  if (ministry.id) {
    const role = matchList("MINISTRY_ROLE", "MINISTRY_ROLE", roleText);
    const memberRole = lookups.lists.MINISTRY_ROLE.find((r) => r.label === "Member");
    if (roleText && !role.id && !role.blank) keepRaw("MINISTRY_ROLE", roleText, `Role "${roleText}" is not in the role list; linked as Member`);
    const roleId = role.id ?? memberRole?.id;
    if (roleId) ministries.push({ ministryId: ministry.id, roleId });
  } else if (roleText && !isBlankToken(roleText) && minText && !ministry.blank) {
    keepRaw("MINISTRY_ROLE", roleText, `Role "${roleText}" kept for review (ministry not matched)`, "info");
  }

  return {
    memberNo,
    columns: {
      lastName,
      firstName,
      gender,
      dobPrecision: dob.precision,
      dobDate: dob.date,
      dobYear: dob.year,
      yearJoined,
      zoneId: zone.id,
      phoneRaw: phone ? (phone.valid ? phone.display : phone.raw) : null,
      phoneE164: phone?.e164 ?? null,
      email,
      status,
      maritalStatus,
      spouseName,
      nextOfKinName,
      nextOfKinPhoneRaw: nokPhone?.valid ? nokPhone.display : null,
      nextOfKinPhoneE164: nokPhone?.e164 ?? null,
      professionId: profession.id,
    },
    ministries,
    rawValues,
    issues,
    skip,
  };
}
