"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { signInAction } from "../actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action] = useActionState(signInAction, undefined);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <div>
        <label htmlFor="email" className="field-label">Email</label>
        <input key={state?.email} id="email" name="email" type="email" autoComplete="username" required className="input" defaultValue={state?.email} />
      </div>
      <div>
        <label htmlFor="password" className="field-label">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className="input" autoFocus={Boolean(state?.email)} />
      </div>
      <FormMessage state={state} />
      <SubmitButton pendingText="Signing in…">Sign in</SubmitButton>
      <p className="text-sm text-center">
        <Link href="/forgot-password" className="text-primary underline-offset-2 hover:underline">Forgot password?</Link>
      </p>
    </form>
  );
}
