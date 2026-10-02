"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { resetPasswordAction } from "../actions";

function ResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const [state, action] = useActionState(resetPasswordAction, undefined);
  if (!token) return <FormMessage state={{ error: "This link is incomplete. Request a new reset link." }} />;
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <div>
        <label htmlFor="password" className="field-label">New password (10+ characters)</label>
        <input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required className="input" />
      </div>
      <div>
        <label htmlFor="confirm" className="field-label">Repeat new password</label>
        <input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={10} required className="input" />
      </div>
      <FormMessage state={state} />
      <SubmitButton pendingText="Saving…">Set new password</SubmitButton>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <>
      <h1 className="text-[28px] font-semibold mb-6">Choose a new password</h1>
      <Suspense>
        <ResetForm />
      </Suspense>
    </>
  );
}
