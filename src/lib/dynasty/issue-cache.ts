// Per-week issue cache (see design Q3). Keyed by (dynasty, year, week) so the token cost
// of auto-population is once per in-game week, not once per app-open: reopening the app
// that same week reads straight from here, spends nothing, and paints instantly.
//
// Stored in its own Tauri store file, separate from settings. A small recency index
// bounds the file so a long dynasty doesn't grow it without limit.

import { LazyStore } from "@tauri-apps/plugin-store";

export type TabStatus = "generating" | "ready" | "error";

export interface TabState<T = unknown> {
  status: TabStatus;
  data: T | null;
  error: string | null;
  generatedAt: number | null;
}

export interface Issue {
  key: string;
  dynastyId: string;
  year: number;
  week: number;
  createdAt: number;
  updatedAt: number;
  /** Keyed by tabCacheKey(kind, extra) — see issue.ts. */
  tabs: Record<string, TabState>;
}

const store = new LazyStore("dynastywire.issues.json");
const INDEX_KEY = "__index";
const ISSUE_PREFIX = "issue::";
// How many weekly issues to keep. This is the backing store for the Archive browser, so it
// holds several seasons rather than one — it's a few hundred KB of local JSON, and losing
// old weeks is exactly what users asked us to stop doing.
const MAX_ISSUES = 90;

export function issueKey(dynastyId: string, year: number, week: number): string {
  return `${dynastyId}::${year}::${week}`;
}

export function newIssue(
  key: string,
  dynastyId: string,
  year: number,
  week: number
): Issue {
  const now = Date.now();
  return { key, dynastyId, year, week, createdAt: now, updatedAt: now, tabs: {} };
}

export async function loadIssue(key: string): Promise<Issue | null> {
  return (await store.get<Issue>(ISSUE_PREFIX + key)) ?? null;
}

/**
 * Load a week's issue, clearing tabs that were left mid-write.
 *
 * A tab is seeded `generating` before its request goes out and resolved when it comes back.
 * If the process dies in between — the updater swapping the exe and relaunching, a crash, or
 * simply the hard page navigation the nav uses on every tab switch — that seed is never
 * resolved and the tab reads "writing…" forever. A tester watched exactly this across an
 * update: the issue sat queued, and only started moving again once something happened to
 * re-trigger the pass.
 *
 * Any `generating` tab found at LOAD time is stale by construction: nothing can still be in
 * flight, because whatever was generating it no longer exists. So drop it — the week reads
 * honestly as not-yet-written, and auto-write picks it up instead of skipping a tab that
 * looks busy.
 */
export async function loadIssueLive(key: string): Promise<Issue | null> {
  const issue = await loadIssue(key);
  if (!issue) return null;
  const stale = Object.keys(issue.tabs).filter((k) => issue.tabs[k]?.status === "generating");
  if (!stale.length) return issue;
  for (const k of stale) delete issue.tabs[k];
  await persist(issue);
  return issue;
}

/**
 * Every stored issue for a dynasty, newest week first — the backing list for the Archive.
 * Pregame editions (key suffix "::pre") are folded out: the archive shows the week as it
 * finished, not the preview that preceded it.
 */
export async function listIssues(dynastyId: string): Promise<Issue[]> {
  const idx = (await store.get<string[]>(INDEX_KEY)) ?? [];
  const out: Issue[] = [];
  for (const key of idx) {
    if (!key.startsWith(`${dynastyId}::`) || key.endsWith("::pre")) continue;
    const issue = await store.get<Issue>(ISSUE_PREFIX + key);
    if (issue) out.push(issue);
  }
  return out.sort((a, b) => b.year - a.year || b.week - a.week);
}

async function touchIndex(key: string): Promise<void> {
  const idx = (await store.get<string[]>(INDEX_KEY)) ?? [];
  const next = [key, ...idx.filter((k) => k !== key)];
  for (const stale of next.slice(MAX_ISSUES)) {
    await store.delete(ISSUE_PREFIX + stale);
  }
  await store.set(INDEX_KEY, next.slice(0, MAX_ISSUES));
}

async function persist(issue: Issue): Promise<void> {
  issue.updatedAt = Date.now();
  await store.set(ISSUE_PREFIX + issue.key, issue);
  await touchIndex(issue.key);
  await store.save();
}

export async function saveIssue(issue: Issue): Promise<void> {
  await persist(issue);
}

/** Read one tab's cached state, or null if this week hasn't written it yet. */
export async function readTab<T = unknown>(
  key: string,
  tabKey: string
): Promise<TabState<T> | null> {
  const issue = await loadIssue(key);
  return (issue?.tabs[tabKey] as TabState<T> | undefined) ?? null;
}

/** Write one tab's state, creating the issue record on first write. Returns the issue. */
export async function writeTab(
  key: string,
  tabKey: string,
  state: TabState,
  meta: { dynastyId: string; year: number; week: number }
): Promise<Issue> {
  const issue =
    (await loadIssue(key)) ?? newIssue(key, meta.dynastyId, meta.year, meta.week);
  issue.tabs[tabKey] = state;
  await persist(issue);
  return issue;
}

/** Drop a week's whole issue (used by "regenerate this week"'s force path via re-write). */
/** Wipe every cached weekly issue (all generated articles/shows/pressers, all dynasties). */
export async function clearAllIssues(): Promise<void> {
  await store.clear();
  await store.save();
}

export async function clearIssue(key: string): Promise<void> {
  await store.delete(ISSUE_PREFIX + key);
  const idx = (await store.get<string[]>(INDEX_KEY)) ?? [];
  await store.set(
    INDEX_KEY,
    idx.filter((k) => k !== key)
  );
  await store.save();
}
