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

export function createAuth(client: Db = db) {
  return betterAuth({
    appName: "SDAK Church Manager",
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL,
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
    session: {
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
      session: {
        create: {
          async before(session) {
            const user = await client.user.findUnique({ where: { id: session.userId }, select: { active: true } });
            if (!user?.active) return false;
          },
          async after(session) {
            const user = await client.user.update({ where: { id: session.userId }, data: { lastLoginAt: new Date() } });
            await new AuditWriter(client, { userId: user.id, label: user.name, sessionId: session.id, ipAddress: session.ipAddress }, "UI").log({
              action: "LOGIN",
              entity: "User",
              entityId: user.id,
              note: session.userAgent ?? null,
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
