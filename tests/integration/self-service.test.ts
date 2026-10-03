import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db";
import { createAuth, type Auth } from "@/server/auth/auth";
import { loadAuthContext } from "@/server/authz/context";
import { can } from "@/server/authz/policy";
import { ConflictError, ForbiddenError, ValidationError } from "@/server/errors";
import { createMember, updateMember } from "@/server/members/service";
import { smsOutbox } from "@/server/notify/sms";
import {
  cancelOwnCorrectionRequest,
  correctionQueue,
  createCorrectionRequest,
  decideCorrectionRequest,
  getOwnRecord,
  hasCurrentConsent,
  provisionMemberLogin,
  recordSelfServiceConsent,
} from "@/server/selfservice/service";
import { listId, testDb, userWith } from "./helpers";

let db: Db;
let auth: Auth;
let clerk: Awaited<ReturnType<typeof userWith>>;

beforeAll(async () => {
  process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-123";
  process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
  db = await testDb();
  auth = createAuth(db);
  clerk = await userWith(db, ["CHURCH_CLERK"]);
});
afterAll(async () => {
  await db.$disconnect();
});

let seq = 0;
/** A fictitious, unused Ugandan mobile number. */
const phone = () => `0700${String(Date.now() % 100000).padStart(5, "0")}${seq++ % 10}`;
const e164 = (p: string) => `+256${p.slice(1)}`;

async function memberLogin(p = phone()) {
  const m = await createMember(db, clerk, { lastName: "Self", firstName: `Service${seq}`, phone: p });
  const to = await provisionMemberLogin(db, p);
  expect(to).toBe(e164(p));
  const user = await db.user.findUniqueOrThrow({ where: { phoneNumber: to! } });
  return { m, ctx: await loadAuthContext(db, user.id, { sessionId: `s-${seq}` }), phone: p };
}

describe("phone sign-in", () => {
  it("provisions a member login from the register (audited) and signs in with the SMS code", async () => {
    const p = phone();
    const m = await createMember(db, clerk, { lastName: "Otp", firstName: "Member", phone: p });
    const to = await provisionMemberLogin(db, p);
    const user = await db.user.findUniqueOrThrow({ where: { phoneNumber: to! }, include: { roles: { include: { role: true } } } });
    expect(user.memberId).toBe(m.id);
    expect(user.roles.map((r) => r.role.key)).toEqual(["MEMBER"]);
    expect(await db.auditLog.count({ where: { entity: "User", entityId: user.id, action: "CREATE", source: "SELF_SERVICE" } })).toBe(1);
    // Idempotent.
    expect(await provisionMemberLogin(db, p)).toBe(to);
    expect(await db.user.count({ where: { memberId: m.id } })).toBe(1);

    smsOutbox.length = 0;
    await auth.api.sendPhoneNumberOTP({ body: { phoneNumber: to! } });
    const code = smsOutbox.at(-1)!.text.slice(0, 6);
    expect(smsOutbox.at(-1)!.to).toBe(to);
    await expect(auth.api.verifyPhoneNumber({ body: { phoneNumber: to!, code: code === "000000" ? "111111" : "000000" } })).rejects.toThrow();
    const res = await auth.api.verifyPhoneNumber({ body: { phoneNumber: to!, code }, asResponse: true });
    expect(res.status).toBe(200);
    const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
    expect(session?.user.id).toBe(user.id);
    expect(await db.auditLog.count({ where: { actorUserId: user.id, action: "LOGIN" } })).toBe(1);
  });

  it("never sends codes for unknown, shared, deceased or staff-linked numbers", async () => {
    expect(await provisionMemberLogin(db, "0700 000 001")).toBeNull();
    expect(await provisionMemberLogin(db, "not a phone")).toBeNull();

    const shared = phone();
    await createMember(db, clerk, { lastName: "Shared", firstName: "One", phone: shared });
    await createMember(db, clerk, { lastName: "Shared", firstName: "Two", phone: shared });
    expect(await provisionMemberLogin(db, shared)).toBeNull();

    const dead = phone();
    const d = await createMember(db, clerk, { lastName: "Late", firstName: "Member", phone: dead });
    await updateMember(db, clerk, d.id, { status: "DECEASED" });
    expect(await provisionMemberLogin(db, dead)).toBeNull();

    const staffPhone = phone();
    const s = await createMember(db, clerk, { lastName: "Staff", firstName: "Member", phone: staffPhone });
    await userWith(db, ["ELDER"], { memberId: s.id });
    expect(await provisionMemberLogin(db, staffPhone)).toBeNull();

    // The plugin itself stays silent for numbers without a login.
    smsOutbox.length = 0;
    await auth.api.sendPhoneNumberOTP({ body: { phoneNumber: e164(shared) } });
    expect(smsOutbox).toHaveLength(0);
  });

  it("deactivated member logins get no code", async () => {
    const { ctx, phone: p } = await memberLogin();
    await db.user.update({ where: { id: ctx.userId }, data: { active: false } });
    expect(await provisionMemberLogin(db, p)).toBeNull();
  });
});

describe("member permissions", () => {
  it("a member sees only their own record and can't use staff features", async () => {
    const { m, ctx } = await memberLogin();
    expect(ctx.roles).toEqual(["MEMBER"]);
    const own = await getOwnRecord(db, ctx);
    expect(own.id).toBe(m.id);
    expect(own.restricted).toEqual([]);
    expect(can(ctx, "export", "run")).toBe(false);
    expect(can(ctx, "correction_request", "review")).toBe(false);
    await expect(correctionQueue(db, ctx)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateMember(db, ctx, m.id, { firstName: "Hacked" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("records DPPA consent once per policy version (audited)", async () => {
    const { m, ctx } = await memberLogin();
    expect(await hasCurrentConsent(db, m.id)).toBe(false);
    await recordSelfServiceConsent(db, ctx);
    await recordSelfServiceConsent(db, ctx);
    expect(await hasCurrentConsent(db, m.id)).toBe(true);
    expect(await db.consent.count({ where: { memberId: m.id, method: "SELF_SERVICE" } })).toBe(1);
    expect(await db.auditLog.count({ where: { memberId: m.id, entity: "Consent", source: "SELF_SERVICE" } })).toBe(1);
  });
});

describe("correction requests", () => {
  it("member requests → clerk sees a diff → partial approval applies only chosen fields, all audited", async () => {
    const { m, ctx } = await memberLogin();
    const zone = await listId(db, "ZONE", "Lugoba");
    const req = await createCorrectionRequest(db, ctx, { firstName: "Corrected", zoneId: zone, nextOfKinName: "Kin Person", email: "", note: "New zone since June" });
    // Nothing changes before review.
    expect((await db.member.findUniqueOrThrow({ where: { id: m.id } })).zoneId).toBeNull();
    await expect(createCorrectionRequest(db, ctx, { firstName: "Again" })).rejects.toBeInstanceOf(ConflictError);
    expect(await db.auditLog.count({ where: { entity: "CorrectionRequest", entityId: req.id, action: "CREATE", source: "SELF_SERVICE" } })).toBe(1);

    const queue = await correctionQueue(db, clerk);
    const item = queue.find((q) => q.id === req.id)!;
    expect(item.rows.map((r) => r.field).sort()).toEqual(["firstName", "nextOfKinName", "zoneId"]); // blank email = no change
    expect(item.rows.find((r) => r.field === "zoneId")).toMatchObject({ from: "", to: "Lugoba", now: "" });

    await expect(decideCorrectionRequest(db, clerk, req.id, { approve: false })).rejects.toBeInstanceOf(ValidationError);
    await decideCorrectionRequest(db, clerk, req.id, { approve: true, fields: ["zoneId", "nextOfKinName"], note: "Name spelling to confirm in person" });
    const after = await db.member.findUniqueOrThrow({ where: { id: m.id } });
    expect(after).toMatchObject({ zoneId: zone, nextOfKinName: "Kin Person" });
    expect(after.firstName).not.toBe("Corrected");

    const changes = await db.auditLog.findMany({ where: { memberId: m.id, entity: "Member", source: "SELF_SERVICE" } });
    expect(changes.map((c) => c.field).sort()).toEqual(["nextOfKinName", "zoneId"]);
    expect(changes.every((c) => c.actorUserId === clerk.userId)).toBe(true);
    expect(await db.auditLog.findFirst({ where: { entity: "CorrectionRequest", entityId: req.id, action: "APPROVE" } })).toMatchObject({
      newValue: { applied: ["zoneId", "nextOfKinName"], declined: ["firstName"] },
    });
    await expect(decideCorrectionRequest(db, clerk, req.id, { approve: true })).rejects.toThrow();
  });

  it("rejects need a reason; members can cancel their own pending request", async () => {
    const { ctx } = await memberLogin();
    const r1 = await createCorrectionRequest(db, ctx, { lastName: "Typo" });
    await decideCorrectionRequest(db, clerk, r1.id, { approve: false, note: "Please bring your ID" });
    expect((await db.correctionRequest.findUniqueOrThrow({ where: { id: r1.id } })).state).toBe("REJECTED");
    const r2 = await createCorrectionRequest(db, ctx, { lastName: "Typo2" });
    await cancelOwnCorrectionRequest(db, ctx, r2.id);
    expect((await db.correctionRequest.findUniqueOrThrow({ where: { id: r2.id } })).state).toBe("CANCELLED");
    await expect(createCorrectionRequest(db, ctx, { phone: "12345" })).rejects.toBeInstanceOf(ValidationError);
    await expect(createCorrectionRequest(db, ctx, {})).rejects.toBeInstanceOf(ValidationError);
  });

  it("a ministry head can't review corrections and a member can't touch another member's request", async () => {
    const a = await memberLogin();
    const b = await memberLogin();
    const r = await createCorrectionRequest(db, a.ctx, { lastName: "Other" });
    await expect(cancelOwnCorrectionRequest(db, b.ctx, r.id)).rejects.toThrow();
    const head = await userWith(db, ["MINISTRY_HEAD"], { ministryLabels: ["Youth"] });
    await expect(decideCorrectionRequest(db, head, r.id, { approve: true })).rejects.toBeInstanceOf(ForbiddenError);
  });
});
