import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Db } from "@/server/db";
import { createMember, updateMember } from "@/server/members/service";
import { testDb, userWith } from "./helpers";

// The route resolves the signed-in user through getContext(); swap it for a test context.
const current: { ctx: unknown } = { ctx: null };
vi.mock("@/server/auth/session", () => ({ getContext: async () => current.ctx }));
vi.mock("@/server/db", async (orig) => {
  const real = await orig<typeof import("@/server/db")>();
  return { ...real, db: real.createDbClient(process.env.TEST_DATABASE_URL ?? "postgresql://sdak:sdak@localhost:5432/sdak_test") };
});

let db: Db;
let clerk: Awaited<ReturnType<typeof userWith>>;
let POST: (r: Request) => Promise<Response>;

beforeAll(async () => {
  db = await testDb();
  clerk = await userWith(db, ["CHURCH_CLERK"]);
  ({ POST } = await import("@/app/api/sync/member-update/route"));
});
afterAll(async () => {
  await db.$disconnect();
});

const call = (body: unknown) => POST(new Request("http://localhost/api/sync/member-update", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }));

describe("offline outbox sync", () => {
  it("applies a queued edit once (retries are idempotent) and audits it", async () => {
    current.ctx = { ...clerk, twoFactorEnabled: true };
    const m = await createMember(db, clerk, { lastName: "Offline", firstName: "Edit" });
    const clientId = crypto.randomUUID();
    const body = { clientId, memberId: m.id, version: m.version, patch: { nextOfKinName: "Queued Kin" } };
    expect((await call(body)).status).toBe(200);
    expect((await call(body)).status).toBe(200); // lost response, client retries
    const after = await db.member.findUniqueOrThrow({ where: { id: m.id } });
    expect(after.nextOfKinName).toBe("Queued Kin");
    expect(after.version).toBe(m.version + 1);
    expect(await db.auditLog.count({ where: { correlationId: clientId, field: "nextOfKinName" } })).toBe(1);
  });

  it("rejects a stale edit with 409 instead of overwriting", async () => {
    current.ctx = { ...clerk, twoFactorEnabled: true };
    const m = await createMember(db, clerk, { lastName: "Offline", firstName: "Stale" });
    await updateMember(db, clerk, m.id, { email: "online@example.org" }); // someone else, while we were offline
    const res = await call({ clientId: crypto.randomUUID(), memberId: m.id, version: m.version, patch: { email: "offline@example.org" } });
    expect(res.status).toBe(409);
    expect((await db.member.findUniqueOrThrow({ where: { id: m.id } })).email).toBe("online@example.org");
  });

  it("requires 2FA where the role demands it", async () => {
    current.ctx = clerk; // Clerk without 2FA set up
    expect((await call({ clientId: crypto.randomUUID(), memberId: "x", version: 1, patch: {} })).status).toBe(403);
  });

  it("enforces sign-in and field permissions", async () => {
    const m = await createMember(db, clerk, { lastName: "Offline", firstName: "Perm" });
    current.ctx = null;
    expect((await call({ clientId: crypto.randomUUID(), memberId: m.id, version: 1, patch: { firstName: "X" } })).status).toBe(401);
    current.ctx = await userWith(db, ["ELDER"]); // read-only role
    expect((await call({ clientId: crypto.randomUUID(), memberId: m.id, version: m.version, patch: { firstName: "X" } })).status).toBe(403);
    current.ctx = { ...clerk, twoFactorEnabled: true };
    expect((await call({ clientId: "not-a-uuid", memberId: m.id, version: 1, patch: {} })).status).toBe(400);
    expect((await call({ clientId: crypto.randomUUID(), memberId: m.id, version: m.version, patch: { phone: "12" } })).status).toBe(422);
  });
});
