import type { Metadata } from "next";
import { Require2fa } from "@/components/admin/matrix-widgets";
import { RevokeSession } from "@/components/admin/session-widgets";
import { ROLE_LABELS, type RoleKey } from "@/server/authz/catalog";
import { SESSION_IDLE_MINUTES } from "@/server/auth/auth";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Security · Admin" };

function device(ua: string | null) {
  if (!ua) return "Unknown device";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "Other";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${browser} on ${os}`;
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000);

export default async function SecurityPage() {
  const ctx = await requirePermission("admin.security", "manage");
  const since = daysAgo(7);
  const [roles, sessions, failed, events] = await Promise.all([
    db.role.findMany({ orderBy: { createdAt: "asc" } }),
    db.session.findMany({ where: { expiresAt: { gt: new Date() } }, include: { user: { select: { name: true } } }, orderBy: { updatedAt: "desc" }, take: 100 }),
    db.auditLog.count({ where: { action: "LOGIN_FAILED", at: { gte: since } } }),
    db.auditLog.findMany({ where: { action: { in: ["SECURITY", "LOGIN_FAILED"] } }, orderBy: { id: "desc" }, take: 12 }),
  ]);
  const fmt = (d: Date) => d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Kampala" });
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-5">
        <section className="card">
          <div className="border-b border-line p-5">
            <h2 className="text-[17px] font-semibold">Signed-in sessions ({sessions.length})</h2>
            <p className="mt-1 text-[14px] text-ink-2">Sessions end after {SESSION_IDLE_MINUTES} minutes without activity (set with SESSION_IDLE_MINUTES). Sign out any you don’t recognise.</p>
          </div>
          {sessions.length === 0 ? (
            <p className="p-5 text-ink-2">Nobody is signed in.</p>
          ) : (
            <ul>
              {sessions.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3 last:border-0">
                  <span>
                    <span className="block font-semibold">{s.user.name}{s.id === ctx.sessionId && <span className="ml-2 rounded bg-primary-soft px-2 py-0.5 text-[12px] text-primary">You</span>}</span>
                    <span className="block text-[13px] text-ink-2">{device(s.userAgent)} · last active {fmt(s.updatedAt)}{s.ipAddress ? ` · ${s.ipAddress}` : ""}</span>
                  </span>
                  {s.id !== ctx.sessionId && <RevokeSession sessionId={s.id} label={`${s.user.name} on ${device(s.userAgent)}`} />}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card p-5">
          <h2 className="mb-3 text-[17px] font-semibold">Recent security events</h2>
          {events.length === 0 ? (
            <p className="text-ink-2">None recorded.</p>
          ) : (
            <ul className="divide-y divide-line text-[14px]">
              {events.map((e) => (
                <li key={e.id.toString()} className="flex flex-wrap justify-between gap-2 py-2">
                  <span>
                    <span className={e.action === "LOGIN_FAILED" ? "text-error" : ""}>{e.action === "LOGIN_FAILED" ? "Failed sign-in" : `${e.entity}${e.field ? ` · ${e.field}` : ""}`}</span>
                    <span className="text-ink-2"> — {e.actorLabel}{e.note ? ` · ${e.note}` : ""}</span>
                  </span>
                  <span className="text-ink-2">{fmt(e.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <aside className="space-y-5">
        <section className="card p-5">
          <h2 className="text-[17px] font-semibold">Two-step verification</h2>
          <p className="mb-2 mt-1 text-[14px] text-ink-2">Roles that must use an authenticator app. Members sign in with an SMS code instead.</p>
          {roles.filter((r) => r.key !== "MEMBER").map((r) => (
            <Require2fa key={r.id} roleId={r.id} name={ROLE_LABELS[r.key as RoleKey] ?? r.name} required={r.require2fa} fixed={r.key === "SYSTEM_ADMIN" || r.key === "CHURCH_CLERK"} />
          ))}
        </section>
        <section className="card p-5">
          <h2 className="text-[17px] font-semibold">Last 7 days</h2>
          <p className="mt-2 text-[34px] font-semibold leading-none">{failed}</p>
          <p className="mt-1 text-[14px] text-ink-2">failed sign-in attempts. Sign-in is rate-limited (10 tries per 15 minutes; 5 codes per 5 minutes).</p>
        </section>
      </aside>
    </div>
  );
}
