import type { Metadata } from "next";
import { RevokeSession } from "@/components/admin/session-widgets";
import { SESSION_IDLE_MINUTES } from "@/server/auth/auth";
import { requirePermission } from "@/server/auth/session";
import { regionCheck } from "@/server/admin/regions";
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
  const [sessions, failed, events] = await Promise.all([
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
        <RegionCard />
        <section className="card p-5">
          <h2 className="text-[17px] font-semibold">Two-step verification</h2>
          <p className="mt-1 text-[14px] text-ink-2">Required for System Administrators only. Other staff sign in with their password, and members with an SMS code.</p>
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

function RegionCard() {
  const r = regionCheck();
  if (!r.app && !r.database) return null;
  return (
    <section className={`card p-5 ${r.mismatch ? "border-[var(--status-irregular)]" : ""}`}>
      <h2 className="text-[17px] font-semibold">Speed check</h2>
      <dl className="mt-2 space-y-1 text-[14px]">
        <div className="flex justify-between"><dt className="text-ink-2">App runs in</dt><dd className="mono">{r.app ?? "—"}</dd></div>
        <div className="flex justify-between"><dt className="text-ink-2">Database is in</dt><dd className="mono">{r.database ?? "—"}</dd></div>
      </dl>
      {r.mismatch ? (
        <p className="mt-3 text-[14px]">
          These are far apart, which makes every page and import slower. In <strong>vercel.json</strong> set <span className="mono">&quot;regions&quot;: [&quot;{r.expected}&quot;]</span> (ask your developer), then redeploy.
        </p>
      ) : (
        <p className="mt-3 text-[14px] text-ink-2">The app and database are close together.</p>
      )}
    </section>
  );
}
