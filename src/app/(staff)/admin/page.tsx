import type { Metadata } from "next";
import { PageHeader, TopBar } from "@/components/shell/topbar";
import { can } from "@/server/authz/policy";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { getCompletenessRules } from "@/server/settings/rules";
import { PhotoRuleForm } from "./rules-form";

export const metadata: Metadata = { title: "Admin" };

export default async function AdminPage() {
  const ctx = await requirePermission("admin.users", "manage");
  const rules = await getCompletenessRules(db);
  return (
    <>
      <TopBar />
      <main className="p-4 md:p-7 space-y-6 max-w-3xl">
        <PageHeader title="Admin" subtitle="Users, roles, controlled lists and security settings arrive in phase 8." />
        {can(ctx, "admin.lists", "manage") && (
          <section className="card p-5" aria-labelledby="rules-h">
            <h2 id="rules-h" className="text-[17px] font-semibold mb-4">Data rules</h2>
            <PhotoRuleForm photoRequired={rules.photoRequired} />
          </section>
        )}
      </main>
    </>
  );
}
