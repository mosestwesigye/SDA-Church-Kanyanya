"use server";

import { revalidatePath } from "next/cache";
import { attempt } from "@/server/action-result";
import { requireContext } from "@/server/auth/session";
import { markReturnSent, reopenReturn, returnDetail, setDateReceived, setReturnFigure, setSabbathAttendance, type LineKey, type Period } from "@/server/conference/service";
import { db } from "@/server/db";

const refresh = () => revalidatePath("/conference");

export async function setFigureAction(period: Period, key: LineKey, value: string, reason: string) {
  const ctx = await requireContext();
  return attempt(async () => {
    await setReturnFigure(db, ctx, period, { key, value: value.trim() === "" ? null : value, reason });
    refresh();
    return { message: value.trim() === "" ? "Back to the register figure." : "Figure saved." };
  });
}

export async function setAttendanceAction(sabbath: string, count: string) {
  const ctx = await requireContext();
  return attempt(async () => {
    await setSabbathAttendance(db, ctx, { sabbath, count: count.trim() === "" ? null : count });
    refresh();
    return { message: count.trim() === "" ? "Attendance cleared." : "Attendance saved." };
  });
}

export async function markSentAction(period: Period, dateSent: string, pastorName: string) {
  const ctx = await requireContext();
  return attempt(async () => {
    await markReturnSent(db, ctx, period, { dateSent, pastorName });
    refresh();
    return { message: "Return marked as sent. Its figures are now locked." };
  });
}

export async function reopenAction(period: Period, reason: string) {
  const ctx = await requireContext();
  return attempt(async () => {
    await reopenReturn(db, ctx, period, reason);
    refresh();
    return { message: "Return reopened for correction." };
  });
}

export async function dateReceivedAction(period: Period, date: string) {
  const ctx = await requireContext();
  return attempt(async () => {
    await setDateReceived(db, ctx, period, date || null);
    refresh();
    return { message: date ? "Date received saved." : "Date received cleared." };
  });
}

export async function detailAction(period: Period, key: LineKey) {
  const ctx = await requireContext();
  return returnDetail(db, ctx, period, key);
}
