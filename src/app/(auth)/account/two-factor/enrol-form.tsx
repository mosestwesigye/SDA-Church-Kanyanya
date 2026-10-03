"use client";

import { useActionState, useState } from "react";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { enrolAction, type EnrolState } from "./actions";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="min-h-[36px] rounded-[6px] border border-line bg-surface px-3 text-[13px] font-semibold text-primary"
      onClick={() => navigator.clipboard?.writeText(text).then(() => setCopied(true), () => setCopied(false))}
    >
      {copied ? "Copied" : "Copy key"}
    </button>
  );
}

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
          <p className="mb-1">Add SDAK Church Manager to your authenticator app.</p>
          <p className="mb-3 text-[14px] text-ink-2">
            On a computer, scan the code with your phone. On the phone that has the app, tap the button instead — a phone can’t scan its own screen.
          </p>
          <a href={state.totpURI} className="btn btn-primary mb-4 w-full sm:w-auto">Add to authenticator app on this phone</a>
          <div className="block w-fit rounded-[10px] border border-line bg-white p-2" dangerouslySetInnerHTML={{ __html: state.qrSvg }} aria-label="QR code for your authenticator app" role="img" />
          <div className="mt-3 text-[13px] text-ink-2">
            <p>Or type this key into the app (choose “Enter a setup key”, time-based):</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="mono break-all rounded-[6px] bg-surface-2 px-2 py-1 text-ink">{state.secret}</span>
              <CopyButton text={state.secret} />
            </div>
          </div>
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
