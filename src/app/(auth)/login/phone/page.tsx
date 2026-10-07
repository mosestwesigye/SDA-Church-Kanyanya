import type { Metadata } from "next";
import { AuthTabs } from "@/components/auth/auth-ui";
import { PhoneSignIn } from "./phone-form";

export const metadata: Metadata = { title: "Member sign in" };

export default function PhoneLoginPage() {
  return (
    <>
      <AuthTabs />
      <PhoneSignIn />
    </>
  );
}
