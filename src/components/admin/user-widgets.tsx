"use client";

import { useState } from "react";
import { createUserAction, resetTwoFactorAction, revokeSessionsAction, setUserActiveAction, updateAccessAction } from "@/app/(staff)/admin/actions";
import { Dialog } from "@/components/ui/dialog";
import { Msg, useRun } from "@/components/ui/use-run";
import type { RoleKey } from "@/server/authz/catalog";

type Opt = { id: string; label: string };
type RoleOpt = { key: RoleKey; label: string };

function RolePicker({ roles, ministries, value, onChange, ministryIds, onMinistries }: {
  roles: RoleOpt[]; ministries: Opt[]; value: RoleKey[]; onChange: (v: RoleKey[]) => void; ministryIds: string[]; onMinistries: (v: string[]) => void;
}) {
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  return (
    <>
      <fieldset>
        <legend className="field-label">Roles</legend>
        <div className="grid gap-x-4 sm:grid-cols-2">
          {roles.map((r) => (
            <label key={r.key} className="flex min-h-[40px] items-center gap-2.5">
              <input type="checkbox" className="size-4" checked={value.includes(r.key)} onChange={() => onChange(toggle(value, r.key))} /> {r.label}
            </label>
          ))}
        </div>
      </fieldset>
      {value.includes("MINISTRY_HEAD") && (
        <fieldset className="mt-3">
          <legend className="field-label">Ministries they lead</legend>
          <div className="grid max-h-48 gap-x-4 overflow-y-auto sm:grid-cols-2">
            {ministries.map((m) => (
              <label key={m.id} className="flex min-h-[36px] items-center gap-2.5 text-[14px]">
                <input type="checkbox" className="size-4" checked={ministryIds.includes(m.id)} onChange={() => onMinistries(toggle(ministryIds, m.id))} /> {m.label}
              </label>
            ))}
          </div>
        </fieldset>
      )}
    </>
  );
}

export function NewUser({ roles, ministries }: { roles: RoleOpt[]; ministries: Opt[] }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", email: "", password: "" });
  const [sel, setSel] = useState<RoleKey[]>([]);
  const [mins, setMins] = useState<string[]>([]);
  const { pending, msg, run, setMsg } = useRun();
  const close = () => { setOpen(false); setMsg(null); };
  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>Add user</button>
      <Dialog open={open} onClose={close} title="Add a staff user"
        footer={<>
          <button type="button" className="btn btn-secondary" onClick={close}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={pending || !f.name || !f.email || !f.password || !sel.length}
            onClick={() => run(() => createUserAction({ ...f, roles: sel, ministryIds: mins }), () => { setF({ name: "", email: "", password: "" }); setSel([]); setMins([]); })}>
            {pending ? "Adding…" : "Add user"}
          </button>
        </>}>
        <div className="space-y-3">
          <div><label className="field-label" htmlFor="nu-name">Full name</label><input id="nu-name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="off" /></div>
          <div><label className="field-label" htmlFor="nu-email">Email (used to sign in)</label><input id="nu-email" type="email" className="input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="off" /></div>
          <div>
            <label className="field-label" htmlFor="nu-pw">First password</label>
            <input id="nu-pw" type="text" className="input mono" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" />
            <p className="mt-1 text-[13px] text-ink-2">At least 10 characters. Share it privately; they can change it with “Forgot password”.</p>
          </div>
          <RolePicker roles={roles} ministries={ministries} value={sel} onChange={setSel} ministryIds={mins} onMinistries={setMins} />
          <Msg msg={msg} />
        </div>
      </Dialog>
    </>
  );
}

export function EditAccess({ userId, name, roles, ministries, current, currentMinistries }: { userId: string; name: string; roles: RoleOpt[]; ministries: Opt[]; current: RoleKey[]; currentMinistries: string[] }) {
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<RoleKey[]>(current);
  const [mins, setMins] = useState<string[]>(currentMinistries);
  const { pending, msg, run, setMsg } = useRun();
  const close = () => { setOpen(false); setMsg(null); };
  return (
    <>
      <button type="button" className="min-h-[44px] px-2 text-[14px] font-semibold text-primary" onClick={() => setOpen(true)} aria-label={`Change access for ${name}`}>Access</button>
      <Dialog open={open} onClose={close} title={`Access for ${name}`}
        footer={<>
          <button type="button" className="btn btn-secondary" onClick={close}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={pending || !sel.length} onClick={() => run(() => updateAccessAction(userId, sel, mins), close)}>{pending ? "Saving…" : "Save"}</button>
        </>}>
        <RolePicker roles={roles} ministries={ministries} value={sel} onChange={setSel} ministryIds={mins} onMinistries={setMins} />
        <p className="mt-3 text-[13px] text-ink-2">Saving signs them out so the new permissions apply straight away.</p>
        <Msg msg={msg} />
      </Dialog>
    </>
  );
}

export function UserActions({ userId, name, active, twoFactor, sessions, self, canSecurity }: { userId: string; name: string; active: boolean; twoFactor: boolean; sessions: number; self: boolean; canSecurity: boolean }) {
  const { pending, msg, run } = useRun();
  const btn = "min-h-[44px] px-2 text-[14px] disabled:opacity-50";
  return (
    <span className="inline-flex flex-col items-end">
      <span className="flex flex-wrap justify-end">
        {canSecurity && twoFactor && (
          <button type="button" className={btn} disabled={pending} onClick={() => confirm(`Reset two-step verification for ${name}? They will set it up again at next sign-in.`) && run(() => resetTwoFactorAction(userId))}>Reset 2FA</button>
        )}
        {canSecurity && sessions > 0 && !self && (
          <button type="button" className={btn} disabled={pending} onClick={() => run(() => revokeSessionsAction({ userId }))}>Sign out</button>
        )}
        {!self && (
          <button type="button" className={`${btn} ${active ? "text-error" : "text-primary font-semibold"}`} disabled={pending}
            onClick={() => (active ? confirm(`Deactivate ${name}? They are signed out and can’t sign in until reactivated.`) : true) && run(() => setUserActiveAction(userId, !active))}>
            {active ? "Deactivate" : "Reactivate"}
          </button>
        )}
      </span>
      <Msg msg={msg} />
    </span>
  );
}
