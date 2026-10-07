"use client";

import Link from "next/link";
import { useActionState } from "react";
import { AuthAlert, AuthHeader, AuthIcon, BackLink, IconField } from "@/components/auth/auth-ui";
import { SubmitButton } from "@/components/ui/form";
import { requestResetAction } from "../actions";
import { useToastState } from "@/components/ui/use-toast-state";

export default function ForgotPasswordPage() {
  const [state, action] = useActionState(requestResetAction, undefined);
  useToastState(state?.ok ? { ok: "Reset link requested — check your email" } : state);

  if (state?.ok) {
    return (
      <>
        <AuthHeader icon="mail" title="Check your email">
          {state.ok}
        </AuthHeader>
        <ul className="mb-7 space-y-2.5 text-[14px] text-ink-2">
          {["Open the email from SDAK Church Manager.", "Follow the link to choose a new password.", "Not there after a few minutes? Check your spam folder."].map((t, i) => (
            <li key={t} className="flex gap-3">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-surface-2 text-[12px] font-semibold text-ink">{i + 1}</span>
              {t}
            </li>
          ))}
        </ul>
        <Link href="/login" className="btn btn-primary min-h-[48px] w-full text-[15px]">Back to sign in</Link>
        <p className="mt-4 text-center text-[13px] text-ink-2">
          Still nothing? <Link href="/forgot-password" className="font-semibold text-primary hover:underline">Send another link</Link> or ask the church clerk.
        </p>
      </>
    );
  }

  return (
    <>
      <BackLink href="/login">Back to sign in</BackLink>
      <div className="mt-4">
        <AuthHeader icon="key" title="Reset your password">
          Enter the email you use for SDAK Church Manager and we’ll send you a link to choose a new password.
        </AuthHeader>
      </div>
      <form action={action} className="space-y-5">
        <IconField id="email" name="email" type="email" label="Email" icon="mail" autoComplete="email" required placeholder="you@example.org" autoFocus />
        <AuthAlert state={state} />
        <SubmitButton className="btn btn-primary min-h-[48px] w-full text-[15px]" pendingText="Sending link…">Send reset link</SubmitButton>
      </form>
      <p className="mt-6 flex items-start gap-2 text-[13px] text-ink-2">
        <AuthIcon name="shield" className="mt-px size-4 text-ink-3" />
        For your security, the link expires in 30 minutes and works only once. Members who sign in by phone don’t need a password.
      </p>
    </>
  );
}
