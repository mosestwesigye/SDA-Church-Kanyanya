import { afterEach, describe, expect, it, vi } from "vitest";

const KEYS = ["BLOB_READ_WRITE_TOKEN", "BLOB_STORE_ID", "VERCEL"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

async function fresh(env: Partial<Record<(typeof KEYS)[number], string>>) {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
  vi.resetModules();
  return (await import("@/server/storage")).storage;
}

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("storage backend selection", () => {
  it("uses Vercel Blob for dashboard-connected stores (OIDC: BLOB_STORE_ID, no token)", async () => {
    const storage = await fresh({ VERCEL: "1", BLOB_STORE_ID: "store_test" });
    expect(storage().constructor.name).toBe("BlobStorage");
  });

  it("uses Vercel Blob with a read-write token", async () => {
    const storage = await fresh({ BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_test" });
    expect(storage().constructor.name).toBe("BlobStorage");
  });

  it("refuses local disk on Vercel with a clear message", async () => {
    const storage = await fresh({ VERCEL: "1" });
    expect(() => storage()).toThrow(/Connect a Vercel Blob store/);
  });

  it("uses local disk in development", async () => {
    const storage = await fresh({});
    expect(storage().constructor.name).toBe("LocalStorage");
  });
});
