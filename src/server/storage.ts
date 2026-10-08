import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";

/**
 * File storage for photos and documents.
 * - Production (Vercel): private Vercel Blob store (BLOB_READ_WRITE_TOKEN).
 * - Development/tests: ./storage on local disk.
 * Files are never served directly; /api/files/[id] checks permissions first.
 */
export interface Storage {
  put(prefix: string, fileName: string, data: Buffer, contentType: string): Promise<string>;
  get(key: string): Promise<{ data: ReadableStream | Buffer; contentType: string } | null>;
  remove(key: string): Promise<void>;
}

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export const ALLOWED_UPLOAD_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
/** Vercel functions accept request bodies up to 4.5 MB; keep uploads under that. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

function safeName(fileName: string) {
  const ext = fileName.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  return `${randomUUID()}.${ext}`;
}

class LocalStorage implements Storage {
  constructor(private readonly root = join(process.cwd(), "storage")) {}
  private path(key: string) {
    const p = normalize(join(this.root, key));
    if (!p.startsWith(this.root)) throw new Error("Invalid storage key");
    return p;
  }
  async put(prefix: string, fileName: string, data: Buffer) {
    const key = `${prefix}/${safeName(fileName)}`;
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, data);
    return key;
  }
  async get(key: string) {
    try {
      const data = await readFile(this.path(key));
      return { data, contentType: MIME_BY_EXT[key.split(".").pop() ?? ""] ?? "application/octet-stream" };
    } catch {
      return null;
    }
  }
  async remove(key: string) {
    await rm(this.path(key), { force: true });
  }
}

class BlobStorage implements Storage {
  async put(prefix: string, fileName: string, data: Buffer, contentType: string) {
    const { put } = await import("@vercel/blob");
    const res = await put(`${prefix}/${safeName(fileName)}`, data, { access: "private", contentType, addRandomSuffix: false });
    return res.pathname;
  }
  async get(key: string) {
    const { get } = await import("@vercel/blob");
    const res = await get(key, { access: "private" });
    if (!res || res.statusCode !== 200 || !res.stream) return null;
    return { data: res.stream, contentType: res.blob.contentType };
  }
  async remove(key: string) {
    const { del } = await import("@vercel/blob");
    await del(key);
  }
}

let instance: Storage | null = null;
export function storage(): Storage {
  if (instance) return instance;
  // Blob stores connected through the Vercel dashboard authenticate with OIDC
  // (BLOB_STORE_ID + the runtime's VERCEL_OIDC_TOKEN); older ones use a token.
  if (process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID) instance = new BlobStorage();
  else if (process.env.VERCEL) {
    // Vercel's disk is read-only: fail with a clear message instead of an EROFS error.
    throw new Error("File storage is not configured. Connect a Vercel Blob store to this project (Storage → Blob) and redeploy.");
  } else instance = new LocalStorage();
  return instance;
}

/** Check magic bytes so a renamed file can't pass as an image/PDF. */
export function sniffType(buf: Buffer): string | null {
  if (buf.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") return "image/webp";
  if (buf.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  return null;
}
