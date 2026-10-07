import type { Metadata } from "next";
import { AuthTabs, GoogleFailed } from "@/components/auth/auth-ui";
import { googleEnabled } from "@/server/auth/auth";
import { PhoneSignIn } from "./phone-form";

export const metadata: Metadata = { title: "Member sign in" };

export default async function PhoneLoginPage({ searchParams }: { searchParams: Promise<{ google?: string }> }) {
  const { google } = await searchParams;
  return (
    <>
      <AuthTabs />
      {google === "failed" && <GoogleFailed audience="member" />}
      <PhoneSignIn google={googleEnabled()} />
    </>
  );
}
