import type { Metadata } from "next";
import Link from "next/link";
import { AuthAlert, AuthHeader, AuthIcon, AuthTabs, GoogleFailed, GoogleSignIn, OrDivider } from "@/components/auth/auth-ui";
import { googleEnabled } from "@/server/auth/auth";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string; google?: string }> }) {
  const { next, reset, google } = await searchParams;
  return (
    <>
      <AuthTabs />
      <AuthHeader eyebrow="Church staff" title="Sign in to your account">
        For the clerk, pastors, elders, ministry leaders and other church officers.
      </AuthHeader>
      {reset && (
        <div className="mb-5">
          <AuthAlert state={{ ok: "Password changed. Sign in with your new password." }} />
        </div>
      )}
      {google === "failed" && <GoogleFailed audience="staff" />}
      {googleEnabled() && (
        <>
          <GoogleSignIn audience="staff" next={next ?? "/dashboard"} />
          <OrDivider>or sign in with email</OrDivider>
        </>
      )}
      <LoginForm next={next ?? "/dashboard"} />
      <div className="mt-8 rounded-[10px] border border-line bg-surface p-4">
        <p className="flex items-start gap-3 text-[14px]">
          <span className="grid size-9 shrink-0 place-items-center rounded-[8px] bg-surface-2 text-ink-2">
            <AuthIcon name="phone" />
          </span>
          <span>
            <span className="block font-semibold">Are you a church member?</span>
            <span className="block text-ink-2">See your own record with a code sent to your phone{googleEnabled() ? " or with Google" : ""}.</span>
            <Link href="/login/phone" className="mt-1 inline-flex items-center gap-1 font-semibold text-primary hover:underline">
              Member sign in <AuthIcon name="arrowRight" className="size-4" />
            </Link>
          </span>
        </p>
      </div>
    </>
  );
}
