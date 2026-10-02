import { describe, expect, it } from "vitest";
import { maskUgPhoneInput, normalizeUgPhone } from "@/lib/phone";

describe("normalizeUgPhone", () => {
  it.each([
    ["0772 418 903", "+256772418903", "0772 418 903"],
    ["+256772418903", "+256772418903", "0772 418 903"],
    ["256 772 418903", "+256772418903", "0772 418 903"],
    [772418903, "+256772418903", "0772 418 903"], // Excel dropped the leading zero
    ["0797-574-104", "+256797574104", "0797 574 104"], // newer ranges accepted
    ["0414 123456", "+256414123456", "0414 123 456"], // landline
  ])("normalises %s", (input, e164, display) => {
    const r = normalizeUgPhone(input)!;
    expect(r.valid).toBe(true);
    expect(r.e164).toBe(e164);
    expect(r.display).toBe(display);
  });

  it.each(["0772 45 678", "07449508", "123", "0888123456789"])("rejects %s", (input) => {
    const r = normalizeUgPhone(input)!;
    expect(r.valid).toBe(false);
    expect(r.e164).toBeNull();
    expect(r.display).toBe(String(input));
  });

  it("treats placeholders as empty", () => {
    expect(normalizeUgPhone("-")).toBeNull();
    expect(normalizeUgPhone("--")).toBeNull();
    expect(normalizeUgPhone("N/A")).toBeNull();
    expect(normalizeUgPhone("")).toBeNull();
    expect(normalizeUgPhone(null)).toBeNull();
  });

  it("keeps the first valid number and lists the rest", () => {
    const r = normalizeUgPhone("0703753832/ 0777123456")!;
    expect(r.e164).toBe("+256703753832");
    expect(r.extra).toEqual(["+256777123456"]);
  });

  it("masks typing as 07XX XXX XXX", () => {
    expect(maskUgPhoneInput("0772418903")).toBe("0772 418 903");
    expect(maskUgPhoneInput("07724")).toBe("0772 4");
  });
});
