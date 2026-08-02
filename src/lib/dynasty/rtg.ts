// Road to Glory — the deterministic core.
//
// Same contract as scouting.ts / recap.ts / postseason.ts: everything here is computed from the
// save, and the model writes prose around locked tables it may not contradict.
//
// RTG has one advantage dynasty never had, and it shapes this whole file. In dynasty the save
// gives season totals and no box score, so a game story can only ever say what a player did
// ALL YEAR. Here we follow ONE player across two snapshots — so subtracting last week's line
// from this week's yields **his actual game**. A real per-game stat line, computed, not invented.
// That is the single biggest reason RTG coverage can be better than dynasty coverage rather
// than a thinner version of it.
//
// The honest limit: this needs a baseline. Without one — first ingest, or the user simmed three
// weeks before opening the app — the diff is unattributable, and every function below says so
// rather than guessing.

import type { RosterPlayer, RosterStats, RtgPlayer, SchoolInterest } from "./client";

// ── Where he stands this week ───────────────────────────────────────────────────

export type PlayerWeekState =
  /** No baseline to compare against — we cannot say what happened. */
  | "unknown"
  /** Games played did not move. He did not take the field. */
  | "did-not-play"
  /** He appeared but did not start. */
  | "played-off-bench"
  /** Games started moved for the FIRST time in his career at this point. */
  | "first-start"
  /** He started, and had started before. */
  | "starter"
  /** More than one game happened since we last looked; we can't attribute a week. */
  | "multi-week-gap";

export const WEEK_STATE_LABEL: Record<PlayerWeekState, string> = {
  unknown: "no baseline — playing time unknown",
  "did-not-play": "did NOT play",
  "played-off-bench": "played, did not start",
  "first-start": "made his FIRST career start",
  starter: "started",
  "multi-week-gap": "more than one game has passed since the last check",
};

// NOTE: the design doc listed `mop-up` and `rotational` as separate states. The save carries
// GAMESPLAYED / GAMESSTARTED and NOT snap counts, so those two are not distinguishable from
// each other — inventing the distinction would put a confident wrong claim ("mop-up duty") in
// front of the writer. Collapsed to `played-off-bench` until a snap source is found.

const n = (v: number | null | undefined): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function side(s: RosterStats | null | undefined) {
  if (!s) return null;
  return s.offense ?? s.defense ?? s.kicking ?? (s as unknown as NonNullable<RosterStats["offense"]>);
}

export interface PlayingTime {
  state: PlayerWeekState;
  gamesPlayed: number;
  gamesStarted: number;
  /** Games played since the baseline. 0 means he did not take the field. */
  gamesSinceBaseline: number;
  /** Consecutive weeks with no appearance, when we can tell. */
  hasBaseline: boolean;
}

export function playingTime(
  current: RtgPlayer | null | undefined,
  baseline: RtgPlayer | null | undefined
): PlayingTime {
  const cur = current?.stats ?? null;
  const gp = n(cur?.gamesPlayed);
  const gs = n(cur?.gamesStarted);
  if (!baseline || !baseline.stats) {
    return { state: "unknown", gamesPlayed: gp, gamesStarted: gs, gamesSinceBaseline: 0, hasBaseline: false };
  }
  const prevGp = n(baseline.stats.gamesPlayed);
  const prevGs = n(baseline.stats.gamesStarted);
  const dGp = gp - prevGp;
  const dGs = gs - prevGs;

  let state: PlayerWeekState;
  if (dGp <= 0) state = "did-not-play";
  else if (dGp > 1) state = "multi-week-gap";
  else if (dGs > 0) state = prevGs === 0 ? "first-start" : "starter";
  else state = "played-off-bench";

  return { state, gamesPlayed: gp, gamesStarted: gs, gamesSinceBaseline: Math.max(0, dGp), hasBaseline: true };
}

// ── His actual game ─────────────────────────────────────────────────────────────

export interface WeekLine {
  passYds: number; passTDs: number; passInts: number; passComp: number; passAtt: number;
  rushYds: number; rushAtt: number; rushTDs: number;
  recYds: number; recCatches: number; recTDs: number;
  tackles: number; sacks: number; ints: number;
}

/**
 * THIS WEEK'S line — season totals minus the baseline's. Only returned when exactly one game
 * happened in between, because that is the only case where the difference is attributable to a
 * single game. Anything else returns null and the caller must say the line is unknown rather
 * than present a multi-game total as one performance — the precise mistake that produced
 * "900+ yards in a single game" on the dynasty side.
 */
export function weekLine(
  current: RtgPlayer | null | undefined,
  baseline: RtgPlayer | null | undefined,
  time: PlayingTime
): WeekLine | null {
  if (time.state !== "played-off-bench" && time.state !== "first-start" && time.state !== "starter") {
    return null;
  }
  if (time.gamesSinceBaseline !== 1) return null;
  const c = side(current?.stats);
  const b = side(baseline?.stats);
  if (!c) return null;
  const d = (k: keyof NonNullable<ReturnType<typeof side>>): number =>
    Math.max(0, n(c[k] as number | null) - n(b ? (b[k] as number | null) : 0));
  return {
    passYds: d("passYds"), passTDs: d("passTDs"), passInts: d("passInts"),
    passComp: d("passComp"), passAtt: d("passAtt"),
    rushYds: d("rushYds"), rushAtt: d("rushAtt"), rushTDs: d("rushTDs"),
    recYds: d("recYds"), recCatches: d("recCatches"), recTDs: d("recTDs"),
    tackles: d("tackles"), sacks: d("sacks"), ints: d("ints"),
  };
}

/** The game line as a writer would state it, or null when he did nothing countable. */
export function weekLineText(line: WeekLine | null): string | null {
  if (!line) return null;
  const bits: string[] = [];
  // Guarded on EITHER the attempt or the yardage, matching seasonLineOf() in recap.ts: a save
  // that carries yards without attempts would otherwise drop the line silently, which reads
  // to the writer as "he did nothing" — the opposite of the truth.
  if (line.passAtt || line.passYds) {
    bits.push(`${line.passComp}/${line.passAtt}, ${line.passYds} yds, ${line.passTDs} TD${line.passInts ? `, ${line.passInts} INT` : ""}`);
  }
  if (line.rushAtt || line.rushYds) bits.push(`${line.rushAtt} car, ${line.rushYds} yds, ${line.rushTDs} TD`);
  if (line.recCatches || line.recYds) bits.push(`${line.recCatches} rec, ${line.recYds} yds, ${line.recTDs} TD`);
  if (line.tackles || line.sacks || line.ints) {
    bits.push(`${line.tackles} tkl${line.sacks ? `, ${line.sacks} sacks` : ""}${line.ints ? `, ${line.ints} INT` : ""}`);
  }
  return bits.length ? bits.join("; ") : null;
}

// ── Recruitment ─────────────────────────────────────────────────────────────────

export interface RecruitmentBoard {
  offers: SchoolInterest[];
  /** Schools showing real interest that have not offered. */
  interested: SchoolInterest[];
  decommittedFrom: SchoolInterest[];
  total: number;
}

export function recruitmentBoard(interest: SchoolInterest[] | undefined, limit = 10): RecruitmentBoard {
  const all = (interest ?? []).filter((s) => s.school);
  const offered = (s: SchoolInterest) => !!s.offerStatus && !/^(none|invalid|)$/i.test(s.offerStatus);
  return {
    offers: all.filter(offered).slice(0, limit),
    interested: all.filter((s) => !offered(s)).slice(0, limit),
    decommittedFrom: all.filter((s) => s.decommitted === true),
    total: all.length,
  };
}

// ── The locked table ────────────────────────────────────────────────────────────

export interface RtgFactsInput {
  player: RtgPlayer | null | undefined;
  baseline: RtgPlayer | null | undefined;
  school: string | null;
  interest?: SchoolInterest[];
  /** The team's result this week, already computed by the existing recap core. */
  teamResult?: string | null;
}

export interface RtgFacts {
  time: PlayingTime;
  line: WeekLine | null;
  lineText: string | null;
  board: RecruitmentBoard;
  /** Statements the story may not contradict. */
  locked: string[];
  /** What nobody can know. */
  unknown: string[];
}

export function rtgFacts(input: RtgFactsInput): RtgFacts {
  const p = input.player ?? null;
  const time = playingTime(p, input.baseline);
  const line = weekLine(p, input.baseline, time);
  const lineText = weekLineText(line);
  const board = recruitmentBoard(input.interest);

  const locked: string[] = [];
  if (p) {
    locked.push(
      `${p.name ?? "The player"} — ${p.classYear ?? "unknown class"} ${p.position ?? "player"}` +
        `${input.school ? ` at ${input.school}` : ""}${p.homeState ? `, from ${p.homeState}` : ""}.`
    );
    if (p.prospectStars) {
      locked.push(
        `He came out of high school a ${p.prospectStars.replace(/_/g, " ").toLowerCase()} recruit. ` +
          "That is what he WAS rated, not what he is now — never restate it as his current standing."
      );
    }
    if (p.redshirt) locked.push(`Redshirt status: ${p.redshirt}.`);
    if (p.injuryStatus && !/uninjured/i.test(p.injuryStatus)) locked.push(`INJURY: ${p.injuryStatus}.`);
  }

  locked.push(`THIS WEEK he ${WEEK_STATE_LABEL[time.state]}.`);
  if (time.hasBaseline) {
    locked.push(`Season to date: ${time.gamesPlayed} games played, ${time.gamesStarted} started.`);
  }
  if (lineText) {
    locked.push(`HIS LINE IN THIS GAME (computed, real, not a season total): ${lineText}.`);
  } else if (time.state === "did-not-play") {
    locked.push(
      "He recorded NOTHING this week because he was not on the field. Do not give him a stat, " +
        "a snap, a rep in the game, or a moment in it."
    );
  }
  if (input.teamResult) locked.push(`The team: ${input.teamResult}`);

  if (board.offers.length) {
    locked.push(`Schools with a live offer out to him: ${board.offers.map((o) => o.school).join(", ")}.`);
  }
  if (board.decommittedFrom.length) {
    locked.push(`He has DECOMMITTED from: ${board.decommittedFrom.map((o) => o.school).join(", ")}.`);
  }

  const unknown = [
    "His snap count, his practice reps, and anything a coach said to him privately. Invent those " +
      "as colour if the piece needs them, never as reported fact.",
    "What the coaching staff intends to do with him next week. Nobody has told anyone that.",
    // Found by the gate: with nothing locking the team's game, all three test pieces invented
    // one — a scoreline, a lead, a record. The player's week is the subject, but a story about
    // a football player inevitably reaches for the football around him.
    "THE TEAM'S SCORE, RESULT, LEAD AND RECORD, unless stated above. Do NOT write that the team " +
      "was ahead, behind, won, lost, or holds any record. Do not invent a scoreline, a margin, " +
      "or how many games are left. If it is not in the locked facts, the game around him is " +
      "UNKNOWN and the piece must be written without it.",
  ];
  if (time.state === "multi-week-gap") {
    unknown.push(
      "WHICH week he played. More than one game has passed since the last reading, so his " +
        "recent playing time cannot be attributed to a single week — do not pin it to one."
    );
  }
  if (!time.hasBaseline) {
    unknown.push(
      "Whether he played THIS WEEK. There is no previous reading to compare against, so write " +
        "about where he stands overall and never claim he did or did not play."
    );
  }

  return { time, line, lineText, board, locked, unknown };
}

/** The brief the writer is handed. */
export function rtgBrief(facts: RtgFacts): string {
  const parts = [
    "=== LOCKED FACTS (computed from the save — every one is true, none may be contradicted) ===",
    ...facts.locked.map((l) => `  ${l}`),
    "",
    "=== NOT IN THE SAVE (do not state these as fact) ===",
    ...facts.unknown.map((u) => `  ${u}`),
  ];
  return parts.join("\n");
}

// ── Who is ahead of him ─────────────────────────────────────────────────────────
//
// `ForcedDepthChartEntry` turned out to be unusable on its own: a real save carried TWO QB rows
// and nothing said which was the user's. So the room is reconstructed from the roster instead —
// everyone at his position, ordered by what they have actually DONE this season rather than by
// a rating, which is both more honest and the only ordering the no-ratings rule allows.

export interface RoomMate {
  name: string;
  classYear: string | null;
  /** Season production, already in words. Null when he has no line. */
  line: string | null;
  gamesStarted: number;
  isUser: boolean;
}

const prod = (p: RosterPlayer): number => {
  const s = side(p.stats);
  if (!s) return 0;
  return n(s.passYds) + n(s.rushYds) + n(s.recYds) + n(s.tackles) * 12 + n(s.sacks) * 60;
};

/**
 * His position room, best season so far first. Starts are the tiebreak because the depth chart
 * is decided by who the staff actually plays, not by who has the prettiest total.
 */
export function positionRoom(
  roster: RosterPlayer[] | undefined,
  player: RtgPlayer | null | undefined
): RoomMate[] {
  if (!roster?.length || !player?.position) return [];
  const pos = player.position.toUpperCase();
  const mine = (player.name ?? "").toLowerCase();
  return roster
    .filter((p) => (p.position ?? "").toUpperCase() === pos)
    .sort((a, b) => {
      const gs = n(b.stats?.gamesStarted) - n(a.stats?.gamesStarted);
      return gs !== 0 ? gs : prod(b) - prod(a);
    })
    .map((p) => {
      const s = side(p.stats);
      const bits: string[] = [];
      if (s) {
        if (n(s.passYds)) bits.push(`${n(s.passYds)} pass yds, ${n(s.passTDs)} TD`);
        if (n(s.rushYds)) bits.push(`${n(s.rushYds)} rush yds, ${n(s.rushTDs)} TD`);
        if (n(s.recYds)) bits.push(`${n(s.recCatches)} rec, ${n(s.recYds)} yds`);
        if (n(s.tackles)) bits.push(`${n(s.tackles)} tkl`);
      }
      return {
        name: p.name,
        classYear: p.year ?? null,
        line: bits.length ? bits.join("; ") : null,
        gamesStarted: n(p.stats?.gamesStarted),
        isUser: p.name.toLowerCase() === mine,
      };
    });
}

/** Where he sits in that room, 1-indexed, or null when he isn't in it. */
export function depthOf(room: RoomMate[]): number | null {
  const i = room.findIndex((r) => r.isUser);
  return i < 0 ? null : i + 1;
}

/** The room as the writer is handed it — names and production, never a rating. */
export function roomBlock(room: RoomMate[], position: string | null): string | null {
  if (!room.length) return null;
  const depth = depthOf(room);
  return [
    `=== THE ${(position ?? "POSITION").toUpperCase()} ROOM (real — ordered by starts, then production) ===`,
    ...room.map((r, i) => {
      const mark = r.isUser ? " ← HIM" : "";
      const starts = r.gamesStarted ? `${r.gamesStarted} starts` : "no starts";
      return `  ${i + 1}. ${r.name}${r.classYear ? ` (${r.classYear})` : ""} — ${starts}${r.line ? `; ${r.line}` : ""}${mark}`;
    }),
    depth
      ? `  He is ${depth} of ${room.length} in the room. That is the gap the season is about.`
      : "  He is not listed in this room — do not claim a depth position for him.",
  ].join("\n");
}
