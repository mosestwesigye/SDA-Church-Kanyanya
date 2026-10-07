"use client";

import { useEffect } from "react";
import { toast } from "@/lib/toast";

/** Toast each new `useActionState` result: `error` as an error, `ok` as a success (unless `success: false`). */
export function useToastState(state: { error?: string; ok?: string } | undefined | null, opts: { success?: boolean } = {}) {
  const showOk = opts.success !== false;
  useEffect(() => {
    if (state?.error) toast.error(state.error);
    else if (state?.ok && showOk) toast.success(state.ok);
  }, [state, showOk]);
}
