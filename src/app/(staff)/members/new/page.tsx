import type { Metadata } from "next";
import Link from "next/link";
import { EMPTY_VALUES, MemberForm } from "@/components/members/member-form";
import { PageHeader, TopBar } from "@/components/shell/topbar";
import { can } from "@/server/authz/policy";
import { requirePermission } from "@/server/auth/session";
import { formOptions } from "../form-options";

export const metadata: Metadata = { title: "Add member" };

export default async function NewMemberPage() {
  const ctx = await requirePermission("member", "create");
  return (
    <>
      <TopBar />
      <main className="p-4 md:p-7">
        <nav aria-label="Breadcrumb" className="mb-3 text-[14px] text-ink-2">
          <Link href="/members" className="hover:underline">Members</Link> / Add member
        </nav>
        <PageHeader title="Add member" subtitle="A permanent member ID (SDAK/M…) is issued when you save." />
        <MemberForm
          mode="create"
          initial={EMPTY_VALUES}
          options={await formOptions()}
          caps={{
            profile: can(ctx, "member.profile", "update"),
            contact: can(ctx, "member.contact", "update"),
            sensitive: can(ctx, "member.sensitive", "update"),
            statusEditable: true,
            manageMinistry: can(ctx, "member", "update") || can(ctx, "ministry", "manage"),
          }}
        />
      </main>
    </>
  );
}
