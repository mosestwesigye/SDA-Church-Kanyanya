import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { phoneNumber, twoFactor } from "better-auth/plugins";
import { AuditWriter } from "../audit/audit";
import { db, type Db } from "../db";
import { sendEmail } from "../notify/email";
import { sendSms } from "../notify/sms";
import { hashPassword, verifyPassword } from "./password";

/** Idle timeout: a session expires after this many minutes without activity. */
export const SESSION_IDLE_MINUTES = Number(process.env.SESSION_IDLE_MINUTES ?? 30);

/** Google sign-in is offered only when both credentials are set. */
export const googleEnabled = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

export function createAuth(client: Db = db) {
  return betterAuth({
    appName: "SDAK Church Manager",
    secret: process.env.BETTER_AUTH_SECRET,
    // On Vercel the production URL is known; BETTER_AUTH_URL overrides it (e.g. a custom domain).
    baseURL: process.env.BETTER_AUTH_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : undefined),
    database: prismaAdapter(client, { provider: "postgresql" }),
    emailAndPassword: {
      enabled: true,
      // Staff accounts are created by an administrator, never by sign-up.
      disableSignUp: true,
      minPasswordLength: 10,
      password: { hash: hashPassword, verify: verifyPassword },
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 30 * 60,
      async sendResetPassword({ user, url }) {
        await sendEmail({
          to: user.email,
          subject: "Reset your SDAK Church Manager password",
          text: `Hello ${user.name},\n\nUse this link within 30 minutes to set a new password:\n${url}\n\nIf you did not ask for this, ignore this email.`,
        });
      },
    },
    // Google: only for people already known — staff by their account email, members by the email on their record.
    socialProviders: googleEnabled()
      ? { google: { clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET!, prompt: "select_account" } }
      : {},
    account: { accountLinking: { enabled: true, trustedProviders: ["google"], allowDifferentEmails: false } },
    session: {
      additionalFields: { secondFactorPending: { type: "boolean", defaultValue: false, input: false } },
      // Sliding idle timeout: each request older than updateAge extends expiry.
      expiresIn: SESSION_IDLE_MINUTES * 60,
      updateAge: Math.min(5 * 60, SESSION_IDLE_MINUTES * 30),
    },
    user: {
      additionalFields: {
        active: { type: "boolean", defaultValue: true, input: false },
        memberId: { type: "string", required: false, input: false },
      },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 15 * 60, max: 10 },
        "/two-factor/verify-totp": { window: 5 * 60, max: 5 },
        "/request-password-reset": { window: 15 * 60, max: 3 },
        "/phone-number/send-otp": { window: 15 * 60, max: 3 },
        "/phone-number/verify": { window: 5 * 60, max: 5 },
      },
    },
    databaseHooks: {
      user: {
        create: {
          // Logins are never self-registered: staff are added by an administrator and members are
          // provisioned from the register. The only sign-up allowed here is a Google sign-in whose
          // email is on exactly one member record.
          async before(user, ctx) {
            if (!ctx?.path?.startsWith("/callback/")) return false;
            const { memberForGoogleEmail } = await import("../selfservice/service");
            const memberId = await memberForGoogleEmail(client, user.email);
            if (!memberId) return false;
            return { data: { ...user, email: user.email.toLowerCase(), memberId, active: true } };
          },
          async after(user) {
            const { finishGoogleMemberLogin } = await import("../selfservice/service");
            await finishGoogleMemberLogin(client, user.id);
          },
        },
      },
      session: {
        create: {
          async before(session, ctx) {
            const user = await client.user.findUnique({ where: { id: session.userId }, select: { active: true, twoFactorEnabled: true } });
            if (!user?.active) return false;
            // Google skips the plugin's code step, so hold the session until the authenticator code is entered.
            if (ctx?.path?.startsWith("/callback/") && user.twoFactorEnabled) return { data: { ...session, secondFactorPending: true } };
          },
          async after(session, ctx) {
            const user = await client.user.update({ where: { id: session.userId }, data: { lastLoginAt: new Date() } });
            await new AuditWriter(client, { userId: user.id, label: user.name, sessionId: session.id, ipAddress: session.ipAddress }, "UI").log({
              action: "LOGIN",
              entity: "User",
              entityId: user.id,
              note: [ctx?.path?.startsWith("/callback/google") ? "Google sign-in" : null, session.userAgent].filter(Boolean).join(" · ") || null,
            });
          },
        },
      },
    },
    plugins: [
      twoFactor({ issuer: "SDAK Church Manager" }),
      // Member self-service: sign in with a one-time SMS code. Logins are
      // provisioned from the register first (src/server/selfservice), so the
      // plugin never signs up unknown numbers.
      phoneNumber({
        otpLength: 6,
        expiresIn: 5 * 60,
        allowedAttempts: 3,
        phoneNumberValidator: (n) => /^\+256\d{9}$/.test(n),
        async sendOTP({ phoneNumber: to, code }) {
          const user = await client.user.findUnique({ where: { phoneNumber: to }, select: { active: true } });
          if (!user?.active) return;
          await sendSms({ to, text: `${code} is your SDA Church Kanyanya sign-in code. It expires in 5 minutes. Don't share it with anyone.` });
        },
      }),
      nextCookies(),
    ],
  });
}

export const auth = createAuth();
export type Auth = ReturnType<typeof createAuth>;
