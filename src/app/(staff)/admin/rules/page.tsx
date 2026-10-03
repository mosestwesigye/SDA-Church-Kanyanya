import type { Metadata } from "next";
import { requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { getCompletenessRules } from "@/server/settings/rules";
import { PhotoRuleForm } from "../rules-form";

export const metadata: Metadata = { title: "Data rules · Admin" };

export default async function RulesPage() {
  await requirePermission("admin.lists", "manage");
  const rules = await getCompletenessRules(db);
  return (
    <section className="card max-w-3xl p-5" aria-labelledby="rules-h">
      <h2 id="rules-h" className="mb-4 text-[17px] font-semibold">Profile completeness</h2>
      <PhotoRuleForm photoRequired={rules.photoRequired} />
    </section>
  );
}
