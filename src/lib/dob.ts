export type DobPrecision = "FULL" | "YEAR" | "UNKNOWN";

export type ParsedDob = {
  precision: DobPrecision;
  /** ISO yyyy-mm-dd when precision is FULL. */
  date: string | null;
  year: number | null;
  /** Set when the value was understood only approximately (e.g. "12yrs"). */
  note?: string;
};

const UNKNOWN: ParsedDob = { precision: "UNKNOWN", date: null, year: null };

const MIN_YEAR = 1900;

function maxYear(now: Date) {
  return now.getUTCFullYear();
}

function iso(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** Excel serial date (1900 system) → ISO date. */
export function excelSerialToIso(serial: number): string {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Parse a date of birth as it appears in the clerk's register: real Excel
 * dates, Excel serial numbers, a bare year, "dd/mm/yyyy" (also with "." or
 * "-" and common typos such as the letter "o" for zero) or an age ("12yrs").
 * Ages become year-only values (counted back from `agesAsOf`, the date the
 * register was written) and carry a note so the clerk can confirm.
 */
export function parseDob(input: unknown, now: Date = new Date(), agesAsOf: Date = now): ParsedDob {
  if (input === null || input === undefined || input === "") return UNKNOWN;
  const hi = maxYear(now);

  if (input instanceof Date && !isNaN(input.getTime())) {
    const y = input.getUTCFullYear();
    if (y < MIN_YEAR || y > hi) return UNKNOWN;
    return { precision: "FULL", date: input.toISOString().slice(0, 10), year: y };
  }

  if (typeof input === "number") {
    // Four-digit numbers are years (valid or not). Excel serials for living
    // members' birth dates start well above 3000 (1908+).
    if (Number.isInteger(input) && input >= 1000 && input <= 2999) {
      return input >= MIN_YEAR && input <= hi ? { precision: "YEAR", date: null, year: input } : UNKNOWN;
    }
    if (input >= 3000 && input < 80000) {
      const date = excelSerialToIso(input);
      const y = Number(date.slice(0, 4));
      if (y >= MIN_YEAR && y <= hi) return { precision: "FULL", date, year: y };
    }
    return UNKNOWN;
  }

  const s = String(input).trim().toLowerCase().replace(/o/g, "0");
  if (!s) return UNKNOWN;

  const age = s.match(/^(\d{1,3})\s*(yrs?|years?)(\s*old)?$/);
  if (age) {
    const y = agesAsOf.getUTCFullYear() - Number(age[1]);
    return { precision: "YEAR", date: null, year: y, note: `Approximate: derived from age "${String(input).trim()}"` };
  }

  if (/^\d{4}$/.test(s)) {
    const y = Number(s);
    return y >= MIN_YEAR && y <= hi ? { precision: "YEAR", date: null, year: y } : UNKNOWN;
  }

  // dd/mm/yyyy with any of / . - as separators (mixed allowed).
  const dmy = s.match(/^(\d{1,2})\s*[/.\-]\s*(\d{1,2})\s*[/.\-]\s*(\d{4})$/);
  if (dmy) {
    const [d, m, y] = [Number(dmy[1]), Number(dmy[2]), Number(dmy[3])];
    if (y < MIN_YEAR || y > hi) return UNKNOWN;
    const date = iso(y, m, d);
    return date ? { precision: "FULL", date, year: y } : { precision: "YEAR", date: null, year: y, note: "Day/month invalid" };
  }

  // yyyy-mm-dd
  const ymd = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (ymd) {
    const y = Number(ymd[1]);
    if (y < MIN_YEAR || y > hi) return UNKNOWN;
    const date = iso(y, Number(ymd[2]), Number(ymd[3]));
    return date ? { precision: "FULL", date, year: y } : UNKNOWN;
  }

  return UNKNOWN;
}

/** Display: "12 Apr 1961", "1978 (year only)" or null. */
export function formatDob(precision: DobPrecision, date: Date | string | null, year: number | null): string | null {
  if (precision === "FULL" && date) {
    const d = typeof date === "string" ? new Date(date + "T00:00:00Z") : date;
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
  }
  if (precision === "YEAR" && year) return `${year} (year only)`;
  return null;
}

/** Age in whole years; year-only DOBs give an approximate age. */
export function ageOn(precision: DobPrecision, date: Date | null, year: number | null, on: Date = new Date()): number | null {
  if (precision === "FULL" && date) {
    let age = on.getUTCFullYear() - date.getUTCFullYear();
    const m = on.getUTCMonth() - date.getUTCMonth();
    if (m < 0 || (m === 0 && on.getUTCDate() < date.getUTCDate())) age--;
    return age;
  }
  if (precision === "YEAR" && year) return on.getUTCFullYear() - year;
  return null;
}
