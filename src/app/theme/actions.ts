"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

export type ThemeChoice = "system" | "light" | "dark";

export async function setThemeAction(choice: ThemeChoice) {
  const jar = await cookies();
  if (choice === "system") jar.delete("theme");
  else jar.set("theme", choice, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  revalidatePath("/", "layout");
}
