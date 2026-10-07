"use server";

import { APIError } from "better-auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { AuditWriter } from "@/server/audit/audit";
import { auth } from "@/server/auth/auth";
import { clear, hit, LOGIN_LIMITS } from "@/server/auth/rate-limit";
import { db } from "@/server/db";
import { flash } from "@/server/flash";

export type FormState = { error?: string; ok?: string; email?: string } | undefined;

function ipOf(h: Headers) {
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

function safeNext(v: FormDataEntryValue | null): string {
  const s = typeof v === "string" ? v : "";
  return s.startsWith("/") && !s.startsWith("//") ? s : "/dashboard";
}

function waitMessage(seconds: number) {
  return `Too many attempts. Try again in ${Math.ceil(seconds / 60)} minute${seconds > 60 ? "s" : ""}.`;
}

const credentials = z.object({ email: z.email().transform((e) => e.trim().toLowerCase()), password: z.string().min(1) });

export async function signInAction(_: FormState, form: FormData): Promise<FormState> {
  const typed = String(form.get("email") ?? "");
  const parsed = credentials.safeParse({ email: typed, password: form.get("password") });
  if (!parsed.success) return { error: "Enter your email and password.", email: typed };
  const { email, password } = parsed.data;
  const h = await headers();
  const ip = ipOf(h);

  for (const [key, limit] of [[`login:ip:${ip}`, LOGIN_LIMITS.perIp], [`login:acct:${email}`, LOGIN_LIMITS.perAccount]] as const) {
    const r = await hit(db, key, limit);
    if (!r.allowed) return { error: waitMessage(r.retryAfterSeconds), email };
  }

  let twoFactor = false;
  try {
    const res = await auth.api.signInEmail({ body: { email, password }, headers: h });
    twoFactor = "twoFactorRedirect" in res && Boolean(res.twoFactorRedirect);
  } catch (e) {
    if (e instanceof APIError) {
      const user = await db.user.findUnique({ where: { email }, select: { id: true } });
      await new AuditWriter(db, { userId: user?.id ?? null, label: email, ipAddress: ip }, "UI").log({
        action: "LOGIN_FAILED",
        entity: "User",
        entityId: user?.id ?? null,
        note: e.message,
      });
      return { error: "That email and password don’t match an active account.", email };
    }
    throw e;
  }
  await clear(db, `login:acct:${email}`);
  const next = safeNext(form.get("next"));
  if (!twoFactor) await flash("success", "Signed in", "Welcome to SDAK Church Manager.");
  redirect(twoFactor ? `/login/verify?next=${encodeURIComponent(next)}` : next);
}

export async function verifyTotpAction(_: FormState, form: FormData): Promise<FormState> {
  const code = String(form.get("code") ?? "").replace(/\s/g, "");
  const useBackup = form.get("mode") === "backup";
  const h = await headers();
  const r = await hit(db, `totp:ip:${ipOf(h)}`, LOGIN_LIMITS.totp);
  if (!r.allowed) return { error: waitMessage(r.retryAfterSeconds) };
  try {
    if (useBackup) await auth.api.verifyBackupCode({ body: { code }, headers: h });
    else {
      if (!/^\d{6}$/.test(code)) return { error: "Enter the 6-digit code from your authenticator app." };
      await auth.api.verifyTOTP({ body: { code }, headers: h });
    }
  } catch (e) {
    if (e instanceof APIError) return { error: useBackup ? "That backup code is not valid." : "That code is not valid. Check your phone’s time and try again." };
    throw e;
  }
  await flash("success", "Signed in", "Two-step verification confirmed.");
  redirect(safeNext(form.get("next")));
}

export async function requestResetAction(_: FormState, form: FormData): Promise<FormState> {
  const email = z.email().safeParse(String(form.get("email") ?? "").trim().toLowerCase());
  if (!email.success) return { error: "Enter a valid email address." };
  const h = await headers();
  const r = await hit(db, `reset:${email.data}`, LOGIN_LIMITS.otpSend);
  if (r.allowed) {
    try {
      await auth.api.requestPasswordReset({ body: { email: email.data, redirectTo: "/reset-password" }, headers: h });
    } catch (e) {
      if (!(e instanceof APIError)) throw e;
    }
  }
  // Same answer whether or not the account exists.
  return { ok: "If that email belongs to an account, a reset link is on its way. It expires in 30 minutes." };
}

export async function resetPasswordAction(_: FormState, form: FormData): Promise<FormState> {
  const token = String(form.get("token") ?? "");
  const password = String(form.get("password") ?? "");
  if (password !== String(form.get("confirm") ?? "")) return { error: "The two passwords don’t match." };
  const { passwordProblem } = await import("@/server/auth/password");
  const problem = passwordProblem(password);
  if (problem) return { error: problem };
  try {
    await auth.api.resetPassword({ body: { token, newPassword: password }, headers: await headers() });
  } catch (e) {
    if (e instanceof APIError) return { error: "This reset link has expired or was already used. Request a new one." };
    throw e;
  }
  await flash("success", "Password changed", "Sign in with your new password.");
  redirect("/login?reset=1");
}

export async function signOutAction() {
  await auth.api.signOut({ headers: await headers() });
  await flash("info", "You’ve signed out", "Your session has ended on this device.");
  redirect("/login");
}

// ───────── Member self-service: phone + SMS code ─────────

export type PhoneState = { error?: string; ok?: string; phone?: string; step?: "phone" | "code" } | undefined;

const GENERIC_SENT = "If this number is in the church register, a 6-digit code is on its way by SMS. It expires in 5 minutes.";

export async function requestPhoneCodeAction(_: PhoneState, form: FormData): Promise<PhoneState> {
  const typed = String(form.get("phone") ?? "").trim();
  if (form.get("privacy") !== "on") return { error: "Please read and accept the privacy notice to continue.", phone: typed, step: "phone" };
  const { provisionMemberLogin } = await import("@/server/selfservice/service");
  const h = await headers();
  for (const [key, limit] of [[`otp:ip:${ipOf(h)}`, LOGIN_LIMITS.perIp], [`otp:phone:${typed.replace(/\D/g, "").slice(-9)}`, LOGIN_LIMITS.otpSend]] as const) {
    const r = await hit(db, key, limit);
    if (!r.allowed) return { error: waitMessage(r.retryAfterSeconds), phone: typed, step: "phone" };
  }
  const to = await provisionMemberLogin(db, typed);
  if (to) {
    try {
      await auth.api.sendPhoneNumberOTP({ body: { phoneNumber: to }, headers: h });
    } catch (e) {
      console.error("OTP send failed", e instanceof Error ? e.message : e);
      return { error: "We couldn’t send the SMS just now. Please try again in a few minutes.", phone: typed, step: "phone" };
    }
  }
  return { ok: GENERIC_SENT, phone: typed, step: "code" };
}

export async function verifyPhoneCodeAction(_: PhoneState, form: FormData): Promise<PhoneState> {
  const typed = String(form.get("phone") ?? "").trim();
  const code = String(form.get("code") ?? "").replace(/\s/g, "");
  const h = await headers();
  const r = await hit(db, `otpv:ip:${ipOf(h)}`, LOGIN_LIMITS.totp);
  if (!r.allowed) return { error: waitMessage(r.retryAfterSeconds), phone: typed, step: "code" };
  if (!/^\d{6}$/.test(code)) return { error: "Enter the 6-digit code from the SMS.", phone: typed, step: "code" };
  const { normalizeUgPhone } = await import("@/lib/phone");
  const e164 = normalizeUgPhone(typed)?.e164;
  try {
    if (!e164) throw new APIError("BAD_REQUEST");
    await auth.api.verifyPhoneNumber({ body: { phoneNumber: e164, code }, headers: h });
  } catch (e) {
    if (e instanceof APIError) {
      await new AuditWriter(db, { userId: null, label: "Phone sign-in", ipAddress: ipOf(h) }, "SELF_SERVICE").log({ action: "LOGIN_FAILED", entity: "User", note: "Wrong or expired SMS code" });
      return { error: "That code is wrong or has expired. Check the SMS or ask for a new code.", phone: typed, step: "code" };
    }
    throw e;
  }
  await flash("success", "Signed in", "Welcome to your church record.");
  redirect("/me");
}
