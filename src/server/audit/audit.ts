import { randomUUID } from "node:crypto";
import type { AuditAction, AuditSource, Prisma } from "@/generated/prisma/client";
import type { DbOrTx } from "../db";
import { diffRecords, toJsonValue, type FieldChange } from "./diff";

/** Who did it, from where. Built from the AuthContext or a system label. */
export type Actor = {
  userId: string | null;
  label: string;
  sessionId?: string | null;
  ipAddress?: string | null;
};

export const SYSTEM_ACTOR: Actor = { userId: null, label: "System" };

export type AuditEntry = {
  action: AuditAction;
  entity: string;
  entityId?: string | null;
  memberId?: string | null;
  field?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  note?: string | null;
};

/**
 * Writes audit rows. Always call with the same transaction client that makes
 * the change, so the change and its audit trail commit (or roll back) together.
 */
export class AuditWriter {
  readonly correlationId: string;

  constructor(
    private readonly tx: DbOrTx,
    private readonly actor: Actor,
    private readonly source: AuditSource,
    correlationId?: string,
  ) {
    this.correlationId = correlationId ?? randomUUID();
  }

  private row(e: AuditEntry): Prisma.AuditLogCreateManyInput {
    return {
      actorUserId: this.actor.userId,
      actorLabel: this.actor.label,
      source: this.source,
      action: e.action,
      entity: e.entity,
      entityId: e.entityId ?? null,
      memberId: e.memberId ?? null,
      field: e.field ?? null,
      oldValue: e.oldValue === undefined || e.oldValue === null ? undefined : (toJsonValue(e.oldValue) as Prisma.InputJsonValue),
      newValue: e.newValue === undefined || e.newValue === null ? undefined : (toJsonValue(e.newValue) as Prisma.InputJsonValue),
      ipAddress: this.actor.ipAddress ?? null,
      sessionId: this.actor.sessionId ?? null,
      correlationId: this.correlationId,
      note: e.note ?? null,
    };
  }

  async log(...entries: AuditEntry[]): Promise<void> {
    if (entries.length === 0) return;
    await this.tx.auditLog.createMany({ data: entries.map((e) => this.row(e)) });
  }

  /** One UPDATE row per changed field. Returns the changes written. */
  async logChanges(
    entity: string,
    entityId: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown>,
    opts: { memberId?: string | null; note?: string | null; keys?: string[] } = {},
  ): Promise<FieldChange[]> {
    const changes = diffRecords(before, after, opts.keys);
    await this.log(
      ...changes.map((c) => ({
        action: "UPDATE" as const,
        entity,
        entityId,
        memberId: opts.memberId ?? null,
        field: c.field,
        oldValue: c.oldValue,
        newValue: c.newValue,
        note: opts.note ?? null,
      })),
    );
    return changes;
  }
}
