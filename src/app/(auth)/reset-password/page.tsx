"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useActionState, useState } from "react";
import { AuthAlert, AuthHeader, AuthIcon, PasswordField } from "@/components/auth/auth-ui";
import { SubmitButton } from "@/components/ui/form";
import { resetPasswordAction } from "../actions";
import { useToastState } from "@/components/ui/use-toast-state";

function Rule({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className={`flex items-center gap-2 text-[13px] ${ok ? "text-ok" : "text-ink-2"}`}>
      <AuthIcon name="check" className={`size-4 ${ok ? "" : "opacity-30"}`} />
      {children}
    </li>
  );
}

function ResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const [state, action] = useActionState(resetPasswordAction, undefined);
  useToastState(state);
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  if (!token) {
    return (
      <>
        <AuthAlert state={{ error: "This reset link is incomplete or has expired." }} />
        <Link href="/forgot-password" className="btn btn-primary mt-5 min-h-[48px] w-full">Request a new link</Link>
      </>
    );
  }
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="token" value={token} />
      <PasswordField id="password" name="password" label="New password" autoComplete="new-password" minLength={10} required value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
      <ul className="-mt-2 space-y-1">
        <Rule ok={pw.length >= 10}>At least 10 characters</Rule>
        <Rule ok={[/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length >= 2}>A mix of capitals, small letters, numbers or symbols</Rule>
      </ul>
      <PasswordField id="confirm" name="confirm" label="Repeat new password" autoComplete="new-password" minLength={10} required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      {confirm && confirm !== pw && <p className="-mt-3 text-[13px] text-error">The passwords don’t match yet.</p>}
      <AuthAlert state={state} />
      <SubmitButton className="btn btn-primary min-h-[48px] w-full text-[15px]" pendingText="Saving…">Set new password</SubmitButton>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <>
      <AuthHeader icon="key" title="Choose a new password">
        You’ll be signed out of other devices and can sign in with the new password straight away.
      </AuthHeader>
      <Suspense>
        <ResetForm />
      </Suspense>
    </>
  );
}
