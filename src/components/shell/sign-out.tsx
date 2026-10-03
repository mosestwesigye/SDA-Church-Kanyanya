"use client";

import { useRef } from "react";
import { signOutAction } from "@/app/(auth)/actions";
import { clearDeviceData, listOutbox } from "@/lib/outbox";

/** Sign out and remove offline copies of personal data from this device. */
export function SignOutButton({ className = "btn btn-secondary" }: { className?: string }) {
  const cleared = useRef(false);
  return (
    <form
      action={signOutAction}
      onSubmit={(e) => {
        if (cleared.current) return; // second pass: let the server action run
        e.preventDefault();
        const form = e.currentTarget;
        (async () => {
          const waiting = (await listOutbox().catch(() => [])).length;
          if (waiting && !confirm(`${waiting} change${waiting === 1 ? " hasn’t" : "s haven’t"} been sent yet. Signing out deletes ${waiting === 1 ? "it" : "them"} from this device. Sign out anyway?`)) return;
          await clearDeviceData();
          cleared.current = true;
          form.requestSubmit();
        })();
      }}
    >
      <button className={className}>Sign out</button>
    </form>
  );
}
