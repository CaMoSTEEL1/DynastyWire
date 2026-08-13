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
  | "big-play"
  | "loss"
  | "conversion"
  | "stuffed"
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
  /** Yards gained on the play, when the chains allow it to be known. Null otherwise. */
  yards?: number | null;
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


// ── Reading the play off the chains ────────────────────────────────────────────
//
// The score bar looked like it only carried a score. It carries the DOWN AND DISTANCE, and
// between two consecutive downs in the same series that is arithmetic: 1st & 10 becoming
// 2nd & 3 is a seven-yard gain, and becoming 2nd & 14 is a four-yard loss. No extra reading,
// no new OCR — the number was always on screen, nobody was subtracting.
//
// The hard rule is that this only holds INSIDE a series. A down going 1st → 2nd → 3rd is the
// same team on the same drive and the maths is safe. A reset to 1st & 10 is not: it is a
// conversion, or a punt, or a turnover, and the bar cannot tell us which, because it never
// says who has the ball. So a reset is reported as "they moved the chains" when it followed a
// real third or fourth down, and otherwise says nothing at all rather than guessing.

interface DownState {
  /** 1-4. */
  down: number;
  /** Yards to go, or null when the bar says GOAL or inches. */
  distance: number | null;
  /** The literal, for the cases arithmetic cannot touch. */
  word: string | null;
}

export function parseDown(text: string | null | undefined): DownState | null {
  if (!text) return null;
  const m = /^([1-4])(?:st|nd|rd|th)\s*&\s*(.+)$/i.exec(text.trim());
  if (!m) return null;
  const rest = m[2].trim();
  const num = /^\d+$/.test(rest) ? Number(rest) : null;
  return { down: Number(m[1]), distance: num, word: num == null ? rest : null };
}

export interface PlayResult {
  kind: LiveEventKind;
  text: string;
  /** Yards gained on the play, when the chains allow it to be known. */
  yards: number | null;
}

/**
 * What just happened, from the chains alone.
 *
 * Returns null when the transition is one the bar genuinely cannot explain — which is most of
 * them at a change of possession. Saying nothing is the correct output there; the alternative
 * is a booth confidently narrating a punt as a nine-yard gain.
 */
export function playResult(prev: string | null, next: string | null): PlayResult | null {
  const a = parseDown(prev);
  const b = parseDown(next);
  if (!a || !b) return null;

  // Same series, the VERY next down. One play, so the difference is one play's yardage.
  //
  // A skipped down — 1st straight to 3rd — means a read was missed, and the difference then
  // spans two plays. Reporting "6 yards" for what was really a 2 and a 4 is the kind of small
  // confident lie this whole module exists to avoid, so a gap reports the down and no number.
  if (b.down > a.down + 1) {
    return { kind: b.down >= 3 ? "down" : "down", text: `${next}`, yards: null };
  }
  if (b.down === a.down + 1) {
    if (a.distance == null || b.distance == null) {
      // Goal-to-go or "inches" — a down was used and we cannot say for how much.
      return { kind: "stuffed", text: `${next}`, yards: null };
    }
    const yards = a.distance - b.distance;
    if (yards <= -5) {
      return { kind: "loss", text: `Dropped for a loss of ${Math.abs(yards)} — now ${next}`, yards };
    }
    if (yards >= 15) {
      return { kind: "big-play", text: `A ${yards}-yard play — ${next}`, yards };
    }
    if (yards <= 0) {
      return { kind: "stuffed", text: yards === 0 ? `Nothing on the play — ${next}` : `${next}`, yards };
    }
    return { kind: "down", text: `${yards} yards — ${next}`, yards };
  }

  // A reset to first down. A conversion ONLY when it followed a down that had to be
  // converted; off a 1st or 2nd down it is far more likely a change of possession, and the
  // bar cannot tell the difference.
  if (b.down === 1 && a.down >= 3) {
    const need = a.distance;
    if (need != null && need >= 7) {
      return { kind: "conversion", text: `Converted on ${a.down === 3 ? "third" : "fourth"} and ${need}`, yards: null };
    }
    return { kind: "first-down", text: `Moved the chains on ${a.down === 3 ? "third" : "fourth"} down`, yards: null };
  }

  return null;
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
    // The chains say more than "it is second down now" — see playResult().
    const play = playResult(prev.down, next.down);
    if (play) {
      out.push({ ...base, kind: play.kind, team: null, text: play.text, yards: play.yards });
    } else {
      const isFirst = /^1st/.test(next.down);
      out.push({
        ...base,
        kind: isFirst ? "first-down" : "down",
        team: null,
        text: isFirst ? `First down — ${next.down}` : next.down,
      });
    }
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
/**
 * Is this board a continuation of the log, or the start of something else?
 *
 * The log is keyed by week, and a week can be looked at more than once. Two things happen in
 * practice and both leave a mixed record if the log is simply appended to:
 *
 * - The game is QUIT and replayed. The board goes back to nil and every score happens again,
 *   at a different clock, in a different order. Deduping by "a team can only reach 21 once"
 *   keeps the FIRST sighting, so the log ends up carrying the abandoned attempt's clock times
 *   for the replayed attempt's scores. Fragmented in the worst way — plausible and wrong.
 * - The NEXT game is played before the save is exported. The app still believes it is week N,
 *   so the booth writes week N+1's game into week N's log. Nothing about that is a restart;
 *   it is a different fixture.
 *
 * A score cannot go down inside one game, and the two teams cannot change. Either of those
 * means what is on screen is not the game the log is about, so the log is replaced rather
 * than extended.
 */
export function supersedes(
  log: LiveLog | null | undefined,
  board: [string, number][]
): boolean {
  if (!log?.events?.length || board.length < 2) return false;
  const had = new Map(log.final);
  // A log with no usable final can't be contradicted by anything.
  if (had.size < 2) return false;
  const sameFixture = board.length === had.size && board.every(([team]) => had.has(team));
  if (!sameFixture) return true;
  return board.some(([team, score]) => score < (had.get(team) ?? 0));
}

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

// ── When the booth speaks ──────────────────────────────────────────────────────

/** A call and the reaction to it, as shown in the feed. */
export interface LiveCall {
  /** The booth talking to each other. Two or three turns, alternating. */
  exchange: { who: string; line: string }[];
  /** The same thing flattened, for anywhere that only wants one string. */
  call: string;
  posts: { handle: string; displayName: string; type: string; body: string }[];
  at: string | null;
  quarter: string | null;
  seen: number;
}

/**
 * How long the booth stays quiet after speaking.
 *
 * Not a rate limit for its own sake — a broadcast one. Scores arrive in bursts (a touchdown,
 * then its extra point, then the kickoff, sometimes inside ten seconds) and a booth that
 * files a fresh take on each of them talks over itself. One call covering the burst reads the
 * way a real one sounds, and costs a third as much.
 */
export const CALL_COOLDOWN_MS = 25_000;

/** Bounded so a long game cannot quietly run up a bill while the user is looking at the TV. */
export const CALLS_PER_GAME = 40;

/**
 * Is the booth's VOICE shipped yet?
 *
 * The reader is verified — the score, the clock, the down and distance were all checked
 * against a live game and read correctly on 30 consecutive frames. The commentary written on
 * top of it has never produced a sentence anybody has read: the prompt assembles and the
 * plumbing typechecks, and that is the whole of what is known about it.
 *
 * There is also a specific unfixed risk. `live-call` asks for a two-or-three turn exchange
 * PLUS three posts inside 800 tokens, which is the same shape that truncated the phone twice
 * in real use after its output grew and its budget did not.
 *
 * So it stays out of the build rather than merely defaulting to off — off-by-default is still
 * a feature a tester can find, turn on, and report on, and an unverified feature is not worth
 * the report. Flip this to true once a drive has been watched with it running.
 */
export const COMMENTARY_READY = false;

/**
 * Which events are worth interrupting for.
 *
 * Scores and quarters. NOT downs — a booth that says something on every first down is the
 * reason nobody leaves live commentary on, and it is also where the money goes: downs are an
 * order of magnitude more frequent than scores.
 */
export function worthCalling(events: LiveEvent[]): boolean {
  return events.some(
    (e) =>
      SCORING.has(e.kind) ||
      e.kind === "quarter" ||
      // Now that the chains give real yardage, the booth can react to the plays that matter
      // rather than only to points. Still never an ordinary gain — "four yards, second and
      // six" is the noise that made live commentary unusable.
      e.kind === "big-play" ||
      e.kind === "conversion" ||
      e.kind === "loss"
  );
}

/** The moment, as the booth is told about it: what changed, newest last. */
export function momentLines(events: LiveEvent[]): string[] {
  return events
    .filter(
      (e) =>
        SCORING.has(e.kind) ||
        e.kind === "quarter" ||
        e.kind === "situation" ||
        e.kind === "big-play" ||
        e.kind === "conversion" ||
        e.kind === "loss"
    )
    .sort((a, b) => a.seen - b.seen)
    .map((e) => {
      const when = [e.quarter, e.at].filter(Boolean).join(" ");
      return when ? `${when} — ${e.text}` : e.text;
    });
}

/** The scoreboard as a sentence, for a prompt that must not be handed a data structure. */
export function boardLine(state: LiveState | null): string {
  if (!state || state.scores.length < 2) return "";
  return state.scores.map(([t, v]) => `${t} ${v}`).join(", ");
}


// ── Who ────────────────────────────────────────────────────────────────────────
//
// The score bar answers what and when and never who. The rest of the screen does: the game
// puts names on the ball carrier, on post-play graphics, on the play-call screen. None of it
// is at a fixed position and none of it needs to be — the app is holding both rosters, so
// anything readable on screen can be matched against the men who are actually in this game.
//
// The honest limit, and it is the whole design: A NAME ON SCREEN IS NOT A CONFESSION. The
// play-call screen shows names of men who are about to do nothing. A season-leader graphic
// shows a man who is standing on the sideline. So this returns CANDIDATES — who was legible
// at the moment something happened — and never an actor.
//
// What that is good enough for: a live booth, which is allowed to say "that looked like
// Marsh" and be corrected, the way a real one does forty times a night. What it is NOT good
// enough for is the newsroom, which gets the real per-game box score out of the save after
// the game and has no need of a guess. The two are kept apart on purpose.

/** A roster name that was legible on screen when something happened. */
export interface ScreenName {
  name: string;
  /**
   * How it was spotted. "banner" is the strong one — see BANNER_ABOVE_BAR.
   */
  via: "banner" | "name" | "jersey";
  x: number;
  y: number;
}

/**
 * How far above the score bar the involved-player graphic sits.
 *
 * Measured on a live game rather than guessed. During a play the game renders the player's
 * full name in its own strip immediately above the bar — captured verbatim as
 * `BRADLEY@1522,1806  HURLEY@1678,1806` with the bar itself at y≈1904, so about fifty window
 * pixels of gap. Names found anywhere ELSE on screen at the same moment were side panels: a
 * career-comparison card and a ratings graphic, both far to the right, neither about the play.
 *
 * That distinction is the whole value of the position. A name in this band is about what is
 * happening; a name outside it is furniture.
 */
const BANNER_ABOVE_BAR = 90;

const squash = (t: string): string => t.replace(/[^a-z]/gi, "").toUpperCase();

/**
 * Roster men who are legible on screen right now.
 *
 * Surnames only. First names are short, common, and collide with everything on a football
 * broadcast — "Cam" is a name and half a camera graphic — while a surname of five letters or
 * more is a genuinely rare token to find by accident. Jersey numbers are matched only when
 * written as `#12`, because a bare number on a football screen is the down, the distance, the
 * yard line, the clock, the score, or the play clock.
 */
export function namesOnScreen(
  words: LiveWord[],
  roster: { name: string; jersey?: number | null }[],
  /** The score-bar crop, so a name sitting just above it can be told from one in a side panel. */
  bar?: { y: number } | null
): ScreenName[] {
  const bySurname = new Map<string, string>();
  const byJersey = new Map<number, string[]>();
  for (const p of roster) {
    const parts = p.name.trim().split(/\s+/);
    const surname = squash(parts[parts.length - 1] ?? "");
    // Five letters is the bar for a token that has to survive being found by accident in the
    // middle of a broadcast graphic.
    if (surname.length >= 5) bySurname.set(surname, p.name);
    if (typeof p.jersey === "number" && p.jersey > 0) {
      byJersey.set(p.jersey, [...(byJersey.get(p.jersey) ?? []), p.name]);
    }
  }

  const inBanner = (y: number): boolean =>
    bar != null && y < bar.y && y >= bar.y - BANNER_ABOVE_BAR;

  const found = new Map<string, ScreenName>();
  for (const w of words) {
    const t = w.text.trim();
    const key = squash(t);
    if (key.length >= 5) {
      const hit = bySurname.get(key);
      if (hit && !found.has(hit)) {
        found.set(hit, { name: hit, via: inBanner(w.y) ? "banner" : "name", x: w.x, y: w.y });
        continue;
      }
    }
    const jersey = /^#\s*(\d{1,2})$/.exec(t);
    if (jersey) {
      const owners = byJersey.get(Number(jersey[1])) ?? [];
      // A number both teams use is no identification at all. Only an unambiguous one counts.
      if (owners.length === 1 && !found.has(owners[0])) {
        found.set(owners[0], { name: owners[0], via: inBanner(w.y) ? "banner" : "jersey", x: w.x, y: w.y });
      }
    }
  }
  return [...found.values()];
}

/**
 * How the booth is allowed to talk about who it saw.
 *
 * One name is a lead worth following on air. Several at once is the play-call screen or a
 * graphic, and means nothing — so it says nothing, rather than picking whichever came first
 * and sounding certain about a coin flip.
 */
export function whoLine(names: ScreenName[]): string | null {
  // A name in the strip above the bar wins outright, even with side-panel names on screen
  // beside it — that strip is the game telling us who the play is about. Two of them is a
  // graphic we do not understand, and gets the same silence as everything else ambiguous.
  const banner = names.filter((n) => n.via === "banner");
  if (banner.length > 1) return null;
  const n = banner[0] ?? (names.length === 1 ? names[0] : null);
  if (!n) return null;

  if (n.via === "banner") {
    return (
      `ON SCREEN AT THAT MOMENT: ${n.name}, in the player strip directly above the score bar — ` +
      "which is where the game names the man the play is about. Strong, but still a SCREEN " +
      "READ and not a box score: follow it the way a live booth does, and correct yourself " +
      "later if it turns out to be someone else."
    );
  }
  return (
    `ON SCREEN AT THAT MOMENT: ${n.name}${n.via === "jersey" ? " (by jersey number)" : ""}. ` +
    "This is a NAME THAT WAS LEGIBLE somewhere on screen, not a confirmed ball carrier — the " +
    "play-call screen and side graphics put names up too. You may follow it the way a live " +
    'booth does, hedged ("that looks like…"), and never as a flat statement of fact.'
  );
}

/** Every word on screen, for the one question the score bar cannot answer. */
export function screenWords(): Promise<LiveWord[]> {
  return invoke<LiveWord[]>("live_screen_words").catch(() => []);
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
