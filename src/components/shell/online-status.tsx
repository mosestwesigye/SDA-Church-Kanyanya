"use client";

import { useSyncExternalStore } from "react";

function subscribe(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

/** Connection indicator in the top bar (the offline outbox count is added in phase 8). */
export function OnlineStatus() {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
  return (
    <span role="status" className="ml-auto hidden sm:flex items-center gap-2 text-[13px] text-ink-3">
      <span aria-hidden className={`size-2 rounded-full ${online ? "bg-ok" : "bg-[var(--status-irregular)]"}`} />
      {online ? "Online" : "Offline — showing saved data"}
    </span>
  );
}
