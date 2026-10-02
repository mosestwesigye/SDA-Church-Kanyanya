import { PageHeader, TopBar } from "./topbar";
import { requirePermission } from "@/server/auth/session";
import type { Resource } from "@/server/authz/catalog";

/** Placeholder for screens scheduled in a later build phase (permission-checked already). */
export async function ComingSoon({ title, phase, need }: { title: string; phase: number; need: [Resource, string] }) {
  await requirePermission(need[0], need[1]);
  return (
    <>
      <TopBar />
      <main className="p-4 md:p-7">
        <PageHeader title={title} />
        <div className="card p-8 max-w-xl text-ink-2">This screen is built in phase {phase} of the plan.</div>
      </main>
    </>
  );
}
