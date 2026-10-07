"use client";

import Link from "next/link";
import { useActionState } from "react";
import { AuthAlert, IconField, PasswordField } from "@/components/auth/auth-ui";
import { SubmitButton } from "@/components/ui/form";
import { signInAction } from "../actions";
import { useToastState } from "@/components/ui/use-toast-state";

export function LoginForm({ next }: { next: string }) {
  const [state, action] = useActionState(signInAction, undefined);
  useToastState(state);
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="next" value={next} />
      <IconField
        key={state?.email}
        id="email"
        name="email"
        type="email"
        label="Email"
        icon="mail"
        autoComplete="username"
        required
        placeholder="you@example.org"
        defaultValue={state?.email}
      />
      <PasswordField
        id="password"
        name="password"
        label="Password"
        autoComplete="current-password"
        required
        autoFocus={Boolean(state?.email)}
        aside={<Link href="/forgot-password" className="text-[13px] font-semibold text-primary hover:underline">Forgot password?</Link>}
      />
      <AuthAlert state={state} />
      <SubmitButton className="btn btn-primary min-h-[48px] w-full text-[15px]" pendingText="Signing in…">Sign in</SubmitButton>
    </form>
  );
}
