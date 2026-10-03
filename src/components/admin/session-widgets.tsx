"use client";

import { revokeSessionsAction } from "@/app/(staff)/admin/actions";
import { Msg, useRun } from "@/components/ui/use-run";

export function RevokeSession({ sessionId, label }: { sessionId: string; label: string }) {
  const { pending, msg, run } = useRun();
  return (
    <span className="inline-flex flex-col items-end">
      <button type="button" className="min-h-[44px] px-2 text-[14px] text-error" disabled={pending} aria-label={`Sign out ${label}`} onClick={() => run(() => revokeSessionsAction({ sessionId }))}>
        Sign out
      </button>
      <Msg msg={msg} />
    </span>
  );
}
