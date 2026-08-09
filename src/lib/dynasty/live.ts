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
function pointsMeaning(delta: number): { kind: LiveEventKind; text: string } {
  switch (delta) {
    case 6:
      return { kind: "touchdown", text: "TOUCHDOWN" };
    case 7:
      return { kind: "touchdown", text: "TOUCHDOWN, extra point good" };
    case 8:
      return { kind: "touchdown", text: "TOUCHDOWN and the two-point try" };
    case 3:
      return { kind: "field-goal", text: "FIELD GOAL" };
    case 2:
      return { kind: "safety-or-2pt", text: "Two points — safety or a conversion" };
    case 1:
      return { kind: "pat", text: "Extra point good" };
    default:
      return { kind: "score", text: `${delta > 0 ? "+" : ""}${delta} points` };
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
    const { kind, text } = pointsMeaning(score - was);
    out.push({ ...base, kind, team, text: `${text} — ${team} ${score}` });
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

// ── The bridge ─────────────────────────────────────────────────────────────────

export interface CropRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Sensible at 1920x1080. Anything else calibrates once and stores its own. */
export const DEFAULT_CROP: CropRegion = { x: 360, y: 925, w: 1450, h: 70 };

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
  const top = Math.max(0, Math.min(...ys) - 20);
  return {
    x: left,
    y: top,
    w: Math.max(...xs) - left + 240,
    h: Math.max(...ys) - top + 60,
  };
}
