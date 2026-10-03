"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { maskUgPhoneInput } from "@/lib/phone";
import { requestPhoneCodeAction, verifyPhoneCodeAction, type PhoneState } from "../../actions";

export function PhoneSignIn() {
  const [sent, request] = useActionState<PhoneState, FormData>(requestPhoneCodeAction, undefined);
  const [verified, verify] = useActionState<PhoneState, FormData>(verifyPhoneCodeAction, undefined);
  const [phone, setPhone] = useState("");
  const [restart, setRestart] = useState(false);
  const step = !restart && (verified?.step === "code" || sent?.step === "code") ? "code" : "phone";

  if (step === "code") {
    const shownPhone = verified?.phone ?? sent?.phone ?? phone;
    return (
      <form action={verify} className="space-y-4">
        <input type="hidden" name="phone" value={shownPhone} />
        {sent?.ok && !verified && <p role="status" className="rounded-[6px] bg-primary-soft px-3 py-2 text-sm text-primary">{sent.ok}</p>}
        <div>
          <label htmlFor="code" className="field-label">Code sent to {shownPhone}</label>
          <input id="code" name="code" className="input mono text-lg tracking-[0.2em]" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required autoFocus />
        </div>
        <FormMessage state={verified} />
        <SubmitButton pendingText="Checking…">Sign in</SubmitButton>
        <button type="button" className="min-h-[44px] w-full text-sm text-primary" onClick={() => setRestart(true)}>Use a different number or send a new code</button>
      </form>
    );
  }
  return (
    <form action={(f) => { setRestart(false); return request(f); }} className="space-y-4">
      <div>
        <label htmlFor="phone" className="field-label">Your phone number</label>
        <input id="phone" name="phone" className="input" inputMode="tel" autoComplete="tel" placeholder="07XX XXX XXX" required
          value={phone || sent?.phone || ""} onChange={(e) => setPhone(maskUgPhoneInput(e.target.value))} />
        <p className="mt-1 text-[13px] text-ink-2">Use the number the church has on your record.</p>
      </div>
      <div className="rounded-[8px] border border-line bg-surface-2 p-3 text-[14px] text-ink-2">
        <p className="font-semibold text-ink">Privacy notice</p>
        <p className="mt-1">
          SDA Church Kanyanya keeps your membership record to care for members and run the church. Signing in lets you see that record and ask the clerk to correct it.
          We don’t share it outside the church and its Conference. Your rights under the Data Protection and Privacy Act, 2019 are explained on the next page.
        </p>
        <label className="mt-2 flex min-h-[44px] items-center gap-2.5 text-ink">
          <input type="checkbox" name="privacy" className="size-5" required /> I have read the privacy notice
        </label>
      </div>
      <FormMessage state={sent} />
      <SubmitButton pendingText="Sending…">Send me a code</SubmitButton>
      <p className="text-center text-[14px] text-ink-2"><Link href="/login" className="text-primary">Church staff sign in here</Link></p>
    </form>
  );
}
