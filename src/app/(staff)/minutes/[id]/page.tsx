import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AddFiles, DeleteMinutes, RemoveFile } from "@/components/minutes/minutes-widgets";
import { MinutesStatus } from "@/components/minutes/minutes-status";
import { PrintButton } from "@/components/reports/report-actions";
import { TopBar } from "@/components/shell/topbar";
import { clock, eat, fileKind, fileSize, meetingDay } from "@/lib/minutes-format";
import { requirePermission } from "@/server/auth/session";
import { can } from "@/server/authz/policy";
import { db } from "@/server/db";
import { NotFoundError } from "@/server/errors";
import { getMinutes, MEETING_TYPES } from "@/server/minutes/service";

export const metadata: Metadata = { title: "Minutes" };

const ACTION_LABEL: Record<string, string> = { CREATE: "Recorded", UPDATE: "Edited", APPROVE: "Approved", DELETE: "Removed", EXPORT: "Opened" };

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">{label}</dt>
      <dd className="mt-0.5 text-[15px]">{children ?? <span className="text-ink-3">Not recorded</span>}</dd>
    </div>
  );
}

export default async function MinutesDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePermission("minutes", "read");
  const { id } = await params;
  const m = await getMinutes(db, ctx, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const canManage = can(ctx, "minutes", "manage");
  const type = MEETING_TYPES[m.type];
  const decisions = (m.summary ?? "").split("\n").map((l) => l.trim()).filter(Boolean);

  return (
    <>
      <div className="print:hidden"><TopBar /></div>
      <main className="mx-auto max-w-4xl p-4 md:p-7 print:max-w-none print:p-0">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <Link href="/minutes" className="inline-flex min-h-[44px] items-center text-[14px] text-ink-2 hover:text-ink">← Board minutes</Link>
          <div className="flex flex-wrap gap-2">
            <PrintButton />
            {canManage && <Link href={`/minutes/${m.id}/edit`} className="btn btn-secondary">Edit details</Link>}
            {canManage && <DeleteMinutes id={m.id} reference={m.reference} />}
          </div>
        </div>

        {/* The record */}
        <article className="card overflow-hidden print:border-0 print:shadow-none">
          <header className="border-b border-line px-6 py-6 md:px-9 md:py-8">
            <div className="flex items-start justify-between gap-6">
              <div className="flex items-center gap-3.5">
                <span className="grid size-12 shrink-0 place-items-center rounded-[10px] bg-sidebar print:bg-white print:ring-1 print:ring-line">
                  <Image src="/sda-mark.png" alt="" width={26} height={29} className="print:invert" />
                </span>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">Seventh-day Adventist Church</p>
                  <p className="text-[17px] font-semibold">Kanyanya · Church Clerk’s Office</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3">Reference</p>
                <p className="mono text-[18px] font-semibold text-primary">{m.reference}</p>
              </div>
            </div>
            <div className="mt-7">
              <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-primary">Minutes of the {type.label.toLowerCase()}</p>
              <h1 className="mt-1 text-[26px] font-semibold leading-tight md:text-[30px]">{m.title}</h1>
              <p className="mt-1.5 text-[16px] text-ink-2">
                {meetingDay(m.heldOn)}
                {m.startTime && <> · {clock(m.startTime)} EAT</>}
              </p>
              <div className="mt-3"><MinutesStatus status={m.status} approvedOn={m.approvedOn} /></div>
            </div>
          </header>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-5 border-b border-line px-6 py-6 md:grid-cols-4 md:px-9">
            <Detail label="Venue">{m.venue}</Detail>
            <Detail label="Chairperson">{m.chairperson}</Detail>
            <Detail label="Recording secretary">{m.secretary}</Detail>
            <Detail label="Members present">{m.attendance}</Detail>
          </dl>

          <section className="border-b border-line px-6 py-6 md:px-9">
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-ink-3">Key decisions</h2>
            {decisions.length ? (
              <ol className="mt-3 space-y-2 text-[15px] leading-relaxed">
                {decisions.map((d, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="mono w-6 shrink-0 text-right text-ink-3">{d.match(/^\d+[.)]/) ? "" : `${i + 1}.`}</span>
                    <span>{d}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-2 text-[14px] text-ink-3">No summary entered. See the minutes file below.</p>
            )}
          </section>

          <section className="border-b border-line px-6 py-6 md:px-9">
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-ink-3">Minutes file{m.files.length === 1 ? "" : "s"}</h2>
            {m.files.length === 0 ? (
              <p className="mt-2 rounded-[8px] bg-[color-mix(in_srgb,var(--status-irregular)_12%,transparent)] px-3.5 py-3 text-[14px]">No file uploaded yet.{canManage && " Add the typed or scanned minutes below."}</p>
            ) : (
              <ul className="mt-3 divide-y divide-line rounded-[10px] border border-line">
                {m.files.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                    <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-[8px] bg-primary-soft text-[11px] font-bold text-primary">{fileKind(f.mimeType)}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{f.fileName}</p>
                      <p className="text-[13px] text-ink-2">
                        {fileSize(f.sizeBytes)} · Uploaded {eat(f.uploadedAt)} by {f.uploadedByName}
                      </p>
                      <p className="mono text-[11px] text-ink-3" title="SHA-256 fingerprint of the file as uploaded">SHA-256 {f.sha256.slice(0, 16)}…</p>
                    </div>
                    <div className="flex items-center gap-2 print:hidden">
                      {f.mimeType !== "application/vnd.openxmlformats-officedocument.wordprocessingml.document" && (
                        <a href={`/api/minutes/files/${f.id}`} target="_blank" rel="noopener" className="btn btn-secondary">View</a>
                      )}
                      <a href={`/api/minutes/files/${f.id}?download=1`} className="btn btn-secondary">Download</a>
                      {canManage && <RemoveFile minutesId={m.id} fileId={f.id} name={f.fileName} />}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {canManage && (
              <div className="mt-4 print:hidden">
                <AddFiles minutesId={m.id} />
              </div>
            )}
          </section>

          <footer className="grid gap-4 bg-surface-2/60 px-6 py-5 text-[13px] text-ink-2 md:grid-cols-3 md:px-9">
            <p><span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">Recorded</span>{eat(m.createdAt)} by {m.createdByName}</p>
            <p><span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">Last updated</span>{eat(m.updatedAt)}</p>
            <p>
              <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">Approval</span>
              {m.status === "APPROVED" && m.approvedOn ? `Confirmed ${meetingDay(m.approvedOn)}` : "To be read and confirmed at the next meeting"}
            </p>
          </footer>
        </article>

        {/* History */}
        <section className="card mt-5 p-5 md:p-6 print:hidden">
          <h2 className="text-[17px] font-semibold">History</h2>
          <p className="mt-1 text-[14px] text-ink-2">Every change, upload and download of these minutes.</p>
          <ol className="mt-4 space-y-3">
            {m.history.map((h) => (
              <li key={h.id} className="flex gap-3 text-[14px]">
                <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${h.action === "DELETE" ? "bg-error" : h.action === "APPROVE" ? "bg-ok" : h.action === "EXPORT" ? "bg-line" : "bg-primary"}`} />
                <span className="flex-1">
                  <span className="font-medium">{ACTION_LABEL[h.action] ?? h.action}</span>
                  {h.note && <span className="text-ink-2"> — {h.note}</span>}
                  <span className="block text-[12px] text-ink-3">{eat(h.at)} · {h.actor}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>
      </main>
    </>
  );
}
