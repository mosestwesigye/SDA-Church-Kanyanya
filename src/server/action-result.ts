import { ZodError } from "zod";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "./errors";

export type ActionResult<T = undefined> =
  | { ok: true; message?: string; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/** Run a server-action body and turn expected errors into a form-friendly result. */
export async function attempt<T>(fn: () => Promise<{ message?: string; data?: T } | void>): Promise<ActionResult<T>> {
  try {
    const r = (await fn()) ?? {};
    return { ok: true, message: r.message, data: r.data };
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, error: e.message, fieldErrors: e.fieldErrors };
    if (e instanceof ForbiddenError || e instanceof NotFoundError || e instanceof ConflictError) return { ok: false, error: e.message };
    if (e instanceof ZodError) {
      const fieldErrors: Record<string, string> = {};
      for (const i of e.issues) fieldErrors[String(i.path[0] ?? "form")] ??= i.message;
      return { ok: false, error: "Some fields need attention.", fieldErrors };
    }
    // Next.js redirects/not-found are thrown as errors and must propagate.
    if (e && typeof e === "object" && "digest" in e) throw e;
    console.error(e);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
