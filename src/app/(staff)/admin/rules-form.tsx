"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { setPhotoRequiredAction } from "./actions";
import { useToastState } from "@/components/ui/use-toast-state";

export function PhotoRuleForm({ photoRequired }: { photoRequired: boolean }) {
  const [state, action] = useActionState(setPhotoRequiredAction, undefined);
  useToastState(state);
  return (
    <form action={action} className="space-y-4">
      <label className="flex items-start gap-3 min-h-[44px] cursor-pointer">
        <input type="checkbox" name="photoRequired" defaultChecked={photoRequired} className="mt-1 size-5 accent-[var(--primary)]" />
        <span>
          <span className="block font-semibold">Photo counts toward profile completeness</span>
          <span className="block text-[14px] text-ink-2">
            When off, a record can reach 100% without a photo. Photos can still be added; they just don’t appear in “missing fields”.
          </span>
        </span>
      </label>
      <FormMessage state={state} />
      <SubmitButton className="btn btn-primary" pendingText="Updating every member…">
        Save and rescore members
      </SubmitButton>
    </form>
  );
}
