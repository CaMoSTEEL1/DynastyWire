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
  ties?: number | null;
  confWins: number | null;
  confLosses: number | null;
  rankMedia: number | null;
  rankCoaches: number | null;
  rankCFP: number | null;
  prestige: number | null;
  ratingOVR: number | null;
  // Dynasty "points" economy (user team only).
  pointBudget?: number | null;
  pointsRemaining?: number | null;
  nilPointsSpent?: number | null;
  brandExposurePoints?: number | null;
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

export interface CoachInfo {
  teamIndex: number | null;
  coachName: string | null;
  /** 'HeadCoach' | 'OffensiveCoordinator' | 'DefensiveCoordinator' — the user's actual job. */
  position?: string | null;
  archetype?: string | null;
  jobSecurity: string | null;
  fireReported: boolean | null;
  performanceLevel: number | null;
  age: number | null;
  awardPoints: number | null;
  careerWinSeasons: number | null;
  careerPlayoffs: number | null;
  careerLongWinStreak: number | null;
}

export interface Recruit {
  name: string;
  position: string | null;
  overall: number | null;
  stars: number | null;
  commitScore: number | null;
  nationalRank: number | null;
  positionRank: number | null;
  stateRank: number | null;
  class: string | null;
  stage: string | null;
  // User recruiting-board state (from UserRecruitTarget). onBoard = you're recruiting him;
  // committedToUser = he's committed to your program.
  onBoard?: boolean;
  committedToUser?: boolean;
  scholarship?: string | null;
  nilOffer?: number | null;
  isFavorite?: boolean | null;
  boardInfluence?: number | null;
}

export interface SnapshotGame {
  week: number | null;
  year: number | null;
  homeRow: number | null;
  awayRow: number | null;
  homeScore: number | null;
  awayScore: number | null;
  played: boolean;
  simmed: boolean | null;
}

export interface DynastyCalendar {
  /** "RegularSeason" | "BowlSeason1".."BowlSeason4" | "OffSeason" | ... */
  weekType: string | null;
  stage: string | null;
  postSeasonWeeks: number | null;
  regularSeasonLastWeek: number | null;
  confChampWeek: number | null;
  offseasonStage?: number | null;
  offseasonNumStages?: number | null;
}

export interface DynastySnapshot {
  week: number | null;
  year: number | null;
  dynastyYear: number | null;
  /** Real season calendar from SeasonInfo — drives playoff-round awareness. */
  calendar: DynastyCalendar | null;
  coachName: string | null;
  coach: CoachInfo | null;
  tableCount: number;
  userTeamRow: number | null;
  userTeam: TeamInfo | null;
  teams: Record<string, TeamInfo>;
  games: SnapshotGame[];
  /** Every program's REAL head coach from the save: teamIndex -> "First Last". */
  headCoaches?: Record<string, string>;
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

export async function getRecruits(savePath: string): Promise<Recruit[]> {
  const { recruits } = JSON.parse(await invoke<string>("dynasty_recruits", { savePath }));
  return recruits ?? [];
}

export interface PortalTransfer {
  name: string;
  team: string;
  teamRank: number | null;
  position: string | null;
  overall: number | null;
  year: string | null;
  chance: number;
  dealbreaker: string | null;
}
export interface PortalRisk {
  name: string;
  team: string;
  teamRank: number | null;
  position: string | null;
  overall: number | null;
  year: string | null;
  depth: number;
  starterOvr: number | null;
  dealbreaker: string | null;
  tier: "high" | "watch";
}
export interface PortalBoard {
  /** True once the in-game portal is open (postseason/offseason) with real chances. */
  active: boolean;
  transferred: PortalTransfer[];
  atRisk: PortalRisk[];
}

/** League-wide transfer-portal board built from real depth-chart + dealbreaker data. */
export async function getPortal(savePath: string): Promise<PortalBoard> {
  return JSON.parse(await invoke<string>("dynasty_portal", { savePath }));
}

export interface RosterStatsSide {
  gamesPlayed: number | null;
  gamesStarted: number | null;
  passYds?: number | null;
  passTDs?: number | null;
  passInts?: number | null;
  passComp?: number | null;
  passAtt?: number | null;
  rushYds?: number | null;
  rushAtt?: number | null;
  rushTDs?: number | null;
  rushLong?: number | null;
  recYds?: number | null;
  recTDs?: number | null;
  recCatches?: number | null;
  /** Return production — present on the KP-return flavour of the season stats table. */
  kickRetYds?: number | null;
  kickRetTDs?: number | null;
  puntRetYds?: number | null;
  puntRetTDs?: number | null;
  tackles?: number | null;
  tfl?: number | null;
  sacks?: number | null;
  ints?: number | null;
  deflections?: number | null;
  forcedFumbles?: number | null;
  // Kicking / punting (SeasonKickingStats).
  fgMade?: number | null;
  fgAtt?: number | null;
  fgLong?: number | null;
  fgMade50Plus?: number | null;
  fgAtt50Plus?: number | null;
  xpMade?: number | null;
  xpAtt?: number | null;
  gameWinners?: number | null;
  punts?: number | null;
  puntYds?: number | null;
  puntLong?: number | null;
  puntIn20?: number | null;
  puntBlocked?: number | null;
}

export interface RosterStats {
  side: "offense" | "defense" | "kicking";
  /** True when the player logged games on BOTH sides this season. */
  twoWay?: boolean;
  offense?: RosterStatsSide | null;
  defense?: RosterStatsSide | null;
  kicking?: RosterStatsSide | null;
  gamesPlayed: number | null;
  gamesStarted: number | null;
  passYds?: number | null;
  passTDs?: number | null;
  passInts?: number | null;
  passComp?: number | null;
  passAtt?: number | null;
  rushYds?: number | null;
  rushAtt?: number | null;
  rushTDs?: number | null;
  rushLong?: number | null;
  recYds?: number | null;
  recTDs?: number | null;
  recCatches?: number | null;
  kickRetYds?: number | null;
  kickRetTDs?: number | null;
  puntRetYds?: number | null;
  puntRetTDs?: number | null;
  tackles?: number | null;
  tfl?: number | null;
  sacks?: number | null;
  ints?: number | null;
  deflections?: number | null;
  forcedFumbles?: number | null;
}

export interface RosterPlayer {
  name: string;
  position: string | null;
  year: string | null;
  overall: number | null;
  jersey: number | null;
  /** Game-assigned personality: Unpredictable | Intense | TeamPlayer | Entertainer | Leader. */
  personality?: string | null;
  confidence?: number | null;
  redshirt?: string | null;
  injury?: string | null;
  /** NIL economy: intrinsic worth + current compensation (both from the save). */
  nilBaseValue?: number | null;
  nilComp?: number | null;
  dealbreaker?: string | null;
  /** Latest-season stat line (top-40 players only). */
  stats?: RosterStats | null;
}

/** A team's real roster. No teamIndex = the user's team; pass a teamIndex to read any
 * other program (e.g. this week's opponent). */
export async function getRoster(savePath: string, team?: string, teamIndex?: number): Promise<RosterPlayer[]> {
  const { roster } = JSON.parse(
    await invoke<string>("dynasty_roster", {
      savePath,
      team: team ?? null,
      teamIndex: teamIndex ?? null,
    })
  );
  return roster ?? [];
}

// ---- Consequence Sync (writes back into the save) ----

export interface ImpactPayload {
  teamIndex: number;
  confidence?: { name: string; value: number }[];
  programPointsDelta?: number;
  jobSecurityPct?: number | null;
  /** NIL allotment: set each player's CurrentNILCompensation. */
  nil?: { name: string; value: number }[];
  /** Suspensions: set a player's OverallRating (a temporary drop buries him on the depth
   * chart so the game benches him; the sidecar returns the before value for restoration). */
  overall?: { name: string; value: number }[];
}

export interface ImpactResult {
  ok: boolean;
  error?: string;
  detail?: string;
  verified?: boolean;
  applied?: {
    confidence?: { name: string; value: number }[];
    programPoints?: { before: number; after: number } | null;
    jobSecurity?: { before: number | null; after: number } | null;
    nil?: { name: string; before: number | null; after: number }[];
    overall?: { name: string; field: string; before: number | null; after: number }[];
  };
  backup?: string;
}

/** Write meter-driven consequences into the save. The sidecar refuses while the game is
 * running, backs the save up first, and verifies its writes by re-reading the file. */
export async function applyImpact(savePath: string, payload: ImpactPayload): Promise<ImpactResult> {
  return JSON.parse(
    await invoke<string>("dynasty_impact", { savePath, payload: JSON.stringify(payload) })
  );
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

/**
 * Native Claude call (Tauri command → Rust reqwest). Replaces the per-load Node sidecar
 * spawn: content is generated in-app from the already-parsed snapshot, so a screen/situation
 * load is a single HTTPS request with nothing spawning a process. Returns Claude's raw text.
 */
export function claudeComplete(
  apiKey: string,
  system: string,
  prompt: string,
  maxTokens?: number,
  model?: string,
  images?: string[],
  cachePrefix?: string
): Promise<string> {
  // NOTE: Tauri v2 exposes Rust snake_case params as camelCase to JS — argument keys here
  // MUST be camelCase or invoke rejects the call ("missing required key …").
  return invoke<string>("claude_complete", {
    apiKey,
    system,
    prompt,
    maxTokens: maxTokens ?? null,
    model: model ?? null,
    // Base64 screenshots (no data: prefix) for vision calls, e.g. highlight extraction.
    images: images && images.length ? images : null,
    // Shared week context, cached server-side across an issue's sections (≈90% off the
    // repeated input tokens when the tabs generate back-to-back).
    cachePrefix: cachePrefix ?? null,
  });
}

/**
 * OpenAI-compatible chat completion (OpenAI, OpenRouter, Groq, LM Studio, Ollama, …).
 * The user pastes their provider's v1 base URL + key + model name in settings.
 */
export function openaiComplete(
  baseUrl: string,
  apiKey: string,
  model: string,
  system: string,
  prompt: string,
  maxTokens?: number | null,
  images?: string[]
): Promise<string> {
  // camelCase keys required (see claude_complete note) — snake_case here broke EVERY
  // generation call for OpenAI-compatible users with "missing required key baseUrl".
  return invoke<string>("openai_complete", {
    baseUrl,
    apiKey,
    model,
    system,
    prompt,
    // null = omit max_tokens entirely (local reasoning models need an uncapped budget)
    maxTokens: maxTokens ?? null,
    images: images && images.length ? images : null,
  });
}

/** List the model ids an OpenAI-compatible endpoint offers for this key. */
export function openaiListModels(baseUrl: string, apiKey: string): Promise<string[]> {
  return invoke<string[]>("openai_list_models", { baseUrl, apiKey });
}

/** List the model ids Anthropic endpoint offers for this key. */
export function anthropicListModels(apiKey: string): Promise<string[]> {
  return invoke<string[]>("anthropic_list_models", { apiKey });
}

/** Which LLM transport to use, resolved from settings by the dynasty context. */
export interface LlmConfig {
  provider: "anthropic" | "openai";
  apiKey: string;
  /** openai provider only: the v1 base URL, e.g. https://api.openai.com/v1 */
  baseUrl?: string;
  /** openai provider only: model name, e.g. gpt-4o-mini */
  model?: string;
  /** openai provider only: omit max_tokens so local reasoning models aren't capped. */
  noMaxTokens?: boolean;
  /** Budget mode: use the cheaper model (Anthropic → Haiku) to slash per-week cost.
   * Defaults ON when unset — pass false explicitly for the premium model. */
  budgetMode?: boolean;
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

/**
 * One saved dynasty: an exact save FILE the user picked, plus its team/coach. Keyed by a
 * stable id so the Saga/issue cache follow the dynasty across renames. The app reads THIS
 * file (not "newest in the folder"), which is what keeps it from silently loading an
 * unrelated autosave.
 */
export interface DynastyProfile {
  id: string;
  label: string; // display name, e.g. "SKISWORLD — Kansas State"
  saveFile: string; // exact path to the dynasty save file
  userTeam: string | null;
  coachName: string | null;
}

export interface DynastySettings {
  // ---- Multi-dynasty (the source of truth going forward) ----
  dynasties: DynastyProfile[];
  activeDynastyId: string | null;
  // ---- Legacy single-save fields (kept for back-compat / migration) ----
  savesFolder: string | null; // .../EA SPORTS College Football 27/saves
  userTeam: string | null; // confirmed at setup (auto-detect is unreliable)
  coachName: string | null;
  // ---- Global (shared across dynasties) ----
  anthropicKey: string | null; // BYO-key, stored locally only
  elevenLabsKey: string | null;
  // OpenAI-compatible provider (optional alternative to the Anthropic key): any service
  // exposing a /v1/chat/completions endpoint — OpenAI, OpenRouter, Groq, local models.
  provider: "anthropic" | "openai" | null; // null = anthropic
  openaiBaseUrl: string | null;
  openaiKey: string | null;
  openaiModel: string | null;
  /** Omit max_tokens on OpenAI-compatible calls (for local reasoning models). */
  openaiNoMaxTokens: boolean | null;
  /** Hide exact recruit OVR on the board (immersion — you don't see true ratings IRL). */
  hideRecruitOverall: boolean | null;
  /** Consequence Sync: write meters back into the save (player confidence, program points,
   * job security). Opt-in — it modifies the save file (with automatic backups). */
  consequenceSync: boolean | null;
  /** Podcast audio: read shows aloud via ElevenLabs (needs the ElevenLabs key). Opt-in. */
  podcastAudio: boolean | null;
  /** Budget mode — cheaper model + leaner auto-write to cut API cost. null = ON (default). */
  budgetMode: boolean | null;
  // Weekly Issue auto-population (design Q3). Default-on: when a new in-game week is
  // ingested, the Wire writes the full issue in the background (one issue per week,
  // cached after). null is treated as on; false = generate on demand instead.
  autoGenerate: boolean | null;
  /** Which sections the weekly auto-write generates (issue-tab kinds). null = the default
   * set (all sections, or the core trio in budget mode). Sections left unchecked still
   * generate lazily when their tab is opened — nothing is lost, only deferred. */
  autoGenerateTabs: string[] | null;
}

const store = new LazyStore("dynastywire.settings.json");

export async function loadSettings(): Promise<DynastySettings> {
  return {
    dynasties: (await store.get<DynastyProfile[]>("dynasties")) ?? [],
    activeDynastyId: (await store.get<string>("activeDynastyId")) ?? null,
    savesFolder: (await store.get<string>("savesFolder")) ?? null,
    userTeam: (await store.get<string>("userTeam")) ?? null,
    coachName: (await store.get<string>("coachName")) ?? null,
    anthropicKey: (await store.get<string>("anthropicKey")) ?? null,
    elevenLabsKey: (await store.get<string>("elevenLabsKey")) ?? null,
    provider: (await store.get<"anthropic" | "openai">("provider")) ?? null,
    openaiBaseUrl: (await store.get<string>("openaiBaseUrl")) ?? null,
    openaiKey: (await store.get<string>("openaiKey")) ?? null,
    openaiModel: (await store.get<string>("openaiModel")) ?? null,
    openaiNoMaxTokens: (await store.get<boolean>("openaiNoMaxTokens")) ?? null,
    hideRecruitOverall: (await store.get<boolean>("hideRecruitOverall")) ?? null,
    consequenceSync: (await store.get<boolean>("consequenceSync")) ?? null,
    podcastAudio: (await store.get<boolean>("podcastAudio")) ?? null,
    budgetMode: (await store.get<boolean>("budgetMode")) ?? null,
    autoGenerate: (await store.get<boolean>("autoGenerate")) ?? null,
    autoGenerateTabs: (await store.get<string[]>("autoGenerateTabs")) ?? null,
  };
}

export async function saveSettings(patch: Partial<DynastySettings>): Promise<void> {
  for (const [k, v] of Object.entries(patch)) await store.set(k, v);
  await store.save();
}

/** Wipe every stored setting (keys, dynasties, toggles, ingest baselines) — the app comes
 * back up as a first run. Used by Settings → Reset, and to clear configs left polluted by
 * older versions. */
export async function clearAllSettings(): Promise<void> {
  await store.clear();
  await store.save();
}

/** Cache the last-ingested snapshot path (per dynasty) so the diff has a "before" baseline. */
export async function setLastIngested(path: string, dynastyId = "default"): Promise<void> {
  await store.set(`lastIngested::${dynastyId}`, path);
  await store.save();
}
export async function getLastIngested(dynastyId = "default"): Promise<string | null> {
  return (await store.get<string>(`lastIngested::${dynastyId}`)) ?? null;
}
