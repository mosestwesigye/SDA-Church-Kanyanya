export type FieldChange = { field: string; oldValue: unknown; newValue: unknown };

function normalise(v: unknown): unknown {
  if (v === undefined || v === "") return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return v.map(normalise);
  return v;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(normalise(a)) === JSON.stringify(normalise(b));
}

/**
 * Field-level diff between two flat records. Only keys present in `after`
 * are compared (a patch), unless `keys` is given. Bookkeeping columns are
 * ignored.
 */
export function diffRecords(
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
  keys: string[] = Object.keys(after),
): FieldChange[] {
  const IGNORE = new Set(["updatedAt", "createdAt", "version", "completeness", "missingFields"]);
  const changes: FieldChange[] = [];
  for (const k of keys) {
    if (IGNORE.has(k)) continue;
    const o = before ? before[k] : null;
    const n = after[k];
    if (!same(o, n)) changes.push({ field: k, oldValue: normalise(o), newValue: normalise(n) });
  }
  return changes;
}

export function toJsonValue(v: unknown): unknown {
  return normalise(v);
}
