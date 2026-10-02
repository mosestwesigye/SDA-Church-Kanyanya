"use client";

import { ErrorState } from "@/components/ui/states";

export default function StaffError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  return (
    <main className="p-4 md:p-7">
      <ErrorState
        title={offline ? "You’re offline" : "This page couldn’t load"}
        action={
          <button type="button" className="btn btn-primary" onClick={reset}>
            Try again
          </button>
        }
      >
        {offline ? "Check your data connection and try again." : "Please try again. If it keeps happening, tell the system administrator"}
        {!offline && error.digest ? <> (reference {error.digest}).</> : !offline ? "." : null}
      </ErrorState>
    </main>
  );
}
