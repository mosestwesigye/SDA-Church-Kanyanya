import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

export type Db = PrismaClient;
export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
export type DbOrTx = PrismaClient | Tx;

function create(url = process.env.DATABASE_URL): PrismaClient {
  if (!url) throw new Error("DATABASE_URL is not set");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}

const globalForDb = globalThis as unknown as { __sdakDb?: PrismaClient };

/** Shared client (one per server instance; reused across hot reloads). */
export const db: PrismaClient = globalForDb.__sdakDb ?? create();
if (process.env.NODE_ENV !== "production") globalForDb.__sdakDb = db;

export { create as createDbClient };
