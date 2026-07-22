// The "Weekly Issue" model (see design Q3). An issue is the full set of media the Wire
// writes for one in-game week. These are pure helpers — no React, no Tauri — shared by
// the dynasty context (orchestrator + cache-through generate) and any UI that reads an
// issue. The cache itself lives in issue-cache.ts.

export interface IssueTabDef {
  /** Generation kind — maps to ingest/gen/<kind>.js via the Tauri bridge. */
  kind: string;
  /** Human label for the loading screen / progress list. */
  label: string;
}

// The tabs written eagerly in the background pass, in the order the reader meets them.
// These are the "this week's news" sections with no per-visit variant. Variant-driven
// tabs (shows/showType, offseason/phase) and season-long tabs (trophy, nil, carousel)
// stay lazy — but still flow through the same cache-through generate(), so they're
// written once per week on first visit and instant thereafter.
export const ISSUE_TABS: IssueTabDef[] = [
  { kind: "recap-lead", label: "Front Page" },
  { kind: "national-wire", label: "Around the League" },
  { kind: "national-desk", label: "National Desk" },
  { kind: "social", label: "Social Reactions" },
  { kind: "rankings", label: "Rankings" },
  { kind: "press-conference", label: "Press Conference" },
  { kind: "recruiting", label: "Recruiting" },
];

// The lean default for budget mode: the sections nearly everyone reads every week. The
// rest still generate lazily on first visit — deferred, never lost.
const CORE_TAB_KINDS = new Set(["recap-lead", "social", "rankings"]);

/**
 * The sections the weekly auto-write actually generates, resolved from settings:
 * - the user's explicit per-section checkboxes win when set (autoGenerateTabs);
 * - otherwise budget mode auto-writes the core trio, full mode auto-writes everything.
 * Anything not in this list still generates on demand when its tab is opened.
 */
export function eagerTabs(settings: {
  budgetMode?: boolean | null;
  autoGenerateTabs?: string[] | null;
}): IssueTabDef[] {
  const picked = settings.autoGenerateTabs;
  if (Array.isArray(picked)) {
    const set = new Set(picked);
    return ISSUE_TABS.filter((t) => set.has(t.kind));
  }
  const budget = settings.budgetMode !== false; // null/undefined = budget on (default)
  return budget ? ISSUE_TABS.filter((t) => CORE_TAB_KINDS.has(t.kind)) : ISSUE_TABS;
}

// Kinds whose output is answer-specific / interactive and must NEVER be served from a
// per-week cache (e.g. grading the user's own press-conference answer).
// - storyline-fallout: fallout of a specific decision the coach made
// - player-text: a live reply in the coach↔player thread
const NON_CACHEABLE = new Set<string>([
  "press-conference-grade",
  "storyline-fallout",
  "player-text",
  "coach-backstory",
  "recruit-text",
  "podium-answer",
]);

export function isCacheable(kind: string): boolean {
  return !NON_CACHEABLE.has(kind);
}

// Internal option keys that steer generate() but must not reach the generator's extra
// (they aren't part of the content's identity). `backstory` is injected globally by the
// dynasty context (opts.backstory) — pages that also pass it in extra must not duplicate it.
const INTERNAL_KEYS = new Set<string>(["__force", "backstory"]);

// Keys that DO reach the generator (they steer the prompt) but must NOT be part of the
// cache key — large data blobs whose presence shouldn't fork a per-week cache entry:
// the league-wide portal board and highlight screenshots. The content still caches by its
// real identity (kind + showType/phase).
const KEY_IGNORED_KEYS = new Set<string>(["portalData", "images", "commits", "oppRoster"]);

/** Strip internal steering keys, returning undefined when nothing meaningful remains. */
export function cleanExtra(
  extra?: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (!extra) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(extra)) {
    if (!INTERNAL_KEYS.has(k)) out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Deterministic JSON so a variant's cache key is stable regardless of key order. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/**
 * The per-tab cache key within an issue. No-variant tabs key on the kind alone;
 * variant tabs (offseason phase, show type) fold the variant in so each is cached
 * separately for the same week.
 */
export function tabCacheKey(kind: string, extra?: Record<string, unknown>): string {
  const clean = cleanExtra(extra);
  if (!clean) return kind;
  // Drop large steering blobs from the KEY only — they feed the generator but aren't part
  // of the content's cache identity.
  const forKey: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(clean)) {
    if (!KEY_IGNORED_KEYS.has(k)) forKey[k] = v;
  }
  return Object.keys(forKey).length > 0 ? `${kind}::${stableStringify(forKey)}` : kind;
}
