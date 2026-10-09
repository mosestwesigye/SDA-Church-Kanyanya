"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addToMinistryAction, removeFromMinistryAction, setRoleAction } from "@/app/(staff)/ministries/actions";
import { addMemberAction, createHouseholdAction, removeMemberAction, renameHouseholdAction, setRelationAction } from "@/app/(staff)/families/actions";
import { RELATIONS_BY_KIND, relationLabel, suggestFamilyName } from "@/lib/households";
import { MemberPicker, PickedMember, type Picked } from "@/components/members/member-picker";
import type { Option } from "@/components/members/types";
import { toast } from "@/lib/toast";

type R = { ok: boolean; message?: string; error?: string };

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (fn: () => Promise<R>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r) return;
      toast.result(r, "Saved.");
      setMsg(r.ok ? null : { ok: false, text: r.error ?? "Failed." });
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

/* ───── Families and cells ───── */

type Kind = "FAMILY" | "CELL";

const roleOptions = (kind: Kind, hasHead: boolean) =>
  RELATIONS_BY_KIND[kind].filter((r) => r !== "HEAD" || !hasHead).map((r) => ({ id: r, label: relationLabel(kind, r) }));

/** New family: husband and wife picked from the register, name suggested as "Mr and Mrs …". */
export function NewFamily({ suggestion }: { suggestion?: { head: Picked; spouse: Picked } }) {
  const [head, setHead] = useState<Picked | null>(suggestion?.head ?? null);
  const [spouse, setSpouse] = useState<Picked | null>(suggestion?.spouse ?? null);
  const [name, setName] = useState(suggestion ? suggestFamilyName(suggestion.head, suggestion.spouse) : "");
  const [edited, setEdited] = useState(false);
  const [link, setLink] = useState(true);
  const { pending, msg, run } = useRun();
  const pick = (h: Picked | null, s: Picked | null) => {
    setHead(h);
    setSpouse(s);
    if (!edited) setName(suggestFamilyName(h, s));
  };
  return (
    <div className="space-y-3">
      {head ? (
        <PickedMember label="Husband / head of family" member={head} onClear={() => pick(null, spouse)} />
      ) : (
        <MemberPicker label="Husband / head of family" onPick={(m) => pick(m, spouse)} excludeIds={spouse ? [spouse.id] : []} />
      )}
      {spouse ? (
        <PickedMember label="Wife / spouse" member={spouse} onClear={() => pick(head, null)} />
      ) : (
        <MemberPicker label="Wife / spouse (optional)" onPick={(m) => pick(head, m)} excludeIds={head ? [head.id] : []} />
      )}
      <label className="block">
        <span className="field-label">Family name <span className="text-error" aria-hidden>*</span></span>
        <input className="input" value={name} onChange={(e) => (setName(e.target.value), setEdited(true))} placeholder="e.g. Mr and Mrs Twesigye Moses" maxLength={80} />
        <span className="mt-1 block text-[12px] text-ink-3">Suggested from the husband’s name; you can change it.</span>
      </label>
      {head && spouse && (
        <label className="flex min-h-[40px] items-center gap-2 text-[14px]">
          <input type="checkbox" className="size-4" checked={link} onChange={(e) => setLink(e.target.checked)} />
          Set both as Married and link them as spouses
        </label>
      )}
      <button
        type="button"
        className="btn btn-primary w-full"
        disabled={name.trim().length < 2 || pending}
        onClick={() => run(() => createHouseholdAction({ kind: "FAMILY", name, headMemberId: head?.id, spouseMemberId: spouse?.id, linkSpouses: link }))}
      >
        {pending ? "Creating…" : "Create family"}
      </button>
      <Msg msg={msg} />
    </div>
  );
}

export function NewCell() {
  const [leader, setLeader] = useState<Picked | null>(null);
  const [name, setName] = useState("");
  const { pending, msg, run } = useRun();
  return (
    <div className="space-y-3">
      <label className="block">
        <span className="field-label">Cell name <span className="text-error" aria-hidden>*</span></span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Kanyanya Cell 3" maxLength={80} />
      </label>
      {leader ? (
        <PickedMember label="Cell leader" member={leader} onClear={() => setLeader(null)} />
      ) : (
        <MemberPicker label="Cell leader (optional)" onPick={setLeader} />
      )}
      <button type="button" className="btn btn-primary w-full" disabled={name.trim().length < 2 || pending} onClick={() => run(() => createHouseholdAction({ kind: "CELL", name, headMemberId: leader?.id }))}>
        {pending ? "Creating…" : "Create cell"}
      </button>
      <Msg msg={msg} />
    </div>
  );
}

export function RenameHousehold({ id, name: current, kind }: { id: string; name: string; kind: Kind }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(current);
  const { pending, msg, run } = useRun();
  if (!open) return <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>Rename</button>;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <input aria-label={`New ${kind === "FAMILY" ? "family" : "cell"} name`} className="input h-10 min-h-10 w-64" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      <button type="button" className="btn btn-primary" disabled={pending || name.trim().length < 2} onClick={() => run(() => renameHouseholdAction(id, name), () => setOpen(false))}>Save</button>
      <button type="button" className="btn btn-secondary" onClick={() => (setOpen(false), setName(current))}>Cancel</button>
      <Msg msg={msg} />
    </span>
  );
}

export function AddHouseholdMember({ kind, householdId, hasHead, hasSpouse = false, memberIds = [] }: { kind: Kind; householdId: string; hasHead: boolean; hasSpouse?: boolean; memberIds?: string[] }) {
  const [picked, setPicked] = useState<Picked | null>(null);
  const defaultRole = !hasHead ? "HEAD" : kind === "FAMILY" ? (hasSpouse ? "CHILD" : "SPOUSE") : "OTHER";
  const [chosen, setChosen] = useState(defaultRole);
  const options = roleOptions(kind, hasHead);
  // Once a head exists (e.g. just added), "Head" is no longer offered.
  const relation = options.some((o) => o.id === chosen) ? chosen : options[0]!.id;
  const [linkSpouse, setLinkSpouse] = useState(true);
  const { pending, msg, run } = useRun();
  return (
    <div className="space-y-3">
      {picked ? (
        <PickedMember label="Member" member={picked} onClear={() => setPicked(null)} />
      ) : (
        <MemberPicker label="Search the member directory" onPick={setPicked} excludeIds={memberIds} />
      )}
      <label className="block">
        <span className="field-label">Role in this {kind === "FAMILY" ? "family" : "cell"}</span>
        <select className="input" value={relation} onChange={(e) => setChosen(e.target.value)}>
          {options.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
      </label>
      {kind === "FAMILY" && relation === "SPOUSE" && hasHead && (
        <label className="flex min-h-[44px] items-center gap-2 text-[14px]">
          <input type="checkbox" className="size-4" checked={linkSpouse} onChange={(e) => setLinkSpouse(e.target.checked)} />
          Also set Married and link them as spouses on both records
        </label>
      )}
      <button
        type="button"
        className="btn btn-primary w-full"
        disabled={!picked || pending}
        onClick={() => run(() => addMemberAction(householdId, picked!.id, relation as never, kind === "FAMILY" && relation === "SPOUSE" && linkSpouse), () => setPicked(null))}
      >
        {pending ? "Saving…" : picked ? `Add ${picked.firstName} ${picked.lastName}` : "Choose a member first"}
      </button>
      <Msg msg={msg} />
    </div>
  );
}

export function RelationSelect({ kind, householdId, memberId, relation, label, hasOtherHead }: { kind: Kind; householdId: string; memberId: string; relation: string; label: string; hasOtherHead: boolean }) {
  const { pending, msg, run } = useRun();
  const options = roleOptions(kind, hasOtherHead);
  // Older entries can carry a role this kind no longer offers; keep it visible.
  if (!options.some((o) => o.id === relation)) options.push({ id: relation as never, label: relationLabel(kind, relation as never) });
  return (
    <span className="flex flex-col">
      <select aria-label={`Role of ${label}`} className="input h-10 min-h-10 w-60" defaultValue={relation} disabled={pending} onChange={(e) => run(() => setRelationAction(householdId, memberId, e.target.value as never))}>
        {options.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
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
