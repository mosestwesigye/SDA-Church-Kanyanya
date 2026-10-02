import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string }> }) {
  const { next, reset } = await searchParams;
  return (
    <>
      <h1 className="text-[28px] font-semibold mb-1">Sign in</h1>
      <p className="text-ink-2 mb-6">Church staff accounts only.</p>
      {reset && <p className="mb-4 rounded-[6px] bg-primary-soft text-primary px-3 py-2 text-sm">Password changed. Sign in with your new password.</p>}
      <LoginForm next={next ?? "/dashboard"} />
    </>
  );
}
