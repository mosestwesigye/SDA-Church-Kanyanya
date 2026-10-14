import { getContext } from "@/server/auth/session";
import { can } from "@/server/authz/policy";
import { getConferenceReturn, periodSchema } from "@/server/conference/service";
import { conferenceFormXlsx } from "@/server/conference/xlsx";
import { db } from "@/server/db";

/** The church's row in the Central Uganda Conference form layout (aggregate figures only, no personal data). */
export async function GET(request: Request) {
  const ctx = await getContext();
  if (!ctx) return new Response("Sign in required", { status: 401 });
  if (ctx.requires2fa && !ctx.twoFactorEnabled) return new Response("Two-step verification required", { status: 403 });
  if (!can(ctx, "conference_return", "read")) return new Response("You don’t have access to the Conference return.", { status: 403 });
  const parsed = periodSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return new Response("Choose a year and quarter.", { status: 400 });
  const r = await getConferenceReturn(db, ctx, parsed.data);
  const body = await conferenceFormXlsx(r);
  return new Response(new Uint8Array(body) as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="kanyanya-statistical-report-${r.period.year}-q${r.period.quarter}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
