// Turning screen reads into events.
//
// The Rust side reports one observation per call and decides nothing, on purpose. Everything
// that says "something HAPPENED" lives here, and it is pure so it can be tested against the
// noise a real game actually produces rather than the noise a design imagines.
//
// The single most important rule: a state must be seen TWICE before it is believed. OCR of a
// score bar flickers — a frame lands mid-redraw with half the bar, or misreads a digit for
// one tick — and acting on a single frame means announcing touchdowns that never happened.
// Confirmation costs one extra tick of latency and removes essentially all of that.

import { invoke } from "@tauri-apps/api/core";

export interface LiveState {
  raw: string;
  quarter: string | null;
  clock: string | null;
  down: string | null;
  situation: string | null;
  /** [team, score] as read. Names are snapped to the save's own spelling in Rust. */
  scores: [string, number][];
  /** False when no score bar was on screen — the normal case between plays. */
  onScreen: boolean;
}

export interface LiveWord {
  text: string;
  x: number;
  y: number;
}

export type LiveEventKind =
  | "touchdown"
  | "field-goal"
  | "pat"
  | "safety-or-2pt"
  | "score"
  | "first-down"
  | "down"
  | "quarter"
  | "situation";

export interface LiveEvent {
  kind: LiveEventKind;
  /** What a person would say happened. */
  text: string;
  team: string | null;
  /** Game clock when it was noticed, not wall clock. */
  at: string | null;
  quarter: string | null;
  /** Wall-clock ms, for ordering and de-duplication in the UI. */
  seen: number;
  /** On a scoring play: the team's new total. Null on downs and quarters. */
  total?: number | null;
  /** On a scoring play: the same fact in a sentence, for the newsroom. */
  phrase?: string;
}

const scoreMap = (s: LiveState): Map<string, number> => new Map(s.scores);

/**
 * Is this scoreboard trustworthy?
 *
 * The bar always shows both teams, so a read with only one is a PARTIAL read, and partial
 * reads lie in a specific way. Caught live: `UTAH 1 KANSAS STATE 1st 11:59` — Kansas State's
 * zero was missed, so Utah absorbed Kansas State's #1 RANK BADGE as its score. It appeared
 * seven times in a single drive, twice back to back, so it is not a flicker that averages
 * out. A half-read scoreboard is thrown away rather than believed.
 */
function scoresUsable(s: LiveState): boolean {
  return s.scores.length >= 2;
}

/**
 * A stable fingerprint of the things whose change IS an event.
 *
 * The game clock is deliberately excluded. It ticks between every read, so including it gave
 * every read a unique key and nothing could ever be confirmed while the clock ran — the
 * prototype only appeared to work because it happened to be watching during a stoppage.
 * Scores, down, and quarter are the state; the clock is just the clock.
 */
export function stateKey(s: LiveState): string {
  const scores = scoresUsable(s)
    ? [...scoreMap(s)]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([t, v]) => `${t}=${v}`)
        .join(",")
    : "?";
  return `${s.quarter ?? ""}|${s.down ?? ""}|${scores}`;
}

/**
 * What a points change means. The scoreboard only gives us the delta, so a 7 is a touchdown
 * whose PAT landed inside the same tick rather than two separate events — which is honest,
 * and better than announcing a touchdown and a PAT a second apart when we cannot actually
 * tell them apart.
 */
function pointsMeaning(delta: number): { kind: LiveEventKind; text: string; phrase: string } {
  switch (delta) {
    case 6:
      return { kind: "touchdown", text: "TOUCHDOWN", phrase: "touchdown" };
    case 7:
      return { kind: "touchdown", text: "TOUCHDOWN, extra point good", phrase: "touchdown, extra point good" };
    case 8:
      return { kind: "touchdown", text: "TOUCHDOWN and the two-point try", phrase: "touchdown and a two-point conversion" };
    case 3:
      return { kind: "field-goal", text: "FIELD GOAL", phrase: "field goal" };
    case 2:
      return {
        kind: "safety-or-2pt",
        text: "Two points — safety or a conversion",
        phrase: "two points — the scoreboard cannot say whether it was a safety or a conversion",
      };
    case 1:
      return { kind: "pat", text: "Extra point good", phrase: "extra point" };
    default:
      return {
        kind: "score",
        text: `${delta > 0 ? "+" : ""}${delta} points`,
        phrase: `${delta} points`,
      };
  }
}

/**
 * Compare two CONFIRMED states and say what changed.
 *
 * Never called with an unconfirmed read — see `confirm` below. Returns [] when nothing
 * meaningful moved, which is most ticks: the play clock ticking is not an event.
 */
export function deriveEvents(prev: LiveState, next: LiveState, now = Date.now()): LiveEvent[] {
  const out: LiveEvent[] = [];
  const base = { at: next.clock, quarter: next.quarter, seen: now };

  // Only compare scoreboards we actually trust on BOTH sides. See scoresUsable().
  const before = scoreMap(prev);
  const compareScores = scoresUsable(prev) && scoresUsable(next);
  for (const [team, score] of compareScores ? scoreMap(next) : new Map<string, number>()) {
    const was = before.get(team);
    // A team appearing for the first time is not a scoring play — it is the bar finally
    // being read properly. Only a team we already had a number for can have "scored".
    if (was == null || score <= was) continue;
    const { kind, text, phrase } = pointsMeaning(score - was);
    out.push({ ...base, kind, team, total: score, phrase, text: `${text} — ${team} ${score}` });
  }

  if (next.down && prev.down && next.down !== prev.down) {
    const isFirst = /^1st/.test(next.down);
    out.push({
      ...base,
      kind: isFirst ? "first-down" : "down",
      team: null,
      text: isFirst ? `First down — ${next.down}` : next.down,
    });
  }

  if (next.quarter && prev.quarter && next.quarter !== prev.quarter) {
    out.push({ ...base, kind: "quarter", team: null, text: `Start of the ${next.quarter}` });
  }

  if (next.situation && next.situation !== prev.situation) {
    out.push({ ...base, kind: "situation", team: null, text: next.situation });
  }

  return out;
}

/**
 * The confirmation gate.
 *
 * Feed every read in. It returns the new CONFIRMED state only once the same key has arrived
 * twice in a row; anything else returns null and should change nothing on screen. Reads with
 * no bar on screen are ignored entirely rather than treated as a state — between plays the
 * game shows a play-call overlay, and that is not the score going to nil.
 */
export interface Confirmer {
  confirmed: LiveState | null;
  pending: string | null;
  /** The scoreboard gets its own, stricter gate — see SCORE_READS. */
  scoreKey: string | null;
  scoreCount: number;
  scores: [string, number][];
}

export const freshConfirmer = (): Confirmer => ({
  confirmed: null,
  pending: null,
  scoreKey: null,
  scoreCount: 0,
  scores: [],
});

/**
 * How many consecutive identical reads a SCOREBOARD needs before it is believed.
 *
 * Three, where everything else needs two, because the scoreboard is both the highest-stakes
 * field and the most durable one. A real score sits on the bar for minutes, so a third read
 * costs about a second of latency on a touchdown — while the phantom this defends against is
 * always transient.
 *
 * Measured over 200 reads of one real drive: `[("Utah", 1)]` appeared 22 times and
 * `[("Utah", 1), ("Kansas State", 0)]` three more — Utah absorbing Kansas State's #1 rank
 * badge whenever the zero was missed. The one-sided reads land back to back, so two
 * confirmations would not have stopped them; the two-sided ones never repeated in that
 * sample, but three occurrences in 200 reads is not a margin worth trusting over a whole game.
 */
const SCORE_READS = 3;

const scoreSignature = (s: LiveState): string =>
  [...scoreMap(s)].sort(([a], [b]) => a.localeCompare(b)).map(([t, v]) => `${t}=${v}`).join(",");

export function confirm(c: Confirmer, read: LiveState): { next: Confirmer; settled: LiveState | null } {
  if (!read.onScreen) return { next: c, settled: null };

  // ── the scoreboard's own gate ────────────────────────────────────────────────
  // A half-read board is discarded outright; anything else has to hold still.
  let { scoreKey, scoreCount, scores } = c;
  if (scoresUsable(read)) {
    const sig = scoreSignature(read);
    if (sig === scoreKey) scoreCount += 1;
    else {
      scoreKey = sig;
      scoreCount = 1;
    }
    if (scoreCount >= SCORE_READS) scores = read.scores;
  }

  // Whatever the current read said, the state carries only the score we actually trust.
  const trusted: LiveState = { ...read, scores };

  const key = stateKey(trusted);
  const base = { scoreKey, scoreCount, scores };
  if (c.confirmed && stateKey(c.confirmed) === key) {
    return { next: { ...base, confirmed: c.confirmed, pending: null }, settled: null };
  }
  if (c.pending !== key) {
    return { next: { ...base, confirmed: c.confirmed, pending: key }, settled: null };
  }
  // Seen twice. Believe it.
  return { next: { ...base, confirmed: trusted, pending: null }, settled: trusted };
}

// ── What the newsroom gets ─────────────────────────────────────────────────────
//
// The save is written once per week advance. It carries the final score and the points each
// team scored in each quarter, and that is the end of what anyone downstream has ever known
// about how a game went. It does not carry the ORDER of the scoring, or when inside a quarter
// anything happened, or whether seven points was a touchdown or a touchdown plus a stop.
//
// A watched game carries all of that, and it is the first thing in this app that the save
// cannot tell us. So it goes in as locked fact, on the same channel screenshots already use —
// which means every generator that already respects verified plays respects these too, with
// no new plumbing.
//
// The one thing it must never do is contradict the save. A live log is only offered to the
// newsroom when it is consistent with the result the save recorded; see playsForResult.

/** A watched game, as stored against the week it belongs to. */
export interface LiveLog {
  /** Every confirmed event, oldest first. */
  events: LiveEvent[];
  /** The last confirmed scoreboard, which is how a partial watch is reconciled. */
  final: [string, number][];
  updatedAt: number;
}

const SCORING = new Set<LiveEventKind>(["touchdown", "field-goal", "pat", "safety-or-2pt", "score"]);

/**
 * Fold this session's scoring into the week's stored log.
 *
 * Watching is not one continuous act. A user stops to eat, the app is reopened, a game is
 * quit to the menu and resumed — and each restart begins with a fresh confirmer that derives
 * no events from its first read, so appending is normally right. What it is NOT right for is
 * REPLAYING a game: the score returns to nil and every touchdown is scored a second time.
 *
 * A team can only reach any given total once, so that is the identity used. The earliest
 * sighting wins, because that is the one whose clock is real.
 */
export function mergeLog(
  prev: LiveLog | null | undefined,
  events: LiveEvent[],
  final: [string, number][],
  now = Date.now()
): LiveLog {
  const byTotal = new Map<string, LiveEvent>();
  for (const e of [...(prev?.events ?? []), ...events]) {
    if (!SCORING.has(e.kind) || !e.team || e.total == null) continue;
    const key = `${e.team}|${e.total}`;
    const held = byTotal.get(key);
    if (!held || e.seen < held.seen) byTotal.set(key, e);
  }
  return {
    events: [...byTotal.values()].sort((a, b) => a.seen - b.seen),
    final: final.length ? final : prev?.final ?? [],
    updatedAt: now,
  };
}

/**
 * The scoring plays only, oldest first, with an extra point folded into the touchdown it
 * followed.
 *
 * The bar sometimes updates a touchdown in one step (0 → 7) and sometimes in two (0 → 6 → 1),
 * depending on where the read lands relative to the kick. Left alone that reads as two scoring
 * plays, which a writer will turn into two drives.
 */
export function scoringPlays(events: LiveEvent[]): LiveEvent[] {
  const scores = events.filter((e) => SCORING.has(e.kind) && e.team).sort((a, b) => a.seen - b.seen);
  const out: LiveEvent[] = [];
  for (const e of scores) {
    const prev = out[out.length - 1];
    const kick = e.kind === "pat" && prev?.kind === "touchdown" && prev.team === e.team;
    if (kick && e.seen - prev.seen < 30_000) {
      out[out.length - 1] = { ...prev, total: e.total, phrase: "touchdown, extra point good" };
      continue;
    }
    out.push(e);
  }
  return out;
}

/** The scoreboard as it stood after each play, so a line can state the game, not just a team. */
function boardAt(plays: LiveEvent[], upTo: number, final: [string, number][]): string {
  const board = new Map<string, number>(final.map(([t]) => [t, 0]));
  for (let i = 0; i <= upTo; i++) {
    const p = plays[i];
    if (p.team && p.total != null) board.set(p.team, p.total);
  }
  return [...board]
    .sort((a, b) => b[1] - a[1])
    .map(([t, v]) => `${t} ${v}`)
    .join(", ");
}

export interface PlayFeed {
  /** One sentence per scoring play, oldest first. */
  plays: string[];
  /** False when the watch started late or ended early. */
  complete: boolean;
}

const EMPTY: PlayFeed = { plays: [], complete: false };

/**
 * The verified plays for a game, or nothing at all.
 *
 * Every reason to return nothing here is a reason a live log might be about a DIFFERENT game
 * than the one being written about — a log left over from last week, a game the user restarted,
 * a second controller's game. Locked facts are locked; the cost of one wrong line in that block
 * is higher than the value of every right line, so anything that does not reconcile with the
 * save is dropped whole rather than partially trusted.
 *
 * A log that stops early is NOT a contradiction — those plays really happened, we just did not
 * see the rest — so it is kept, and says so in its own last line. Without that the block reads
 * as the complete list of scores and a 34-21 game gets written as though it were 14-7.
 */
export function playsForResult(
  log: LiveLog | null | undefined,
  result: { home: string; away: string; homeScore: number | null; awayScore: number | null } | null
): PlayFeed {
  if (!log?.events?.length || !result) return EMPTY;
  if (result.homeScore == null || result.awayScore == null) return EMPTY;

  const saveFinal = new Map([
    [result.home, result.homeScore],
    [result.away, result.awayScore],
  ]);
  const live = new Map(log.final);
  // Both teams, and only those teams. A log whose teams are not this game's teams is a log
  // about another game.
  if (live.size !== 2 || [...live.keys()].some((t) => !saveFinal.has(t))) return EMPTY;
  // Nobody can have scored more live than they finished with.
  for (const [team, score] of live) {
    if (score > (saveFinal.get(team) ?? 0)) return EMPTY;
  }
  const complete = [...saveFinal].every(([team, score]) => live.get(team) === score);

  const plays = scoringPlays(log.events);
  if (!plays.length) return EMPTY;

  const lines = plays.map((p, i) => {
    const when = [p.quarter ? `${p.quarter} quarter` : null, p.at].filter(Boolean).join(", ");
    const what = `${p.team} ${p.phrase ?? "scored"}`;
    return `${when ? `${when} — ` : ""}${what}. ${boardAt(plays, i, log.final)}.`;
  });

  if (!complete) {
    const last = plays[plays.length - 1];
    lines.push(
      `(Tracked live only through ${last.quarter ? `the ${last.quarter} quarter` : "part of the game"}` +
        `${last.at ? `, ${last.at}` : ""} — every play above really happened, but this is NOT the ` +
        `complete list of scoring. The final score is the authority on how the game ended.)`
    );
  }

  return { plays: lines, complete };
}

// ── The bridge ─────────────────────────────────────────────────────────────────

export interface CropRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Sensible at 1920x1080. Anything else calibrates once and stores its own.
 *
 * The height matters more than it looks. The two team names are set in a modest font and the
 * SCORES are set about twice as large, so a crop tall enough to read "KANSAS STATE" cleanly can
 * still slice the bottom off "14" — and a half-height numeral is not misread, it is dropped
 * entirely. That is exactly what a 70px window did: every read came back with both teams and
 * no score at all, for a whole quarter, on a 14-14 game. Err tall.
 */
export const DEFAULT_CROP: CropRegion = { x: 350, y: 930, w: 1400, h: 90 };

export function gameRunning(): Promise<boolean> {
  return invoke<boolean>("live_game_running").catch(() => false);
}

/** Every word on screen with its position, for finding the score bar once. */
export function calibrate(): Promise<LiveWord[]> {
  return invoke<LiveWord[]>("live_calibrate");
}

export async function readBar(crop: CropRegion, teams: string[]): Promise<LiveState> {
  const s = await invoke<Record<string, unknown>>("live_read", { ...crop, teams });
  return {
    raw: String(s.raw ?? ""),
    quarter: (s.quarter as string) ?? null,
    clock: (s.clock as string) ?? null,
    down: (s.down as string) ?? null,
    situation: (s.situation as string) ?? null,
    scores: Array.isArray(s.scores) ? (s.scores as [string, number][]) : [],
    onScreen: Boolean(s.on_screen),
  };
}

/**
 * Guess the score bar from a calibration pass: the row that carries a clock, and everything
 * horizontally in line with it. Saves the user measuring pixels, and they can still nudge it.
 */
export function guessCrop(words: LiveWord[]): CropRegion | null {
  const clockish = words.find((w) => /^\d{1,2}:\d{2}$/.test(w.text.trim()));
  if (!clockish) return null;
  const band = words.filter((w) => Math.abs(w.y - clockish.y) <= 30);
  if (band.length < 3) return null;
  const xs = band.map((w) => w.x);
  const ys = band.map((w) => w.y);
  const left = Math.max(0, Math.min(...xs) - 40);
  const top = Math.max(0, Math.min(...ys) - 25);
  return {
    x: left,
    y: top,
    w: Math.max(...xs) - left + 240,
    // Generous at the bottom on purpose. The words we can see are the small ones — the clock,
    // the down — and the scores are set roughly twice their size, so a box that just contains
    // the words we found will clip the numerals we most need. A clipped digit is not misread,
    // it is dropped, and a scoreboard read with no numbers on it is worse than none.
    h: Math.max(...ys) - top + 85,
  };
}
