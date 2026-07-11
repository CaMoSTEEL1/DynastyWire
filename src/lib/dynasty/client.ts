// Frontend data layer for the standalone app. Replaces the Supabase-backed data flow:
// the source of truth is the parsed save (via the Tauri command bridge in src-tauri),
// and local settings/cache live in the Tauri store — no server, no accounts.

import { invoke } from "@tauri-apps/api/core";
import { LazyStore } from "@tauri-apps/plugin-store";

// ---- Types (mirror the ingest sidecar output; see ingest/snapshot.js, diff.js) ----

export interface TeamInfo {
  row: number;
  teamIndex: number | null;
  name: string;
  nickname: string | null;
  city: string | null;
  wins: number;
  losses: number;
  confWins: number | null;
  confLosses: number | null;
  rankMedia: number | null;
  rankCoaches: number | null;
  rankCFP: number | null;
  prestige: number | null;
  ratingOVR: number | null;
}

export interface GameResult {
  week: number | null;
  home: string;
  away: string;
  homeScore: number | null;
  awayScore: number | null;
  winner: string;
  loser: string;
  margin: number;
  rankHome: number | null;
  rankAway: number | null;
  userInvolved: boolean;
  simmed: boolean | null;
}

export interface DynastySnapshot {
  week: number | null;
  tableCount: number;
  userTeamRow: number | null;
  userTeam: TeamInfo | null;
  teams: Record<string, TeamInfo>;
  games: unknown[];
}

export interface WeekDelta {
  weekPlayed: number | null;
  userTeam: string | null;
  gamesPlayed: number;
  userResult: GameResult | null;
  results: GameResult[];
  rankingMoves: { team: string; from: number | null; to: number | null; delta: number }[];
}

export interface MediaCycle {
  recap: { headline: string; byline: string; body: string; pullQuote: string } | null;
  beatTakes: { headline: string; takes: { number: number; title: string; body: string }[] } | null;
  social: { posts: { handle: string; displayName: string; type: string; body: string; likes: number; reposts: number }[] } | null;
  rankings: { headline: string; body: string; movement: string } | null;
}

// ---- Command bridge (Tauri invoke → src-tauri → parser/sidecar) ----

/** Fast native check; resolves to the save's internal name, or throws. */
export function validateSave(path: string): Promise<string> {
  return invoke<string>("validate_save", { path });
}

export async function getSnapshot(savePath: string, team?: string): Promise<DynastySnapshot> {
  return JSON.parse(await invoke<string>("dynasty_snapshot", { savePath, team: team ?? null }));
}

export async function getDelta(beforePath: string, afterPath: string, team?: string): Promise<WeekDelta> {
  return JSON.parse(
    await invoke<string>("dynasty_delta", { beforePath, afterPath, team: team ?? null })
  );
}

export async function getMedia(
  beforePath: string,
  afterPath: string,
  apiKey: string,
  team?: string,
  coach?: string
): Promise<MediaCycle> {
  return JSON.parse(
    await invoke<string>("dynasty_media", {
      beforePath,
      afterPath,
      team: team ?? null,
      coach: coach ?? null,
      apiKey,
    })
  );
}

/**
 * Generic per-kind generation (press-conference, nil, offseason, shows, trophy, …).
 * Each `kind` maps to ingest/gen/<kind>.js in the sidecar. `extra` is feature options.
 */
export async function generate<T = unknown>(
  kind: string,
  beforePath: string,
  afterPath: string,
  apiKey: string,
  opts: { team?: string; coach?: string; extra?: Record<string, unknown> } = {}
): Promise<T> {
  return JSON.parse(
    await invoke<string>("dynasty_generate", {
      kind,
      beforePath,
      afterPath,
      team: opts.team ?? null,
      coach: opts.coach ?? null,
      extra: opts.extra ? JSON.stringify(opts.extra) : null,
      apiKey,
    })
  );
}

export interface SaveEntry {
  name: string;
  path: string;
  modified: number;
}

/** Dynasty saves in a folder, newest first. */
export function listSaves(folder: string): Promise<SaveEntry[]> {
  return invoke<SaveEntry[]>("list_saves", { folder });
}

/** Copy a save into the app archive so the next ingest has a "before" to diff. */
export function archiveSave(path: string, archiveDir: string, label: string): Promise<string> {
  return invoke<string>("archive_save", { path, archiveDir, label });
}

// ---- Local settings + cache (Tauri store) ----

export interface DynastySettings {
  savesFolder: string | null; // .../EA SPORTS College Football 27/saves
  userTeam: string | null; // confirmed at setup (auto-detect is unreliable)
  coachName: string | null;
  anthropicKey: string | null; // BYO-key, stored locally only
  elevenLabsKey: string | null;
}

const store = new LazyStore("dynastywire.settings.json");

export async function loadSettings(): Promise<DynastySettings> {
  return {
    savesFolder: (await store.get<string>("savesFolder")) ?? null,
    userTeam: (await store.get<string>("userTeam")) ?? null,
    coachName: (await store.get<string>("coachName")) ?? null,
    anthropicKey: (await store.get<string>("anthropicKey")) ?? null,
    elevenLabsKey: (await store.get<string>("elevenLabsKey")) ?? null,
  };
}

export async function saveSettings(patch: Partial<DynastySettings>): Promise<void> {
  for (const [k, v] of Object.entries(patch)) await store.set(k, v);
  await store.save();
}

/** Cache the last-ingested snapshot path so the watcher/diff has a "before" to compare. */
export async function setLastIngested(path: string): Promise<void> {
  await store.set("lastIngestedPath", path);
  await store.save();
}
export async function getLastIngested(): Promise<string | null> {
  return (await store.get<string>("lastIngestedPath")) ?? null;
}
