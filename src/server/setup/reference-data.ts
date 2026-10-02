import type { ListType, RawValueField } from "@/generated/prisma/client";
import { normalizeValue } from "@/lib/normalize";
import { DEFAULT_MATRIX } from "../authz/defaults";
import { REQUIRE_2FA, ROLE_KEYS, ROLE_LABELS } from "../authz/catalog";
import type { Db } from "../db";

/**
 * Controlled lists. Zones combine the brief with every place in the clerk's
 * register that appears for two or more members; rarer places land in the
 * Non-standard values queue for the clerk to add or map.
 */
export const ZONES = [
  "Kanyanya", "Mpererwe", "Kiteezi", "Kasangati", "Komamboga", "Kawempe",
  "Lusanja", "Ttula", "Kitala", "Kyebando", "Nansana", "Kikuubo", "Kiyanja",
  "Lutunda", "Namere", "Kireka", "Kabaga", "Mugalu", "Gayaza", "Ggaba",
  "Katikamu", "Sekati", "Kisaasi", "Lugoba",
];

export const MINISTRIES = [
  "Deaconry", "Elders", "Youth", "Children", "Health", "Sabbath School", "Church Choir",
  "Music", "Treasury", "Development", "Hospital & Prison", "Prayer", "Family Life",
  "Education", "Communication", "Welfare", "PA System", "Ambassadors", "Adventurers",
  "Pathfinders", "Senior Citizens", "Interests",
];

export const MINISTRY_ROLES = [
  "Member", "Head", "Assistant Head", "Elder", "Chief Elder", "Deacon", "Deaconess",
  "Teacher", "Clerk", "Treasurer", "Chorister", "Coordinator",
];

export const PROFESSIONS = [
  "Accountant", "Baker", "Banker", "Book Binder", "Brick Layer", "Broadcaster", "Builder",
  "Business Person", "Cashier", "Chef", "Civil Engineer", "Civil Servant", "Clinical Officer",
  "Commercial Artist", "Cook", "Cosmetologist", "Driver", "Electrician", "Engineer", "Farmer",
  "Hair Dresser", "Health Worker", "Homemaker", "Hotelier", "House Manager", "Hydrogeologist",
  "ICT Specialist", "Journalist", "Lab Technician", "Land Surveyor", "Lecturer", "Market Vendor",
  "Mechanic", "Medic", "Medical Officer", "Motor Vehicle Technician", "Nurse", "Office Messenger",
  "Painter", "Pharmacist", "Procurement Officer", "Public Health Specialist", "Real Estate",
  "Retired", "Sales Person", "Secretary", "Self Employed", "Shop Attendant", "Social Worker",
  "Software Engineer", "Statistician", "Student", "Tailor", "Teacher", "Telecommunications Engineer",
  "Welder",
];

export const LISTS: Record<ListType, string[]> = {
  ZONE: ZONES,
  MINISTRY: MINISTRIES,
  MINISTRY_ROLE: MINISTRY_ROLES,
  PROFESSION: PROFESSIONS,
};

/**
 * Starting value mappings for spellings found in the register. `null` means
 * the value stands for "not recorded". Clerks can review and extend these
 * in the clean-up workspace.
 */
export const VALUE_MAPPINGS: { field: RawValueField; raw: string; to: string | null }[] = [
  ...["Nil", "Nill", "Non", "None", "N/A"].map((raw) => ({ field: "MINISTRY" as const, raw, to: null })),
  { field: "MINISTRY", raw: "Elder", to: "Elders" },
  { field: "MINISTRY", raw: "Senior Cetizin", to: "Senior Citizens" },
  { field: "MINISTRY", raw: "Senior Citizine", to: "Senior Citizens" },
  { field: "MINISTRY", raw: "Senior Citizen", to: "Senior Citizens" },
  { field: "MINISTRY", raw: "Chior", to: "Church Choir" },
  { field: "MINISTRY", raw: "P.A System", to: "PA System" },
  { field: "MINISTRY_ROLE", raw: "Mmber", to: "Member" },
  { field: "MINISTRY_ROLE", raw: "Assistant head", to: "Assistant Head" },
  { field: "MINISTRY_ROLE", raw: "Cordinator", to: "Coordinator" },
  { field: "MINISTRY_ROLE", raw: "Head Deacon", to: "Head" },
  { field: "MINISTRY_ROLE", raw: "Head Deaconess", to: "Head" },
  ...["Business Woman", "Business Man", "Business Lady", "Busines Woman", "Business  Woman"].map((raw) => ({ field: "PROFESSION" as const, raw, to: "Business Person" })),
  ...["Sales Man", "Sale Man"].map((raw) => ({ field: "PROFESSION" as const, raw, to: "Sales Person" })),
  ...["House Wife", "House wife"].map((raw) => ({ field: "PROFESSION" as const, raw, to: "Homemaker" })),
  { field: "PROFESSION", raw: "Retairee", to: "Retired" },
  { field: "PROFESSION", raw: "Medic: Lab Tec", to: "Lab Technician" },
  { field: "PROFESSION", raw: "Medic:  Pharmacist", to: "Pharmacist" },
  { field: "PROFESSION", raw: "Medic: Psych Nurse", to: "Nurse" },
  { field: "PROFESSION", raw: "Medic:  MCO", to: "Clinical Officer" },
  { field: "PROFESSION", raw: "Medic: P.H.Specialist", to: "Public Health Specialist" },
  { field: "PROFESSION", raw: "Computer sci", to: "ICT Specialist" },
  { field: "PROFESSION", raw: "ICT", to: "ICT Specialist" },
  { field: "PROFESSION", raw: "Telecommunications Eng", to: "Telecommunications Engineer" },
  { field: "PROFESSION", raw: "Motor vehicle mechanic", to: "Mechanic" },
  { field: "PROFESSION", raw: "Motor Engineer", to: "Motor Vehicle Technician" },
  { field: "PROFESSION", raw: "Primary Teacher", to: "Teacher" },
  { field: "PROFESSION", raw: "Nursery Teacher", to: "Teacher" },
  { field: "PROFESSION", raw: "Home Baker", to: "Baker" },
  { field: "PROFESSION", raw: "Hotelian", to: "Hotelier" },
  { field: "PROFESSION", raw: "TV Broadcaster", to: "Broadcaster" },
  { field: "PROFESSION", raw: "Real Estates", to: "Real Estate" },
  { field: "PROFESSION", raw: "Procurement", to: "Procurement Officer" },
  { field: "PROFESSION", raw: "Tailor/ & Seamstress", to: "Tailor" },
  { field: "PROFESSION", raw: "Cosmetics", to: "Cosmetologist" },
  { field: "PROFESSION", raw: "Comercial Artist", to: "Commercial Artist" },
  { field: "PROFESSION", raw: "Civial Servant", to: "Civil Servant" },
  { field: "PROFESSION", raw: "Stastician", to: "Statistician" },
  { field: "PROFESSION", raw: "Land Survayor", to: "Land Surveyor" },
  { field: "PROFESSION", raw: "Office Messanger", to: "Office Messenger" },
  ...["Nil", "Nill", "Non", "None", "N/A"].map((raw) => ({ field: "PROFESSION" as const, raw, to: null })),
  { field: "ZONE", raw: "Kyebando erisa", to: "Kyebando" },
  { field: "ZONE", raw: "Kyebando Katale", to: "Kyebando" },
  { field: "ZONE", raw: "Kyebando Central", to: "Kyebando" },
  { field: "ZONE", raw: "Seeta Kasangati", to: "Kasangati" },
  { field: "ZONE", raw: "Bulamu Gayaza", to: "Gayaza" },
];

export const DEFAULT_SETTINGS: Record<string, unknown> = {
  "privacy.consentVersion": "2026-1",
  "retention.purgeAfterDays": 365,
  "merge.undoDays": 30,
  // Whether a photo counts toward profile completeness (Admin → Data rules).
  "completeness.photoRequired": true,
};

/** Idempotently create roles, permission matrix, lists, mappings and settings. */
export async function ensureReferenceData(db: Db, opts: { resetPermissions?: boolean } = {}) {
  for (const key of ROLE_KEYS) {
    const role = await db.role.upsert({
      where: { key },
      create: { key, name: ROLE_LABELS[key], require2fa: REQUIRE_2FA.includes(key) },
      update: {},
    });
    const existing = await db.permission.count({ where: { roleId: role.id } });
    if (existing === 0 || opts.resetPermissions) {
      await db.permission.deleteMany({ where: { roleId: role.id } });
      await db.permission.createMany({
        data: DEFAULT_MATRIX[key].map((g) => ({ roleId: role.id, resource: g.resource, action: g.action, scope: g.scope })),
      });
    }
  }

  for (const [type, labels] of Object.entries(LISTS) as [ListType, string[]][]) {
    await db.listItem.createMany({
      data: labels.map((label, i) => ({ type, label, sortOrder: i })),
      skipDuplicates: true,
    });
  }

  const items = await db.listItem.findMany({ select: { id: true, type: true, label: true } });
  const byKey = new Map(items.map((i) => [`${i.type}:${i.label}`, i.id]));
  const listTypeFor: Partial<Record<RawValueField, ListType>> = {
    ZONE: "ZONE", MINISTRY: "MINISTRY", MINISTRY_ROLE: "MINISTRY_ROLE", PROFESSION: "PROFESSION",
  };
  await db.valueMapping.createMany({
    data: VALUE_MAPPINGS.map((m) => ({
      field: m.field,
      normalized: normalizeValue(m.raw),
      listItemId: m.to ? (byKey.get(`${listTypeFor[m.field]}:${m.to}`) ?? null) : null,
      meansBlank: m.to === null,
    })),
    skipDuplicates: true,
  });

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await db.appSetting.upsert({ where: { key }, create: { key, value: value as never }, update: {} });
  }
}
