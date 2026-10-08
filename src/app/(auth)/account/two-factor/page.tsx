import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireContext } from "@/server/auth/session";
import { EnrolForm } from "./enrol-form";

export const metadata: Metadata = { title: "Two-step verification" };

export default async function TwoFactorPage({ searchParams }: { searchParams: Promise<{ required?: string }> }) {
  const ctx = await requireContext({ allowWithout2fa: true });
  const { required } = await searchParams;
  if (!ctx.requires2fa && !ctx.twoFactorEnabled) redirect("/account");

  if (ctx.twoFactorEnabled) {
    return (
      <>
        <h1 className="text-[28px] font-semibold mb-2">Two-step verification is on</h1>
        <p className="text-ink-2 mb-6">You’ll be asked for a code from your authenticator app each time you sign in.</p>
        <Link href="/account" className="btn btn-secondary">Back to account</Link>
      </>
    );
  }

  return (
    <>
      <h1 className="text-[28px] font-semibold mb-2">Set up two-step verification</h1>
      <p className="text-ink-2 mb-6">
        {required
          ? "System Administrator accounts need a second step before you continue."
          : "Add a second step to your sign-in using an authenticator app."}{" "}
        Use Google Authenticator, Microsoft Authenticator or any TOTP app.
      </p>
      <EnrolForm />
    </>
  );
}
