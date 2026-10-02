"use server";

import { APIError } from "better-auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { AuditWriter } from "@/server/audit/audit";
import { auth } from "@/server/auth/auth";
import { clear, hit, LOGIN_LIMITS } from "@/server/auth/rate-limit";
import { db } from "@/server/db";

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
  redirect("/login?reset=1");
}

export async function signOutAction() {
  await auth.api.signOut({ headers: await headers() });
  redirect("/login");
}
