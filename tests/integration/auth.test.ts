import { generateSync } from "otplib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db";
import { createAuth, type Auth } from "@/server/auth/auth";
import { hit, LOGIN_LIMITS } from "@/server/auth/rate-limit";
import { createStaffUser } from "@/server/admin/users";
import { SYSTEM_ACTOR } from "@/server/audit/audit";
import { loadAuthContext } from "@/server/authz/context";
import { testDb } from "./helpers";

let db: Db;
let auth: Auth;
const PASSWORD = "Clerk-password-2026";

beforeAll(async () => {
  process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-123";
  process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
  db = await testDb();
  auth = createAuth(db);
});
afterAll(async () => {
  await db.$disconnect();
});

function cookieHeaders(res: Response): Headers {
  const cookies = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  return new Headers({ cookie: cookies });
}

async function signIn(email: string, password: string) {
  return auth.api.signInEmail({ body: { email, password }, asResponse: true, headers: new Headers({ "x-forwarded-for": "10.0.0.1" }) });
}

describe("staff sign-in", () => {
  it("signs in with argon2-hashed credentials and audits the login", async () => {
    const u = await createStaffUser(db, SYSTEM_ACTOR, { name: "Login Clerk", email: "login.clerk@test.example.org", password: PASSWORD, roles: ["CHURCH_CLERK"] });
    const account = await db.account.findFirstOrThrow({ where: { userId: u.id } });
    expect(account.password).toMatch(/^\$argon2id\$/);

    const res = await signIn("login.clerk@test.example.org", PASSWORD);
    expect(res.status).toBe(200);
    const session = await auth.api.getSession({ headers: cookieHeaders(res) });
    expect(session?.user.id).toBe(u.id);
    expect(await db.auditLog.count({ where: { actorUserId: u.id, action: "LOGIN" } })).toBe(1);
  });

  it("rejects a wrong password", async () => {
    const res = await signIn("login.clerk@test.example.org", "wrong-password-123");
    expect(res.status).toBe(401);
  });

  it("refuses sign-in for a deactivated user", async () => {
    const u = await createStaffUser(db, SYSTEM_ACTOR, { name: "Gone", email: "gone@test.example.org", password: PASSWORD, roles: ["ELDER"] });
    await db.user.update({ where: { id: u.id }, data: { active: false } });
    const res = await signIn("gone@test.example.org", PASSWORD);
    expect(res.status).not.toBe(200);
  });

  it("public sign-up is disabled", async () => {
    const res = await auth.api.signUpEmail({ body: { name: "X", email: "x@test.example.org", password: PASSWORD }, asResponse: true });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe("TOTP two-factor", () => {
  it("is required for System Admins only", async () => {
    const admin = await createStaffUser(db, SYSTEM_ACTOR, { name: "Req", email: "req2fa@test.example.org", password: PASSWORD, roles: ["SYSTEM_ADMIN"] });
    const clerk = await createStaffUser(db, SYSTEM_ACTOR, { name: "Opt", email: "opt2fa@test.example.org", password: PASSWORD, roles: ["CHURCH_CLERK"] });
    expect((await loadAuthContext(db, admin.id)).requires2fa).toBe(true);
    expect((await loadAuthContext(db, clerk.id)).requires2fa).toBe(false);
  });

  it("enrols with a standard authenticator code and then demands it at sign-in", async () => {
    await createStaffUser(db, SYSTEM_ACTOR, { name: "Two Factor", email: "tf@test.example.org", password: PASSWORD, roles: ["SYSTEM_ADMIN"] });
    const first = await signIn("tf@test.example.org", PASSWORD);
    const headers = cookieHeaders(first);

    const enable = await auth.api.enableTwoFactor({ body: { password: PASSWORD }, headers });
    if (enable.method !== "totp") throw new Error("expected TOTP enrolment");
    const secret = new URL(enable.totpURI).searchParams.get("secret")!;
    expect(enable.backupCodes.length).toBeGreaterThan(0);
    await auth.api.verifyTOTP({ body: { code: generateSync({ secret }) }, headers });
    const user = await db.user.findUniqueOrThrow({ where: { email: "tf@test.example.org" } });
    expect(user.twoFactorEnabled).toBe(true);

    // Next sign-in stops at the second factor…
    const second = await signIn("tf@test.example.org", PASSWORD);
    const body = await second.json();
    expect(body.twoFactorRedirect).toBe(true);
    const pending = cookieHeaders(second);
    expect(await auth.api.getSession({ headers: pending })).toBeNull();

    // …a wrong code fails, the right one completes it.
    await expect(auth.api.verifyTOTP({ body: { code: "000000" }, headers: pending })).rejects.toThrow();
    const ok = await auth.api.verifyTOTP({ body: { code: generateSync({ secret }) }, headers: pending, asResponse: true });
    expect(ok.status).toBe(200);
    const session = await auth.api.getSession({ headers: cookieHeaders(ok) });
    expect(session?.user.email).toBe("tf@test.example.org");
  });
});

describe("rate limiting", () => {
  it("locks an account key after 5 attempts in the window and reopens after it", async () => {
    const key = `login:acct:${Date.now()}`;
    const t0 = 1_000_000;
    for (let i = 0; i < LOGIN_LIMITS.perAccount.max; i++) {
      expect((await hit(db, key, LOGIN_LIMITS.perAccount, t0 + i)).allowed).toBe(true);
    }
    const blocked = await hit(db, key, LOGIN_LIMITS.perAccount, t0 + 10);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    const later = await hit(db, key, LOGIN_LIMITS.perAccount, t0 + LOGIN_LIMITS.perAccount.windowSeconds * 1000 + 1);
    expect(later.allowed).toBe(true);
  });
});
