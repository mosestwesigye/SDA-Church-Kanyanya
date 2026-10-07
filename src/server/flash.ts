import { cookies } from "next/headers";
import { FLASH_COOKIE, type ToastKind } from "@/lib/toast";

/**
 * Queue a toast for the next page the browser shows. Use before `redirect()` in a server action,
 * where a client-side toast would be lost. Short-lived and readable by the page script; never put personal data in it.
 */
export async function flash(kind: ToastKind, title: string, description?: string) {
  (await cookies()).set(FLASH_COOKIE, JSON.stringify({ kind, title, description }), {
    path: "/",
    maxAge: 60,
    sameSite: "lax",
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
  });
}
