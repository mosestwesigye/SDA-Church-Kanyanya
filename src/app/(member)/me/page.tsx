import type { Metadata } from "next";
import Link from "next/link";
import { CancelCorrection } from "@/components/selfservice/self-widgets";
import { StatusBadge } from "@/components/ui/badges";
import { formatDob } from "@/lib/dob";
import { formatDate, GENDER_LABELS, MARITAL_LABELS } from "@/lib/labels";
import { requireContext } from "@/server/auth/session";
import { db } from "@/server/db";
import { consentVersion, getOwnRecord, hasCurrentConsent, ownCorrectionRequests, type Change } from "@/server/selfservice/service";
import { acceptPrivacyAction } from "./actions";

export const metadata: Metadata = { title: "My record" };

const STATE_LABEL = { PENDING: "Waiting for the clerk", APPROVED: "Approved", REJECTED: "Not approved", CANCELLED: "Cancelled" } as const;

export default async function MePage({ searchParams }: { searchParams: Promise<{ sent?: string }> }) {
  const ctx = await requireContext();
  if (!ctx.memberId) {
    return (
      <div className="card p-6">
        <h1 className="text-[22px] font-semibold">No member record linked</h1>
        <p className="mt-2 text-ink-2">This login isn’t linked to a membership record. Please speak to the church clerk.</p>
      </div>
    );
  }
  if (!(await hasCurrentConsent(db, ctx.memberId))) return <PrivacyGate version={await consentVersion(db)} />;

  const [m, requests, { sent }] = await Promise.all([getOwnRecord(db, ctx), ownCorrectionRequests(db, ctx), searchParams]);
  const pending = requests.find((r) => r.state === "PENDING");
  const rows: [string, React.ReactNode][] = [
    ["Member ID", <span key="id" className="mono">{m.memberId}</span>],
    ["Name", `${m.firstName} ${m.lastName}`],
    ["Gender", m.gender ? GENDER_LABELS[m.gender as "MALE"] : null],
    ["Date of birth", formatDob(m.dobPrecision, m.dobDate, m.dobYear)],
    ["Year joined", m.yearJoined],
    ["Zone", m.zone?.label],
    ["Phone", m.phoneRaw],
    ["Email", m.email],
    ["Marital status", m.maritalStatus ? MARITAL_LABELS[m.maritalStatus as "SINGLE"] : null],
    ["Spouse", m.spouse ? `${m.spouse.firstName} ${m.spouse.lastName}` : m.spouseName],
    ["Next of kin", m.nextOfKinName ? `${m.nextOfKinName}${m.nextOfKinPhoneRaw ? ` · ${m.nextOfKinPhoneRaw}` : ""}` : null],
    ["Profession", m.profession?.label],
    ["Ministries", (m.ministries ?? []).map((l: { ministry: { label: string }; role: { label: string } }) => `${l.ministry.label} (${l.role.label})`).join(", ") || null],
  ];

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-semibold leading-tight">Hello, {m.firstName}</h1>
          <p className="mt-1 flex items-center gap-2 text-ink-2">Membership status: <StatusBadge status={m.status} /></p>
        </div>
        {!pending && <Link href="/me/correct" className="btn btn-primary">Ask for a correction</Link>}
      </div>
      {sent && <p role="status" className="mb-4 rounded-[6px] bg-primary-soft px-3 py-2 text-primary">Thank you. The clerk will review your request; you’ll see the result here.</p>}

      <section className="card mb-5" aria-labelledby="rec-h">
        <h2 id="rec-h" className="border-b border-line px-5 py-4 text-[17px] font-semibold">Your record</h2>
        <dl>
          {rows.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[140px_1fr] gap-3 border-b border-line px-5 py-2.5 last:border-0 sm:grid-cols-[180px_1fr]">
              <dt className="text-ink-2">{k}</dt>
              <dd>{v === null || v === undefined || v === "" ? <span className="text-ink-3">Not recorded</span> : v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="card p-5" aria-labelledby="req-h">
        <h2 id="req-h" className="text-[17px] font-semibold">Your correction requests</h2>
        {requests.length === 0 ? (
          <p className="mt-2 text-ink-2">None yet. If something above is wrong or missing, ask for a correction — the clerk checks every change before it’s saved.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line">
            {requests.map((r) => {
              const changes = r.changes as Record<string, Change>;
              return (
                <li key={r.id} className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">{STATE_LABEL[r.state]}</span>
                    <span className="text-[13px] text-ink-2">Sent {formatDate(r.createdAt)}</span>
                  </div>
                  <ul className="mt-1 text-[14px]">
                    {Object.values(changes).map((c) => (
                      <li key={c.label} className={r.state === "APPROVED" && c.applied === false ? "text-ink-3 line-through" : ""}>
                        {c.label}: <span className="text-ink-2">{c.from || "—"}</span> → <strong>{c.to || "—"}</strong>
                      </li>
                    ))}
                  </ul>
                  {r.reviewNote && <p className="mt-1 text-[14px] text-ink-2">Clerk’s note: {r.reviewNote}</p>}
                  {r.state === "PENDING" && <CancelCorrection id={r.id} />}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <p className="mt-6 text-[13px] text-ink-2">
        Your data is protected under Uganda’s Data Protection and Privacy Act, 2019. To withdraw consent or ask what we hold about you, speak to the church clerk.
      </p>
    </>
  );
}

function PrivacyGate({ version }: { version: string }) {
  return (
    <section className="card p-6">
      <h1 className="text-[24px] font-semibold">Before you continue</h1>
      <div className="mt-3 space-y-3 text-ink-2">
        <p>SDA Church Kanyanya keeps a membership record for each member: your name, contact details, date of birth, family and next of kin, zone, ministries and membership status.</p>
        <p>We use it only to care for members and run the church (membership, ministries, visitation and the Conference’s statistical returns). Only church officers whose role needs it can see it, and every change is logged.</p>
        <p>Under the Data Protection and Privacy Act, 2019 you may see your record, ask for corrections, and object to or withdraw consent for its use. Here you can view your record and request corrections; the clerk reviews every request.</p>
      </div>
      <form action={acceptPrivacyAction} className="mt-5 flex flex-wrap items-center gap-3">
        <button className="btn btn-primary">I agree — show my record</button>
        <span className="text-[13px] text-ink-3">Privacy notice version {version}</span>
      </form>
    </section>
  );
}
