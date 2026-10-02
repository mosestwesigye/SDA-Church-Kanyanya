"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { AuditWriter } from "@/server/audit/audit";
import { auth } from "@/server/auth/auth";
import { requireContext } from "@/server/auth/session";
import { db } from "@/server/db";

export async function revokeSessionAction(form: FormData) {
  const ctx = await requireContext();
  const token = String(form.get("token") ?? "");
  // Only the caller's own sessions can be revoked here.
  const target = await db.session.findFirst({ where: { token, userId: ctx.userId }, select: { id: true } });
  if (!target) return;
  await auth.api.revokeSession({ body: { token }, headers: await headers() });
  await new AuditWriter(db, { userId: ctx.userId, label: ctx.label, sessionId: ctx.sessionId, ipAddress: ctx.ipAddress }, "UI").log({
    action: "SECURITY",
    entity: "Session",
    entityId: target.id,
    note: "Session revoked by user",
  });
  revalidatePath("/account");
}
