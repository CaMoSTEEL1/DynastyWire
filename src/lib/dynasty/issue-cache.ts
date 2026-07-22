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
// Keep a season-and-change of issues; older ones are pruned when a new one is written.
const MAX_ISSUES = 20;

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
