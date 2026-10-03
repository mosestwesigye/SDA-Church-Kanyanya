import { describe, expect, it } from "vitest";
import { regionCheck } from "@/server/admin/regions";

describe("region check", () => {
  it("flags an app far from its Neon database", () => {
    const r = regionCheck({ VERCEL_REGION: "fra1", DATABASE_URL: "postgresql://u:p@ep-x-pooler.c-2.us-east-1.aws.neon.tech/db" } as never);
    expect(r).toEqual({ app: "fra1", database: "us-east-1", expected: "iad1", mismatch: true });
  });
  it("is quiet when they match or outside Vercel", () => {
    expect(regionCheck({ VERCEL_REGION: "fra1", DATABASE_URL: "postgresql://u:p@ep-x.eu-central-1.aws.neon.tech/db" } as never).mismatch).toBe(false);
    expect(regionCheck({ DATABASE_URL: "postgresql://localhost/db" } as never).mismatch).toBe(false);
  });
});
