import { getContext } from "@/server/auth/session";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { openDocument } from "@/server/members/documents";

/** Permission-checked download of a member photo or document. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext();
  if (!ctx) return new Response("Sign in required", { status: 401 });
  const { id } = await params;
  try {
    const { doc, file } = await openDocument(db, ctx, id);
    const inline = new URL(request.url).searchParams.get("download") !== "1";
    return new Response(Buffer.isBuffer(file.data) ? new Uint8Array(file.data) : (file.data as ReadableStream), {
      headers: {
        "Content-Type": doc.mimeType,
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${doc.fileName.replace(/[^\w.\- ]/g, "_")}"`,
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return new Response("Forbidden", { status: 403 });
    if (e instanceof NotFoundError) return new Response("Not found", { status: 404 });
    throw e;
  }
}
