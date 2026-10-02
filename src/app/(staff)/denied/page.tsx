import type { Metadata } from "next";
import Link from "next/link";
import { TopBar } from "@/components/shell/topbar";

export const metadata: Metadata = { title: "Permission needed" };

export default function DeniedPage() {
  return (
    <>
      <TopBar />
      <main className="p-4 md:p-7">
        <div className="card p-8 max-w-xl">
          <h1 className="text-[22px] font-semibold">You don’t have access to this page</h1>
          <p className="text-ink-2 mt-2">
            Your role doesn’t include this part of SDAK Church Manager. If you need it for your work, ask the Church Clerk or the system administrator to
            update your role.
          </p>
          <Link href="/dashboard" className="btn btn-primary mt-6">Back to dashboard</Link>
        </div>
      </main>
    </>
  );
}
