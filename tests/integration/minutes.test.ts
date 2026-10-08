import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { addMinutesFile, createMinutes, deleteMinutes, getMinutes, listMinutes, openMinutesFile, removeMinutesFile, updateMinutes } from "@/server/minutes/service";
import { testDb, userWith } from "./helpers";

let db: Db;
let clerk: Awaited<ReturnType<typeof userWith>>;
const year = 2019 + Math.floor(Math.random() * 6); // keep references distinct between test runs

beforeAll(async () => {
  db = await testDb();
  clerk = await userWith(db, ["CHURCH_CLERK"]);
  // Fresh numbering for the year under test.
  await db.meetingMinutes.deleteMany({ where: { reference: { contains: `/${year}/` } } });
});
afterAll(async () => {
  await db.$disconnect();
});

const base = (over: Record<string, unknown> = {}) => ({
  type: "CHURCH_BOARD" as const, title: "Church Board Meeting", heldOn: `${year}-03-09`, startTime: "14:30", venue: "Boardroom",
  chairperson: "Pr. Test Chair", secretary: "Test Clerk", attendance: "12", summary: "1. Voted to hold a health week.", status: "DRAFT" as const, approvedOn: "",
  ...over,
});
const pdf = (text = "minutes") => ({ name: "minutes.pdf", data: Buffer.from(`%PDF-1.4\n% ${text}\n%%EOF`) });

describe("board minutes", () => {
  it("only staff with access can read or record minutes", async () => {
    const treasurer = await userWith(db, ["TREASURER"]);
    await expect(listMinutes(db, treasurer)).rejects.toBeInstanceOf(ForbiddenError);
    const elder = await userWith(db, ["ELDER"]);
    await expect(listMinutes(db, elder)).resolves.toBeTruthy();
    await expect(createMinutes(db, elder, base())).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("numbers minutes per meeting type and year, and validates dates", async () => {
    const a = await createMinutes(db, clerk, base());
    const b = await createMinutes(db, clerk, base({ heldOn: `${year}-04-13` }));
    const c = await createMinutes(db, clerk, base({ type: "BUSINESS_MEETING", title: "Business Meeting" }));
    expect([a.reference, b.reference, c.reference]).toEqual([`CB/${year}/01`, `CB/${year}/02`, `BM/${year}/01`]);
    await expect(createMinutes(db, clerk, base({ heldOn: "2999-01-01" }))).rejects.toThrow();
    await expect(createMinutes(db, clerk, base({ status: "APPROVED", approvedOn: "" }))).rejects.toThrow();
    await expect(createMinutes(db, clerk, base({ status: "APPROVED", approvedOn: `${year}-01-01` }))).rejects.toThrow();
    expect(await db.auditLog.count({ where: { entity: "MeetingMinutes", entityId: a.id, action: "CREATE" } })).toBe(1);
  });

  it("records each change and approval in the history", async () => {
    const m = await createMinutes(db, clerk, base({ heldOn: `${year}-05-11` }));
    const { changed } = await updateMinutes(db, clerk, m.id, base({ heldOn: `${year}-05-11`, venue: "Main hall", status: "APPROVED", approvedOn: `${year}-06-08` }));
    expect(changed.sort()).toEqual(["approvedOn", "status", "venue"]);
    const got = await getMinutes(db, clerk, m.id);
    expect(got.status).toBe("APPROVED");
    expect(got.history.map((h) => h.action)).toContain("APPROVE");
    expect(await db.auditLog.count({ where: { entity: "MeetingMinutes", entityId: m.id, field: "venue", oldValue: { equals: "Boardroom" } } })).toBe(1);
  });

  it("stores files with a fingerprint, accepts Word documents and refuses anything else", async () => {
    const m = await createMinutes(db, clerk, base({ heldOn: `${year}-07-06` }));
    const f = await addMinutesFile(db, clerk, m.id, pdf());
    expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(f.mimeType).toBe("application/pdf");
    const docx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("....word/document.xml....")]);
    expect((await addMinutesFile(db, clerk, m.id, { name: "minutes.docx", data: docx })).mimeType).toContain("wordprocessingml");
    await expect(addMinutesFile(db, clerk, m.id, { name: "fake.pdf", data: Buffer.from("not a pdf") })).rejects.toBeInstanceOf(ValidationError);
    await expect(addMinutesFile(db, clerk, m.id, { name: "big.pdf", data: Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(4 * 1024 * 1024)]) })).rejects.toBeInstanceOf(ValidationError);

    const pastor = await userWith(db, ["PASTOR"]);
    const opened = await openMinutesFile(db, pastor, f.id);
    expect(opened.meta.fileName).toBe("minutes.pdf");
    expect(await db.auditLog.count({ where: { entity: "MinutesFile", entityId: f.id, action: "EXPORT", actorUserId: pastor.userId } })).toBe(1);

    await removeMinutesFile(db, clerk, f.id);
    await expect(openMinutesFile(db, pastor, f.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await getMinutes(db, clerk, m.id)).files).toHaveLength(1);
  });

  it("removal needs a reason, hides the minutes and never reuses the reference", async () => {
    const m = await createMinutes(db, clerk, base({ type: "ELDERS_COUNCIL", title: "Elders", heldOn: `${year}-08-03` }));
    await expect(deleteMinutes(db, clerk, m.id, "")).rejects.toBeInstanceOf(ValidationError);
    await deleteMinutes(db, clerk, m.id, "Recorded twice");
    expect((await listMinutes(db, clerk, { year })).rows.some((r) => r.id === m.id)).toBe(false);
    await expect(getMinutes(db, clerk, m.id)).rejects.toBeInstanceOf(NotFoundError);
    const next = await createMinutes(db, clerk, base({ type: "ELDERS_COUNCIL", title: "Elders", heldOn: `${year}-08-04` }));
    expect(next.reference).toBe(`EC/${year}/02`);
  });

  it("searches by reference, title and decisions, and filters by year and type", async () => {
    await createMinutes(db, clerk, base({ heldOn: `${year}-09-07`, summary: "Approved the Zebra-fund appeal" }));
    expect((await listMinutes(db, clerk, { q: "zebra-fund" })).rows).toHaveLength(1);
    const byType = await listMinutes(db, clerk, { year, type: "BUSINESS_MEETING" });
    expect(byType.rows.every((r) => r.type === "BUSINESS_MEETING")).toBe(true);
    expect(byType.years).toContain(year);
  });
});
