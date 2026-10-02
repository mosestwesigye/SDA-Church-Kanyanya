import type { Metadata } from "next";
import { VerifyForm } from "./verify-form";

export const metadata: Metadata = { title: "Two-step verification" };

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <>
      <h1 className="text-[28px] font-semibold mb-1">Two-step verification</h1>
      <p className="text-ink-2 mb-6">Open your authenticator app and enter the 6-digit code for SDAK Church Manager.</p>
      <VerifyForm next={next ?? "/dashboard"} />
    </>
  );
}
