import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { NAV } from "@/components/shell/nav";
import { NavIcon } from "@/components/shell/nav-icons";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { can } from "@/server/authz/policy";
import Link from "next/link";
import { PageHeader, TopBar } from "@/components/shell/topbar";
import { ROLE_LABELS } from "@/server/authz/catalog";
import { auth, SESSION_IDLE_MINUTES } from "@/server/auth/auth";
import { requireContext } from "@/server/auth/session";
import { SignOutButton } from "@/components/shell/sign-out";
import { revokeSessionAction } from "./actions";

export const metadata: Metadata = { title: "Account" };

function device(ua: string | null | undefined) {
  if (!ua) return "Unknown device";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "Other";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${browser} on ${os}`;
}

export default async function AccountPage() {
  const ctx = await requireContext();
  const sessions = await auth.api.listSessions({ headers: await headers() });
  const themeCookie = (await cookies()).get("theme")?.value;
  const theme = themeCookie === "light" || themeCookie === "dark" ? themeCookie : "system";
  const fmt = (d: Date) => new Date(d).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Kampala" });

  return (
    <>
      <TopBar />
      <main className="p-4 md:p-7 space-y-6 max-w-3xl">
        <PageHeader title="Account" subtitle={`${ctx.label} · ${ctx.roles.map((r) => ROLE_LABELS[r]).join(", ")}`}>
          <SignOutButton />
        </PageHeader>

        {/* Phones: the bottom bar has room for a few sections; the rest are listed here. */}
        <nav aria-label="All sections" className="card p-2 md:hidden">
          <ul className="grid grid-cols-2 gap-1">
            {NAV.flatMap((sec) => sec.items)
              .filter((i) => !i.mobile && (!i.need || can(ctx, i.need[0], i.need[1])))
              .map((i) => (
                <li key={i.href}>
                  <Link href={i.href} className="flex min-h-[48px] items-center gap-2.5 rounded-[8px] px-3 text-[14px] font-medium hover:bg-surface-2">
                    <NavIcon name={i.icon} className="size-[18px] text-ink-2" />
                    {i.label}
                  </Link>
                </li>
              ))}
          </ul>
        </nav>

        <section className="card p-5">
          <h2 className="text-[17px] font-semibold mb-3">Appearance</h2>
          <ThemeToggle current={theme} />
        </section>

        {(ctx.requires2fa || ctx.twoFactorEnabled) && <section className="card p-5">
          <h2 className="text-[17px] font-semibold">Two-step verification</h2>
          <p className="text-ink-2 mt-1">
            {ctx.twoFactorEnabled ? "On — a code from your authenticator app is needed at sign-in." : "Off."}
            {ctx.requires2fa && " Required for your role."}
          </p>
          {!ctx.twoFactorEnabled && <Link href="/account/two-factor" className="btn btn-primary mt-4">Set up</Link>}
        </section>}

        <section className="card">
          <div className="p-5 border-b border-line">
            <h2 className="text-[17px] font-semibold">Signed-in devices</h2>
            <p className="text-ink-2 mt-1 text-[14px]">Sessions end after {SESSION_IDLE_MINUTES} minutes without activity. Sign out any device you don’t recognise.</p>
          </div>
          <ul>
            {sessions.map((s) => {
              const current = s.id === ctx.sessionId;
              return (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-line last:border-0">
                  <div>
                    <div className="font-semibold">
                      {device(s.userAgent)} {current && <span className="ml-2 text-[12px] rounded bg-primary-soft text-primary px-2 py-0.5">This device</span>}
                    </div>
                    <div className="text-[13px] text-ink-2">
                      Signed in {fmt(s.createdAt)} · last active {fmt(s.updatedAt)}
                      {s.ipAddress ? ` · ${s.ipAddress}` : ""}
                    </div>
                  </div>
                  {!current && (
                    <form action={revokeSessionAction}>
                      <input type="hidden" name="token" value={s.token} />
                      <button className="btn btn-danger">Sign out</button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      </main>
    </>
  );
}
