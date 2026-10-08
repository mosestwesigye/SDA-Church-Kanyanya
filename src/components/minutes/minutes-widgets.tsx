"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { createMinutesAction, deleteMinutesAction, removeMinutesFileAction, updateMinutesAction, uploadMinutesFileAction } from "@/app/(staff)/minutes/actions";
import { Dialog } from "@/components/ui/dialog";
import { fileSize } from "@/lib/minutes-format";
import { toast } from "@/lib/toast";

type MeetingType = "CHURCH_BOARD" | "BUSINESS_MEETING" | "ELDERS_COUNCIL" | "NOMINATING_COMMITTEE" | "OTHER";
export type MinutesValues = {
  type: MeetingType;
  title: string;
  heldOn: string;
  startTime: string;
  venue: string;
  chairperson: string;
  secretary: string;
  attendance: string;
  summary: string;
  status: "DRAFT" | "APPROVED";
  approvedOn: string;
};

const TYPES: { value: MeetingType; label: string; title: string }[] = [
  { value: "CHURCH_BOARD", label: "Church board", title: "Church Board Meeting" },
  { value: "BUSINESS_MEETING", label: "Business meeting", title: "Church Business Meeting" },
  { value: "ELDERS_COUNCIL", label: "Elders’ council", title: "Elders’ Council Meeting" },
  { value: "NOMINATING_COMMITTEE", label: "Nominating committee", title: "Nominating Committee Meeting" },
  { value: "OTHER", label: "Other meeting", title: "Committee Meeting" },
];

const MAX_BYTES = 4 * 1024 * 1024;
const ACCEPT = ".pdf,.docx,.jpg,.jpeg,.png,.webp,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png,image/webp";

/** Upload files one by one (each request stays under the size limit). Returns how many succeeded. */
async function uploadAll(minutesId: string, files: File[], onProgress: (i: number) => void) {
  let ok = 0;
  for (const [i, f] of files.entries()) {
    onProgress(i);
    const fd = new FormData();
    fd.set("file", f);
    try {
      const r = await uploadMinutesFileAction(minutesId, fd);
      if (r.ok) ok++;
      else toast.error(`Couldn’t upload ${f.name}`, { description: r.error });
    } catch {
      toast.error(`Couldn’t upload ${f.name}`, { description: "Check your connection and add it again from the minutes page." });
    }
  }
  return ok;
}

function FilePicker({ files, setFiles }: { files: File[]; setFiles: (f: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const add = (list: FileList | null) => {
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      if (f.size > MAX_BYTES) {
        toast.error(`${f.name} is larger than 4 MB`, { description: "Save it as a smaller PDF or scan at a lower resolution." });
        continue;
      }
      if (!next.some((x) => x.name === f.name && x.size === f.size)) next.push(f);
    }
    setFiles(next);
  };
  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); }}
        className={`flex flex-col items-center justify-center gap-2 rounded-[10px] border-2 border-dashed px-4 py-7 text-center transition-colors ${drag ? "border-primary bg-primary-soft" : "border-line bg-surface-2/50"}`}
      >
        <svg aria-hidden viewBox="0 0 24 24" className="size-8 text-ink-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" /><path d="M14 3v5h5M12 18v-6m0 0-2.5 2.5M12 12l2.5 2.5" />
        </svg>
        <p className="text-[14px]"><span className="font-semibold">Drag the minutes here</span> or</p>
        <button type="button" className="btn btn-secondary" onClick={() => input.current?.click()}>Choose files</button>
        <p className="text-[12px] text-ink-3">PDF, Word (.docx) or scanned pages (JPEG, PNG) · up to 4 MB each</p>
        <input ref={input} type="file" multiple accept={ACCEPT} className="sr-only" tabIndex={-1} onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
      </div>
      {files.length > 0 && (
        <ul className="mt-3 divide-y divide-line rounded-[8px] border border-line">
          {files.map((f, i) => (
            <li key={`${f.name}-${f.size}`} className="flex items-center justify-between gap-3 px-3 py-2 text-[14px]">
              <span className="min-w-0 truncate">{f.name} <span className="text-ink-3">· {fileSize(f.size)}</span></span>
              <button type="button" className="min-h-[36px] text-[13px] text-error" onClick={() => setFiles(files.filter((_, j) => j !== i))}>Remove</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Field({ id, label, error, hint, children, className = "" }: { id: string; label: string; error?: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label htmlFor={id} className="field-label">{label}</label>
      {children}
      {error ? <p className="mt-1 text-[13px] text-error">{error}</p> : hint ? <p className="mt-1 text-[13px] text-ink-2">{hint}</p> : null}
    </div>
  );
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="card p-5 md:p-6">
      <h2 className="mb-4 flex items-center gap-2.5 text-[16px] font-semibold">
        <span className="grid size-6 place-items-center rounded-full bg-primary-soft text-[12px] font-bold text-primary">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

export function MinutesForm({ id, initial }: { id?: string; initial?: MinutesValues }) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [v, setV] = useState<MinutesValues>(
    initial ?? { type: "CHURCH_BOARD", title: "Church Board Meeting", heldOn: "", startTime: "", venue: "Church boardroom", chairperson: "", secretary: "", attendance: "", summary: "", status: "DRAFT", approvedOn: "" },
  );
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();
  const set = <K extends keyof MinutesValues>(k: K, val: MinutesValues[K]) => setV((p) => ({ ...p, [k]: val }));
  const changeType = (t: MeetingType) =>
    setV((p) => ({ ...p, type: t, title: TYPES.some((x) => x.title === p.title) || !p.title ? TYPES.find((x) => x.value === t)!.title : p.title }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    start(async () => {
      setBusy("Saving…");
      try {
        const r = id ? await updateMinutesAction(id, v) : await createMinutesAction(v);
        if (!r.ok) {
          setErrors(r.fieldErrors ?? {});
          toast.error(r.error);
          return;
        }
        if (id) {
          toast.success(r.message ?? "Minutes updated.");
          router.push(`/minutes/${id}`);
          router.refresh();
          return;
        }
        const { id: newId, reference } = (r as { data: { id: string; reference: string } }).data;
        const sent = await uploadAll(newId, files, (i) => setBusy(`Uploading file ${i + 1} of ${files.length}…`));
        toast.success(`Minutes ${reference} recorded`, { description: files.length ? `${sent} of ${files.length} file${files.length === 1 ? "" : "s"} uploaded.` : "Add the minutes file from this page when it’s ready." });
        router.push(`/minutes/${newId}`);
        router.refresh();
      } catch {
        toast.error("Couldn’t reach the server", { description: "Check your connection and try again." });
      } finally {
        setBusy(null);
      }
    });
  };

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <Section n={1} title="Meeting">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="m-type" label="Meeting type">
            <select id="m-type" className="input" value={v.type} onChange={(e) => changeType(e.target.value as MeetingType)}>
              {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Field>
          <Field id="m-title" label="Title" error={errors.title}>
            <input id="m-title" className="input" value={v.title} maxLength={160} onChange={(e) => set("title", e.target.value)} aria-invalid={Boolean(errors.title)} />
          </Field>
          <Field id="m-date" label="Date of meeting" error={errors.heldOn}>
            <input id="m-date" type="date" className="input" value={v.heldOn} max={today} required onChange={(e) => set("heldOn", e.target.value)} aria-invalid={Boolean(errors.heldOn)} />
          </Field>
          <Field id="m-time" label="Start time" error={errors.startTime} hint="Optional, East Africa Time">
            <input id="m-time" type="time" className="input" value={v.startTime} onChange={(e) => set("startTime", e.target.value)} />
          </Field>
          <Field id="m-venue" label="Venue" className="sm:col-span-2">
            <input id="m-venue" className="input" value={v.venue} maxLength={160} onChange={(e) => set("venue", e.target.value)} />
          </Field>
        </div>
      </Section>

      <Section n={2} title="Officers and attendance">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="m-chair" label="Chairperson">
            <input id="m-chair" className="input" value={v.chairperson} maxLength={120} placeholder="e.g. Pr. Ochieng" onChange={(e) => set("chairperson", e.target.value)} />
          </Field>
          <Field id="m-sec" label="Recording secretary">
            <input id="m-sec" className="input" value={v.secretary} maxLength={120} placeholder="Usually the church clerk" onChange={(e) => set("secretary", e.target.value)} />
          </Field>
          <Field id="m-att" label="Members present" error={errors.attendance}>
            <input id="m-att" type="number" min={0} inputMode="numeric" className="input" value={v.attendance} onChange={(e) => set("attendance", e.target.value)} />
          </Field>
        </div>
      </Section>

      <Section n={3} title="Key decisions">
        <Field id="m-summary" label="Summary of resolutions" error={errors.summary} hint="A short list for the register and search. The full minutes are in the uploaded file.">
          <textarea id="m-summary" className="input min-h-[140px] py-2.5" maxLength={5000} value={v.summary} placeholder={"1. Approved the baptism of …\n2. Voted to …"} onChange={(e) => set("summary", e.target.value)} />
        </Field>
      </Section>

      <Section n={4} title="Approval">
        <fieldset>
          <legend className="sr-only">Status of these minutes</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {([["DRAFT", "Awaiting approval", "Not yet read and confirmed at a meeting."], ["APPROVED", "Approved", "Read and confirmed as a true record."]] as const).map(([val, label, hint]) => (
              <label key={val} className={`flex cursor-pointer gap-3 rounded-[10px] border p-4 ${v.status === val ? "border-primary bg-primary-soft" : "border-line"}`}>
                <input type="radio" name="status" className="mt-1 size-4 accent-[var(--primary)]" checked={v.status === val} onChange={() => set("status", val)} />
                <span>
                  <span className="block font-semibold">{label}</span>
                  <span className="block text-[13px] text-ink-2">{hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {v.status === "APPROVED" && (
          <Field id="m-approved" label="Date approved" error={errors.approvedOn} className="mt-4 max-w-xs">
            <input id="m-approved" type="date" className="input" value={v.approvedOn} min={v.heldOn || undefined} max={today} onChange={(e) => set("approvedOn", e.target.value)} aria-invalid={Boolean(errors.approvedOn)} />
          </Field>
        )}
      </Section>

      {!id && (
        <Section n={5} title="Minutes file">
          <FilePicker files={files} setFiles={setFiles} />
        </Section>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3">
        {busy && <span role="status" className="text-[14px] text-ink-2">{busy}</span>}
        <button type="button" className="btn btn-secondary" onClick={() => router.back()} disabled={Boolean(busy)}>Cancel</button>
        <button className="btn btn-primary min-w-[160px]" disabled={Boolean(busy)}>{id ? "Save changes" : "Record minutes"}</button>
      </div>
    </form>
  );
}

/** Add more files to existing minutes. */
export function AddFiles({ minutesId }: { minutesId: string }) {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const upload = async () => {
    const sent = await uploadAll(minutesId, files, (i) => setBusy(`Uploading ${i + 1} of ${files.length}…`));
    setBusy(null);
    if (sent) toast.success(`${sent} file${sent === 1 ? "" : "s"} added`);
    setFiles([]);
    router.refresh();
  };
  return (
    <div>
      <FilePicker files={files} setFiles={setFiles} />
      {files.length > 0 && (
        <div className="mt-3 flex items-center justify-end gap-3">
          {busy && <span role="status" className="text-[14px] text-ink-2">{busy}</span>}
          <button type="button" className="btn btn-primary" disabled={Boolean(busy)} onClick={upload}>Upload {files.length} file{files.length === 1 ? "" : "s"}</button>
        </div>
      )}
    </div>
  );
}

export function RemoveFile({ minutesId, fileId, name }: { minutesId: string; fileId: string; name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="min-h-[36px] text-[13px] text-error hover:underline print:hidden"
      disabled={pending}
      onClick={() => {
        if (!confirm(`Remove ${name} from these minutes? The audit log keeps a record.`)) return;
        start(async () => {
          const r = await removeMinutesFileAction(minutesId, fileId);
          toast.result(r);
          if (r.ok) router.refresh();
        });
      }}
    >
      Remove
    </button>
  );
}

export function DeleteMinutes({ id, reference }: { id: string; reference: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  return (
    <>
      <button type="button" className="btn btn-secondary text-error" onClick={() => setOpen(true)}>Remove</button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Remove minutes ${reference}?`}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={pending || reason.trim().length < 3}
              onClick={() => start(async () => {
                const r = await deleteMinutesAction(id, reason);
                if (r && !r.ok) toast.error(r.error);
              })}
            >
              Remove minutes
            </button>
          </>
        }
      >
        <p className="text-[14px] text-ink-2">Use this only for minutes recorded by mistake. They leave the register, but the audit log keeps who removed them and why.</p>
        <label htmlFor="del-reason" className="field-label mt-4">Reason</label>
        <input id="del-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Recorded twice" />
      </Dialog>
    </>
  );
}
