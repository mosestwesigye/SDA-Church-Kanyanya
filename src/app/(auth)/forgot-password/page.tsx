"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { requestResetAction } from "../actions";

export default function ForgotPasswordPage() {
  const [state, action] = useActionState(requestResetAction, undefined);
  return (
    <>
      <h1 className="text-[28px] font-semibold mb-1">Reset password</h1>
      <p className="text-ink-2 mb-6">We’ll email you a link to choose a new password.</p>
      <form action={action} className="space-y-4">
        <div>
          <label htmlFor="email" className="field-label">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" required className="input" />
        </div>
        <FormMessage state={state} />
        <SubmitButton pendingText="Sending…">Send reset link</SubmitButton>
        <p className="text-sm text-center">
          <Link href="/login" className="text-primary hover:underline">Back to sign in</Link>
        </p>
      </form>
    </>
  );
}
