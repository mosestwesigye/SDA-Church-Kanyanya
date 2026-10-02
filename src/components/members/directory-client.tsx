"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Avatar, CompletenessBar, StatusBadge } from "@/components/ui/badges";
import { Dialog } from "@/components/ui/dialog";
import { GENDER_SHORT, initials } from "@/lib/labels";
import {
  bulkAssignMinistryAction,
  bulkDeleteAction,
  bulkFlagAction,
  bulkSetZoneAction,
  deleteViewAction,
  restoreMemberAction,
  saveViewAction,
} from "@/app/(staff)/members/actions";
import { FilterMenu } from "./filter-menu";
import { COLUMNS, type ColumnKey, type DirRow, type Option } from "./types";

export type DirectoryProps = {
  rows: DirRow[];
  total: number;
  page: number;
  pages: number;
  pageSize: number;
  columns: ColumnKey[];
  readableGroups: string[];
  options: { statuses: Option[]; ministries: Option[]; zones: Option[]; roles: Option[]; marital: Option[] };
  caps: {
    bulkUpdate: boolean;
    del: boolean;
    flag: boolean;
    exportRun: boolean;
    restore: boolean;
    manageMinistry: boolean;
    filterProfile: boolean;
    filterSensitive: boolean;
    shareView: boolean;
  };
  tabs: { label: string; count: number; href: string; active: boolean; viewId?: string; own?: boolean }[];
  deletedView: boolean;
};

type BulkDialog = null | "ministry" | "zone" | "flag" | "delete" | "export" | "save";

export function DirectoryClient(p: DirectoryProps) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  // Selection belongs to one page of results; changing page clears it.
  const pageKey = p.rows.map((r) => r.id).join();
  const [selection, setSelection] = useState<{ key: string; ids: Set<string> }>({ key: pageKey, ids: new Set() });
  const selected = selection.key === pageKey ? selection.ids : new Set<string>();
  const setSelected = (ids: Set<string>) => setSelection({ key: pageKey, ids });
  const [dialog, setDialog] = useState<BulkDialog>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [colsOpen, setColsOpen] = useState(false);
  const [q, setQ] = useState(sp.get("q") ?? "");


  function navigate(changes: Record<string, string | string[] | null>, keepPage = false) {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(changes)) {
      const val = Array.isArray(v) ? v.join(",") : v;
      if (val === null || val === "") next.delete(k);
      else next.set(k, val);
    }
    if (!keepPage) next.delete("page");
    const s = next.toString();
    start(() => router.push(`${pathname}${s ? `?${s}` : ""}`));
  }

  // Debounced search.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => {
      if ((sp.get("q") ?? "") !== q) navigate({ q });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const list = (k: string) => (sp.get(k) ?? "").split(",").filter(Boolean);
  const visibleCols = COLUMNS.filter((c) => p.columns.includes(c.key) && p.readableGroups.includes(c.group));
  const allSelected = p.rows.length > 0 && p.rows.every((r) => selected.has(r.id));
  const ids = [...selected];

  function run(action: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    start(async () => {
      const r = await action();
      setNotice({ ok: r.ok, text: r.ok ? (r.message ?? "Done.") : (r.error ?? "Failed.") });
      if (r.ok) {
        setDialog(null);
        setSelected(new Set());
        router.refresh();
      }
    });
  }

  const sort = sp.get("sort") ?? "name";
  const dir = sp.get("dir") ?? "asc";
  function sortBy(key: string) {
    navigate({ sort: key === "name" ? null : key, dir: sort === key && dir === "asc" ? "desc" : null });
  }
  const sortIcon = (key: string) => (sort === key ? (dir === "asc" ? " ↑" : " ↓") : "");

  return (
    <div className="space-y-4">
      {/* Saved views / tabs */}
      <nav aria-label="Views" className="flex gap-1 overflow-x-auto border-b border-line -mx-4 px-4 md:mx-0 md:px-0">
        {p.tabs.map((t) => (
          <span key={t.href} className="flex items-center">
            <Link
              href={t.href}
              aria-current={t.active ? "page" : undefined}
              className={`flex min-h-[44px] items-center gap-1.5 whitespace-nowrap px-3.5 text-[14px] ${
                t.active ? "border-b-2 border-ink font-semibold text-ink" : "text-ink-2 hover:text-ink"
              }`}
            >
              {t.label} <span className="text-ink-3 tabular-nums">{t.count.toLocaleString("en-UG")}</span>
            </Link>
            {t.own && t.viewId && t.active && (
              <button
                type="button"
                className="text-[12px] text-ink-3 hover:text-error px-1"
                aria-label={`Delete view ${t.label}`}
                onClick={() => run(() => deleteViewAction(t.viewId!).then((r) => (r.ok ? (router.push(pathname), r) : r)))}
              >
                ✕
              </button>
            )}
          </span>
        ))}
        <button type="button" onClick={() => setDialog("save")} className="min-h-[44px] whitespace-nowrap px-3 text-[14px] font-semibold text-primary">
          + Save view
        </button>
      </nav>

      {/* Search + filters */}
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="dir-search" className="sr-only">
          Search name, ID or phone
        </label>
        <input
          id="dir-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Name, ID or phone…"
          className="h-10 w-full sm:w-72 rounded-[6px] border border-line bg-surface px-3 text-[16px] sm:text-[14px]"
        />
        {p.caps.filterProfile && (
          <FilterMenu label="Status" options={p.options.statuses} selected={list("status")} onChange={(v) => navigate({ status: v })} />
        )}
        <FilterMenu label="Ministry" options={p.options.ministries} selected={list("ministry")} onChange={(v) => navigate({ ministry: v })} />
        {p.caps.filterProfile && <FilterMenu label="Zone" options={p.options.zones} selected={list("zone")} onChange={(v) => navigate({ zone: v })} />}
        {p.caps.filterProfile && (
          <FilterMenu
            label="Gender"
            multi={false}
            options={[
              { id: "FEMALE", label: "Female" },
              { id: "MALE", label: "Male" },
              { id: "NONE", label: "Not recorded" },
            ]}
            selected={list("gender")}
            onChange={(v) => navigate({ gender: v[0] ?? null })}
          />
        )}
        {p.caps.filterSensitive && <FilterMenu label="Marital" options={p.options.marital} selected={list("marital")} onChange={(v) => navigate({ marital: v })} />}
        {p.caps.filterProfile && (
          <FilterMenu
            label="Profile"
            multi={false}
            options={[
              { id: "incomplete", label: "Incomplete" },
              { id: "nameonly", label: "Name and ID only" },
              { id: "complete", label: "Complete" },
            ]}
            selected={list("profile")}
            onChange={(v) => navigate({ profile: v[0] ?? null })}
          />
        )}
        {p.caps.exportRun && !p.deletedView && (
          <button type="button" onClick={() => (setSelected(new Set()), setDialog("export"))} className="ml-auto hidden h-10 rounded-[6px] border border-line bg-surface px-3 text-[14px] md:block">
            Export {p.total.toLocaleString("en-UG")}
          </button>
        )}
        <div className={`relative hidden md:block ${p.caps.exportRun && !p.deletedView ? "" : "ml-auto"}`}>
          <button type="button" aria-expanded={colsOpen} onClick={() => setColsOpen((o) => !o)} className="h-10 rounded-[6px] border border-primary bg-primary-soft px-3 text-[14px] font-semibold">
            Columns · {visibleCols.length + 1} of {COLUMNS.length + 1}
          </button>
          {colsOpen && (
            <div className="absolute right-0 z-30 mt-1 w-64 rounded-[8px] border border-line bg-surface p-3 shadow-lg">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">Show columns</div>
              <label className="flex min-h-[34px] items-center gap-3 opacity-70">
                <input type="checkbox" checked disabled className="size-4" /> Member
              </label>
              {COLUMNS.map((c) => {
                const allowed = p.readableGroups.includes(c.group);
                return (
                  <label key={c.key} className="flex min-h-[34px] items-center gap-3">
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--primary)]"
                      disabled={!allowed}
                      checked={allowed && p.columns.includes(c.key)}
                      onChange={(e) => {
                        const next = e.target.checked ? [...p.columns, c.key] : p.columns.filter((k) => k !== c.key);
                        navigate({ cols: COLUMNS.filter((x) => next.includes(x.key)).map((x) => x.key) }, true);
                      }}
                    />
                    <span className="flex-1 text-[14px]">{c.label}</span>
                    {!allowed && <span className="text-[11px] text-ink-3">Restricted</span>}
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {notice && (
        <p role={notice.ok ? "status" : "alert"} className={`rounded-[6px] px-3 py-2 text-sm ${notice.ok ? "bg-primary-soft text-primary" : "bg-error-soft text-error"}`}>
          {notice.text}
        </p>
      )}

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="sticky top-16 z-20 flex flex-wrap items-center gap-2 rounded-[8px] bg-primary px-4 py-2 text-primary-ink">
          <span className="mr-2 font-semibold">{selected.size} selected</span>
          {p.deletedView ? (
            p.caps.restore && (
              <BulkButton onClick={() => run(async () => {
                for (const id of ids) await restoreMemberAction(id);
                return { ok: true, message: `${ids.length} restored.` };
              })}>Restore</BulkButton>
            )
          ) : (
            <>
              {p.caps.manageMinistry && <BulkButton onClick={() => setDialog("ministry")}>Assign ministry</BulkButton>}
              {p.caps.bulkUpdate && <BulkButton onClick={() => setDialog("zone")}>Set zone</BulkButton>}
              {p.caps.flag && <BulkButton onClick={() => setDialog("flag")}>Send to clean-up queue</BulkButton>}
              {p.caps.exportRun && <BulkButton onClick={() => setDialog("export")}>Export selected</BulkButton>}
              {p.caps.del && <BulkButton onClick={() => setDialog("delete")}>Delete</BulkButton>}
            </>
          )}
          <button type="button" className="ml-auto min-h-[36px] px-2 text-[14px] underline" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}

      {p.rows.length === 0 ? (
        <div className="card p-10 text-center">
          <h2 className="text-[17px] font-semibold">{p.deletedView ? "Nothing recently deleted" : "No members match"}</h2>
          <p className="mt-2 text-ink-2">{p.deletedView ? "Deleted records appear here until they are restored or purged." : "Try a different spelling, or clear some filters."}</p>
          {!p.deletedView && sp.toString() && (
            <Link href={pathname} className="btn btn-secondary mt-4">
              Clear search and filters
            </Link>
          )}
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className={`card hidden overflow-x-auto md:block ${pending ? "opacity-60" : ""}`} aria-busy={pending}>
            <table className="w-full text-[14px]">
              <thead className="bg-surface-2 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-2">
                <tr>
                  <th className="w-12 px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label="Select all on this page"
                      className="size-4 accent-[var(--primary)]"
                      checked={allSelected}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(p.rows.map((r) => r.id)))}
                    />
                  </th>
                  <th className="px-3 py-3">
                    <button type="button" onClick={() => sortBy("name")} className="uppercase tracking-wider">
                      Member{sortIcon("name")}
                    </button>
                  </th>
                  {visibleCols.map((c) => (
                    <th key={c.key} className="px-3 py-3 whitespace-nowrap">
                      {c.key === "completeness" || c.key === "updated" ? (
                        <button type="button" onClick={() => sortBy(c.key)} className="uppercase tracking-wider">
                          {c.key === "completeness" ? "Profile" : c.label}
                          {sortIcon(c.key)}
                        </button>
                      ) : c.key === "ministry" ? (
                        "Ministry"
                      ) : (
                        c.label
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {p.rows.map((r) => (
                  <tr key={r.id} className={`border-t border-line ${selected.has(r.id) ? "bg-primary-soft" : "hover:bg-surface-2/60"}`}>
                    <td className="px-4 py-2.5">
                      <input
                        type="checkbox"
                        aria-label={`Select ${r.lastName}, ${r.firstName}`}
                        className="size-4 accent-[var(--primary)]"
                        checked={selected.has(r.id)}
                        onChange={() => {
                          const next = new Set(selected);
                          if (next.has(r.id)) next.delete(r.id);
                          else next.add(r.id);
                          setSelected(next);
                        }}
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <Link href={`/members/${r.id}`} className="flex items-center gap-3">
                        <Avatar initials={initials(r.firstName, r.lastName)} />
                        <span>
                          <span className="block font-semibold hover:underline">
                            {r.lastName}
                            {r.firstName ? `, ${r.firstName}` : ""}
                          </span>
                          <span className="mono block text-[12px] text-ink-3">
                            {r.memberId}
                            {r.flagged && <span className="ml-2 font-sans text-[11px] text-[var(--status-irregular)]">In clean-up queue</span>}
                          </span>
                        </span>
                      </Link>
                    </td>
                    {visibleCols.map((c) => (
                      <td key={c.key} className="px-3 py-2.5 whitespace-nowrap">
                        <Cell row={r} col={c.key} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <ul className={`space-y-2 md:hidden ${pending ? "opacity-60" : ""}`}>
            {p.rows.map((r) => (
              <li key={r.id}>
                <Link href={`/members/${r.id}`} className="card flex items-center gap-3 p-3 min-h-[72px]">
                  <Avatar initials={initials(r.firstName, r.lastName)} size={44} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-2">
                      <span className="truncate text-[16px] font-semibold">
                        {r.lastName}
                        {r.firstName ? `, ${r.firstName}` : ""}
                      </span>
                      {!r.restricted.includes("member.profile") && <StatusBadge status={r.status} />}
                    </span>
                    <span className="mono block text-[13px] text-ink-2">
                      {r.memberId}
                      <span className="font-sans"> · {r.zone ?? "No zone"}</span>
                    </span>
                    {r.completeness !== null && <CompletenessBar value={r.completeness} className="mt-1.5" />}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Pagination */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-[14px] text-ink-2">
        <span>
          Showing {p.total === 0 ? 0 : (p.page - 1) * p.pageSize + 1}–{Math.min(p.page * p.pageSize, p.total)} of {p.total.toLocaleString("en-UG")}
        </span>
        <span className="flex items-center gap-2">
          <button type="button" className="btn btn-secondary" disabled={p.page <= 1 || pending} onClick={() => navigate({ page: String(p.page - 1) }, true)}>
            Previous
          </button>
          <span>
            Page {p.page} of {p.pages}
          </span>
          <button type="button" className="btn btn-secondary" disabled={p.page >= p.pages || pending} onClick={() => navigate({ page: String(p.page + 1) }, true)}>
            Next
          </button>
        </span>
      </div>

      <BulkDialogs
        dialog={dialog}
        close={() => setDialog(null)}
        ids={ids}
        options={p.options}
        pending={pending}
        run={run}
        shareView={p.caps.shareView}
        search={sp.toString()}
        columns={p.columns}
      />
    </div>
  );
}

function BulkButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="min-h-[36px] rounded-[5px] bg-white/15 px-3 text-[14px] hover:bg-white/25">
      {children}
    </button>
  );
}

function Restricted() {
  return <span className="text-[12px] text-ink-3">Restricted</span>;
}

const dash = <span className="text-ink-3">—</span>;

function Cell({ row: r, col }: { row: DirRow; col: ColumnKey }) {
  const group = COLUMNS.find((c) => c.key === col)!.group;
  if (r.restricted.includes(group)) return <Restricted />;
  switch (col) {
    case "status":
      return <StatusBadge status={r.status} />;
    case "gender":
      return r.gender ? <>{GENDER_SHORT[r.gender]}</> : dash;
    case "completeness":
      return r.completeness === null ? dash : <CompletenessBar value={r.completeness} className="w-36" />;
    case "updated":
      return <>{new Date(r.updatedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</>;
    default: {
      const v = r[col as keyof DirRow];
      return v === null || v === undefined || v === "" ? dash : <>{String(v)}</>;
    }
  }
}

function BulkDialogs({
  dialog,
  close,
  ids,
  options,
  pending,
  run,
  shareView,
  search,
  columns,
}: {
  dialog: BulkDialog;
  close: () => void;
  ids: string[];
  options: DirectoryProps["options"];
  pending: boolean;
  run: (a: () => Promise<{ ok: boolean; message?: string; error?: string }>) => void;
  shareView: boolean;
  search: string;
  columns: ColumnKey[];
}) {
  const [ministry, setMinistry] = useState("");
  const [role, setRole] = useState(options.roles.find((r) => r.label === "Member")?.id ?? "");
  const [zone, setZone] = useState("");
  const [reason, setReason] = useState("");
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [format, setFormat] = useState("xlsx");
  const n = ids.length;
  const plural = useMemo(() => (n === 1 ? "1 member" : `${n} members`), [n]);

  const actions = (label: string, disabled: boolean, onClick: () => void, danger = false) => (
    <>
      <button type="button" className="btn btn-secondary" onClick={close}>
        Cancel
      </button>
      <button type="button" className={danger ? "btn btn-danger" : "btn btn-primary"} disabled={disabled || pending} onClick={onClick}>
        {pending ? "Working…" : label}
      </button>
    </>
  );

  return (
    <>
      <Dialog open={dialog === "ministry"} onClose={close} title={`Assign ministry to ${plural}`}
        footer={actions("Assign", !ministry || !role, () => run(() => bulkAssignMinistryAction(ids, ministry, role)))}>
        <label className="field-label" htmlFor="bm-ministry">Ministry</label>
        <select id="bm-ministry" className="input mb-4" value={ministry} onChange={(e) => setMinistry(e.target.value)}>
          <option value="">Choose…</option>
          {options.ministries.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <label className="field-label" htmlFor="bm-role">Role</label>
        <select id="bm-role" className="input" value={role} onChange={(e) => setRole(e.target.value)}>
          {options.roles.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </Dialog>

      <Dialog open={dialog === "zone"} onClose={close} title={`Set zone for ${plural}`}
        footer={actions("Set zone", !zone, () => run(() => bulkSetZoneAction(ids, zone)))}>
        <label className="field-label" htmlFor="bz-zone">Zone</label>
        <select id="bz-zone" className="input" value={zone} onChange={(e) => setZone(e.target.value)}>
          <option value="">Choose…</option>
          {options.zones.filter((z) => z.id !== "NONE").map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <p className="mt-3 text-[13px] text-ink-2">Each change is recorded in the members’ audit logs.</p>
      </Dialog>

      <Dialog open={dialog === "flag"} onClose={close} title={`Send ${plural} to the clean-up queue`}
        footer={actions("Send", false, () => run(() => bulkFlagAction(ids, reason)))}>
        <label className="field-label" htmlFor="bf-reason">What needs checking? (optional)</label>
        <input id="bf-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Confirm phone numbers at Sabbath" />
      </Dialog>

      <Dialog open={dialog === "delete"} onClose={close} title={`Delete ${plural}?`}
        footer={actions("Delete", reason.trim().length < 3, () => run(() => bulkDeleteAction(ids, reason)), true)}>
        <p className="mb-3 text-ink-2">Records move to “Recently deleted” and can be restored. Member IDs are never reused.</p>
        <label className="field-label" htmlFor="bd-reason">Reason</label>
        <input id="bd-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Entered twice" />
      </Dialog>

      <Dialog open={dialog === "save"} onClose={close} title="Save this view"
        footer={actions("Save view", !name.trim(), () => run(() => saveViewAction({ name, search, columns, shared })))}>
        <label className="field-label" htmlFor="sv-name">Name</label>
        <input id="sv-name" className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="e.g. Youth without phone" />
        <p className="mt-2 text-[13px] text-ink-2">Saves the current search, filters and columns.</p>
        {shareView && (
          <label className="mt-3 flex min-h-[44px] items-center gap-3">
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} className="size-4" /> Share with all staff
          </label>
        )}
      </Dialog>

      <Dialog open={dialog === "export"} onClose={close} title={ids.length ? `Export ${plural}` : "Export members"}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={close}>Cancel</button>
            <form method="post" action={`/api/export/members${search ? `?${search}` : ""}`} onSubmit={() => setTimeout(close, 300)}>
              <input type="hidden" name="format" value={format} />
              <input type="hidden" name="ack" value="1" />
              <input type="hidden" name="columns" value={columns.join(",")} />
              {ids.map((id) => <input key={id} type="hidden" name="ids" value={id} />)}
              <button className="btn btn-primary">I understand — download</button>
            </form>
          </>
        }>
        <PrivacyNotice />
        <fieldset className="mt-4">
          <legend className="field-label">Format</legend>
          <div className="flex gap-4">
            {["xlsx", "csv"].map((f) => (
              <label key={f} className="flex min-h-[44px] items-center gap-2">
                <input type="radio" name="fmt" checked={format === f} onChange={() => setFormat(f)} /> {f === "xlsx" ? "Excel (.xlsx)" : "CSV"}
              </label>
            ))}
          </div>
        </fieldset>
      </Dialog>
    </>
  );
}

export function PrivacyNotice() {
  return (
    <div className="rounded-[8px] border border-line bg-surface-2 p-3 text-[14px] text-ink-2">
      <p className="font-semibold text-ink">Personal data — Data Protection and Privacy Act, 2019</p>
      <p className="mt-1">
        This file contains members’ personal data. Use it only for church administration, store it securely, don’t share it outside the church, and delete it when
        you no longer need it. Your export is recorded with your name and the time.
      </p>
    </div>
  );
}
