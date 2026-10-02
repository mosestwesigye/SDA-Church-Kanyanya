import type { DbOrTx } from "../db";

export type Limit = { max: number; windowSeconds: number };

export const LOGIN_LIMITS = {
  perAccount: { max: 5, windowSeconds: 15 * 60 },
  perIp: { max: 30, windowSeconds: 15 * 60 },
  totp: { max: 5, windowSeconds: 5 * 60 },
  otpSend: { max: 3, windowSeconds: 15 * 60 },
} satisfies Record<string, Limit>;

/**
 * Fixed-window counter stored in Postgres (works across serverless
 * instances on Vercel). Returns whether this attempt is allowed and how
 * long to wait if not.
 */
export async function hit(db: DbOrTx, key: string, limit: Limit, now = Date.now()): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const windowMs = limit.windowSeconds * 1000;
  const row = await db.rateLimit.findUnique({ where: { key } });
  if (!row || now - Number(row.lastRequest) > windowMs) {
    await db.rateLimit.upsert({
      where: { key },
      create: { key, count: 1, lastRequest: BigInt(now) },
      update: { count: 1, lastRequest: BigInt(now) },
    });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (row.count >= limit.max) {
    return { allowed: false, retryAfterSeconds: Math.ceil((Number(row.lastRequest) + windowMs - now) / 1000) };
  }
  // The window is anchored at the first attempt; keep lastRequest unchanged.
  await db.rateLimit.update({ where: { key }, data: { count: { increment: 1 } } });
  return { allowed: true, retryAfterSeconds: 0 };
}

export async function clear(db: DbOrTx, key: string): Promise<void> {
  await db.rateLimit.deleteMany({ where: { key } });
}
