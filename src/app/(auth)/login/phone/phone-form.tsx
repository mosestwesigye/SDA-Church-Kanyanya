"use client";

import { useActionState, useState } from "react";
import { AuthAlert, AuthHeader, AuthIcon, GoogleSignIn, IconField, OrDivider } from "@/components/auth/auth-ui";
import { SubmitButton } from "@/components/ui/form";
import { maskUgPhoneInput } from "@/lib/phone";
import { requestPhoneCodeAction, verifyPhoneCodeAction, type PhoneState } from "../../actions";
import { useToastState } from "@/components/ui/use-toast-state";

function StepBar({ step }: { step: 1 | 2 }) {
  return (
    <ol className="mb-6 flex items-center gap-2 text-[13px]" aria-label={`Step ${step} of 2`}>
      {["Your phone number", "Enter the code"].map((label, i) => {
        const n = i + 1;
        const state = n < step ? "done" : n === step ? "current" : "todo";
        return (
          <li key={label} className="flex flex-1 items-center gap-2" aria-current={state === "current" ? "step" : undefined}>
            <span
              className={`grid size-6 shrink-0 place-items-center rounded-full text-[12px] font-semibold ${
                state === "current" ? "bg-primary text-primary-ink" : state === "done" ? "bg-primary-soft text-primary" : "bg-surface-2 text-ink-3"
              }`}
            >
              {state === "done" ? "✓" : n}
            </span>
            <span className={state === "todo" ? "text-ink-3" : "font-medium text-ink"}>{label}</span>
            {n === 1 && <span aria-hidden className={`ml-1 h-px flex-1 ${step === 2 ? "bg-primary" : "bg-line"}`} />}
          </li>
        );
      })}
    </ol>
  );
}

export function PhoneSignIn({ google = false }: { google?: boolean }) {
  const [sent, request] = useActionState<PhoneState, FormData>(requestPhoneCodeAction, undefined);
  const [verified, verify] = useActionState<PhoneState, FormData>(verifyPhoneCodeAction, undefined);
  useToastState(sent?.ok ? { ok: "Code requested — check your SMS" } : sent);
  useToastState(verified);
  const [phone, setPhone] = useState("");
  const [restart, setRestart] = useState(false);
  const step = !restart && (verified?.step === "code" || sent?.step === "code") ? 2 : 1;

  if (step === 2) {
    const shownPhone = verified?.phone ?? sent?.phone ?? phone;
    return (
      <>
        <AuthHeader eyebrow="Member sign in" title="Enter your code">
          We sent a 6-digit code by SMS to <strong className="text-ink">{shownPhone}</strong>. It expires in 5 minutes.
        </AuthHeader>
        <StepBar step={2} />
        <form action={verify} className="space-y-5">
          <input type="hidden" name="phone" value={shownPhone} />
          <div>
            <label htmlFor="code" className="mb-1.5 block text-[14px] font-medium">SMS code</label>
            <input
              id="code"
              name="code"
              className="input mono min-h-[56px] text-center text-[26px] tracking-[0.5em]"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]{6,7}"
              maxLength={7}
              placeholder="000000"
              required
              autoFocus
            />
          </div>
          {!verified && sent?.ok && <AuthAlert state={{ ok: sent.ok }} />}
          <AuthAlert state={verified?.error ? { error: verified.error } : undefined} />
          <SubmitButton className="btn btn-primary min-h-[48px] w-full text-[15px]" pendingText="Checking…">Sign in</SubmitButton>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4 text-[14px]">
            <button type="button" className="min-h-[44px] font-semibold text-primary hover:underline" onClick={() => setRestart(true)}>
              Change number
            </button>
            <button type="button" className="min-h-[44px] font-semibold text-primary hover:underline" onClick={() => setRestart(true)}>
              Send a new code
            </button>
          </div>
        </form>
      </>
    );
  }

  return (
    <>
      <AuthHeader eyebrow="Member sign in" title="Sign in with your phone">
        See your church membership record and ask the clerk to correct anything. No password needed — we’ll text you a code.
      </AuthHeader>
      <StepBar step={1} />
      <form
        action={(f) => {
          setRestart(false);
          return request(f);
        }}
        className="space-y-5"
      >
        <IconField
          id="phone"
          name="phone"
          label="Phone number"
          icon="phone"
          inputMode="tel"
          autoComplete="tel"
          placeholder="07XX XXX XXX"
          required
          value={phone || sent?.phone || ""}
          onChange={(e) => setPhone(maskUgPhoneInput(e.target.value))}
          hint="Use the number the church has on your membership record."
        />
        <div className="rounded-[10px] border border-line bg-surface">
          <details className="group border-b border-line px-4 py-3">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[14px] font-semibold">
              <span className="flex items-center gap-2">
                <AuthIcon name="shield" className="size-4 text-primary" />
                Privacy notice
              </span>
              <span className="text-[13px] font-medium text-primary group-open:hidden">Read</span>
              <span className="hidden text-[13px] font-medium text-primary group-open:inline">Hide</span>
            </summary>
            <p className="mt-2 text-[14px] leading-relaxed text-ink-2">
              SDA Church Kanyanya keeps your membership record to care for members and run the church. Signing in lets you see that record and ask the clerk to correct it. We
              don’t share it outside the church and its Conference. Your rights under Uganda’s Data Protection and Privacy Act, 2019 are explained after you sign in.
            </p>
          </details>
          <label className="flex min-h-[52px] cursor-pointer items-center gap-3 px-4 text-[14px]">
            <input type="checkbox" name="privacy" className="size-5 accent-[var(--primary)]" required />
            I have read the privacy notice
          </label>
        </div>
        <AuthAlert state={sent?.error ? { error: sent.error } : undefined} />
        <SubmitButton className="btn btn-primary min-h-[48px] w-full text-[15px]" pendingText="Sending code…">Send me a code</SubmitButton>
      </form>
      {google && (
        <>
          <OrDivider />
          <GoogleSignIn audience="member" label="Continue with Google" />
          <p className="mt-2 text-center text-[12px] text-ink-3">Works when your Google email is the one on your church record.</p>
        </>
      )}
      <p className="mt-6 text-[13px] text-ink-2">
        Family members sharing one phone number need their own number on record. Ask the church clerk to update it.
      </p>
    </>
  );
}
