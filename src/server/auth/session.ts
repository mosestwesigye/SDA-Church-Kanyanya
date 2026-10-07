import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { loadAuthContext } from "../authz/context";
import { can, type AuthContext } from "../authz/policy";
import type { Resource } from "../authz/catalog";
import { db } from "../db";
import { auth } from "./auth";

export type RequestContext = Awaited<ReturnType<typeof loadAuthContext>>;

function clientIp(h: Headers): string | null {
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
}

const getSession = cache(async () => auth.api.getSession({ headers: await headers() }));

/** Current user's auth context, or null when signed out (or still owing the authenticator code). Cached per request. */
export const getContext = cache(async (): Promise<RequestContext | null> => {
  const h = await headers();
  const session = await getSession();
  if (!session || session.session.secondFactorPending) return null;
  const ctx = await loadAuthContext(db, session.user.id, { sessionId: session.session.id, ipAddress: clientIp(h) });
  return ctx.active ? ctx : null;
});

/**
 * Require a signed-in user. Users whose role mandates 2FA are sent to set it
 * up before they can reach anything else.
 */
export async function requireContext(opts: { allowWithout2fa?: boolean } = {}): Promise<RequestContext> {
  const ctx = await getContext();
  if (!ctx) redirect((await getSession())?.session.secondFactorPending ? "/login/verify?google=1" : "/login");
  if (ctx.requires2fa && !ctx.twoFactorEnabled && !opts.allowWithout2fa) redirect("/account/two-factor?required=1");
  return ctx;
}

/** Require a permission for a page; otherwise show the permission-denied screen. */
export async function requirePermission(resource: Resource, action: string): Promise<RequestContext> {
  const ctx = await requireContext();
  if (!can(ctx as AuthContext, resource, action)) redirect(`/denied?need=${encodeURIComponent(`${resource}:${action}`)}`);
  return ctx;
}
