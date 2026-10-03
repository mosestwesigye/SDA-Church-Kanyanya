import type { Metadata } from "next";
import Image from "next/image";

export const metadata: Metadata = { title: "Offline" };
export const dynamic = "force-static";

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center p-6 text-center">
      <Image src="/sda-logo.png" alt="" width={48} height={50} />
      <h1 className="mt-4 text-[24px] font-semibold">You’re offline</h1>
      <p className="mt-2 text-ink-2">
        This page hasn’t been saved on this device yet. Pages you have opened recently (dashboard, members, ministries, families) can still be read offline, and edits you make are
        kept on this device until you’re back online.
      </p>
      <a href="/dashboard" className="btn btn-primary mt-6">Try the dashboard</a>
    </main>
  );
}
