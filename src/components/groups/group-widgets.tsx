"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addToMinistryAction, removeFromMinistryAction, setRoleAction } from "@/app/(staff)/ministries/actions";
import { addMemberAction, createHouseholdAction, removeMemberAction, setRelationAction } from "@/app/(staff)/families/actions";
import { MemberPicker, PickedMember, type Picked } from "@/components/members/member-picker";
import type { Option } from "@/components/members/types";

type R = { ok: boolean; message?: string; error?: string };

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (fn: () => Promise<R>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r) return;
      setMsg(r.ok ? (r.message ? { ok: true, text: r.message } : null) : { ok: false, text: r.error ?? "Failed." });
      if (r.ok) {
        after?.();
        router.refresh();
      }
    });
  return { pending, msg, run };
}

function Msg({ msg }: { msg: { ok: boolean; text: string } | null }) {
  return msg ? <p role={msg.ok ? "status" : "alert"} className={`text-[13px] ${msg.ok ? "text-ok" : "text-error"}`}>{msg.text}</p> : null;
}

/* ───── Ministries ───── */

export function RoleSelect({ ministryId, linkId, roleId, roles, label }: { ministryId: string; linkId: string; roleId: string; roles: Option[]; label: string }) {
  const { pending, msg, run } = useRun();
  return (
    <span className="flex flex-col">
      <select aria-label={`Role for ${label}`} className="input h-10 min-h-10 w-44" defaultValue={roleId} disabled={pending} onChange={(e) => run(() => setRoleAction(ministryId, linkId, e.target.value))}>
        {roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
      </select>
      <Msg msg={msg} />
    </span>
  );
}

export function RemoveFromMinistry({ ministryId, linkId, label }: { ministryId: string; linkId: string; label: string }) {
  const { pending, msg, run } = useRun();
  return (
    <span>
      <button type="button" className="min-h-[44px] px-2 text-[14px] text-error" disabled={pending} aria-label={`Remove ${label}`} onClick={() => run(() => removeFromMinistryAction(ministryId, linkId))}>Remove</button>
      <Msg msg={msg} />
    </span>
  );
}

export function AddToMinistry({ ministryId, roles }: { ministryId: string; roles: Option[] }) {
  const [picked, setPicked] = useState<Picked | null>(null);
  const [role, setRole] = useState(roles.find((r) => r.label === "Member")?.id ?? roles[0]?.id ?? "");
  const { pending, msg, run } = useRun();
  return (
    <div className="space-y-3">
      {picked ? (
        <div className="flex min-h-[44px] items-center justify-between rounded-[6px] border border-line px-3">
          <span>{picked.lastName}, {picked.firstName} <span className="mono text-[12px] text-ink-3">{picked.memberId}</span></span>
          <button type="button" className="text-[14px] text-primary" onClick={() => setPicked(null)}>Change</button>
        </div>
      ) : (
        <MemberPicker label="Add a member" onPick={setPicked} />
      )}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex-1 min-w-40">
          <span className="field-label">Role</span>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </label>
        <button type="button" className="btn btn-primary" disabled={!picked || pending} onClick={() => run(() => addToMinistryAction(ministryId, picked!.id, role), () => setPicked(null))}>Add</button>
      </div>
      <Msg msg={msg} />
    </div>
  );
}

/* ───── Households ───── */

const RELATIONS: { id: string; label: string }[] = [
  { id: "HEAD", label: "Head / cell leader" },
  { id: "OTHER", label: "Cell member" },
  { id: "SPOUSE", label: "Spouse" },
  { id: "CHILD", label: "Child" },
  { id: "DEPENDANT", label: "Dependant" },
];

export function NewHousehold({ suggestion }: { suggestion?: { name: string; head: Picked } }) {
  const [head, setHead] = useState<Picked | null>(suggestion?.head ?? null);
  const [name, setName] = useState(suggestion?.name ?? "");
  const { pending, msg, run } = useRun();
  return (
    <div className="space-y-3">
      <label className="block">
        <span className="field-label">Name <span className="text-error" aria-hidden>*</span></span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Kanyanya Cell 3 or Wasswa family" maxLength={80} />
      </label>
      {head ? (
        <PickedMember label="Head / cell leader" member={head} onClear={() => setHead(null)} />
      ) : (
        <MemberPicker label="Head / cell leader (optional)" onPick={(m) => (setHead(m), setName((n) => n || `${m.lastName} family`))} />
      )}
      <p className="text-[13px] text-ink-2">You can add the leader and members now or later.</p>
      <button type="button" className="btn btn-primary w-full" disabled={name.trim().length < 2 || pending} onClick={() => run(() => createHouseholdAction(name, head?.id))}>
        {pending ? "Creating…" : "Create family or cell"}
      </button>
      <Msg msg={msg} />
    </div>
  );
}

export function AddHouseholdMember({ householdId, hasHead, memberIds = [] }: { householdId: string; hasHead: boolean; memberIds?: string[] }) {
  const [picked, setPicked] = useState<Picked | null>(null);
  const [chosenRelation, setRelation] = useState(hasHead ? "OTHER" : "HEAD");
  // Once a head exists (e.g. just added), "Head" is no longer offered.
  const relation = chosenRelation === "HEAD" && hasHead ? "OTHER" : chosenRelation;
  const [linkSpouse, setLinkSpouse] = useState(true);
  const { pending, msg, run } = useRun();
  return (
    <div className="space-y-3">
      {picked ? (
        <PickedMember label="Member" member={picked} onClear={() => setPicked(null)} />
      ) : (
        <MemberPicker label="Find a member" onPick={setPicked} excludeIds={memberIds} />
      )}
      <label className="block">
        <span className="field-label">Role in this family / cell</span>
        <select className="input" value={relation} onChange={(e) => setRelation(e.target.value)}>
          {RELATIONS.filter((r) => r.id !== "HEAD" || !hasHead).map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
      </label>
      {relation === "SPOUSE" && hasHead && (
        <label className="flex min-h-[44px] items-center gap-2 text-[14px]">
          <input type="checkbox" className="size-4" checked={linkSpouse} onChange={(e) => setLinkSpouse(e.target.checked)} />
          Also set Married and link them as spouses on both records
        </label>
      )}
      <button
        type="button"
        className="btn btn-primary w-full"
        disabled={!picked || pending}
        onClick={() => run(() => addMemberAction(householdId, picked!.id, relation as never, relation === "SPOUSE" && linkSpouse), () => setPicked(null))}
      >
        {pending ? "Saving…" : picked ? `Add ${picked.firstName} ${picked.lastName}` : "Choose a member first"}
      </button>
      <Msg msg={msg} />
    </div>
  );
}

export function RelationSelect({ householdId, memberId, relation, label, hasOtherHead }: { householdId: string; memberId: string; relation: string; label: string; hasOtherHead: boolean }) {
  const { pending, msg, run } = useRun();
  return (
    <span className="flex flex-col">
      <select aria-label={`Relation of ${label}`} className="input h-10 min-h-10 w-48" defaultValue={relation} disabled={pending} onChange={(e) => run(() => setRelationAction(householdId, memberId, e.target.value as never))}>
        {RELATIONS.filter((r) => r.id !== "HEAD" || !hasOtherHead).map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
      </select>
      <Msg msg={msg} />
    </span>
  );
}

export function RemoveFromHousehold({ householdId, memberId, label }: { householdId: string; memberId: string; label: string }) {
  const { pending, msg, run } = useRun();
  return (
    <span>
      <button type="button" className="min-h-[44px] px-2 text-[14px] text-error" disabled={pending} aria-label={`Remove ${label}`} onClick={() => run(() => removeMemberAction(householdId, memberId))}>Remove</button>
      <Msg msg={msg} />
    </span>
  );
}
