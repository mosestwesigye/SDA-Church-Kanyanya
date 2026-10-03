"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Dialog } from "@/components/ui/dialog";
import { purgeMemberAction } from "@/app/(staff)/transfers/actions";
import {
  addMinistryAction,
  deleteMemberAction,
  flagMemberAction,
  removeMinistryAction,
  restoreMemberProfileAction,
  uploadDocumentAction,
  uploadPhotoAction,
} from "@/app/(staff)/members/[id]/actions";
import type { Option } from "./types";

type Result = { ok: boolean; message?: string; error?: string };

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (fn: () => Promise<Result>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      setMsg({ ok: r.ok, text: r.ok ? (r.message ?? "Saved.") : (r.error ?? "Failed.") });
      if (r.ok) {
        after?.();
        router.refresh();
      }
    });
  return { pending, msg, run };
}

function Msg({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return (
    <p role={msg.ok ? "status" : "alert"} className={`mt-2 text-[13px] ${msg.ok ? "text-ok" : "text-error"}`}>
      {msg.text}
    </p>
  );
}

/** Shrink a phone photo before upload (keeps uploads small and under the 4 MB limit). */
async function downscale(file: File, max = 1200): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1_500_000) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.86));
    return blob ?? file;
  } catch {
    return file;
  }
}

/** Member photo: large preview, or an "Upload photo" button in the middle when there is none. */
export function PhotoBox({ memberId, photoDocId, canEdit }: { memberId: string; photoDocId: string | null; canEdit: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const { pending, msg, run } = useRun();
  const pick = () => input.current?.click();
  return (
    <div className="w-[128px] shrink-0 md:w-[168px]">
      <div className="group relative aspect-square w-full overflow-hidden rounded-[12px] border border-line bg-surface-2">
        {photoDocId ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/files/${photoDocId}`} alt="Member photo" className="size-full object-cover" />
            {canEdit && (
              <button
                type="button"
                onClick={pick}
                disabled={pending}
                className="absolute inset-x-2 bottom-2 rounded-[8px] bg-black/60 px-2 py-1.5 text-[12px] font-semibold text-white backdrop-blur-sm transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
              >
                {pending ? "Uploading…" : "Change photo"}
              </button>
            )}
          </>
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-2 border-2 border-dashed border-line p-2 text-center">
            <svg viewBox="0 0 24 24" className="size-9 text-ink-3 md:size-11" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
              <circle cx="12" cy="8.5" r="4" />
              <path d="M4 20.5c.9-3.8 4.1-6 8-6s7.1 2.2 8 6" />
            </svg>
            {canEdit ? (
              <button type="button" onClick={pick} disabled={pending} className="btn btn-primary min-h-[36px] px-3 text-[13px]">
                {pending ? "Uploading…" : "Upload photo"}
              </button>
            ) : (
              <span className="text-[12px] text-ink-3">No photo</span>
            )}
          </div>
        )}
      </div>
      {canEdit && (
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            const blob = await downscale(f);
            const fd = new FormData();
            fd.set("file", blob === f ? f : new File([blob], `${f.name.replace(/\.\w+$/, "")}.jpg`, { type: "image/jpeg" }));
            run(() => uploadPhotoAction(memberId, fd));
          }}
        />
      )}
      <Msg msg={msg} />
    </div>
  );
}

export function MinistryEditor({
  memberId,
  links,
  ministries,
  roles,
  canEdit,
}: {
  memberId: string;
  links: { id: string; ministry: string; role: string }[];
  ministries: Option[];
  roles: Option[];
  canEdit: boolean;
}) {
  const { pending, msg, run } = useRun();
  const [ministry, setMinistry] = useState("");
  const [role, setRole] = useState(roles.find((r) => r.label === "Member")?.id ?? "");
  return (
    <div>
      {links.length === 0 ? (
        <p className="text-ink-2">Not linked to any ministry yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {links.map((l) => (
            <li key={l.id} className="flex min-h-[48px] items-center justify-between gap-3">
              <span>
                <span className="font-semibold">{l.ministry}</span> <span className="text-ink-2">· {l.role}</span>
              </span>
              {canEdit && (
                <button type="button" disabled={pending} className="min-h-[44px] px-2 text-[14px] text-error" onClick={() => run(() => removeMinistryAction(memberId, l.id))}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1">
            <label htmlFor="add-ministry" className="field-label">Ministry</label>
            <select id="add-ministry" className="input" value={ministry} onChange={(e) => setMinistry(e.target.value)}>
              <option value="">Choose…</option>
              {ministries.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
          <div className="min-w-40">
            <label htmlFor="add-role" className="field-label">Role</label>
            <select id="add-role" className="input" value={role} onChange={(e) => setRole(e.target.value)}>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </div>
          <button type="button" className="btn btn-primary" disabled={!ministry || !role || pending} onClick={() => run(() => addMinistryAction(memberId, ministry, role), () => setMinistry(""))}>
            Add
          </button>
        </div>
      )}
      <Msg msg={msg} />
    </div>
  );
}

export function DocumentUpload({ memberId }: { memberId: string }) {
  const { pending, msg, run } = useRun();
  const form = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={form}
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        run(() => uploadDocumentAction(memberId, fd), () => form.current?.reset());
      }}
    >
      <div>
        <label htmlFor="doc-kind" className="field-label">Type</label>
        <select id="doc-kind" name="kind" className="input" defaultValue="CONSENT_FORM">
          <option value="CONSENT_FORM">Consent form</option>
          <option value="TRANSFER_LETTER">Transfer letter</option>
          <option value="DEATH_CERTIFICATE">Death certificate</option>
          <option value="BOARD_MINUTE">Board minute</option>
          <option value="OTHER">Other</option>
        </select>
      </div>
      <div className="flex-1 min-w-56">
        <label htmlFor="doc-file" className="field-label">File (PDF or photo, up to 4 MB)</label>
        <input id="doc-file" name="file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" required className="input pt-2.5" />
      </div>
      <button className="btn btn-primary" disabled={pending}>{pending ? "Uploading…" : "Upload"}</button>
      <div className="w-full"><Msg msg={msg} /></div>
    </form>
  );
}

/** The "···" menu: send to clean-up, delete or restore. */
export function ProfileMenu({
  memberId,
  memberCode,
  deleted,
  canDelete,
  canRestore,
  canFlag,
  purgeFrom,
}: {
  memberId: string;
  memberCode: string;
  deleted: boolean;
  canDelete: boolean;
  canRestore: boolean;
  canFlag: boolean;
  /** Set for admins on deleted records: ISO date from which purge is allowed. */
  purgeFrom?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<null | "delete" | "flag" | "purge">(null);
  const [reason, setReason] = useState("");
  const { pending, msg, run } = useRun();
  const purgeReady = purgeFrom ? new Date(purgeFrom) <= new Date() : false;
  if (!canDelete && !canRestore && !canFlag && !purgeFrom) return null;
  return (
    <div className="relative">
      <button type="button" aria-label="More actions" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="btn btn-secondary px-3">
        ···
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-56 rounded-[8px] border border-line bg-surface p-1 shadow-lg">
          {deleted && canRestore && (
            <MenuItem onClick={() => (setOpen(false), run(() => restoreMemberProfileAction(memberId)))}>Restore member</MenuItem>
          )}
          {!deleted && canFlag && <MenuItem onClick={() => (setOpen(false), setDialog("flag"))}>Send to clean-up queue</MenuItem>}
          {!deleted && canDelete && <MenuItem danger onClick={() => (setOpen(false), setDialog("delete"))}>Delete member…</MenuItem>}
          {deleted && purgeFrom && (
            purgeReady ? (
              <MenuItem danger onClick={() => (setOpen(false), setDialog("purge"))}>Purge personal data…</MenuItem>
            ) : (
              <p className="px-3 py-2 text-[13px] text-ink-2">Can be purged from {new Date(purgeFrom).toLocaleDateString("en-GB")}</p>
            )
          )}
        </div>
      )}
      <Dialog
        open={dialog !== null}
        onClose={() => setDialog(null)}
        title={dialog === "delete" ? "Delete this member?" : dialog === "purge" ? "Purge personal data permanently?" : "Send to clean-up queue"}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setDialog(null)}>Cancel</button>
            <button
              type="button"
              className={dialog === "flag" ? "btn btn-primary" : "btn btn-danger"}
              disabled={pending || (dialog === "delete" && reason.trim().length < 3) || (dialog === "purge" && reason.trim().toUpperCase() !== memberCode)}
              onClick={() =>
                run(
                  () => (dialog === "delete" ? deleteMemberAction(memberId, reason) : dialog === "purge" ? purgeMemberAction(memberId, reason) : flagMemberAction(memberId, reason)),
                  () => setDialog(null),
                )
              }
            >
              {dialog === "delete" ? "Delete" : dialog === "purge" ? "Purge permanently" : "Send"}
            </button>
          </>
        }
      >
        {dialog === "delete" && <p className="mb-3 text-ink-2">The record moves to “Recently deleted” and can be restored. The member ID is never reused.</p>}
        {dialog === "purge" && (
          <p className="mb-3 text-ink-2">
            All personal data, documents and photos for this member are erased and cannot be recovered. The ID {memberCode} stays retired. Type the ID to confirm.
          </p>
        )}
        <label htmlFor="pm-reason" className="field-label">{dialog === "delete" ? "Reason" : dialog === "purge" ? "Member ID" : "What needs checking? (optional)"}</label>
        <input id="pm-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Dialog>
      <Msg msg={msg} />
    </div>
  );
}

function MenuItem({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={`block w-full rounded px-3 min-h-[44px] text-left text-[14px] hover:bg-surface-2 ${danger ? "text-error" : ""}`}>
      {children}
    </button>
  );
}

export function PrintButton() {
  return (
    <button type="button" className="btn btn-secondary" onClick={() => window.print()}>
      Print card
    </button>
  );
}

export function TabLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "page" : undefined}
      className={`flex min-h-[44px] items-center gap-1.5 whitespace-nowrap px-3.5 text-[14px] ${active ? "border-b-2 border-ink font-semibold" : "text-ink-2 hover:text-ink"}`}
    >
      {children}
    </Link>
  );
}
