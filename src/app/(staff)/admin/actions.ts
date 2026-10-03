"use server";

import { revalidatePath } from "next/cache";
import type { ListType } from "@/generated/prisma/client";
import type { RoleKey, Scope } from "@/server/authz/catalog";
import { attempt } from "@/server/action-result";
import { addListItem, renameListItem, setListItemActive } from "@/server/admin/lists";
import { setPermission, setRoleRequire2fa } from "@/server/admin/roles";
import { adminCreateUser, resetUserTwoFactor, revokeSessions, setUserActive, updateUserAccess } from "@/server/admin/users";
import { requireContext, requirePermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { setPhotoRequired } from "@/server/settings/completeness";

export type RulesState = { ok?: string; error?: string } | undefined;

export async function setPhotoRequiredAction(_: RulesState, form: FormData): Promise<RulesState> {
  const ctx = await requirePermission("admin.lists", "manage");
  const required = form.get("photoRequired") === "on";
  const { changed } = await setPhotoRequired(db, ctx, required);
  revalidatePath("/", "layout");
  return {
    ok: `${required ? "Photo now counts" : "Photo no longer counts"} toward completeness. ${changed.toLocaleString("en-UG")} member scores updated.`,
  };
}

// Every action re-checks permissions inside the service; requireContext only resolves the user.

export async function createUserAction(input: { name: string; email: string; password: string; roles: RoleKey[]; ministryIds: string[] }) {
  const ctx = await requireContext();
  return attempt(async () => {
    await adminCreateUser(db, ctx, input);
    return { message: `${input.name} can now sign in with ${input.email}.` };
  });
}

export async function updateAccessAction(userId: string, roles: RoleKey[], ministryIds: string[]) {
  const ctx = await requireContext();
  return attempt(async () => {
    await updateUserAccess(db, ctx, userId, { roles, ministryIds });
    return { message: "Access updated. They’ll need to sign in again." };
  });
}

export async function setUserActiveAction(userId: string, active: boolean) {
  const ctx = await requireContext();
  return attempt(async () => {
    await setUserActive(db, ctx, userId, active);
    return { message: active ? "Account reactivated." : "Account deactivated and signed out." };
  });
}

export async function resetTwoFactorAction(userId: string) {
  const ctx = await requireContext();
  return attempt(async () => {
    await resetUserTwoFactor(db, ctx, userId);
    return { message: "Two-step verification reset." };
  });
}

export async function revokeSessionsAction(target: { userId?: string; sessionId?: string }) {
  const ctx = await requireContext();
  return attempt(async () => {
    await revokeSessions(db, ctx, target);
    return { message: "Signed out." };
  });
}

export async function setPermissionAction(roleId: string, resource: string, action: string, scope: Scope | null) {
  const ctx = await requireContext();
  return attempt(async () => {
    await setPermission(db, ctx, { roleId, resource, action, scope });
  });
}

export async function setRequire2faAction(roleId: string, required: boolean) {
  const ctx = await requireContext();
  return attempt(async () => {
    await setRoleRequire2fa(db, ctx, roleId, required);
  });
}

export async function addListItemAction(type: ListType, label: string) {
  const ctx = await requireContext();
  return attempt(async () => {
    const item = await addListItem(db, ctx, type, label);
    return { message: `Added “${item.label}”.` };
  });
}

export async function renameListItemAction(id: string, label: string) {
  const ctx = await requireContext();
  return attempt(async () => {
    await renameListItem(db, ctx, id, label);
    return { message: "Renamed." };
  });
}

export async function setListItemActiveAction(id: string, active: boolean) {
  const ctx = await requireContext();
  return attempt(async () => {
    await setListItemActive(db, ctx, id, active);
  });
}
