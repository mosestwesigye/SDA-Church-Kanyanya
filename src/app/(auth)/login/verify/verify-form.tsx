"use client";

import { useActionState, useState } from "react";
import { AuthAlert } from "@/components/auth/auth-ui";
import { SubmitButton } from "@/components/ui/form";
import { verifyTotpAction } from "../../actions";

export function VerifyForm({ next }: { next: string }) {
  const [state, action] = useActionState(verifyTotpAction, undefined);
  const [backup, setBackup] = useState(false);
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="mode" value={backup ? "backup" : "totp"} />
      <div>
        <label htmlFor="code" className="mb-1.5 block text-[14px] font-medium">{backup ? "Backup code" : "Verification code"}</label>
        <input
          key={backup ? "b" : "t"}
          id="code"
          name="code"
          className={`input min-h-[56px] text-center mono ${backup ? "text-[18px] tracking-[0.1em]" : "text-[26px] tracking-[0.5em]"}`}
          inputMode={backup ? "text" : "numeric"}
          autoComplete="one-time-code"
          pattern={backup ? undefined : "[0-9 ]{6,7}"}
          maxLength={backup ? 20 : 7}
          placeholder={backup ? "xxxxx-xxxxx" : "000000"}
          required
          autoFocus
        />
      </div>
      <AuthAlert state={state} />
      <SubmitButton className="btn btn-primary min-h-[48px] w-full text-[15px]" pendingText="Checking…">Verify and continue</SubmitButton>
      <div className="border-t border-line pt-4 text-center">
        <button type="button" className="min-h-[44px] text-[14px] font-semibold text-primary hover:underline" onClick={() => setBackup((b) => !b)}>
          {backup ? "Use the authenticator app instead" : "Lost your phone? Use a backup code"}
        </button>
      </div>
    </form>
  );
}
