import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CompletenessBar, RestrictedTag, StatusBadge } from "@/components/ui/badges";
import { DocumentUpload, MinistryEditor, PhotoBox, PrintButton, ProfileMenu, TabLink } from "@/components/members/profile-widgets";
import { TopBar } from "@/components/shell/topbar";
import { REQUIRED_FIELD_LABELS, type RequiredField } from "@/lib/completeness";
import { formatDob } from "@/lib/dob";
import { formatDate, formatDateTime, fullName, GENDER_LABELS, MARITAL_LABELS, type StatusKey } from "@/lib/labels";
import { requirePermission } from "@/server/auth/session";
import { can } from "@/server/authz/policy";
import { db } from "@/server/db";
import { getMemberProfile, type MemberProfile, type ProfileTab } from "@/server/members/profile";
import { retentionDays } from "@/server/workflows/status";
import { RELATION_LABELS, householdsOfMember } from "@/server/households/service";

export const metadata: Metadata = { title: "Member" };

// Projected member: fields present depend on the caller's permissions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type M = { id: string; memberId: string; lastName: string; firstName: string; restricted: string[] } & Record<string, any>;

const TABS: { key: ProfileTab; label: string }[] = [
  { key: "personal", label: "Personal" },
  { key: "family", label: "Family & Next of Kin" },
  { key: "ministry", label: "Ministry & Service" },
  { key: "history", label: "Membership History" },
  { key: "documents", label: "Documents" },
  { key: "audit", label: "Audit Log" },
];
const FAMILY_FIELDS: RequiredField[] = ["maritalStatus", "spouse", "nextOfKinName", "nextOfKinPhone"];

export default async function MemberPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; page?: string }> }) {
  const ctx = await requirePermission("member", "read");
  const { id } = await params;
  const sp = await searchParams;
  const data = await getMemberProfile(db, ctx, id, { auditPage: Number(sp.page) || 1 });
  if (!data) notFound();
  const { member, caps } = data;
  const m = member as unknown as M;
  const tabs = TABS.filter((t) => (t.key === "documents" ? caps.docs : t.key === "audit" ? caps.audit : true));
  const tab = (tabs.find((t) => t.key === sp.tab)?.key ?? "personal") as ProfileTab;
  const missing = (m.missingFields ?? []) as RequiredField[];
  const familyMissing = caps.sensitive ? missing.filter((f) => FAMILY_FIELDS.includes(f)).length : 0;

  const lists = caps.manageMinistry
    ? await db.listItem.findMany({ where: { type: { in: ["MINISTRY", "MINISTRY_ROLE"] }, active: true, mergedIntoId: null }, orderBy: { sortOrder: "asc" }, select: { id: true, label: true, type: true } })
    : [];
  const dob = caps.profile ? formatDob(m.dobPrecision, m.dobDate, m.dobYear) : null;
  const links: { id: string; ministry: string; role: string }[] = (m.ministries ?? []).map((l: { id: string; ministry: { label: string }; role: { label: string } }) => ({
    id: l.id,
    ministry: l.ministry?.label,
    role: l.role?.label,
  }));
  const phone = caps.contact ? (m.phoneRaw as string | null) : null;

  return (
    <>
      <TopBar showAdd={false} />
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface px-4 py-3 md:px-7 text-[14px] print:hidden">
        <nav aria-label="Breadcrumb" className="text-ink-2">
          <Link href="/members" className="hover:underline">Members</Link> <span aria-hidden>/</span> <span className="text-ink">{fullName(m)}</span>
        </nav>
        {caps.edit && !m.deletedAt && (
          <Link href={`/members/${m.id}/edit`} className="md:hidden min-h-[44px] inline-flex items-center font-semibold text-primary">
            Edit
          </Link>
        )}
        {data.lastChange && (
          <span className="hidden md:inline text-ink-2">
            Last updated {formatDate(data.lastChange.at)} by {data.lastChange.actorLabel}
          </span>
        )}
      </div>

      <main className="p-4 md:p-7">
        {m.deletedAt && (
          <p role="status" className="mb-4 rounded-[8px] bg-error-soft px-4 py-3 text-error">
            This member was deleted on {formatDate(m.deletedAt)}. Restore the record to edit it.
          </p>
        )}
        {data.mergedInto && (
          <p role="status" className="mb-4 rounded-[8px] bg-primary-soft px-4 py-3 text-primary">
            This record was merged into <Link className="underline" href={`/members/${data.mergedInto.id}`}>{data.mergedInto.memberId}</Link>. Its ID is retired.
          </p>
        )}
        {data.openFlags.length > 0 && (
          <p className="mb-4 rounded-[8px] border border-line bg-surface px-4 py-3 text-[14px]">
            <span className="font-semibold">In the clean-up queue:</span> {data.openFlags.map((f) => f.reason).join("; ")}
          </p>
        )}

        {/* Header */}
        <header className="flex flex-wrap items-start gap-4 md:gap-5">
          <PhotoBox memberId={m.id} photoDocId={data.photoDocId} canEdit={caps.editProfile && !m.deletedAt} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-[24px] md:text-[30px] font-semibold leading-tight">{fullName(m)}</h1>
              {caps.profile && <StatusBadge status={m.status as StatusKey | null} size="md" />}
            </div>
            <p className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-[15px] text-ink-2">
              <span className="mono text-ink">{m.memberId}</span>
              {caps.profile && m.gender && <span>{GENDER_LABELS[m.gender as "MALE" | "FEMALE"]}</span>}
              {dob && <span>Born {dob.replace(/^(\d{4}) \(year only\)$/, "$1 (year only)")}</span>}
              {caps.profile && m.yearJoined && <span>Member since {m.yearJoined}</span>}
              {caps.profile && m.zone && <span>{m.zone.label} zone</span>}
            </p>
          </div>
          <div className="flex w-full flex-wrap gap-2 md:w-auto print:hidden">
            {phone && (
              <a href={`tel:${m.phoneE164 ?? phone}`} className="btn btn-primary flex-1 md:hidden">
                Call {phone}
              </a>
            )}
            {caps.statusRequest && !m.deletedAt && (
              <Link href={`/transfers/new?member=${m.id}`} className="btn btn-secondary flex-1 md:flex-none">
                Change status
              </Link>
            )}
            <span className="hidden md:inline-flex"><PrintButton /></span>
            {caps.edit && !m.deletedAt && (
              <Link href={`/members/${m.id}/edit`} className="btn btn-primary hidden md:inline-flex">
                Edit record
              </Link>
            )}
            <ProfileMenu
              memberId={m.id}
              memberCode={m.memberId}
              deleted={Boolean(m.deletedAt)}
              canDelete={caps.del}
              canRestore={caps.restore}
              canFlag={can(ctx, "cleanup", "use")}
              purgeFrom={m.deletedAt && can(ctx, "member", "purge") ? new Date(new Date(m.deletedAt).getTime() + (await retentionDays(db)) * 86400_000).toISOString() : null}
            />
          </div>
        </header>

        {/* Mobile completeness card (design 1f) */}
        {caps.profile && (
          <div className="md:hidden mt-4">
            <CompletenessCard percent={m.completeness} missing={missing} memberId={m.id} canEdit={caps.edit && !m.deletedAt} compact />
          </div>
        )}

        <nav aria-label="Record sections" className="mt-5 -mx-4 flex overflow-x-auto border-b border-line px-4 md:mx-0 md:px-0 print:hidden">
          {tabs.map((t) => (
            <TabLink key={t.key} href={`/members/${m.id}${t.key === "personal" ? "" : `?tab=${t.key}`}`} active={tab === t.key}>
              {t.label}
              {t.key === "family" && familyMissing > 0 && <span className="text-[12px] font-semibold text-error">{familyMissing} missing</span>}
            </TabLink>
          ))}
        </nav>

        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 space-y-4">
            {tab === "personal" && <PersonalTab m={m} caps={caps} dob={dob} phone={phone} />}
            {tab === "family" && <FamilyTab m={m} caps={caps} />}
            {tab === "family" && caps.sensitive && <HouseholdSection households={await householdsOfMember(db, ctx, m.id)} memberId={m.id} canEdit={can(ctx, "household", "update")} />}
            {tab === "ministry" && (
              <>
                <Section title="Ministries and roles">
                  <div className="p-5">
                    <MinistryEditor
                      memberId={m.id}
                      links={links}
                      ministries={lists.filter((l) => l.type === "MINISTRY")}
                      roles={lists.filter((l) => l.type === "MINISTRY_ROLE")}
                      canEdit={caps.manageMinistry && !m.deletedAt}
                    />
                  </div>
                </Section>
                <Section title="Service">
                  <Grid>
                    <Field label="Profession" restricted={!caps.profile} value={m.profession?.label} missing={missing.includes("profession")} />
                    <Field label="Year joined church" restricted={!caps.profile} value={m.yearJoined} missing={missing.includes("yearJoined")} />
                  </Grid>
                </Section>
              </>
            )}
            {tab === "history" && <HistoryTab data={data} m={m} />}
            {tab === "documents" && caps.docs && (
              <Section title="Documents">
                <div className="p-5 space-y-5">
                  {data.documents.length === 0 ? (
                    <p className="text-ink-2">No documents yet. Upload the signed consent form, transfer letters or other records.</p>
                  ) : (
                    <ul className="divide-y divide-line">
                      {data.documents.map((d) => (
                        <li key={d.id} className="flex min-h-[52px] flex-wrap items-center justify-between gap-2">
                          <span>
                            <span className="font-semibold">{d.fileName}</span>
                            <span className="block text-[13px] text-ink-2">
                              {d.kind.replace(/_/g, " ").toLowerCase()} · {(d.sizeBytes / 1024).toFixed(0)} KB · {formatDate(d.createdAt)}
                            </span>
                          </span>
                          <a className="btn btn-secondary" href={`/api/files/${d.id}`} target="_blank" rel="noreferrer">
                            Open
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                  {caps.uploadDocs && !m.deletedAt && <DocumentUpload memberId={m.id} />}
                </div>
              </Section>
            )}
            {tab === "audit" && caps.audit && <AuditTab data={data} memberId={m.id} />}
          </div>

          <aside className="space-y-4">
            {caps.profile && (
              <div className="hidden md:block">
                <CompletenessCard percent={m.completeness} missing={missing} memberId={m.id} canEdit={caps.edit && !m.deletedAt} />
              </div>
            )}
            {tab !== "history" && (
              <Section title="Membership history">
                <div className="p-5"><Timeline data={data} m={m} limit={3} /></div>
              </Section>
            )}
            {caps.audit && tab !== "audit" && (
              <Section title="Audit log" action={<Link href={`/members/${m.id}?tab=audit`} className="text-[14px] font-semibold text-primary">View all {data.auditTotal}</Link>}>
                <ul className="divide-y divide-line px-5">
                  {data.audit.slice(0, 3).map((a) => (
                    <li key={a.id} className="py-3 text-[14px]">
                      <AuditLine a={a} />
                    </li>
                  ))}
                  {data.audit.length === 0 && <li className="py-3 text-ink-2">No changes recorded yet.</li>}
                </ul>
              </Section>
            )}
            <p className="text-[13px] text-ink-2 px-1">
              {data.consent
                ? `Data consent recorded ${formatDate(data.consent.consentedAt)} under the Data Protection and Privacy Act, 2019 (version ${data.consent.version}).`
                : "No data-protection consent recorded yet. Upload the signed consent form under Documents."}
            </p>
          </aside>
        </div>
      </main>
    </>
  );
}

/* ───────────────────────── Parts ───────────────────────── */

function Section({ title, note, action, children }: { title: string; note?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-4">
        <h2 className="text-[17px] font-semibold">{title}</h2>
        {note && <span className="text-[13px] text-ink-2">{note}</span>}
        {action}
      </div>
      {children}
    </section>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <dl className="grid gap-x-6 gap-y-4 p-5 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">{children}</dl>;
}

function Field({ label, value, restricted, missing, restrictedTag, optional }: { label: string; value?: React.ReactNode; restricted?: boolean; missing?: boolean; restrictedTag?: boolean; optional?: boolean }) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line pb-3 sm:block sm:border-0 sm:pb-0">
      <dt className="text-[13px] text-ink-2">
        {label}
        {optional && " (optional)"}
        {restrictedTag && <RestrictedTag />}
      </dt>
      <dd className="mt-0.5 text-[16px] text-right sm:text-left">
        {restricted ? (
          <span className="text-ink-3">Restricted</span>
        ) : empty ? (
          missing ? (
            <span className="font-semibold text-error"><span aria-hidden>◆ </span>Missing</span>
          ) : (
            <span className="text-ink-3">{optional ? "None recorded" : "—"}</span>
          )
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

function PersonalTab({ m, caps, dob, phone }: { m: M; caps: MemberProfile["caps"]; dob: string | null; phone: string | null }) {
  const missing = (m.missingFields ?? []) as string[];
  return (
    <>
      <Section title="Identification" note="Member ID is permanent">
        <Grid>
          <Field label="Member ID" value={<span className="mono">{m.memberId}</span>} />
          <Field label="Last name" value={m.lastName} missing />
          <Field label="First name" value={m.firstName} missing />
          <Field label="Gender" restricted={!caps.profile} value={m.gender ? GENDER_LABELS[m.gender as "MALE" | "FEMALE"] : null} missing={missing.includes("gender")} />
          <Field label="Date of birth" restricted={!caps.profile} value={dob} missing={missing.includes("dob")} />
          <Field label="Year joined church" restricted={!caps.profile} value={m.yearJoined} missing={missing.includes("yearJoined")} />
        </Grid>
      </Section>
      <Section title="Contact">
        <Grid>
          <Field label="Physical address / zone" restricted={!caps.profile} value={m.zone?.label} missing={missing.includes("zone")} />
          <Field
            label="Phone"
            restricted={!caps.contact}
            value={phone ? (m.phoneE164 ? phone : <span>{phone} <span className="text-[12px] text-error">(not a valid number)</span></span>) : null}
            missing={missing.includes("phone")}
          />
          <Field label="Email" optional restricted={!caps.contact} value={m.email} />
        </Grid>
      </Section>
      <Section title="Status" note="Restricted fields visible to Clerk, Pastor, Elders">
        <Grid>
          <Field label="Membership status" restricted={!caps.profile} value={m.status ? <StatusBadge status={m.status} /> : null} missing={missing.includes("status")} />
          <Field label="Marital status" restrictedTag restricted={!caps.sensitive} value={m.maritalStatus ? MARITAL_LABELS[m.maritalStatus as keyof typeof MARITAL_LABELS] : null} missing={missing.includes("maritalStatus")} />
          <Field label="Spouse" restrictedTag restricted={!caps.sensitive} value={<SpouseValue m={m} />} missing={missing.includes("spouse")} />
          <Field label="Next of kin" restrictedTag restricted={!caps.sensitive} value={m.nextOfKinName} missing={missing.includes("nextOfKinName")} />
          <Field label="Profession" restricted={!caps.profile} value={m.profession?.label} missing={missing.includes("profession")} />
          <Field label="Discipline record" restrictedTag restricted={!caps.sensitive} value={m.status === "UNDER_DISCIPLINE" ? "Under discipline (see history)" : "None"} />
        </Grid>
      </Section>
    </>
  );
}

function SpouseValue({ m }: { m: M }) {
  if (m.spouse) {
    return (
      <Link href={`/members/${m.spouse.id}`} className="text-primary hover:underline">
        {m.spouse.lastName}, {m.spouse.firstName} · <span className="mono">{m.spouse.memberId.replace("SDAK/", "")}</span>
      </Link>
    );
  }
  return m.spouseName ? <>{m.spouseName} <span className="text-[12px] text-ink-3">(not linked to a member)</span></> : null;
}

function FamilyTab({ m, caps }: { m: M; caps: MemberProfile["caps"] }) {
  const missing = (m.missingFields ?? []) as string[];
  if (!caps.sensitive) {
    return (
      <Section title="Family & Next of Kin">
        <p className="p-5 text-ink-2">Marital status, spouse and next of kin are restricted to the Clerk, Assistant Clerk, Pastor and Elders.</p>
      </Section>
    );
  }
  return (
    <>
      <Section title="Family">
        <Grid>
          <Field label="Marital status" value={m.maritalStatus ? MARITAL_LABELS[m.maritalStatus as keyof typeof MARITAL_LABELS] : null} missing={missing.includes("maritalStatus")} />
          <Field label="Spouse" value={<SpouseValue m={m} />} missing={missing.includes("spouse")} />
        </Grid>
      </Section>
      <Section title="Next of kin">
        <Grid>
          <Field label="Name" value={m.nextOfKinName} missing={missing.includes("nextOfKinName")} />
          <Field label="Phone" value={m.nextOfKinPhoneRaw} missing={missing.includes("nextOfKinPhone")} />
        </Grid>
      </Section>
    </>
  );
}

function HouseholdSection({ households, memberId, canEdit }: { households: Awaited<ReturnType<typeof householdsOfMember>>; memberId: string; canEdit: boolean }) {
  return (
    <Section title="Household" action={canEdit && households.length === 0 ? <Link href="/families" className="text-[14px] font-semibold text-primary">Add to a household</Link> : undefined}>
      {households.length === 0 ? (
        <p className="p-5 text-ink-2">Not part of a household yet.</p>
      ) : (
        households.map((hm) => (
          <div key={hm.householdId} className="p-5">
            <Link href={`/families/${hm.householdId}`} className="font-semibold text-primary hover:underline">{hm.household.name}</Link>
            <span className="text-ink-2"> · {RELATION_LABELS[hm.relation]}</span>
            <ul className="mt-2 space-y-1 text-[15px]">
              {hm.household.members.filter((x) => x.memberId !== memberId).map((x) => (
                <li key={x.memberId}>
                  <Link className="hover:underline" href={`/members/${x.member.id}?tab=family`}>{x.member.firstName} {x.member.lastName}</Link>
                  <span className="text-ink-2"> · {RELATION_LABELS[x.relation]}</span>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </Section>
  );
}

function CompletenessCard({ percent, missing, memberId, canEdit, compact }: { percent: number; missing: RequiredField[]; memberId: string; canEdit: boolean; compact?: boolean }) {
  return (
    <section className={`card p-5 ${compact && missing.length ? "border-error/50" : ""}`}>
      <div className="flex items-baseline justify-between">
        <h2 className="text-[17px] font-semibold">{compact ? `Profile ${percent}% complete` : "Profile completeness"}</h2>
        {compact ? (
          missing.length > 0 && <span className="text-[14px] font-semibold text-error">{missing.length} missing</span>
        ) : (
          <span className="text-[22px] font-semibold text-primary">{percent}%</span>
        )}
      </div>
      <CompletenessBar value={percent} showLabel={false} className="mt-3" />
      {missing.length > 0 ? (
        <>
          {!compact && <p className="mt-3 text-[14px] text-ink-2">{missing.length} required field{missing.length === 1 ? "" : "s"} missing</p>}
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {missing.map((f) => (
              <li key={f} className="rounded-[5px] border border-error/40 bg-error-soft px-2 py-1 text-[13px] text-error">
                {REQUIRED_FIELD_LABELS[f] ?? f}
              </li>
            ))}
          </ul>
          {canEdit && !compact && (
            <Link href={`/members/${memberId}/edit?focus=missing`} className="btn btn-primary mt-4 w-full">
              Complete missing fields
            </Link>
          )}
        </>
      ) : (
        <p className="mt-3 text-[14px] text-ok">All required fields are filled in.</p>
      )}
    </section>
  );
}

function Timeline({ data, m, limit }: { data: MemberProfile; m: M; limit?: number }) {
  const items = [
    ...data.events.map((e) => ({
      key: e.id,
      title: e.title,
      when: e.occurredOn ? formatDate(e.occurredOn) : e.occurredYear ? String(e.occurredYear) : formatDate(e.createdAt),
      detail: e.detail,
    })),
    ...(m.yearJoined && !data.events.some((e) => e.type === "JOINED") ? [{ key: "joined", title: "Joined SDA Church Kanyanya", when: String(m.yearJoined), detail: "From the register" }] : []),
  ];
  const shown = limit ? items.slice(0, limit) : items;
  if (shown.length === 0) return <p className="text-ink-2">No history recorded yet.</p>;
  return (
    <ol className="relative space-y-4 border-l-2 border-primary-soft pl-5">
      {shown.map((i) => (
        <li key={i.key} className="relative">
          <span aria-hidden className="absolute -left-[27px] top-1 size-3 rounded-full border-2 border-primary bg-surface" />
          <p className="font-semibold">{i.title}</p>
          <p className="text-[14px] text-ink-2">
            {i.when}
            {i.detail ? ` · ${i.detail}` : ""}
          </p>
        </li>
      ))}
    </ol>
  );
}

function HistoryTab({ data, m }: { data: MemberProfile; m: M }) {
  return (
    <Section title="Membership history" note="Status changes are added here when they are approved">
      <div className="p-5"><Timeline data={data} m={m} /></div>
    </Section>
  );
}

const FIELD_LABEL: Record<string, string> = {
  phoneE164: "Phone", phoneRaw: "Phone (as typed)", zoneId: "Zone", professionId: "Profession", dobDate: "Date of birth",
  dobYear: "Year of birth", dobPrecision: "Date of birth type", nextOfKinName: "Next of kin", nextOfKinPhoneE164: "Next of kin phone",
  nextOfKinPhoneRaw: "Next of kin phone (as typed)", maritalStatus: "Marital status", spouseName: "Spouse", spouseMemberId: "Spouse link",
  lastName: "Last name", firstName: "First name", yearJoined: "Year joined", photoKey: "Photo", ministry: "Ministry", deletedAt: "Deleted",
};

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "object") return "record";
  return String(v);
}

function AuditLine({ a }: { a: MemberProfile["audit"][number] }) {
  const verb = a.action === "CREATE" && a.entity === "Member" ? "created the record" : a.action === "DELETE" && a.entity === "Member" ? "deleted the record" : a.action === "RESTORE" ? "restored the record" : `changed ${FIELD_LABEL[a.field ?? ""] ?? a.field ?? a.entity}`;
  const ids = a.field === "spouseMemberId";
  return (
    <>
      <p>
        <span className="font-semibold">{a.actorLabel}</span> {verb}
      </p>
      {a.field && !ids && (
        <p className="mono text-[12px] text-ink-2 break-all">
          {a.oldValue !== null && a.oldValue !== undefined ? `${show(a.oldValue)} → ` : "+ "}
          {show(a.newValue)}
        </p>
      )}
      {a.note && <p className="mono text-[12px] text-ink-2">{a.note}</p>}
      <p className="text-[12px] text-ink-3">
        {formatDateTime(a.at)} · {a.source.toLowerCase().replace("_", "-")}
      </p>
    </>
  );
}

function AuditTab({ data, memberId }: { data: MemberProfile; memberId: string }) {
  const pages = Math.max(1, Math.ceil(data.auditTotal / 50));
  return (
    <Section title="Audit log" note={`${data.auditTotal} entries · append-only`}>
      {data.audit.length === 0 ? (
        <p className="p-5 text-ink-2">No changes recorded yet.</p>
      ) : (
        <ul className="divide-y divide-line px-5">
          {data.audit.map((a) => (
            <li key={a.id} className="py-3 text-[14px]">
              <AuditLine a={a} />
            </li>
          ))}
        </ul>
      )}
      {pages > 1 && (
        <div className="flex items-center justify-between border-t border-line px-5 py-3 text-[14px]">
          <span>Page {data.auditPage} of {pages}</span>
          <span className="flex gap-2">
            {data.auditPage > 1 && <Link className="btn btn-secondary" href={`/members/${memberId}?tab=audit&page=${data.auditPage - 1}`}>Newer</Link>}
            {data.auditPage < pages && <Link className="btn btn-secondary" href={`/members/${memberId}?tab=audit&page=${data.auditPage + 1}`}>Older</Link>}
          </span>
        </div>
      )}
    </Section>
  );
}
