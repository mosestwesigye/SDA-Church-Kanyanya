import type { Metadata } from "next";
import { PhoneSignIn } from "./phone-form";

export const metadata: Metadata = { title: "Member sign in" };

export default function PhoneLoginPage() {
  return (
    <>
      <h1 className="mb-1 text-[28px] font-semibold">Member sign in</h1>
      <p className="mb-6 text-ink-2">See your church membership record and ask for corrections. We’ll text you a code — no password needed.</p>
      <PhoneSignIn />
    </>
  );
}
