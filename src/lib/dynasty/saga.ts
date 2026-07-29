// The Saga — DynastyWire's storytelling spine. Pure types + helpers (no React, no Tauri)
// for the four pressure meters a coach lives under, the situations they decide on, and the
// running ledger of everything they've owned. Persistence lives in saga-store.ts; the React
// binding in components/dynasty/use-saga.ts.
//
// Design intent: outside forces (arrests, the portal, boosters, the media) are the tape and
// glue of a dynasty. Every decision moves the meters, and the meters follow the coach across
// every screen so the pressure is always felt — not just tallied on one page.

// ---- Meters ----------------------------------------------------------------

export interface SagaMeters {
  /** Donors + the AD's office. Low = your seat gets warm regardless of record. */
  boosterConfidence: number;
  /** The fanbase's trust in the direction of the program. */
  fanTrust: number;
  /** Media scrutiny/pressure. HIGHER IS WORSE. */
  mediaHeat: number;
  /** Team morale & buy-in. Culture. Low = a locker room that quits on you. */
  lockerRoom: number;
}

export type MeterKey = keyof SagaMeters;

/** A program that's neither loved nor in crisis — the day-one baseline. */
export const NEUTRAL_METERS: SagaMeters = {
  boosterConfidence: 55,
  fanTrust: 55,
  mediaHeat: 35,
  lockerRoom: 60,
};

export const METER_META: Record<
  MeterKey,
  { label: string; short: string; goodHigh: boolean; blurb: string }
> = {
  boosterConfidence: { label: "Boosters & AD", short: "AD", goodHigh: true, blurb: "The money and the man who signs your checks." },
  fanTrust: { label: "Fan Trust", short: "Fans", goodHigh: true, blurb: "The faithful in the stands and online." },
  mediaHeat: { label: "Media Heat", short: "Media", goodHigh: false, blurb: "How hard the press is coming for you." },
  lockerRoom: { label: "Locker Room", short: "Room", goodHigh: true, blurb: "Whether the team still believes in you." },
};

export const METER_ORDER: MeterKey[] = ["boosterConfidence", "fanTrust", "mediaHeat", "lockerRoom"];

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export function clampMeters(m: SagaMeters): SagaMeters {
  return {
    boosterConfidence: clamp(m.boosterConfidence),
    fanTrust: clamp(m.fanTrust),
    mediaHeat: clamp(m.mediaHeat),
    lockerRoom: clamp(m.lockerRoom),
  };
}

export function applyDeltas(m: SagaMeters, d: Partial<SagaMeters> | null | undefined): SagaMeters {
  if (!d) return clampMeters(m);
  return clampMeters({
    boosterConfidence: m.boosterConfidence + (num(d.boosterConfidence)),
    fanTrust: m.fanTrust + num(d.fanTrust),
    mediaHeat: m.mediaHeat + num(d.mediaHeat),
    lockerRoom: m.lockerRoom + num(d.lockerRoom),
  });
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Is a meter in good shape? mediaHeat is inverted (high = bad). */
export function meterTone(key: MeterKey, value: number): "good" | "warn" | "bad" {
  const good = METER_META[key].goodHigh ? value : 100 - value;
  if (good >= 60) return "good";
  if (good >= 35) return "warn";
  return "bad";
}

// ---- Seat temperature ------------------------------------------------------

export type SeatLevel = "secure" | "warm" | "hot" | "volcanic";

export interface SeatTemperature {
  level: SeatLevel;
  label: string;
  /** 0-100 composite pressure score (higher = hotter seat). */
  score: number;
  blurb: string;
}

/**
 * Blend the four meters into one seat temperature. Boosters/AD carry the most weight (they
 * fire you), media heat and the locker room amplify it. Record can nudge it via `recordEdge`
 * (wins - losses) so a great season cools the seat and a collapse torches it.
 */
export function seatTemperature(m: SagaMeters, recordEdge = 0): SeatTemperature {
  const pressure =
    (100 - m.boosterConfidence) * 0.4 +
    (100 - m.fanTrust) * 0.2 +
    m.mediaHeat * 0.2 +
    (100 - m.lockerRoom) * 0.2;
  const score = Math.max(0, Math.min(100, Math.round(pressure - recordEdge * 3)));

  if (score >= 78)
    return { level: "volcanic", label: "Volcanic", score, blurb: "One more misstep and you're gone." };
  if (score >= 58)
    return { level: "hot", label: "Hot Seat", score, blurb: "The AD is taking calls. Win or else." };
  if (score >= 38)
    return { level: "warm", label: "Warm", score, blurb: "Not in danger, but they're watching." };
  return { level: "secure", label: "Secure", score, blurb: "You've got the room, the money, and the fans." };
}

export const SEAT_COLOR: Record<SeatLevel, string> = {
  secure: "text-dw-green",
  warm: "text-dw-yellow",
  hot: "text-dw-accent2",
  volcanic: "text-dw-red",
};

// ---- Situations & resolutions (the content shapes the generators return) ----

export type StoryCategory =
  | "legal"
  | "academics"
  | "portal"
  | "nil"
  | "locker-room"
  | "off-field"
  | "booster"
  | "social-media"
  | "recruiting";

export type StorySeverity = "brewing" | "developing" | "crisis";

export interface StoryPlayer {
  name: string;
  position?: string | null;
  year?: string | null;
}

export interface StoryOption {
  id: string;
  label: string;
  approach: string;
  tone: "hardline" | "measured" | "protective" | "pragmatic";
  /** What this move costs — who it upsets, what political capital it spends. Every option
   * carries one, so no choice reads as free. Optional for decks cached by an older build. */
  cost?: string;
}

export interface Situation {
  category: StoryCategory;
  severity: StorySeverity;
  headline: string;
  dek: string;
  player: StoryPlayer | null;
  source: string;
  stakes: string;
  options: StoryOption[];
  /** When this grew out of an earlier decision, one line naming it. The desk now sees the
   * season's decision history, so storylines can compound instead of resetting each week. */
  callback?: string;
}

/** A situation the coach chose to sit on. It comes back next week, one severity hotter —
 * that's what makes "let it ride" a real decision rather than a free skip. */
export interface DeferredSituation {
  storylineId: string;
  week: number;
  year: number;
  headline: string;
  playerName: string | null;
  severity: StorySeverity;
  category: StoryCategory;
}

export interface StorylinesResult {
  situations: Situation[];
  error?: boolean;
}

export interface ThreadMessage {
  from: "coach" | "player";
  text: string;
  mood?: string;
}

export interface MediaAnswer {
  label: string;
  text: string;
  mediaDelta: number;
  fanDelta: number;
  lockerDelta: number;
  /** True when the coach spoke in his own words instead of picking a scripted posture. */
  custom?: boolean;
  /** Own-words answers only: how the room took it + tomorrow's headline. */
  reaction?: string;
  headline?: string;
}

export interface MediaQuestion {
  reporter: string;
  outlet: string;
  tone: "hostile" | "gotcha" | "neutral" | "friendly";
  question: string;
  answers: MediaAnswer[];
}

export interface Fallout {
  outcome: string;
  meterDeltas: Partial<SagaMeters>;
  lockerRoom: { reaction: string; byPlayer: string } | null;
  playerThread: ThreadMessage[];
  mediaQuestions: MediaQuestion[];
  /** Rare, heavy consequence: the involved player is suspended this many weeks. The
   * Situation Room enforces it in the save (temporary OVR drop → benched). */
  suspension?: { weeks: number } | null;
  error?: boolean;
}

/** A resolved situation, persisted so reopening the week shows what you chose and owned. */
export interface Resolution {
  storylineId: string;
  week: number;
  year: number;
  category: StoryCategory;
  headline: string;
  playerName: string | null;
  option: StoryOption;
  fallout: Fallout;
  /** The live text thread (starts from fallout.playerThread, grows as the coach texts). */
  thread: ThreadMessage[];
  /** Which media questions have been answered, by index → chosen answer. */
  answered: Record<number, MediaAnswer>;
  resolvedAt: number;
}

export interface LedgerEntry {
  storylineId: string;
  week: number;
  year: number;
  headline: string;
  decision: string;
  outcome: string;
  at: number;
}

/** Where the PROGRAM itself is coming from. A TeamBuilder school or an FCS team that just
 * jumped up has a completely different story than a blue blood, and the media should know
 * it — this is what makes "we moved up from FCS two years ago" part of every story. */
export type ProgramSituation =
  | "established"
  | "fcs-jump"
  | "new-program"
  | "rebuild"
  | "fallen-giant";

export const PROGRAM_SITUATIONS: { id: ProgramSituation; label: string; desc: string }[] = [
  { id: "established", label: "Established FBS", desc: "A normal FBS program with its own history — nothing unusual about how it got here." },
  { id: "fcs-jump", label: "Moved Up from FCS", desc: "This program just made the jump to FBS. Everything is new: the level, the money, the schedule, the doubters." },
  { id: "new-program", label: "Brand-New Program", desc: "A created/TeamBuilder school playing its first seasons. No history, no alumni base, everything is being written now." },
  { id: "rebuild", label: "Rebuild from the Bottom", desc: "A long-struggling program being dragged back to relevance." },
  { id: "fallen-giant", label: "Fallen Giant", desc: "A program with real history that fell off, expected to return to what it was." },
];

export interface CoachBackstory {
  archetype: "disciplinarian" | "players-coach" | "nil-merchant" | "hometown-savior";
  customPath: string;
  bio: string;
  adName: string;
  boosterName: string;
  reporterName: string;
  rivalCoachName: string;
  /** The program's own origin — drives how the media frames the school itself. */
  programSituation?: ProgramSituation | null;
  /** The user's own words about the program's situation (e.g. "moved up from FCS in 2029,
   * year two in the Sun Belt, still playing in a 20k stadium"). */
  programNote?: string;
  /** Generated narrative of the program's origin/identity. */
  programBio?: string;
}

/** A message in a coach↔recruit text thread (recruiting hub). Persisted so conversations
 * feel like a real, continuing thread across sessions. */
export interface RecruitThreadMessage {
  from: "coach" | "recruit";
  text: string;
  mood?: string;
}

export interface SagaState {
  dynastyId: string;
  meters: SagaMeters;
  /** storylineId → resolution. */
  resolved: Record<string, Resolution>;
  ledger: LedgerEntry[];
  backstory?: CoachBackstory | null;
  /** recruitKey → the running coach↔recruit text thread. */
  recruitThreads?: Record<string, RecruitThreadMessage[]>;
  /** recruitKey → the recruit's generated dossier (persists across weeks/restarts). */
  recruitDossiers?: Record<string, unknown>;
  /** figure ("ad"|"booster"|"reporter") → the running coach↔figure text thread. */
  figureThreads?: Record<string, RecruitThreadMessage[]>;
  /** Situations the coach sat on, waiting to come back hotter. Cleared once they return. */
  deferred?: DeferredSituation[];
  seededAt: number;
  updatedAt: number;
}

/**
 * Stable identity for a recruit across the season: name + position. NEVER key on
 * nationalRank — it shifts week to week, which orphaned every thread/dossier saved
 * under the old rank (the "my texts disappeared" bug).
 */
export function recruitThreadKey(name: string, position: string | null | undefined): string {
  return `${name}::${position ?? ""}`;
}

/**
 * Find a recruit's saved entry tolerating the legacy rank-based key format
 * (`Name::<nationalRank>`), so pre-fix threads aren't lost after updating.
 */
export function findRecruitEntry<T>(
  map: Record<string, T> | undefined,
  name: string,
  position: string | null | undefined
): { key: string; value: T | null } {
  const key = recruitThreadKey(name, position);
  if (!map) return { key, value: null };
  if (map[key] != null) return { key, value: map[key] };
  const legacy = Object.keys(map).find((k) => k.startsWith(`${name}::`));
  return legacy ? { key, value: map[legacy] } : { key, value: null };
}

export function newSaga(dynastyId: string, meters: SagaMeters = NEUTRAL_METERS): SagaState {
  const now = Date.now();
  return {
    dynastyId,
    meters: clampMeters(meters),
    resolved: {},
    ledger: [],
    backstory: null,
    recruitThreads: {},
    recruitDossiers: {},
    seededAt: now,
    updatedAt: now,
  };
}

/**
 * Stable id for a situation within a week so its resolution survives re-reads.
 * (dynasty, year, week, index) — deterministic, no randomness.
 */
export function storylineId(
  dynastyId: string,
  year: number,
  week: number,
  index: number
): string {
  return `${dynastyId}:${year}:w${week}:${index}`;
}

/**
 * Seed meters from the parsed save's coach data on first run so an established hot seat
 * carries in instead of everyone starting neutral.
 */
export function seedMetersFromCoach(job: string | null | undefined): SagaMeters {
  const base = { ...NEUTRAL_METERS };
  if (!job) return base;
  const j = job.toLowerCase();
  if (/hot|fire|danger|volcan/.test(j)) {
    return clampMeters({ boosterConfidence: 30, fanTrust: 35, mediaHeat: 62, lockerRoom: 45 });
  }
  if (/warm|lukewarm/.test(j)) {
    return clampMeters({ boosterConfidence: 45, fanTrust: 48, mediaHeat: 48, lockerRoom: 55 });
  }
  if (/secure|safe|legend|comfortable/.test(j)) {
    return clampMeters({ boosterConfidence: 70, fanTrust: 68, mediaHeat: 25, lockerRoom: 70 });
  }
  return base;
}

export const CATEGORY_LABEL: Record<StoryCategory, string> = {
  legal: "Legal / Off-Field",
  academics: "Academics",
  portal: "Transfer Portal",
  nil: "NIL & Money",
  "locker-room": "Locker Room",
  "off-field": "Personal",
  booster: "Boosters & AD",
  "social-media": "Social Media",
  recruiting: "Recruiting",
};

export const SEVERITY_STYLE: Record<StorySeverity, string> = {
  brewing: "border-ink3/40 text-ink3",
  developing: "border-dw-yellow/50 text-dw-yellow",
  crisis: "border-dw-red/50 text-dw-red",
};
