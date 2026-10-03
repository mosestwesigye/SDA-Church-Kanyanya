import { z } from "zod";
import { getContext } from "@/server/auth/session";
import { db } from "@/server/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { updateMember } from "@/server/members/service";

const body = z.object({
  clientId: z.uuid(),
  memberId: z.string().min(1),
  version: z.number().int().min(1),
  patch: z.record(z.string(), z.unknown()),
});

/**
 * Apply one edit queued offline. Uses the record version the edit was based
 * on (409 if the member changed since) and the client id as the audit
 * correlation id, so a retry after a lost response is applied only once.
 */
export async function POST(request: Request) {
  const ctx = await getContext();
  if (!ctx) return new Response("Sign in required", { status: 401 });
  if (ctx.requires2fa && !ctx.twoFactorEnabled) return new Response("Two-step verification required", { status: 403 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response("Invalid request", { status: 400 });
  const { clientId, memberId, version, patch } = parsed.data;

  if (await db.auditLog.findFirst({ where: { correlationId: clientId, actorUserId: ctx.userId }, select: { id: true } })) {
    return Response.json({ ok: true, duplicate: true });
  }
  try {
    const { changes } = await updateMember(db, ctx, memberId, patch, { expectedVersion: version, correlationId: clientId, note: "Saved offline, synced later" });
    return Response.json({ ok: true, changes: changes.length });
  } catch (e) {
    if (e instanceof ConflictError) return new Response("Someone else changed this member while you were offline. Open the record and make the change again.", { status: 409 });
    if (e instanceof ValidationError) return new Response(e.message, { status: 422 });
    if (e instanceof ForbiddenError) return new Response(e.message, { status: 403 });
    if (e instanceof NotFoundError) return new Response(e.message, { status: 404 });
    if (e instanceof z.ZodError) return new Response("Some fields were not valid.", { status: 422 });
    throw e;
  }
}
