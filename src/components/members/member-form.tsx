"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { maskUgPhoneInput, normalizeUgPhone } from "@/lib/phone";
import { MARITAL_LABELS, STATUS_KEYS, STATUS_META } from "@/lib/labels";
import { checkDuplicatesAction, createMemberAction, searchMembersAction, updateMemberAction } from "@/app/(staff)/members/form-actions";
import type { Option } from "./types";

export type FormValues = {
  lastName: string;
  firstName: string;
  gender: "" | "MALE" | "FEMALE";
  dobMode: "FULL" | "YEAR" | "UNKNOWN";
  dobDate: string;
  dobYear: string;
  yearJoined: string;
  zoneId: string;
  phone: string;
  email: string;
  status: string;
  maritalStatus: string;
  spouseMemberId: string;
  spouseLabel: string;
  spouseName: string;
  nextOfKinName: string;
  nextOfKinPhone: string;
  professionId: string;
};

export const EMPTY_VALUES: FormValues = {
  lastName: "", firstName: "", gender: "", dobMode: "UNKNOWN", dobDate: "", dobYear: "", yearJoined: "", zoneId: "", phone: "",
  email: "", status: "", maritalStatus: "", spouseMemberId: "", spouseLabel: "", spouseName: "", nextOfKinName: "", nextOfKinPhone: "", professionId: "",
};

type Caps = { profile: boolean; contact: boolean; sensitive: boolean; statusEditable: boolean; manageMinistry: boolean };
type Dup = { id: string; memberId: string; lastName: string; firstName: string; zone: string | null; reasons: string[]; samePhone: boolean; similarity: number };

const STEPS = ["Identity", "Contact", "Status & family", "Service", "Review"] as const;

/** Domain patch from form values (empty → null). */
function toFields(v: FormValues) {
  const n = (s: string) => (s.trim() === "" ? null : s.trim());
  const num = (s: string) => (s.trim() === "" ? null : Number(s));
  return {
    lastName: v.lastName.trim(),
    firstName: v.firstName.trim(),
    gender: v.gender || null,
    dobPrecision: v.dobMode,
    dobDate: v.dobMode === "FULL" ? n(v.dobDate) : null,
    dobYear: v.dobMode === "YEAR" ? num(v.dobYear) : v.dobMode === "FULL" && v.dobDate ? Number(v.dobDate.slice(0, 4)) : null,
    yearJoined: num(v.yearJoined),
    zoneId: n(v.zoneId),
    phone: n(v.phone),
    email: n(v.email),
    status: n(v.status),
    maritalStatus: n(v.maritalStatus),
    spouseMemberId: n(v.spouseMemberId),
    spouseName: v.spouseMemberId ? null : n(v.spouseName),
    nextOfKinName: n(v.nextOfKinName),
    nextOfKinPhone: n(v.nextOfKinPhone),
    professionId: n(v.professionId),
  };
}

const GROUP: Record<string, keyof Caps> = {
  gender: "profile", dobPrecision: "profile", dobDate: "profile", dobYear: "profile", yearJoined: "profile", zoneId: "profile", status: "profile", professionId: "profile",
  phone: "contact", email: "contact",
  maritalStatus: "sensitive", spouseMemberId: "sensitive", spouseName: "sensitive", nextOfKinName: "sensitive", nextOfKinPhone: "sensitive",
};

export function MemberForm({
  mode,
  memberId,
  version,
  initial,
  options,
  caps,
  startStep = 0,
}: {
  mode: "create" | "edit";
  memberId?: string;
  version?: number;
  initial: FormValues;
  options: { zones: Option[]; professions: Option[]; ministries: Option[]; roles: Option[] };
  caps: Caps;
  startStep?: number;
}) {
  const router = useRouter();
  const [v, setV] = useState<FormValues>(initial);
  const [step, setStep] = useState(startStep);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [dups, setDups] = useState<Dup[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [ministries, setMinistries] = useState<{ ministryId: string; roleId: string }[]>([]);
  const set = <K extends keyof FormValues>(k: K, val: FormValues[K]) => setV((p) => ({ ...p, [k]: val }));

  // Live duplicate detection (debounced).
  useEffect(() => {
    if (v.lastName.trim().length + v.firstName.trim().length < 4 && !normalizeUgPhone(v.phone)?.valid) return;
    const t = setTimeout(() => {
      checkDuplicatesAction({ lastName: v.lastName, firstName: v.firstName, phone: v.phone, excludeId: memberId }).then((d) => {
        setDups(d);
        setConfirmed(false);
      });
    }, 450);
    return () => clearTimeout(t);
  }, [v.lastName, v.firstName, v.phone, memberId]);
  const strongDup = dups.some((d) => d.samePhone || d.similarity >= 0.7);

  const phoneErr = v.phone && !normalizeUgPhone(v.phone)?.valid ? "Use 07XX XXX XXX" : null;
  const nokPhoneErr = v.nextOfKinPhone && !normalizeUgPhone(v.nextOfKinPhone)?.valid ? "Use 07XX XXX XXX" : null;
  const thisYear = new Date().getFullYear();

  const stepErrors = useMemo(() => {
    const e: Record<string, string> = {};
    if (!v.lastName.trim()) e.lastName = "Last name is required";
    if (!v.firstName.trim()) e.firstName = "First name is required";
    if (v.dobMode === "FULL" && !v.dobDate) e.dobDate = "Enter the date of birth";
    if (v.dobMode === "YEAR" && !(Number(v.dobYear) >= 1900 && Number(v.dobYear) <= thisYear)) e.dobYear = `Enter a year between 1900 and ${thisYear}`;
    if (v.yearJoined && !(Number(v.yearJoined) >= 1900 && Number(v.yearJoined) <= thisYear)) e.yearJoined = `Enter a year between 1900 and ${thisYear}`;
    if (phoneErr) e.phone = phoneErr;
    if (v.email && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v.email)) e.email = "Enter a valid email or leave it blank";
    if (nokPhoneErr) e.nextOfKinPhone = nokPhoneErr;
    return e;
  }, [v, phoneErr, nokPhoneErr, thisYear]);
  const errs = { ...stepErrors, ...fieldErrors };
  const STEP_FIELDS: string[][] = [["lastName", "firstName", "dobDate", "dobYear", "yearJoined"], ["phone", "email"], ["nextOfKinPhone"], [], []];
  const stepHasError = (i: number) => STEP_FIELDS[i].some((f) => stepErrors[f]);

  function save() {
    setError(null);
    setFieldErrors({});
    const all = toFields(v);
    const init = toFields(initial);
    // Only send fields the user may edit, and for edits only those that changed.
    const fields = Object.fromEntries(
      Object.entries(all).filter(([k, val]) => {
        const g = GROUP[k];
        if (g && !caps[g]) return false;
        if (k === "status" && !caps.statusEditable) return false;
        return mode === "create" ? val !== null || k === "lastName" || k === "firstName" : JSON.stringify(val) !== JSON.stringify(init[k as keyof typeof init]);
      }),
    );
    if (mode === "edit" && ("dobPrecision" in fields || "dobDate" in fields || "dobYear" in fields)) {
      Object.assign(fields, { dobPrecision: all.dobPrecision, dobDate: all.dobDate, dobYear: all.dobYear });
    }
    start(async () => {
      const r =
        mode === "create"
          ? await createMemberAction({ fields, ministries, confirmedNotDuplicate: confirmed })
          : await updateMemberAction(memberId!, version!, fields);
      if (!r.ok) {
        setError(r.error);
        setFieldErrors(r.fieldErrors ?? {});
        return;
      }
      router.push(`/members/${r.data?.id ?? memberId}`);
      router.refresh();
    });
  }

  const canSave = Object.keys(stepErrors).length === 0 && (!strongDup || confirmed || mode === "edit");
  const last = step === STEPS.length - 1;

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)_300px]">
      {/* Stepper */}
      <ol className="flex gap-1 overflow-x-auto lg:flex-col" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button
              type="button"
              onClick={() => setStep(i)}
              aria-current={step === i ? "step" : undefined}
              className={`flex min-h-[44px] w-full items-center gap-2 whitespace-nowrap rounded-[6px] px-3 text-left text-[14px] ${step === i ? "bg-primary-soft font-semibold text-primary" : "text-ink-2 hover:bg-surface-2"}`}
            >
              <span className={`grid size-6 place-items-center rounded-full text-[12px] ${step === i ? "bg-primary text-primary-ink" : "bg-surface-2"}`}>{i + 1}</span>
              {s}
              {stepHasError(i) && <span className="text-error" aria-label="has errors">●</span>}
            </button>
          </li>
        ))}
      </ol>

      <form
        className="card p-5 space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (last) save();
          else setStep(step + 1);
        }}
      >
        <h2 className="text-[19px] font-semibold">{STEPS[step]}</h2>

        {step === 0 && (
          <>
            <Row>
              <Text label="Last name" value={v.lastName} onChange={(x) => set("lastName", x)} error={errs.lastName} autoFocus autoComplete="family-name" />
              <Text label="First name" value={v.firstName} onChange={(x) => set("firstName", x)} error={errs.firstName} autoComplete="given-name" />
            </Row>
            {caps.profile ? (
              <>
                <Choice label="Gender" value={v.gender} onChange={(x) => set("gender", x as FormValues["gender"])} options={[{ id: "FEMALE", label: "Female" }, { id: "MALE", label: "Male" }]} />
                <fieldset>
                  <legend className="field-label">Date of birth</legend>
                  <div className="mb-2 flex flex-wrap gap-2" role="radiogroup">
                    {([["FULL", "Full date"], ["YEAR", "Year only"], ["UNKNOWN", "Not known"]] as const).map(([k, l]) => (
                      <button key={k} type="button" role="radio" aria-checked={v.dobMode === k} onClick={() => set("dobMode", k)}
                        className={`min-h-[44px] rounded-[6px] border px-3 text-[14px] ${v.dobMode === k ? "border-primary bg-primary-soft font-semibold" : "border-line"}`}>
                        {l}
                      </button>
                    ))}
                  </div>
                  {v.dobMode === "FULL" && <Text label="Date" type="date" value={v.dobDate} onChange={(x) => set("dobDate", x)} error={errs.dobDate} max={new Date().toISOString().slice(0, 10)} />}
                  {v.dobMode === "YEAR" && <Text label="Year of birth" inputMode="numeric" value={v.dobYear} onChange={(x) => set("dobYear", x.replace(/\D/g, "").slice(0, 4))} error={errs.dobYear} placeholder="e.g. 1978" />}
                </fieldset>
                <Text label="Year joined church" inputMode="numeric" value={v.yearJoined} onChange={(x) => set("yearJoined", x.replace(/\D/g, "").slice(0, 4))} error={errs.yearJoined} placeholder="e.g. 1996" />
              </>
            ) : (
              <RestrictedNote />
            )}
          </>
        )}

        {step === 1 && (
          <>
            {caps.profile && <Select label="Physical address / zone" value={v.zoneId} onChange={(x) => set("zoneId", x)} options={options.zones} />}
            {caps.contact ? (
              <>
                <Text label="Phone" type="tel" inputMode="tel" value={v.phone} onChange={(x) => set("phone", x.startsWith("+") ? x : maskUgPhoneInput(x))} error={errs.phone} placeholder="07XX XXX XXX" autoComplete="tel" />
                <Text label="Email (optional)" type="email" value={v.email} onChange={(x) => set("email", x)} error={errs.email} autoComplete="email" />
              </>
            ) : (
              <RestrictedNote />
            )}
          </>
        )}

        {step === 2 && (
          <>
            {caps.profile &&
              (caps.statusEditable ? (
                <Select label="Membership status" value={v.status} onChange={(x) => set("status", x)} options={STATUS_KEYS.map((s) => ({ id: s, label: STATUS_META[s].label }))} />
              ) : (
                <p className="text-[14px] text-ink-2">
                  Membership status: <strong>{STATUS_META[v.status as keyof typeof STATUS_META]?.label ?? "Not recorded"}</strong>. Status changes go through approval —
                  use <Link className="text-primary underline" href={`/transfers/new?member=${memberId}`}>Change status</Link>.
                </p>
              ))}
            {caps.sensitive ? (
              <>
                <Select label="Marital status" value={v.maritalStatus} onChange={(x) => set("maritalStatus", x)} options={Object.entries(MARITAL_LABELS).map(([id, label]) => ({ id, label }))} />
                {v.maritalStatus === "MARRIED" && <SpousePicker v={v} set={set} excludeId={memberId} />}
                <Row>
                  <Text label="Next of kin" value={v.nextOfKinName} onChange={(x) => set("nextOfKinName", x)} />
                  <Text label="Next of kin phone" type="tel" inputMode="tel" value={v.nextOfKinPhone} onChange={(x) => set("nextOfKinPhone", maskUgPhoneInput(x))} error={errs.nextOfKinPhone} placeholder="07XX XXX XXX" />
                </Row>
              </>
            ) : (
              <p className="text-[14px] text-ink-2">Marital status, spouse and next of kin are restricted for your role.</p>
            )}
          </>
        )}

        {step === 3 && (
          <>
            {caps.profile && <Select label="Profession" value={v.professionId} onChange={(x) => set("professionId", x)} options={options.professions} />}
            {mode === "create" && caps.manageMinistry ? (
              <MinistryPairs pairs={ministries} setPairs={setMinistries} options={options} />
            ) : mode === "edit" ? (
              <p className="text-[14px] text-ink-2">Add or remove ministries on the profile’s “Ministry & Service” tab.</p>
            ) : null}
          </>
        )}

        {step === 4 && <Review v={v} options={options} ministries={ministries} caps={caps} />}

        {error && (
          <p role="alert" className="rounded-[6px] bg-error-soft px-3 py-2 text-[14px] text-error">
            {error}
          </p>
        )}

        <div className="flex flex-wrap justify-between gap-2 border-t border-line pt-4">
          <button type="button" className="btn btn-secondary" disabled={step === 0} onClick={() => setStep(step - 1)}>
            Back
          </button>
          <span className="flex gap-2">
            {mode === "edit" && !last && (
              <button type="button" className="btn btn-secondary" disabled={pending || !canSave} onClick={save}>
                Save
              </button>
            )}
            {last ? (
              <button type="submit" className="btn btn-primary" disabled={pending || !canSave}>
                {pending ? "Saving…" : mode === "create" ? "Create member" : "Save changes"}
              </button>
            ) : (
              <button type="submit" className="btn btn-primary">
                Next
              </button>
            )}
          </span>
        </div>
      </form>

      {/* Duplicate panel */}
      <aside aria-live="polite" className="space-y-3">
        {dups.length > 0 && (
          <section className={`card p-4 ${strongDup ? "border-[var(--status-irregular)]" : ""}`}>
            <h2 className="font-semibold">{strongDup ? "Possible duplicate" : "Similar members"}</h2>
            <p className="mt-1 text-[13px] text-ink-2">Check these before saving so the same person isn’t entered twice.</p>
            <ul className="mt-3 space-y-2">
              {dups.map((d) => (
                <li key={d.id} className="rounded-[6px] border border-line p-2.5 text-[14px]">
                  <Link href={`/members/${d.id}`} target="_blank" className="font-semibold text-primary hover:underline">
                    {d.lastName}, {d.firstName}
                  </Link>
                  <span className="mono block text-[12px] text-ink-3">{d.memberId}{d.zone ? ` · ${d.zone}` : ""}</span>
                  <span className="mt-1 flex flex-wrap gap-1">
                    {d.reasons.map((r) => (
                      <span key={r} className="rounded bg-surface-2 px-1.5 py-0.5 text-[12px]">{r}</span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
            {mode === "create" && strongDup && (
              <label className="mt-3 flex min-h-[44px] items-start gap-2 text-[14px]">
                <input type="checkbox" className="mt-1 size-4" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                I’ve checked — this is a different person
              </label>
            )}
          </section>
        )}
      </aside>
    </div>
  );
}

/* ───── field components ───── */

function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}

function Text({ label, value, onChange, error, ...rest }: { label: string; value: string; onChange: (v: string) => void; error?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const id = `f-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div>
      <label htmlFor={id} className="field-label">{label}</label>
      <input id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-err` : undefined} {...rest} />
      {error && <p id={`${id}-err`} className="mt-1 text-[13px] text-error">{error}</p>}
    </div>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Option[] }) {
  const id = `f-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div>
      <label htmlFor={id} className="field-label">{label}</label>
      <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Not recorded</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </div>
  );
}

function Choice({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Option[] }) {
  return (
    <fieldset>
      <legend className="field-label">{label}</legend>
      <div className="flex flex-wrap gap-2" role="radiogroup">
        {options.map((o) => (
          <button key={o.id} type="button" role="radio" aria-checked={value === o.id} onClick={() => onChange(value === o.id ? "" : o.id)}
            className={`min-h-[44px] min-w-24 rounded-[6px] border px-3 text-[14px] ${value === o.id ? "border-primary bg-primary-soft font-semibold" : "border-line"}`}>
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function RestrictedNote() {
  return <p className="text-[14px] text-ink-2">These fields are restricted for your role.</p>;
}

function SpousePicker({ v, set, excludeId }: { v: FormValues; set: <K extends keyof FormValues>(k: K, val: FormValues[K]) => void; excludeId?: string }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ id: string; memberId: string; lastName: string; firstName: string }[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) return;
    const t = setTimeout(() => searchMembersAction(q, excludeId).then(setResults), 300);
    return () => clearTimeout(t);
  }, [q, excludeId]);
  if (v.spouseMemberId) {
    return (
      <div>
        <span className="field-label">Spouse</span>
        <div className="flex items-center justify-between rounded-[6px] border border-line px-3 min-h-[44px]">
          <span>{v.spouseLabel}</span>
          <button type="button" className="text-[14px] text-primary min-h-[44px]" onClick={() => (set("spouseMemberId", ""), set("spouseLabel", ""))}>Change</button>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div>
        <label htmlFor="spouse-search" className="field-label">Spouse — search members</label>
        <input id="spouse-search" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or SDAK/M ID" autoComplete="off" />
        {q.trim().length >= 2 && results.length > 0 && (
          <ul className="mt-1 rounded-[6px] border border-line bg-surface">
            {results.map((r) => (
              <li key={r.id}>
                <button type="button" className="flex w-full min-h-[44px] items-center justify-between px-3 text-left hover:bg-surface-2"
                  onClick={() => (set("spouseMemberId", r.id), set("spouseLabel", `${r.lastName}, ${r.firstName} · ${r.memberId}`), set("spouseName", ""))}>
                  <span>{r.lastName}, {r.firstName}</span>
                  <span className="mono text-[12px] text-ink-3">{r.memberId}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Text label="…or spouse’s name if not a member" value={v.spouseName} onChange={(x) => set("spouseName", x)} />
    </div>
  );
}

function MinistryPairs({ pairs, setPairs, options }: { pairs: { ministryId: string; roleId: string }[]; setPairs: (p: { ministryId: string; roleId: string }[]) => void; options: { ministries: Option[]; roles: Option[] } }) {
  const memberRole = options.roles.find((r) => r.label === "Member")?.id ?? "";
  return (
    <fieldset className="space-y-2">
      <legend className="field-label">Ministries</legend>
      {pairs.map((p, i) => (
        <div key={i} className="flex flex-wrap gap-2">
          <select aria-label="Ministry" className="input flex-1 min-w-40" value={p.ministryId} onChange={(e) => setPairs(pairs.map((x, j) => (j === i ? { ...x, ministryId: e.target.value } : x)))}>
            <option value="">Choose…</option>
            {options.ministries.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          <select aria-label="Role" className="input w-44" value={p.roleId} onChange={(e) => setPairs(pairs.map((x, j) => (j === i ? { ...x, roleId: e.target.value } : x)))}>
            {options.roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
          <button type="button" className="btn btn-secondary" onClick={() => setPairs(pairs.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      <button type="button" className="btn btn-secondary" onClick={() => setPairs([...pairs, { ministryId: "", roleId: memberRole }])}>+ Add ministry</button>
    </fieldset>
  );
}

function Review({ v, options, ministries, caps }: { v: FormValues; options: { zones: Option[]; professions: Option[]; ministries: Option[]; roles: Option[] }; ministries: { ministryId: string; roleId: string }[]; caps: Caps }) {
  const label = (list: Option[], id: string) => list.find((o) => o.id === id)?.label ?? "—";
  const rows: [string, string][] = [
    ["Name", `${v.lastName}, ${v.firstName}`],
    ...(caps.profile
      ? ([
          ["Gender", v.gender ? (v.gender === "MALE" ? "Male" : "Female") : "—"],
          ["Date of birth", v.dobMode === "FULL" ? v.dobDate || "—" : v.dobMode === "YEAR" ? `${v.dobYear || "—"} (year only)` : "Not known"],
          ["Year joined", v.yearJoined || "—"],
          ["Zone", v.zoneId ? label(options.zones, v.zoneId) : "—"],
          ["Status", v.status ? STATUS_META[v.status as keyof typeof STATUS_META]?.label : "Not recorded"],
          ["Profession", v.professionId ? label(options.professions, v.professionId) : "—"],
        ] as [string, string][])
      : []),
    ...(caps.contact ? ([["Phone", v.phone || "—"], ["Email", v.email || "—"]] as [string, string][]) : []),
    ...(caps.sensitive
      ? ([
          ["Marital status", v.maritalStatus ? MARITAL_LABELS[v.maritalStatus as keyof typeof MARITAL_LABELS] : "—"],
          ["Spouse", v.spouseLabel || v.spouseName || "—"],
          ["Next of kin", [v.nextOfKinName, v.nextOfKinPhone].filter(Boolean).join(" · ") || "—"],
        ] as [string, string][])
      : []),
    ...ministries.filter((m) => m.ministryId).map((m) => ["Ministry", `${label(options.ministries, m.ministryId)} · ${label(options.roles, m.roleId)}`] as [string, string]),
  ];
  return (
    <dl className="divide-y divide-line">
      {rows.map(([k, val], i) => (
        <div key={i} className="flex justify-between gap-4 py-2.5 text-[15px]">
          <dt className="text-ink-2">{k}</dt>
          <dd className="text-right">{val}</dd>
        </div>
      ))}
    </dl>
  );
}
