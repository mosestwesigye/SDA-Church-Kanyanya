import { createDbClient, type Db } from "@/server/db";
import { loadAuthContext } from "@/server/authz/context";
import { createStaffUser } from "@/server/admin/users";
import { SYSTEM_ACTOR } from "@/server/audit/audit";
import { ensureReferenceData } from "@/server/setup/reference-data";
import type { RoleKey } from "@/server/authz/catalog";

export const TEST_URL = process.env.TEST_DATABASE_URL ?? "postgresql://sdak:sdak@localhost:5432/sdak_test";

let shared: Db | null = null;

export async function testDb(): Promise<Db> {
  if (!shared) {
    shared = createDbClient(TEST_URL);
    await ensureReferenceData(shared);
  }
  return shared;
}

let n = 0;
const uniq = () => `${Date.now().toString(36)}${(n++).toString(36)}`;

/** Create a user with the given roles and return their AuthContext. */
export async function userWith(db: Db, roles: RoleKey[], extra: { ministryLabels?: string[]; memberId?: string } = {}) {
  const ministryIds = extra.ministryLabels
    ? (await db.listItem.findMany({ where: { type: "MINISTRY", label: { in: extra.ministryLabels } } })).map((m) => m.id)
    : undefined;
  const user = await createStaffUser(db, SYSTEM_ACTOR, {
    name: `Test ${roles.join("+")} ${uniq()}`,
    email: `${uniq()}@test.example.org`,
    password: "Test-password-123",
    roles,
    ministryIds,
    memberId: extra.memberId ?? null,
  });
  return loadAuthContext(db, user.id, { sessionId: `sess-${uniq()}`, ipAddress: "127.0.0.1" });
}

export async function listId(db: Db, type: "ZONE" | "MINISTRY" | "MINISTRY_ROLE" | "PROFESSION", label: string) {
  return (await db.listItem.findFirstOrThrow({ where: { type, label } })).id;
}

/** Insert a member directly (bypasses the service; for fixtures only). */
export async function rawMember(db: Db, data: Partial<Parameters<Db["member"]["create"]>[0]["data"]> = {}) {
  return db.member.create({
    data: {
      lastName: "Fixture",
      firstName: uniq(),
      ...data,
    } as Parameters<Db["member"]["create"]>[0]["data"],
  });
}
