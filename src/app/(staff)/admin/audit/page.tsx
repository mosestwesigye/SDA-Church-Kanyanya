import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/ui/states";
import { AUDIT_FILTERS, parseAuditQuery, searchAudit } from "@/server/audit/query";
import { requireContext } from "@/server/auth/session";
import { db } from "@/server/db";
import { ForbiddenError } from "@/server/errors";

export const metadata: Metadata = { title: "Audit log · Admin" };

function show(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  const s = JSON.stringify(v);
  return s.length > 140 ? `${s.slice(0, 140)}…` : s;
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireContext();
  const q = parseAuditQuery(await searchParams);
  let res;
  try {
    res = await searchAudit(db, ctx, q);
  } catch (e) {
    if (e instanceof ForbiddenError) redirect("/denied?need=audit:read");
    throw e;
  }
  const qs = (page: number) => {
    const p = new URLSearchParams(Object.entries({ ...q, page }).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)]));
    return `/admin/audit?${p}`;
  };
  const sel = "h-10 rounded-[6px] border border-line bg-surface px-3 text-[14px]";
  return (
    <>
      <form className="card mb-4 flex flex-wrap items-end gap-3 p-4" action="/admin/audit">
        <div><label className="field-label" htmlFor="a-actor">Who</label><input id="a-actor" name="actor" defaultValue={q.actor} className={`${sel} w-40`} placeholder="Name" /></div>
        <div><label className="field-label" htmlFor="a-member">Member ID</label><input id="a-member" name="member" defaultValue={q.member} className={`${sel} w-32`} placeholder="M0123" /></div>
        <div>
          <label className="field-label" htmlFor="a-action">Action</label>
          <select id="a-action" name="action" defaultValue={q.action ?? ""} className={sel}>
            <option value="">Any</option>
            {AUDIT_FILTERS.actions.map((a) => <option key={a} value={a}>{a.replace("_", " ").toLowerCase()}</option>)}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="a-source">Source</label>
          <select id="a-source" name="source" defaultValue={q.source ?? ""} className={sel}>
            <option value="">Any</option>
            {AUDIT_FILTERS.sources.map((a) => <option key={a} value={a}>{a.replace("_", "-").toLowerCase()}</option>)}
          </select>
        </div>
        <div><label className="field-label" htmlFor="a-entity">Record type</label><input id="a-entity" name="entity" defaultValue={q.entity} className={`${sel} w-36`} placeholder="Member, User…" /></div>
        <div><label className="field-label" htmlFor="a-from">From</label><input id="a-from" type="date" name="from" defaultValue={q.from} className={sel} /></div>
        <div><label className="field-label" htmlFor="a-to">To</label><input id="a-to" type="date" name="to" defaultValue={q.to} className={sel} /></div>
        <button className="btn btn-secondary">Filter</button>
        <Link href="/admin/audit" className="btn btn-secondary">Clear</Link>
      </form>
      <p className="mb-3 text-[14px] text-ink-2">
        {res.total.toLocaleString("en-UG")} entries. The log is append-only: the database rejects edits and deletions. Values from fields your role can’t see are shown as •••.
      </p>
      {res.rows.length === 0 ? (
        <EmptyState title="No matching entries">Try widening the filters.</EmptyState>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[900px] text-[14px]">
            <thead className="bg-surface-2 text-left text-[11px] uppercase tracking-wider text-ink-2">
              <tr>
                <th scope="col" className="px-3 py-3">When</th>
                <th scope="col" className="px-3 py-3">Who</th>
                <th scope="col" className="px-3 py-3">What</th>
                <th scope="col" className="px-3 py-3">Change</th>
              </tr>
            </thead>
            <tbody>
              {res.rows.map((r) => (
                <tr key={r.id} className="border-t border-line align-top">
                  <td className="px-3 py-2 whitespace-nowrap">{r.at.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "medium", timeZone: "Africa/Kampala" })}</td>
                  <td className="px-3 py-2">{r.actor}<span className="block text-[12px] text-ink-2">{r.source.toLowerCase().replace("_", "-")}{r.ipAddress ? ` · ${r.ipAddress}` : ""}</span></td>
                  <td className="px-3 py-2">
                    <span className="font-semibold">{r.action.replace("_", " ").toLowerCase()}</span> {r.entity}
                    {r.member && <> · <Link className="mono text-primary hover:underline" href={`/members/${r.member.id}?tab=audit`}>{r.member.memberId}</Link></>}
                    {r.field && <span className="block text-[12px] text-ink-2">{r.field}</span>}
                  </td>
                  <td className="px-3 py-2 break-all">
                    {r.oldValue !== null && r.oldValue !== undefined && <span className="text-ink-2 line-through">{show(r.oldValue)}</span>}
                    {r.oldValue !== null && r.oldValue !== undefined && r.newValue !== null && r.newValue !== undefined && " → "}
                    {show(r.newValue)}
                    {r.note && <span className="block text-[12px] text-ink-2">{r.note}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {res.pages > 1 && (
        <nav aria-label="Pages" className="mt-4 flex items-center justify-between text-[14px]">
          {q.page > 1 ? <Link className="btn btn-secondary" href={qs(q.page - 1)}>Newer</Link> : <span />}
          <span className="text-ink-2">Page {q.page} of {res.pages}</span>
          {q.page < res.pages ? <Link className="btn btn-secondary" href={qs(q.page + 1)}>Older</Link> : <span />}
        </nav>
      )}
    </>
  );
}
