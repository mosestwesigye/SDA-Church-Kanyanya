import { describe, expect, it } from "vitest";
import { ageOn, formatDob, parseDob } from "@/lib/dob";
import { computeCompleteness } from "@/lib/completeness";

const NOW = new Date("2026-10-02T00:00:00Z");

describe("parseDob", () => {
  it("reads real Excel dates", () => {
    expect(parseDob(new Date("1961-04-12T00:00:00Z"), NOW)).toEqual({ precision: "FULL", date: "1961-04-12", year: 1961 });
  });
  it("reads Excel serial numbers", () => {
    expect(parseDob(22383, NOW)).toMatchObject({ precision: "FULL", date: "1961-04-12" });
  });
  it("treats a bare year as year-only", () => {
    expect(parseDob(1978, NOW)).toEqual({ precision: "YEAR", date: null, year: 1978 });
    expect(parseDob("1978", NOW)).toEqual({ precision: "YEAR", date: null, year: 1978 });
  });
  it.each([
    ["27/06/1950", "1950-06-27"],
    ["15.02/1966", "1966-02-15"],
    ["15/o9/1986", "1986-09-15"], // letter o typed for zero
    ["3-1-2001", "2001-01-03"],
  ])("reads day-first text %s", (input, iso) => {
    expect(parseDob(input, NOW)).toMatchObject({ precision: "FULL", date: iso });
  });
  it("turns ages into approximate years counted from the register date", () => {
    const r = parseDob("12yrs", NOW, new Date("2024-11-10T00:00:00Z"));
    expect(r).toMatchObject({ precision: "YEAR", year: 2012 });
    expect(r.note).toMatch(/Approximate/);
  });
  it("keeps the year when the day/month is impossible", () => {
    expect(parseDob("31/02/1972", NOW)).toMatchObject({ precision: "YEAR", year: 1972 });
  });
  it.each(["25/05/198", "abc", 1850, 2099])("gives up on %s", (input) => {
    expect(parseDob(input, NOW).precision).toBe("UNKNOWN");
  });
  it("formats and ages", () => {
    expect(formatDob("FULL", "1961-04-12", 1961)).toBe("12 Apr 1961");
    expect(formatDob("YEAR", null, 1978)).toBe("1978 (year only)");
    expect(ageOn("FULL", new Date("1961-10-03T00:00:00Z"), 1961, NOW)).toBe(64);
    expect(ageOn("YEAR", null, 1978, NOW)).toBe(48);
  });
});

describe("computeCompleteness", () => {
  it("counts name-only records as mostly missing", () => {
    const r = computeCompleteness({ lastName: "Nakato", firstName: "Grace" });
    expect(r.percent).toBe(14);
    expect(r.missing).toContain("photo");
    expect(r.missing).not.toContain("spouse");
  });

  it("does not count email and counts year-only DOB as missing full DOB", () => {
    const full = {
      lastName: "A", firstName: "B", gender: "FEMALE", dobPrecision: "FULL", yearJoined: 1996, photoKey: "p",
      zoneId: "z", phoneE164: "+256772418903", status: "ACTIVE", maritalStatus: "SINGLE",
      nextOfKinName: "C", nextOfKinPhoneE164: "+256772418904", professionId: "p", ministryCount: 1,
    };
    expect(computeCompleteness(full)).toEqual({ percent: 100, missing: [] });
    expect(computeCompleteness({ ...full, dobPrecision: "YEAR" }).missing).toEqual(["dob"]);
  });

  it("requires a spouse only when married", () => {
    const base = {
      lastName: "A", firstName: "B", gender: "FEMALE", dobPrecision: "FULL", yearJoined: 1996, photoKey: "p",
      zoneId: "z", phoneE164: "x", status: "ACTIVE", nextOfKinName: "C", nextOfKinPhoneE164: "y",
      professionId: "p", ministryCount: 1,
    };
    expect(computeCompleteness({ ...base, maritalStatus: "MARRIED" }).missing).toEqual(["spouse"]);
    expect(computeCompleteness({ ...base, maritalStatus: "MARRIED", spouseName: "D" }).percent).toBe(100);
  });
});
