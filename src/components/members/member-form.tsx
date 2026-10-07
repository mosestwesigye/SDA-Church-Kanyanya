"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { maskUgPhoneInput, normalizeUgPhone } from "@/lib/phone";
import { MARITAL_LABELS, STATUS_KEYS, STATUS_META } from "@/lib/labels";
import { queueMemberUpdate } from "@/lib/outbox";
import { checkDuplicatesAction, createMemberAction, searchMembersAction, updateMemberAction } from "@/app/(staff)/members/form-actions";
import type { Option } from "./types";
import { toast } from "@/lib/toast";

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
  /** Optional family/cell placement: "" (none), a household id, or "__new__". */
  householdChoice: string;
  householdNewName: string;
  householdRelation: string;
};

export const EMPTY_VALUES: FormValues = {
  lastName: "", firstName: "", gender: "", dobMode: "UNKNOWN", dobDate: "", dobYear: "", yearJoined: "", zoneId: "", phone: "",
  email: "", status: "", maritalStatus: "", spouseMemberId: "", spouseLabel: "", spouseName: "", nextOfKinName: "", nextOfKinPhone: "", professionId: "",
  householdChoice: "", householdNewName: "", householdRelation: "OTHER",
};

export type HouseholdOption = { id: string; label: string; size: number; hasHead: boolean };
const HOUSEHOLD_RELATIONS = [
  { id: "OTHER", label: "Cell member" },
  { id: "HEAD", label: "Head / cell leader" },
  { id: "SPOUSE", label: "Spouse" },
  { id: "CHILD", label: "Child" },
  { id: "DEPENDANT", label: "Dependant" },
];

type Caps = { profile: boolean; contact: boolean; sensitive: boolean; statusEditable: boolean; manageMinistry: boolean; household?: boolean };
type Dup = { id: string; memberId: string; lastName: string; firstName: string; zone: string | null; reasons: string[]; samePhone: boolean; similarity: number };

const STEPS = ["Identity", "Contact", "Status & family", "Service", "Review"] as const;
const STEP_INFO: Record<(typeof STEPS)[number], string> = {
  Identity: "Name, gender, birth and when they joined",
  Contact: "Where they live and how to reach them",
  "Status & family": "Membership status, marriage, next of kin and family / cell",
  Service: "Profession and ministries",
  Review: "Check everything before saving",
};

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
  households = [],
  currentHouseholds = [],
}: {
  mode: "create" | "edit";
  memberId?: string;
  version?: number;
  initial: FormValues;
  options: { zones: Option[]; professions: Option[]; ministries: Option[]; roles: Option[] };
  caps: Caps;
  startStep?: number;
  households?: HouseholdOption[];
  currentHouseholds?: { id: string; name: string; relation: string }[];
}) {
  const router = useRouter();
  const [v, setV] = useState<FormValues>(initial);
  const [step, setStep] = useState(startStep);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedOffline, setSavedOffline] = useState(false);
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
  // Don't shout about empty required fields until the user tries to move on.
  const [attempted, setAttempted] = useState(false);
  const visibleStepErrors = attempted ? stepErrors : Object.fromEntries(Object.entries(stepErrors).filter(([k]) => String(v[k as keyof FormValues] ?? "").trim() !== ""));
  const errs = { ...visibleStepErrors, ...fieldErrors };
  const STEP_FIELDS: string[][] = [["lastName", "firstName", "dobDate", "dobYear", "yearJoined"], ["phone", "email"], ["nextOfKinPhone"], [], []];
  const stepHasError = (i: number) => STEP_FIELDS[i].some((f) => visibleStepErrors[f]);

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
    const household =
      caps.household && v.householdChoice
        ? v.householdChoice === "__new__"
          ? { newName: v.householdNewName.trim(), relation: v.householdRelation }
          : { householdId: v.householdChoice, relation: v.householdRelation }
        : null;
    if (household && "newName" in household && (household.newName ?? "").length < 2) {
      setError("Enter a name for the new family or cell, or choose “Not in a family or cell”.");
      return;
    }
    start(async () => {
      // Offline edits go to the device outbox and sync later (version-checked on the server).
      const queueOffline = async () => {
        await queueMemberUpdate({ memberId: memberId!, version: version!, patch: fields, label: `${initial.lastName}, ${initial.firstName}` });
        setSavedOffline(true);
        toast.info("Saved on this device", { description: "The change will be sent automatically when you’re back online." });
      };
      if (mode === "edit" && !navigator.onLine) return queueOffline();
      let r;
      try {
        r =
          mode === "create"
            ? await createMemberAction({ fields, ministries, confirmedNotDuplicate: confirmed, household })
            : await updateMemberAction(memberId!, version!, fields, household);
      } catch (e) {
        if (mode === "edit" && !navigator.onLine) return queueOffline();
        const msg = mode === "create" && !navigator.onLine ? "You’re offline. New members can only be added online." : "Couldn’t reach the server. Check your connection and try again.";
        setError(msg);
        toast.error(msg);
        console.error(e);
        return;
      }
      if (!r.ok) {
        setError(r.error);
        setFieldErrors(r.fieldErrors ?? {});
        toast.error(r.error);
        return;
      }
      if (mode === "create") (r.message?.includes("but not added") ? toast.warning : toast.success)("Member added to the register", { description: r.message });
      else toast.success("Member record updated", { description: r.message });
      router.push(`/members/${r.data?.id ?? memberId}`);
      router.refresh();
    });
  }

  const canSave = Object.keys(stepErrors).length === 0 && (!strongDup || confirmed || mode === "edit");
  const last = step === STEPS.length - 1;

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_300px]">
      {/* Stepper */}
      <nav aria-label="Form steps" className="lg:sticky lg:top-[88px]">
        <div className="mb-3 lg:hidden">
          <div className="flex justify-between text-[13px] text-ink-2">
            <span>Step {step + 1} of {STEPS.length}</span>
            <span>{STEPS[step]}</span>
          </div>
          <div className="mt-1.5 h-1.5 rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
          </div>
        </div>
        <ol className="hidden space-y-1 lg:block">
          {STEPS.map((s, i) => {
            const done = i < step && !stepHasError(i);
            return (
              <li key={s} className="relative">
                {i < STEPS.length - 1 && <span aria-hidden className={`absolute left-[23px] top-10 h-[calc(100%-24px)] w-px ${i < step ? "bg-primary" : "bg-line"}`} />}
                <button
                  type="button"
                  onClick={() => setStep(i)}
                  aria-current={step === i ? "step" : undefined}
                  className={`flex w-full items-start gap-3 rounded-[8px] px-2.5 py-2 text-left ${step === i ? "bg-primary-soft" : "hover:bg-surface-2"}`}
                >
                  <span
                    className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-full text-[12px] font-semibold ${
                      stepHasError(i) ? "bg-error-soft text-error" : step === i ? "bg-primary text-primary-ink" : done ? "bg-primary/15 text-primary" : "border border-line bg-surface text-ink-2"
                    }`}
                  >
                    {stepHasError(i) ? "!" : done ? "✓" : i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className={`block text-[14px] ${step === i ? "font-semibold text-primary" : "font-medium text-ink"}`}>{s}</span>
                    <span className="block text-[12px] leading-snug text-ink-2">{STEP_INFO[s]}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <form
        className="card overflow-hidden"
        onInvalidCapture={() => setAttempted(true)}
        onSubmit={(e) => {
          e.preventDefault();
          setAttempted(true);
          if (last) save();
          else setStep(step + 1);
        }}
      >
        <header className="border-b border-line bg-surface-2/50 px-5 py-4 md:px-6">
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-primary">Step {step + 1} of {STEPS.length}</p>
          <h2 className="mt-1 text-[20px] font-semibold leading-tight">{STEPS[step]}</h2>
          <p className="mt-1 text-[14px] text-ink-2">{STEP_INFO[STEPS[step]]}</p>
        </header>
        <div className="space-y-6 px-5 py-5 md:px-6">
        {step === 0 && (
          <>
            <Group title="Name" hint="As written in the church register. Required.">
              <Row>
                <Text label="Last name" required value={v.lastName} onChange={(x) => set("lastName", x)} error={errs.lastName} autoFocus autoComplete="family-name" />
                <Text label="First name" required value={v.firstName} onChange={(x) => set("firstName", x)} error={errs.firstName} autoComplete="given-name" />
              </Row>
            </Group>
            {caps.profile ? (
              <Group title="Personal details">
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
                <Text label="Year joined this church" inputMode="numeric" value={v.yearJoined} onChange={(x) => set("yearJoined", x.replace(/\D/g, "").slice(0, 4))} error={errs.yearJoined} placeholder="e.g. 1996" />
              </Group>
            ) : (
              <RestrictedNote />
            )}
          </>
        )}

        {step === 1 && (
          <>
            {caps.profile && (
              <Group title="Where they live" hint="Pick the church zone. Use “Outside church area” for members beyond the zones.">
                <Select label="Physical address / zone" value={v.zoneId} onChange={(x) => set("zoneId", x)} options={options.zones} />
              </Group>
            )}
            {caps.contact ? (
              <Group title="How to reach them">
                <Text label="Phone" type="tel" inputMode="tel" value={v.phone} onChange={(x) => set("phone", x.startsWith("+") ? x : maskUgPhoneInput(x))} error={errs.phone} placeholder="07XX XXX XXX" autoComplete="tel" />
                <Text label="Email (optional)" type="email" value={v.email} onChange={(x) => set("email", x)} error={errs.email} autoComplete="email" />
              </Group>
            ) : (
              <RestrictedNote />
            )}
          </>
        )}

        {step === 2 && (
          <>
            {caps.profile &&
              (caps.statusEditable ? (
                <Group title="Membership">
                  <Select label="Membership status" value={v.status} onChange={(x) => set("status", x)} options={STATUS_KEYS.map((s) => ({ id: s, label: STATUS_META[s].label }))} />
                </Group>
              ) : (
                <p className="text-[14px] text-ink-2">
                  Membership status: <strong>{STATUS_META[v.status as keyof typeof STATUS_META]?.label ?? "Not recorded"}</strong>. Status changes go through approval —
                  use <Link className="text-primary underline" href={`/transfers/new?member=${memberId}`}>Change status</Link>.
                </p>
              ))}
            {caps.sensitive ? (
              <>
                <Group title="Marriage" restricted>
                  <Select label="Marital status" value={v.maritalStatus} onChange={(x) => set("maritalStatus", x)} options={Object.entries(MARITAL_LABELS).map(([id, label]) => ({ id, label }))} />
                  {v.maritalStatus === "MARRIED" && <SpousePicker v={v} set={set} excludeId={memberId} />}
                </Group>
                <Group title="Next of kin" hint="Who to contact in an emergency." restricted>
                  <Row>
                    <Text label="Name" value={v.nextOfKinName} onChange={(x) => set("nextOfKinName", x)} />
                    <Text label="Phone" type="tel" inputMode="tel" value={v.nextOfKinPhone} onChange={(x) => set("nextOfKinPhone", maskUgPhoneInput(x))} error={errs.nextOfKinPhone} placeholder="07XX XXX XXX" />
                  </Row>
                </Group>
              </>
            ) : (
              <p className="text-[14px] text-ink-2">Marital status, spouse and next of kin are restricted for your role.</p>
            )}
            {caps.household && (
              <HouseholdPicker v={v} set={set} households={households} current={currentHouseholds} />
            )}
          </>
        )}

        {step === 3 && (
          <>
            {caps.profile && (
              <Group title="Work">
                <Select label="Profession" value={v.professionId} onChange={(x) => set("professionId", x)} options={options.professions} />
              </Group>
            )}
            {mode === "create" && caps.manageMinistry ? (
              <Group title="Ministries" hint="A member can serve in several ministries, each with a role.">
                <MinistryPairs pairs={ministries} setPairs={setMinistries} options={options} />
              </Group>
            ) : mode === "edit" ? (
              <p className="text-[14px] text-ink-2">Add or remove ministries on the profile’s “Ministry & Service” tab.</p>
            ) : null}
          </>
        )}

        {step === 4 && <Review v={v} options={options} ministries={ministries} caps={caps} households={households} />}

        {error && (
          <p role="alert" className="rounded-[6px] bg-error-soft px-3 py-2 text-[14px] text-error">
            {error}
          </p>
        )}
        {savedOffline && (
          <p role="status" className="rounded-[6px] bg-primary-soft px-3 py-2 text-[14px] text-primary">
            Saved on this device. It will be sent automatically when you’re back online — see the status in the top bar.
          </p>
        )}

        </div>
        <div className="sticky bottom-[72px] flex flex-wrap items-center justify-between gap-2 border-t border-line bg-surface px-5 py-3 md:bottom-0 md:px-6">
          <button type="button" className="btn btn-secondary" disabled={step === 0} onClick={() => setStep(step - 1)}>
            ← Back
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
                Next: {STEPS[step + 1]} →
              </button>
            )}
          </span>
        </div>
      </form>

      {/* Duplicate panel */}
      <aside aria-live="polite" className="space-y-3 lg:col-start-2 xl:col-start-auto xl:sticky xl:top-[88px]">
        <Summary v={v} options={options} ministries={ministries} mode={mode} />
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

function HouseholdPicker({ v, set, households, current }: { v: FormValues; set: <K extends keyof FormValues>(k: K, val: FormValues[K]) => void; households: HouseholdOption[]; current: { id: string; name: string; relation: string }[] }) {
  const inIds = new Set(current.map((c) => c.id));
  const choices = households.filter((h) => !inIds.has(h.id));
  const chosen = households.find((h) => h.id === v.householdChoice);
  const relations = HOUSEHOLD_RELATIONS.filter((r) => r.id !== "HEAD" || !chosen?.hasHead);
  return (
    <Group title="Family / cell" hint="Optional. Put them in an existing family or cell, or start a new one.">
      {current.length > 0 && (
        <p className="text-[14px]">
          Already in: {current.map((c) => `${c.name} (${HOUSEHOLD_RELATIONS.find((r) => r.id === c.relation)?.label ?? c.relation})`).join(", ")}
        </p>
      )}
      <div>
        <label htmlFor="f-household" className="field-label">{current.length ? "Also add to" : "Family or cell"}</label>
        <select
          id="f-household"
          className="input"
          value={v.householdChoice}
          onChange={(e) => {
            set("householdChoice", e.target.value);
            if (e.target.value && households.find((h) => h.id === e.target.value)?.hasHead && v.householdRelation === "HEAD") set("householdRelation", "OTHER");
          }}
        >
          <option value="">{current.length ? "No other family or cell" : "Not in a family or cell"}</option>
          {choices.map((h) => (
            <option key={h.id} value={h.id}>{h.label} · {h.size} member{h.size === 1 ? "" : "s"}</option>
          ))}
          <option value="__new__">+ Start a new family or cell…</option>
        </select>
      </div>
      {v.householdChoice === "__new__" && (
        <Text label="New family or cell name" value={v.householdNewName} onChange={(x) => set("householdNewName", x)} placeholder="e.g. Kanyanya Cell 3" maxLength={80} />
      )}
      {v.householdChoice && (
        <Select label="Their role in it" value={v.householdRelation} onChange={(x) => set("householdRelation", x || "OTHER")} options={relations} />
      )}
    </Group>
  );
}

function Group({ title, hint, restricted, children }: { title: string; hint?: string; restricted?: boolean; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-4 border-t border-line pt-5 first:border-0 first:pt-0">
      <legend className="float-left mb-1 w-full">
        <span className="flex items-center gap-2 text-[15px] font-semibold">
          {title}
          {restricted && <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink-2">Restricted</span>}
        </span>
        {hint && <span className="mt-0.5 block text-[13px] font-normal text-ink-2">{hint}</span>}
      </legend>
      <div className="clear-both space-y-4">{children}</div>
    </fieldset>
  );
}

/** Live preview of the record being entered, with an estimate of profile completeness. */
function Summary({ v, options, ministries, mode }: { v: FormValues; options: { zones: Option[]; professions: Option[] }; ministries: { ministryId: string }[]; mode: "create" | "edit" }) {
  const checks = [
    v.lastName.trim() && v.firstName.trim(),
    v.gender,
    v.dobMode === "FULL" && v.dobDate,
    v.yearJoined,
    v.zoneId,
    v.phone,
    v.status,
    v.maritalStatus,
    v.nextOfKinName && v.nextOfKinPhone,
    v.professionId,
    mode === "edit" || ministries.some((m) => m.ministryId),
    v.maritalStatus !== "MARRIED" || v.spouseMemberId || v.spouseName,
  ];
  const pct = Math.round((checks.filter(Boolean).length / checks.length) * 100);
  const name = `${v.firstName} ${v.lastName}`.trim();
  const initials = `${v.firstName.trim()[0] ?? ""}${v.lastName.trim()[0] ?? ""}`.toUpperCase();
  const zone = options.zones.find((z) => z.id === v.zoneId)?.label;
  return (
    <section className="card p-4">
      <div className="flex items-center gap-3">
        <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-full bg-primary-soft text-[15px] font-semibold text-primary">{initials || "?"}</span>
        <span className="min-w-0">
          <span className="block truncate font-semibold">{name || "New member"}</span>
          <span className="block truncate text-[13px] text-ink-2">{[zone, v.phone].filter(Boolean).join(" · ") || (mode === "create" ? "ID issued on save" : "")}</span>
        </span>
      </div>
      <div className="mt-4 flex items-baseline justify-between text-[13px]">
        <span className="text-ink-2">Profile completeness</span>
        <span className="font-semibold tabular-nums">{pct}%</span>
      </div>
      <div className="mt-1.5 h-1.5 rounded-full bg-surface-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Profile completeness estimate">
        <div className={`h-full rounded-full ${pct === 100 ? "bg-ok" : "bg-primary"}`} style={{ width: `${Math.max(pct, 2)}%` }} />
      </div>
      <p className="mt-2 text-[12px] text-ink-3">Estimate. A photo, added on the profile after saving, also counts.</p>
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}

function Text({ label, value, onChange, error, ...rest }: { label: string; value: string; onChange: (v: string) => void; error?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const id = `f-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div>
      <label htmlFor={id} className="field-label">
        {label}
        {rest.required && <span className="text-error" aria-hidden> *</span>}
      </label>
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

function Review({ v, options, ministries, caps, households }: { v: FormValues; options: { zones: Option[]; professions: Option[]; ministries: Option[]; roles: Option[] }; ministries: { ministryId: string; roleId: string }[]; caps: Caps; households: HouseholdOption[] }) {
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
    ...(v.householdChoice
      ? ([["Family / cell", `${v.householdChoice === "__new__" ? `${v.householdNewName || "New"} (new)` : (households.find((h) => h.id === v.householdChoice)?.label ?? "—")} · ${HOUSEHOLD_RELATIONS.find((r) => r.id === v.householdRelation)?.label ?? ""}`]] as [string, string][])
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
