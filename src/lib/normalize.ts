/** Grouping key for non-standard values: "N/A " → "na", "Nill" → "nill". */
export function normalizeValue(v: string): string {
  return v
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(zone|ministry|dept|department)\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

/** Values the register uses to mean "nothing recorded". */
const BLANK_TOKENS = new Set([
  "", "nil", "nill", "non", "none", "na", "nan", "null", "notapplicable", "notgiven",
  "notmentioned", "notdisclosed", "unidentified", "unknown", "notrecorded", "-",
]);

export function isBlankToken(v: string): boolean {
  return BLANK_TOKENS.has(normalizeValue(v));
}

/** "  mukasa   nambi " → "Mukasa Nambi" (keeps Mc/O' simple). */
export function titleCaseName(v: string): string {
  return v
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/(^|[\s\-'])([a-z])/g, (_, p, c) => p + c.toUpperCase());
}

/** Levenshtein distance, used for typo-tolerant list matching. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

/**
 * Match a free-text value to a controlled-list label. Exact normalised match
 * first, then a small typo allowance (1 edit for short words, 2 for longer).
 */
export function matchListLabel(value: string, labels: string[], aliases: Record<string, string> = {}): string | null {
  const n = normalizeValue(value);
  if (!n) return null;
  if (aliases[n]) return aliases[n];
  const byNorm = new Map(labels.map((l) => [normalizeValue(l), l]));
  const exact = byNorm.get(n);
  if (exact) return exact;
  let best: { label: string; d: number } | null = null;
  for (const [k, label] of byNorm) {
    const d = editDistance(n, k);
    const allowed = k.length <= 5 ? 1 : 2;
    if (d <= allowed && (!best || d < best.d)) best = { label, d };
  }
  return best?.label ?? null;
}
