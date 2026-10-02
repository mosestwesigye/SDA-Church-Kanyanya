"use client";

import { useState, useTransition } from "react";
import { maskUgPhoneInput, normalizeUgPhone } from "@/lib/phone";
import { quickSaveAction } from "@/app/(staff)/cleanup/actions";
import type { Option } from "@/components/members/types";

export type QuickRow = {
  id: string;
  memberId: string;
  name: string;
  version: number;
  completeness: number;
  gender: string | null;
  dob: string | null;
  zoneId: string | null;
  phone: string | null;
  phoneValid: boolean;
  ministry: string | null;
};

/**
 * One editable row per member. Tab moves between cells; Enter saves the row.
 * Only empty cells are editable here — filled values are shown as text.
 */
function Row({ r, zones, ministries }: { r: QuickRow; zones: Option[]; ministries: Option[] }) {
  const [gender, setGender] = useState("");
  const [dob, setDob] = useState("");
  const [zone, setZone] = useState("");
  const [phone, setPhone] = useState(r.phoneValid ? "" : (r.phone ?? ""));
  const [ministry, setMinistry] = useState("");
  const [version, setVersion] = useState(r.version);
  const [state, setState] = useState<{ ok?: number; error?: string } | null>(null);
  const [pending, start] = useTransition();
  const phoneBad = phone !== "" && !normalizeUgPhone(phone)?.valid;
  const dirty = Boolean(gender || dob || zone || (phone && phone !== r.phone) || ministry);

  function save() {
    if (!dirty || phoneBad || pending) return;
    start(async () => {
      const res = await quickSaveAction(r.id, version, {
        gender: (gender || undefined) as "MALE" | "FEMALE" | undefined,
        dob: dob || undefined,
        zoneId: zone || undefined,
        phone: phone && phone !== r.phone ? phone : undefined,
        ministryId: ministry || undefined,
      });
      if (res.ok) {
        setState({ ok: res.data!.completeness });
        setVersion(res.data!.version);
      } else setState({ error: res.error });
    });
  }

  const cell = "h-10 w-full min-w-0 rounded-[6px] border border-dashed border-line bg-surface px-1.5 text-[13px] focus:border-solid focus:border-primary";
  const filled = "flex h-10 min-w-0 items-center px-1.5 text-[13px] leading-tight";
  const saved = state?.ok !== undefined && !dirty;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className={`grid grid-cols-2 gap-2 lg:gap-1.5 border-t border-line px-4 py-3 lg:grid-cols-[minmax(110px,1.2fr)_74px_90px_92px_118px_minmax(90px,1fr)_64px] lg:items-center ${saved ? "bg-primary-soft" : ""}`}
      aria-label={`Quick edit ${r.name} (${r.memberId})`}
    >
      <div className="col-span-2 lg:col-span-1">
        <a href={`/members/${r.id}`} target="_blank" rel="noreferrer" className="font-semibold leading-tight hover:underline">{r.name}</a>
        <div className="mono text-[12px] text-ink-3">
          {r.memberId.replace("SDAK/", "")} · {state?.ok ?? r.completeness}%
        </div>
      </div>
      {r.gender ? <span className={filled}>{r.gender === "MALE" ? "Male" : "Female"}</span> : (
        <select aria-label="Gender" className={cell} value={gender} onChange={(e) => setGender(e.target.value)}>
          <option value="">Select</option>
          <option value="FEMALE">Female</option>
          <option value="MALE">Male</option>
        </select>
      )}
      {r.dob ? <span className={filled}>{r.dob.replace(" (year only)", "")}</span> : (
        <input aria-label="Year or date of birth" className={cell} placeholder="Year or date" value={dob} onChange={(e) => setDob(e.target.value)} inputMode="numeric" />
      )}
      {r.zoneId ? <span className={filled}>{zones.find((z) => z.id === r.zoneId)?.label}</span> : (
        <select aria-label="Zone" className={cell} value={zone} onChange={(e) => setZone(e.target.value)}>
          <option value="">Select</option>
          {zones.map((z) => <option key={z.id} value={z.id}>{z.label}</option>)}
        </select>
      )}
      {r.phone && r.phoneValid ? <span className={filled}>{r.phone}</span> : (
        <div>
          <input
            aria-label="Phone"
            aria-invalid={phoneBad}
            className={`${cell} ${phoneBad ? "border-solid border-error bg-error-soft" : ""}`}
            placeholder="07XX XXX XXX"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(maskUgPhoneInput(e.target.value))}
          />
          {phoneBad && <p className="mt-0.5 text-[12px] text-error">Use 07XX XXX XXX</p>}
        </div>
      )}
      {r.ministry ? <span className={`${filled} block truncate pt-2.5`} title={r.ministry}>{r.ministry}</span> : (
        <select aria-label="Ministry" className={cell} value={ministry} onChange={(e) => setMinistry(e.target.value)}>
          <option value="">Select</option>
          {ministries.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      )}
      <div className="flex items-center justify-end">
        {saved ? (
          <span className="text-[14px] font-semibold text-ok" role="status">Saved ✓</span>
        ) : (
          <button className="btn btn-primary h-10 min-h-10 w-full px-2" disabled={!dirty || phoneBad || pending}>
            {pending ? "…" : "Save"}
          </button>
        )}
      </div>
      {state?.error && <p role="alert" className="col-span-2 text-[13px] text-error lg:col-span-7">{state.error}</p>}
    </form>
  );
}

export function QuickEditQueue({ rows, zones, ministries }: { rows: QuickRow[]; zones: Option[]; ministries: Option[] }) {
  return (
    <div>
      <div className="hidden bg-surface-2 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-2 lg:grid lg:grid-cols-[minmax(110px,1.2fr)_74px_90px_92px_118px_minmax(90px,1fr)_64px] lg:gap-2">
        <span>Member</span>
        <span>Gender</span>
        <span>DOB / year</span>
        <span>Zone</span>
        <span>Phone</span>
        <span>Ministry</span>
        <span />
      </div>
      {rows.map((r) => (
        <Row key={r.id} r={r} zones={zones} ministries={ministries} />
      ))}
    </div>
  );
}
