"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { enrolAction, type EnrolState } from "./actions";

export function EnrolForm() {
  const [state, action] = useActionState<EnrolState, FormData>(enrolAction, { step: "password" });

  if (state.step === "password") {
    return (
      <form action={action} className="space-y-4">
        <input type="hidden" name="intent" value="start" />
        <div>
          <label htmlFor="password" className="field-label">Confirm your password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required className="input" />
        </div>
        <FormMessage state={{ error: state.error }} />
        <SubmitButton pendingText="Preparing…">Continue</SubmitButton>
      </form>
    );
  }

  return (
    <div className="space-y-6">
      <ol className="space-y-6 list-decimal pl-5">
        <li>
          <p className="mb-3">Scan this code with your authenticator app.</p>
          <div className="inline-block rounded-[10px] bg-white p-2 border border-line" dangerouslySetInnerHTML={{ __html: state.qrSvg }} aria-label="QR code for your authenticator app" role="img" />
          <p className="text-[13px] text-ink-2 mt-2">
            Can’t scan? Enter this key: <span className="mono break-all">{state.secret}</span>
          </p>
        </li>
        <li>
          <p className="mb-2">Save these backup codes somewhere safe. Each works once if you lose your phone.</p>
          <ul className="grid grid-cols-2 gap-2 mono text-[14px] card p-3">
            {state.backupCodes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </li>
        <li>
          <form action={action} className="space-y-3">
            <input type="hidden" name="intent" value="confirm" />
            <label htmlFor="code" className="field-label">Enter the 6-digit code the app shows</label>
            <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required className="input mono tracking-[0.2em] text-lg" />
            <FormMessage state={{ error: state.error }} />
            <SubmitButton pendingText="Checking…">Turn on two-step verification</SubmitButton>
          </form>
        </li>
      </ol>
    </div>
  );
}
