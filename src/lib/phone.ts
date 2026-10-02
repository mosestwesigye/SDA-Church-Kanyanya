import { parsePhoneNumberFromString } from "libphonenumber-js/min";
import { isBlankToken } from "./normalize";

export type PhoneResult = {
  /** What the user (or register) supplied, trimmed. */
  raw: string;
  /** +2567XXXXXXXX when valid, else null. */
  e164: string | null;
  /** 07XX XXX XXX when valid, else the raw value. */
  display: string;
  valid: boolean;
  /** Further numbers found in the same cell ("0703…/ 0777…"). */
  extra: string[];
};

/** Format a valid Ugandan E.164 number as 07XX XXX XXX. */
export function formatUgPhone(e164: string): string {
  const national = "0" + e164.replace(/^\+256/, "");
  return `${national.slice(0, 4)} ${national.slice(4, 7)} ${national.slice(7)}`;
}

function toCandidate(digits: string): string {
  // Excel stores phones as numbers and drops the leading zero: 704604646.
  if (digits.length === 9 && /^[37]/.test(digits)) return "0" + digits;
  if (digits.length === 12 && digits.startsWith("256")) return "+" + digits;
  return digits;
}

/**
 * Ugandan numbers: mobiles 07X XXX XXXX and landlines 03X / 04X, nine digits
 * after the leading zero. We validate the shape rather than carrier ranges,
 * which change faster than phone metadata (and would reject real members).
 */
const UG_NATIONAL = /^(7\d{8}|[34]\d{8})$/;

function parseOne(text: string): string | null {
  const digits = text.replace(/\D/g, "");
  if (!digits) return null;
  const parsed = parsePhoneNumberFromString(toCandidate(digits), "UG");
  if (!parsed || parsed.countryCallingCode !== "256" || !UG_NATIONAL.test(String(parsed.nationalNumber))) return null;
  return parsed.number;
}

/**
 * Normalise a Ugandan phone number. Accepts "0772 418 903", "+256772418903",
 * "256772418903", 772418903 (Excel number) and cells holding several numbers
 * separated by "/", "," or ";". The first valid number becomes the primary.
 */
export function normalizeUgPhone(input: unknown): PhoneResult | null {
  if (input === null || input === undefined) return null;
  const raw = String(input).trim();
  if (!raw || isBlankToken(raw)) return null;

  const parts = raw.split(/[/,;]|\s{2,}|\bor\b|&/i).map((p) => p.trim()).filter(Boolean);
  const valid = parts.map(parseOne).filter((n): n is string => n !== null);
  const unique = [...new Set(valid)];

  if (unique.length === 0) {
    return { raw, e164: null, display: raw, valid: false, extra: [] };
  }
  const [primary, ...rest] = unique;
  return { raw, e164: primary, display: formatUgPhone(primary), valid: true, extra: rest };
}

/** Light input mask for typing: groups digits as 07XX XXX XXX. */
export function maskUgPhoneInput(value: string): string {
  const d = value.replace(/\D/g, "").slice(0, 10);
  if (d.length <= 4) return d;
  if (d.length <= 7) return `${d.slice(0, 4)} ${d.slice(4)}`;
  return `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
}
