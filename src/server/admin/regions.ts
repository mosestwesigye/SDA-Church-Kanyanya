/** Neon (AWS) region → the Vercel function region in the same place. */
const AWS_TO_VERCEL: Record<string, string> = {
  "us-east-1": "iad1",
  "us-east-2": "cle1",
  "us-west-2": "pdx1",
  "eu-central-1": "fra1",
  "eu-west-2": "lhr1",
  "ap-southeast-1": "sin1",
  "ap-southeast-2": "syd1",
  "sa-east-1": "gru1",
};

/**
 * Where the app runs vs where the database lives. Every page makes several
 * database calls, so the two should be in the same region.
 */
export function regionCheck(env: NodeJS.ProcessEnv = process.env) {
  const app = env.VERCEL_REGION ?? null;
  let host = "";
  try {
    host = new URL(env.DATABASE_URL ?? "").hostname;
  } catch {}
  const aws = host.match(/\.([a-z]{2}-[a-z]+-\d)\.aws\.neon\.tech$/)?.[1] ?? null;
  const expected = aws ? (AWS_TO_VERCEL[aws] ?? null) : null;
  return { app, database: aws, expected, mismatch: Boolean(app && expected && app !== expected) };
}
