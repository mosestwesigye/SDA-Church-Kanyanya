import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { MemberForm, type FormValues } from "@/components/members/member-form";
import { PageHeader, TopBar } from "@/components/shell/topbar";
import { fullName } from "@/lib/labels";
import { requirePermission } from "@/server/auth/session";
import { can, canOnMember } from "@/server/authz/policy";
import { householdOptions, householdsOfMember } from "@/server/households/service";
import { db } from "@/server/db";
import { getMemberProfile } from "@/server/members/profile";
import { formOptions } from "../../form-options";

export const metadata: Metadata = { title: "Edit member" };

const STEP_OF: Record<string, number> = {
  lastName: 0, firstName: 0, gender: 0, dob: 0, yearJoined: 0, photo: 0, zone: 1, phone: 1, status: 2, maritalStatus: 2,
  spouse: 2, nextOfKinName: 2, nextOfKinPhone: 2, profession: 3, ministry: 3,
};

export default async function EditMemberPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ focus?: string }> }) {
  const ctx = await requirePermission("member", "update");
  const { id } = await params;
  const { focus } = await searchParams;
  const data = await getMemberProfile(db, ctx, id);
  if (!data) notFound();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = data.member as unknown as Record<string, any>;
  const row = { id, ministries: (m.ministries ?? []) as { ministryId: string }[] };
  if (!canOnMember(ctx, "member", "update", row) || m.deletedAt) redirect(`/members/${id}`);

  const date = m.dobDate ? new Date(m.dobDate).toISOString().slice(0, 10) : "";
  const initial: FormValues = {
    lastName: m.lastName ?? "",
    firstName: m.firstName ?? "",
    gender: m.gender ?? "",
    dobMode: m.dobPrecision ?? "UNKNOWN",
    dobDate: date,
    dobYear: m.dobYear ? String(m.dobYear) : "",
    yearJoined: m.yearJoined ? String(m.yearJoined) : "",
    zoneId: m.zoneId ?? "",
    phone: m.phoneRaw ?? "",
    email: m.email ?? "",
    status: m.status ?? "",
    maritalStatus: m.maritalStatus ?? "",
    spouseMemberId: m.spouseMemberId ?? "",
    spouseLabel: m.spouse ? `${m.spouse.lastName}, ${m.spouse.firstName} · ${m.spouse.memberId}` : "",
    spouseName: m.spouseName ?? "",
    nextOfKinName: m.nextOfKinName ?? "",
    nextOfKinPhone: m.nextOfKinPhoneRaw ?? "",
    professionId: m.professionId ?? "",
    householdChoice: "",
    householdNewName: "",
    householdRelation: "OTHER",
  };
  const canHousehold = can(ctx, "household", "update") && can(ctx, "member.sensitive", "read");
  const [households, current] = canHousehold ? await Promise.all([householdOptions(db, ctx), householdsOfMember(db, ctx, id)]) : [[], []];
  const firstMissing = focus === "missing" ? ((m.missingFields ?? []) as string[]).map((f) => STEP_OF[f]).filter((n) => n !== undefined).sort()[0] : undefined;

  return (
    <>
      <TopBar />
      <main className="p-4 md:p-7">
        <nav aria-label="Breadcrumb" className="mb-3 text-[14px] text-ink-2">
          <Link href="/members" className="hover:underline">Members</Link> / <Link href={`/members/${id}`} className="hover:underline">{fullName(m as { lastName: string; firstName: string })}</Link> / Edit
        </nav>
        <PageHeader title={`Edit ${fullName(m as { lastName: string; firstName: string })}`} subtitle={<span className="mono">{m.memberId}</span>} />
        <MemberForm
          mode="edit"
          memberId={id}
          version={m.version}
          initial={initial}
          startStep={firstMissing ?? 0}
          options={await formOptions()}
          caps={{
            profile: canOnMember(ctx, "member.profile", "update", row),
            contact: canOnMember(ctx, "member.contact", "update", row),
            sensitive: canOnMember(ctx, "member.sensitive", "update", row),
            statusEditable: !m.status,
            manageMinistry: false,
            household: canHousehold,
          }}
          households={households}
          currentHouseholds={current.map((c) => ({ id: c.householdId, name: c.household.name, relation: c.relation }))}
        />
      </main>
    </>
  );
}
