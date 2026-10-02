import type { RawRecord } from "../import/columns";
import { normalizeRow, type Lookups } from "../import/normalize-row";
import type { PreparedRow } from "../import/register-import";

/** Deterministic PRNG so the demo data is the same on every machine. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SURNAMES = [
  "Ssemwanga", "Nakato", "Okello", "Namubiru", "Achieng", "Mugisha", "Nabukenya", "Kato", "Nalwoga",
  "Tumusiime", "Atim", "Lubega", "Namatovu", "Ochan", "Nansubuga", "Byaruhanga", "Kyomuhendo", "Ssekandi",
  "Kizza", "Nantongo", "Ssali", "Akello", "Mukasa", "Wasswa", "Babirye", "Kintu", "Musoke", "Namaganda",
  "Mutebi", "Nakimuli", "Opio", "Odongo", "Auma", "Kiggundu", "Ssebunya", "Nakitto", "Mwesigwa",
  "Ainembabazi", "Tumwine", "Asiimwe", "Kyambadde", "Lwanga", "Nalubega", "Ochieng", "Apio", "Ojok",
  "Kabuye", "Nambi", "Ssenyonga", "Namirembe",
];
const MALE = ["Joseph", "David", "Brian", "Emmanuel", "Peter", "Samuel", "Moses", "John", "Robert", "Daniel", "Ivan", "Charles", "Isaac", "Allan", "Ronald", "Denis", "Paul", "Fred", "Henry", "Martin"];
const FEMALE = ["Grace", "Esther", "Ruth", "Sarah", "Florence", "Rebecca", "Juliet", "Agnes", "Doreen", "Mary", "Prossy", "Patience", "Brenda", "Sharon", "Winnie", "Harriet", "Annet", "Gloria", "Joan", "Lydia"];
const PREFIXES = ["070", "071", "072", "074", "075", "076", "077", "078", "079"];
const NONSTANDARD_PROFESSION = ["Nil", "Nill", "None", "Non", "N/A", "Teacher ", "teacher", "Tr.", "Techer"];
const NONSTANDARD_ZONE = ["Kanyanya zone", "kanyanya", "Mpererwe-Kisaasi", "Lower Konge", "Kawempe Mbogo"];

/**
 * Generate fictitious register rows and run them through the real import
 * normaliser, so demo data exercises exactly the same code path as the
 * clerk's register.
 */
export function generateDemoMembers(lookups: Lookups, opts: { count: number; seed: number }): PreparedRow[] {
  const rnd = mulberry32(opts.seed);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
  const phone = () => pick(PREFIXES) + String(Math.floor(rnd() * 1e7)).padStart(7, "0");
  const ministries = lookups.lists.MINISTRY.map((m) => m.label);
  const roles = ["Member", "Member", "Member", "Member", "Head", "Assistant Head", "Teacher", "Deacon", "Deaconess"];
  const now = new Date();
  const rows: PreparedRow[] = [];

  for (let i = 1; i <= opts.count; i++) {
    const female = rnd() < 0.55;
    const raw: RawRecord = {
      memberId: `SDAK/M${String(i).padStart(4, "0")}`,
      lastName: pick(SURNAMES),
      firstName: pick(female ? FEMALE : MALE),
    };
    const tier = rnd(); // <0.2 complete, <0.47 partial, else name + ID only
    if (tier < 0.47) {
      const full = tier < 0.2;
      raw.gender = female ? "Female" : "Male";
      const year = 1940 + Math.floor(rnd() * 70);
      raw.dob = full || rnd() < 0.5 ? `${1 + Math.floor(rnd() * 28)}/${1 + Math.floor(rnd() * 12)}/${year}` : year;
      raw.zone = rnd() < 0.05 ? pick(NONSTANDARD_ZONE) : pick(lookups.lists.ZONE).label;
      raw.phone = rnd() < 0.04 ? phone().slice(0, 8) : phone();
      raw.status = pick(["Active", "Active", "Active", "Active", "Irregular", "Self transferred"]);
      if (full || rnd() < 0.5) {
        raw.yearJoined = Math.max(year + 12, 1970 + Math.floor(rnd() * 55));
        raw.marital = pick(["Single", "Married", "Married", "Widow", "Separated"]);
        if (raw.marital === "Married") raw.spouse = `${pick(SURNAMES)} ${pick(female ? MALE : FEMALE)}`;
        raw.nextOfKin = `${pick(SURNAMES)} ${pick([...MALE, ...FEMALE])}: ${phone()}`;
        raw.profession = rnd() < 0.08 ? pick(NONSTANDARD_PROFESSION) : pick(lookups.lists.PROFESSION).label;
        raw.ministry = rnd() < 0.06 ? pick(["Nil", "Non", "Chior"]) : pick(ministries);
        raw.role = pick(roles);
      }
    }
    if (rnd() < 0.01) raw.email = `${String(raw.firstName).toLowerCase()}.${i}@example.org`;
    const normalized = normalizeRow(raw, lookups, now);
    rows.push({ rowNumber: i, raw, normalized });
  }

  // Planted duplicates: same person entered twice with small differences.
  for (let d = 0; d < 12; d++) {
    const src = rows[Math.floor(rnd() * rows.length)];
    const raw: RawRecord = {
      ...src.raw,
      memberId: `SDAK/M${String(opts.count + d + 1).padStart(4, "0")}`,
      firstName: d % 3 === 0 ? `${src.raw.firstName} B.` : src.raw.firstName,
      ministry: undefined,
      role: undefined,
    };
    rows.push({ rowNumber: opts.count + d + 1, raw, normalized: normalizeRow(raw, lookups, now) });
  }
  return rows;
}
