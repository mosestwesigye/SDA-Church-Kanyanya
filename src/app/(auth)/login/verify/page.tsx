import type { Metadata } from "next";
import { AuthHeader, BackLink } from "@/components/auth/auth-ui";
import { VerifyForm } from "./verify-form";

export const metadata: Metadata = { title: "Two-step verification" };

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <>
      <BackLink href="/login">Back to sign in</BackLink>
      <div className="mt-4">
        <AuthHeader icon="shield" title="Two-step verification">
          Open your authenticator app and enter the 6-digit code shown for SDAK Church Manager.
        </AuthHeader>
      </div>
      <VerifyForm next={next ?? "/dashboard"} />
    </>
  );
}
