import { describe, expect, it } from "vitest";
import { normalizeValue } from "@/lib/normalize";
import { diffRecords } from "@/server/audit/diff";
import { normalizeRow, parseMemberNo, splitNameAndPhone, type Lookups } from "@/server/import/normalize-row";

const list = (labels: string[]) => labels.map((label) => ({ id: `id:${label}`, label }));
const LOOKUPS: Lookups = {
  lists: {
    ZONE: list(["Kanyanya", "Mpererwe", "Kiyanja", "Kikuubo"]),
    MINISTRY: list(["Deaconry", "Elders", "Youth", "Church Choir", "Senior Citizens"]),
    MINISTRY_ROLE: list(["Member", "Head", "Assistant Head", "Deaconess"]),
    PROFESSION: list(["Teacher", "Accountant", "Business Person"]),
  },
  mappings: new Map([
    [`MINISTRY:${normalizeValue("Nill")}`, null],
    [`MINISTRY:${normalizeValue("Non")}`, null],
    [`MINISTRY:${normalizeValue("Senior Cetizin")}`, "id:Senior Citizens"],
    [`PROFESSION:${normalizeValue("Business Woman")}`, "id:Business Person"],
  ]),
};
const NOW = new Date("2026-10-02T00:00:00Z");

describe("register row normalisation", () => {
  it("parses member IDs", () => {
    expect(parseMemberNo("SDAK/M0001")).toBe(1);
    expect(parseMemberNo("sdak/m 0595")).toBe(595);
    expect(parseMemberNo("[object Object]")).toBeNull();
  });

  it("splits next-of-kin cells", () => {
    expect(splitNameAndPhone("Mary Nansubuga: 0703753832")).toEqual({ name: "Mary Nansubuga", phoneText: "0703753832" });
    expect(splitNameAndPhone("Contact: 0703753832")).toEqual({ name: null, phoneText: "0703753832" });
    expect(splitNameAndPhone("John Okello")).toEqual({ name: "John Okello", phoneText: null });
  });

  it("normalises a typical complete row", () => {
    const r = normalizeRow(
      {
        memberId: "SDAK/M0001", lastName: "OKELLO", firstName: "david", gender: "Male", dob: 1961,
        yearJoined: 1990, zone: "Kiyanja Zone", phone: 704604646, email: "Dave@Example.org", status: "Active",
        marital: "Widow", spouse: "Deceased", nextOfKin: "Contact: 0703753832", profession: "Business Woman",
        ministry: "Senior Cetizin", role: "Assistant head",
      },
      LOOKUPS,
      NOW,
    );
    expect(r.memberNo).toBe(1);
    expect(r.columns).toMatchObject({
      lastName: "Okello", firstName: "David", gender: "MALE", dobPrecision: "YEAR", dobYear: 1961,
      zoneId: "id:Kiyanja", phoneE164: "+256704604646", phoneRaw: "0704 604 646", email: "dave@example.org",
      status: "ACTIVE", maritalStatus: "WIDOWED", spouseName: null, nextOfKinName: null,
      nextOfKinPhoneE164: "+256703753832", professionId: "id:Business Person",
    });
    expect(r.ministries).toEqual([{ ministryId: "id:Senior Citizens", roleId: "id:Assistant Head" }]);
    expect(r.rawValues).toEqual([{ field: "SPOUSE", rawValue: "Deceased" }]);
  });

  it("maps Nil/Non ministries to blank without a review item", () => {
    const r = normalizeRow({ memberId: "SDAK/M0002", lastName: "A", firstName: "B", ministry: "Nill", role: "Member" }, LOOKUPS, NOW);
    expect(r.ministries).toEqual([]);
    expect(r.rawValues).toEqual([]);
  });

  it("keeps unknown values for the clean-up queue instead of guessing", () => {
    const r = normalizeRow(
      { memberId: "SDAK/M0003", lastName: "A", firstName: "B", zone: "Lower Konge", ministry: "Stewardship", role: "Member", phone: "0772 45 678" },
      LOOKUPS,
      NOW,
    );
    expect(r.columns.zoneId).toBeNull();
    expect(r.columns.phoneE164).toBeNull();
    expect(r.columns.phoneRaw).toBe("0772 45 678");
    // The role is kept too, so it can follow the ministry once the clerk maps it.
    expect(r.rawValues.map((v) => v.field).sort()).toEqual(["MINISTRY", "MINISTRY_ROLE", "PHONE", "ZONE"]);
  });

  it("links an unknown role as Member and keeps the original for review", () => {
    const r = normalizeRow({ memberId: "SDAK/M0004", lastName: "A", firstName: "B", ministry: "Church Choir", role: "Pianist" }, LOOKUPS, NOW);
    expect(r.ministries).toEqual([{ ministryId: "id:Church Choir", roleId: "id:Member" }]);
    expect(r.rawValues).toEqual([{ field: "MINISTRY_ROLE", rawValue: "Pianist" }]);
  });

  it("skips rows without any name", () => {
    expect(normalizeRow({ gender: "Male", phone: "0772418903" }, LOOKUPS, NOW).skip).toBe(true);
  });
});

describe("audit diff", () => {
  it("records only changed fields, ignoring bookkeeping", () => {
    const before = { phoneE164: "+256752664091", zoneId: "z1", updatedAt: new Date(1), version: 3 };
    const after = { phoneE164: "+256752664092", zoneId: "z1", updatedAt: new Date(2), version: 4 };
    expect(diffRecords(before, after)).toEqual([{ field: "phoneE164", oldValue: "+256752664091", newValue: "+256752664092" }]);
  });
  it("treats empty string and null as the same", () => {
    expect(diffRecords({ email: null }, { email: "" })).toEqual([]);
  });
  it("serialises dates", () => {
    const d = new Date("1978-01-01T00:00:00Z");
    expect(diffRecords({ dobDate: null }, { dobDate: d })).toEqual([{ field: "dobDate", oldValue: null, newValue: d.toISOString() }]);
  });
});
