import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CorrectionForm } from "@/components/selfservice/self-widgets";
import { requireContext } from "@/server/auth/session";
import { db } from "@/server/db";
import { getOwnRecord, hasCurrentConsent } from "@/server/selfservice/service";

export const metadata: Metadata = { title: "Ask for a correction" };

export default async function CorrectPage() {
  const ctx = await requireContext();
  if (!ctx.memberId || !(await hasCurrentConsent(db, ctx.memberId))) redirect("/me");
  if (await db.correctionRequest.count({ where: { memberId: ctx.memberId, state: "PENDING" } })) redirect("/me");
  const [m, zones, professions] = await Promise.all([
    getOwnRecord(db, ctx),
    db.listItem.findMany({ where: { type: "ZONE", active: true, mergedIntoId: null }, orderBy: [{ sortOrder: "asc" }, { label: "asc" }], select: { id: true, label: true } }),
    db.listItem.findMany({ where: { type: "PROFESSION", active: true, mergedIntoId: null }, orderBy: { label: "asc" }, select: { id: true, label: true } }),
  ]);
  const s = (x: unknown) => (x === null || x === undefined ? "" : String(x));
  const initial = {
    firstName: s(m.firstName),
    lastName: s(m.lastName),
    gender: s(m.gender),
    dobDate: m.dobPrecision === "FULL" && m.dobDate ? (m.dobDate as Date).toISOString().slice(0, 10) : "",
    phone: s(m.phoneRaw),
    email: s(m.email),
    zoneId: s(m.zoneId),
    professionId: s(m.professionId),
    maritalStatus: s(m.maritalStatus),
    yearJoined: s(m.yearJoined),
    nextOfKinName: s(m.nextOfKinName),
    nextOfKinPhone: s(m.nextOfKinPhoneRaw),
  };
  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-3 text-[14px] text-ink-2"><Link href="/me" className="hover:underline">My record</Link> / Correction</nav>
      <h1 className="text-[26px] font-semibold leading-tight">Ask for a correction</h1>
      <p className="mb-5 mt-1 text-ink-2">Change what’s wrong or missing. Nothing is saved to your record until the church clerk checks it.</p>
      <CorrectionForm initial={initial} zones={zones} professions={professions} />
    </>
  );
}
