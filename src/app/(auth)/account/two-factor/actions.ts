"use server";

import { APIError } from "better-auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { AuditWriter } from "@/server/audit/audit";
import { auth } from "@/server/auth/auth";
import { requireContext } from "@/server/auth/session";
import { db } from "@/server/db";

export type EnrolState =
  | { step: "password"; error?: string }
  | { step: "scan"; qrSvg: string; secret: string; totpURI: string; backupCodes: string[]; error?: string };

/** Single action for both steps so the scan state is carried between attempts. */
export async function enrolAction(prev: EnrolState, form: FormData): Promise<EnrolState> {
  return form.get("intent") === "confirm" ? confirmEnrol(prev, form) : startEnrol(form);
}

async function startEnrol(form: FormData): Promise<EnrolState> {
  await requireContext({ allowWithout2fa: true });
  try {
    const res = await auth.api.enableTwoFactor({ body: { password: String(form.get("password") ?? "") }, headers: await headers() });
    if (res.method !== "totp") throw new Error("Unexpected two-factor method");
    const secret = new URL(res.totpURI).searchParams.get("secret") ?? "";
    const qrSvg = await QRCode.toString(res.totpURI, { type: "svg", margin: 1, width: 200 });
    return { step: "scan", qrSvg, secret, totpURI: res.totpURI, backupCodes: res.backupCodes };
  } catch (e) {
    if (e instanceof APIError) return { step: "password", error: "That password is not correct." };
    throw e;
  }
}

async function confirmEnrol(prev: EnrolState, form: FormData): Promise<EnrolState> {
  const ctx = await requireContext({ allowWithout2fa: true });
  const code = String(form.get("code") ?? "").replace(/\s/g, "");
  try {
    await auth.api.verifyTOTP({ body: { code }, headers: await headers() });
  } catch (e) {
    if (e instanceof APIError && prev.step === "scan") return { ...prev, error: "That code didn’t match. Wait for a new code and try again." };
    throw e;
  }
  await new AuditWriter(db, { userId: ctx.userId, label: ctx.label, sessionId: ctx.sessionId, ipAddress: ctx.ipAddress }, "UI").log({
    action: "SECURITY",
    entity: "User",
    entityId: ctx.userId,
    field: "twoFactorEnabled",
    oldValue: false,
    newValue: true,
  });
  redirect("/dashboard");
}
