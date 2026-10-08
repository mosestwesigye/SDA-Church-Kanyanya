"use client";

import { setPermissionAction } from "@/app/(staff)/admin/actions";
import { Msg, useRun } from "@/components/ui/use-run";
import type { Scope } from "@/server/authz/catalog";

const SCOPES: { v: Scope | ""; label: string }[] = [
  { v: "", label: "—" },
  { v: "ALL", label: "All" },
  { v: "MINISTRY", label: "Own ministries" },
  { v: "SELF", label: "Own record" },
];

export function ScopeCell({ roleId, resource, action, scope, label, locked }: { roleId: string; resource: string; action: string; scope: Scope | null; label: string; locked: boolean }) {
  const { pending, msg, run } = useRun();
  const tone = scope === "ALL" ? "bg-primary-soft text-primary font-semibold" : scope ? "bg-[color-mix(in_oklab,var(--status-irregular)_15%,transparent)]" : "text-ink-3";
  return (
    <span className="flex flex-col">
      <select
        aria-label={label}
        className={`h-9 rounded-[6px] border border-line px-1.5 text-[13px] ${tone}`}
        value={scope ?? ""}
        disabled={pending || locked}
        title={locked ? "Required for System Admin" : undefined}
        onChange={(e) => run(() => setPermissionAction(roleId, resource, action, (e.target.value || null) as Scope | null))}
      >
        {SCOPES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
      </select>
      <Msg msg={msg} />
    </span>
  );
}
