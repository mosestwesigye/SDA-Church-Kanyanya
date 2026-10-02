import type { Metadata } from "next";
import Link from "next/link";
import { DuplicateCompare, type CompareRecord } from "@/components/cleanup/duplicate-compare";
import { QuickEditQueue, type QuickRow } from "@/components/cleanup/quick-edit";
import { PhoneFixRow, ResolveFlagButton, TargetForm, UndoMergeButton } from "@/components/cleanup/small-lists";
import { ValueGroup, type GroupView } from "@/components/cleanup/value-groups";
import { TopBar } from "@/components/shell/topbar";
import { REQUIRED_FIELD_LABELS } from "@/lib/completeness";
import { formatDob } from "@/lib/dob";
import { formatDate, GENDER_LABELS, MARITAL_LABELS, STATUS_META, type StatusKey } from "@/lib/labels";
import { requirePermission } from "@/server/auth/session";
import { can } from "@/server/authz/policy";
import { db } from "@/server/db";
import { cleanupProgress, duplicatePairs, flaggedQueue, incompleteQueue, invalidPhoneQueue, LIST_FIELDS, nonStandardGroups, type NonStandardGroup } from "@/server/cleanup/queues";

export const metadata: Metadata = { title: "Data clean-up" };

type Tab = "incomplete" | "duplicates" | "values" | "phones" | "flagged" | "merges";

const RAW_FIELD_LABEL: Record<string, string> = {
  GENDER: "Gender", DOB: "Date of birth", YEAR_JOINED: "Year joined", ZONE: "Zone", PHONE: "Phone", EMAIL: "Email", STATUS: "Status",
  MARITAL: "Marital", SPOUSE: "Spouse", NEXT_OF_KIN: "Next of kin", PROFESSION: "Profession", MINISTRY: "Ministry", MINISTRY_ROLE: "Ministry role",
};

async function compareRecord(id: string): Promise<CompareRecord> {
  const m = await db.member.findUniqueOrThrow({
    where: { id },
    include: { zone: true, profession: true, spouse: { select: { memberId: true, lastName: true, firstName: true } }, ministries: { include: { ministry: true, role: true } } },
  });
  return {
    id: m.id,
    memberId: m.memberId,
    values: {
      lastName: m.lastName || null,
      firstName: m.firstName || null,
      gender: m.gender ? GENDER_LABELS[m.gender] : null,
      dob: formatDob(m.dobPrecision, m.dobDate, m.dobYear),
      yearJoined: m.yearJoined ? String(m.yearJoined) : null,
      photo: m.photoKey ? "Has photo" : null,
      zone: m.zone?.label ?? null,
      phone: m.phoneRaw,
      email: m.email,
      status: m.status ? STATUS_META[m.status as StatusKey].label : null,
      maritalStatus: m.maritalStatus ? MARITAL_LABELS[m.maritalStatus] : null,
      spouse: m.spouse ? `${m.spouse.lastName}, ${m.spouse.firstName}` : m.spouseName,
      nextOfKin: [m.nextOfKinName, m.nextOfKinPhoneRaw].filter(Boolean).join(" · ") || null,
      profession: m.profession?.label ?? null,
      ministries: m.ministries.map((l) => `${l.ministry.label} · ${l.role.label}`).join(", ") || null,
    },
  };
}

function groupView(g: NonStandardGroup, i: number): GroupView {
  return { ...g, key: `${g.field}-${i}`, fieldLabel: RAW_FIELD_LABEL[g.field] ?? g.field, listField: Boolean(LIST_FIELDS[g.field]) };
}

export default async function CleanupPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePermission("cleanup", "use");
  const sp = await searchParams;
  const tab = (["incomplete", "duplicates", "values", "phones", "flagged", "merges"].includes(sp.tab ?? "") ? sp.tab : "incomplete") as Tab;
  const take = Math.min(Number(sp.take) || 25, 200);
  const pairIndex = Math.max(0, (Number(sp.pair) || 1) - 1);

  const [progress, incomplete, pairs, groups, phones, flags, lists, merges] = await Promise.all([
    cleanupProgress(db),
    incompleteQueue(db, ctx, { missing: sp.missing, status: sp.status, sort: sp.sort === "most" ? "most" : "fewest", take }),
    duplicatePairs(db, ctx),
    nonStandardGroups(db, ctx),
    invalidPhoneQueue(db, ctx, 100),
    flaggedQueue(db, ctx),
    db.listItem.findMany({ where: { active: true, mergedIntoId: null }, orderBy: [{ sortOrder: "asc" }, { label: "asc" }], select: { id: true, label: true, type: true } }),
    db.merge.findMany({ orderBy: { mergedAt: "desc" }, take: 30 }),
  ]);
  const opts = (t: string) => lists.filter((l) => l.type === t).map(({ id, label }) => ({ id, label }));
  const zones = opts("ZONE");
  const ministries = opts("MINISTRY");
  const canMerge = can(ctx, "member", "merge");
  const valueCount = groups.reduce((n, g) => n + g.total, 0);

  const quickRows: QuickRow[] = incomplete.rows.map((m) => ({
    id: m.id,
    memberId: m.memberId,
    name: [m.lastName, m.firstName].filter(Boolean).join(", "),
    version: m.version,
    completeness: m.completeness,
    gender: m.gender,
    dob: formatDob(m.dobPrecision, m.dobDate, m.dobYear),
    zoneId: m.zoneId,
    phone: m.phoneRaw,
    phoneValid: Boolean(m.phoneE164),
    ministry: m.ministries.map((l) => `${l.ministry.label} · ${l.role.label}`).join(", ") || null,
  }));

  const pair = pairs[Math.min(pairIndex, Math.max(pairs.length - 1, 0))];
  const [pa, pb] = pair ? await Promise.all([compareRecord(pair.a), compareRecord(pair.b)]) : [null, null];
  const views = groups.map(groupView);
  const listOptionsFor = (g: GroupView) => opts(LIST_FIELDS[g.field as keyof typeof LIST_FIELDS] ?? "");
  const mergeNames = merges.length
    ? new Map((await db.member.findMany({ where: { id: { in: merges.flatMap((m) => [m.survivorId, m.retiredId]) } }, select: { id: true, memberId: true, lastName: true, firstName: true } })).map((m) => [m.id, m]))
    : new Map();

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "incomplete", label: "Incomplete records", count: incomplete.total },
    { key: "duplicates", label: "Suspected duplicates", count: pairs.length },
    { key: "values", label: "Non-standard values", count: valueCount },
    { key: "phones", label: "Invalid phone format", count: phones.total },
    { key: "flagged", label: "Flagged for review", count: flags.length },
    { key: "merges", label: "Merge history" },
  ];
  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...extra }).filter((e): e is [string, string] => Boolean(e[1])));
    return `?${p.toString()}`;
  };

  return (
    <>
      <TopBar />
      <main className="p-4 md:p-7">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="text-[24px] md:text-[28px] font-semibold">Data clean-up</h1>
            <p className="mt-1 text-ink-2">Work through the queues below. Every fix is logged to the audit trail.</p>
          </div>
          <div className="w-full max-w-sm text-[14px]" aria-label="Team progress">
            <div className="flex justify-between gap-4">
              <span className="text-ink-2">Complete profiles</span>
              <span>
                <strong>{progress.complete.toLocaleString("en-UG")}</strong> of {progress.total.toLocaleString("en-UG")} · target {progress.targetPercent}% by{" "}
                {new Date(progress.dueDate).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}
              </span>
            </div>
            <div className="relative mt-2 h-2 rounded-full bg-surface-2" role="progressbar" aria-valuenow={progress.percent} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(progress.percent, 1)}%` }} />
              <div className="absolute -top-1 h-4 w-0.5 bg-ink" style={{ left: `${progress.targetPercent}%` }} aria-hidden />
            </div>
            <p className="mt-1.5 text-ink-2">
              This week: {progress.weekRecords} record{progress.weekRecords === 1 ? "" : "s"} fixed
              {progress.topFixers.length ? ` by ${progress.topFixers.map((f) => f.name).join(" and ")}` : ""}.
            </p>
          </div>
        </div>

        <nav aria-label="Queues" className="mt-5 -mx-4 flex overflow-x-auto border-b border-line px-4 md:mx-0 md:px-0">
          {tabs.map((t) => (
            <Link
              key={t.key}
              href={`/cleanup?tab=${t.key}`}
              aria-current={tab === t.key ? "page" : undefined}
              className={`flex min-h-[44px] items-center gap-2 whitespace-nowrap px-4 text-[14px] ${tab === t.key ? "border-b-2 border-primary font-semibold" : "text-ink-2 hover:text-ink"}`}
            >
              {t.label}
              {t.count !== undefined && (
                <span className={`rounded-full px-2 text-[12px] ${tab === t.key ? "bg-primary text-primary-ink" : "bg-surface-2"}`}>
                  {t.count.toLocaleString("en-UG")}
                  {t.key === "duplicates" && t.count >= 200 ? "+" : ""}
                </span>
              )}
            </Link>
          ))}
        </nav>

        <div className={`mt-5 grid gap-5 ${tab === "incomplete" ? "xl:grid-cols-[minmax(0,1fr)_360px]" : ""}`}>
          <div className="min-w-0">
            {tab === "incomplete" && (
              <section className="card overflow-hidden">
                <div className="flex flex-wrap items-center gap-2 px-4 py-3">
                  <h2 className="mr-auto text-[17px] font-semibold">Incomplete records</h2>
                  <form className="flex flex-wrap gap-2" action="/cleanup">
                    <input type="hidden" name="tab" value="incomplete" />
                    <select name="missing" defaultValue={sp.missing ?? ""} className="input h-10 min-h-10 w-auto text-[14px]" aria-label="Missing field">
                      <option value="">Missing: any field</option>
                      {Object.entries(REQUIRED_FIELD_LABELS).map(([k, l]) => <option key={k} value={k}>Missing: {l}</option>)}
                    </select>
                    <select name="status" defaultValue={sp.status ?? ""} className="input h-10 min-h-10 w-auto text-[14px]" aria-label="Status">
                      <option value="">Status: any</option>
                      {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>Status: {v.label}</option>)}
                      <option value="NONE">Status: not recorded</option>
                    </select>
                    <select name="sort" defaultValue={sp.sort ?? ""} className="input h-10 min-h-10 w-auto text-[14px]" aria-label="Sort">
                      <option value="">Sort: fewest fields first</option>
                      <option value="most">Sort: most missing first</option>
                    </select>
                    <button className="btn btn-secondary h-10 min-h-10">Apply</button>
                  </form>
                  <span className="w-full text-[13px] text-ink-3 xl:w-auto">Tab to move · Enter to save row</span>
                </div>
                {quickRows.length ? (
                  <QuickEditQueue rows={quickRows} zones={zones} ministries={ministries} />
                ) : (
                  <p className="border-t border-line p-8 text-center text-ink-2">Nothing here — every record matching these filters is complete. 🎉</p>
                )}
                <div className="flex items-center justify-between border-t border-line bg-surface-2/50 px-4 py-3 text-[14px]">
                  <span className="text-ink-2">{quickRows.length} of {incomplete.total.toLocaleString("en-UG")} shown</span>
                  {quickRows.length < incomplete.total && (
                    <Link href={qs({ take: String(take + 25) })} scroll={false} className="font-semibold text-primary">Load next 25</Link>
                  )}
                </div>
              </section>
            )}

            {tab === "duplicates" &&
              (pair && pa && pb ? (
                <div className="max-w-3xl">
                  <DuplicateCompare
                    key={`${pair.a}-${pair.b}`}
                    a={pa}
                    b={pb}
                    reasons={pair.reasons}
                    position={pairs.indexOf(pair) + 1}
                    total={pairs.length}
                    prevHref={pairIndex > 0 ? `/cleanup?tab=duplicates&pair=${pairIndex}` : undefined}
                    nextHref={pairIndex + 1 < pairs.length ? `/cleanup?tab=duplicates&pair=${pairIndex + 2}` : undefined}
                    canMerge={canMerge}
                  />
                </div>
              ) : (
                <Empty title="No suspected duplicates">Records with very similar names or the same phone number appear here.</Empty>
              ))}

            {tab === "values" &&
              (views.length ? (
                <div className="grid gap-4 lg:grid-cols-2">
                  {views.map((g) => (
                    <ValueGroup key={g.key} g={g} options={listOptionsFor(g)} canAddNew={can(ctx, "admin.lists", "manage")} />
                  ))}
                </div>
              ) : (
                <Empty title="No non-standard values left">Values from the register that didn’t match a list (like “Nill” or misspelt zones) appear here.</Empty>
              ))}

            {tab === "phones" && (
              <section className="card overflow-hidden">
                <h2 className="px-4 py-3 text-[17px] font-semibold">Invalid phone numbers</h2>
                {phones.rows.length ? (
                  phones.rows.map((r) => <PhoneFixRow key={r.id} r={{ ...r, name: `${r.lastName}, ${r.firstName}` }} />)
                ) : (
                  <p className="border-t border-line p-8 text-center text-ink-2">All recorded phone numbers are valid.</p>
                )}
              </section>
            )}

            {tab === "flagged" && (
              <section className="card overflow-hidden">
                <h2 className="px-4 py-3 text-[17px] font-semibold">Flagged for review</h2>
                {flags.length ? (
                  <ul>
                    {flags.map((f) => (
                      <li key={f.id} className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3">
                        <span className="min-w-48 flex-1">
                          <Link href={`/members/${f.member.id}`} className="font-semibold hover:underline">{f.member.lastName}, {f.member.firstName}</Link>
                          <span className="mono block text-[12px] text-ink-3">{f.member.memberId} · {f.member.completeness}%</span>
                        </span>
                        <span className="flex-1 text-[14px] text-ink-2">{f.reason} · {formatDate(f.createdAt)}</span>
                        <ResolveFlagButton id={f.id} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="border-t border-line p-8 text-center text-ink-2">Nothing flagged. Use “Send to clean-up queue” in the directory to add records here.</p>
                )}
              </section>
            )}

            {tab === "merges" && (
              <section className="card overflow-hidden">
                <h2 className="px-4 py-3 text-[17px] font-semibold">Merge history</h2>
                {merges.length ? (
                  <ul>
                    {merges.map((m) => {
                      const s = mergeNames.get(m.survivorId);
                      const r = mergeNames.get(m.retiredId);
                      const undoable = !m.undoneAt && m.undoableUntil > new Date() && canMerge;
                      return (
                        <li key={m.id} className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3 text-[14px]">
                          <span className="flex-1">
                            <span className="mono">{r?.memberId}</span> merged into{" "}
                            <Link className="font-semibold hover:underline" href={`/members/${m.survivorId}`}>{s?.lastName}, {s?.firstName} ({s?.memberId})</Link>
                            <span className="block text-ink-2">
                              {formatDate(m.mergedAt)}
                              {m.undoneAt ? ` · undone ${formatDate(m.undoneAt)}` : undoable ? ` · can be undone until ${formatDate(m.undoableUntil)}` : ""}
                            </span>
                          </span>
                          {undoable && <UndoMergeButton id={m.id} />}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="border-t border-line p-8 text-center text-ink-2">No merges yet.</p>
                )}
              </section>
            )}
          </div>

          {tab === "incomplete" && (
            <aside className="space-y-5">
              {pair && pa && pb ? (
                <DuplicateCompare a={pa} b={pb} reasons={pair.reasons} position={1} total={pairs.length} nextHref={pairs.length > 1 ? "/cleanup?tab=duplicates&pair=2" : undefined} canMerge={canMerge} compact />
              ) : null}
              {views[0] && (
                <ValueGroup g={views[0]} options={listOptionsFor(views[0])} canAddNew={can(ctx, "admin.lists", "manage")} compact nextLabel={views[1] ? `${views[1].values.flatMap((v) => v.examples).slice(0, 4).join(" / ")}${views[1].suggestion?.kind === "item" ? ` → ${views[1].suggestion.label}` : ""} (${views[1].total})` : undefined} />
              )}
              {can(ctx, "admin.lists", "manage") && (
                <section className="card p-5">
                  <h2 className="mb-3 text-[15px] font-semibold">Team target</h2>
                  <TargetForm percent={progress.targetPercent} due={new Date(progress.dueDate).toISOString().slice(0, 10)} />
                </section>
              )}
            </aside>
          )}
        </div>
      </main>
    </>
  );
}

function Empty({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-10 text-center">
      <h2 className="text-[17px] font-semibold">{title}</h2>
      <p className="mt-2 text-ink-2">{children}</p>
    </div>
  );
}
