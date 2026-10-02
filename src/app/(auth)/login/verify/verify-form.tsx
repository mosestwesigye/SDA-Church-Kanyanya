"use client";

import { useActionState, useState } from "react";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { verifyTotpAction } from "../../actions";

export function VerifyForm({ next }: { next: string }) {
  const [state, action] = useActionState(verifyTotpAction, undefined);
  const [backup, setBackup] = useState(false);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <input type="hidden" name="mode" value={backup ? "backup" : "totp"} />
      <div>
        <label htmlFor="code" className="field-label">{backup ? "Backup code" : "6-digit code"}</label>
        <input
          id="code"
          name="code"
          className="input mono tracking-[0.2em] text-lg"
          inputMode={backup ? "text" : "numeric"}
          autoComplete="one-time-code"
          pattern={backup ? undefined : "[0-9 ]{6,7}"}
          maxLength={backup ? 20 : 7}
          required
          autoFocus
        />
      </div>
      <FormMessage state={state} />
      <SubmitButton pendingText="Checking…">Verify</SubmitButton>
      <button type="button" className="text-sm text-primary w-full min-h-[44px]" onClick={() => setBackup((b) => !b)}>
        {backup ? "Use the authenticator app instead" : "Lost your phone? Use a backup code"}
      </button>
    </form>
  );
}
