// What this team is actually playing for — computed, not guessed.
//
// From a tester's first full season, all three of these in one save:
//   - a Sun Belt bowl game written as "a first round playoff matchup"
//   - "fighting for bowl eligibility" at 7-3, weeks after clinching it
//   - "pushing for a New Year's Six bid" while unranked all year
//
// Every one is the same failure. The context stated the WEEK ("BowlSeason1") and left the
// STAKES to the model, which reached for the stakes that a postseason week usually carries
// in the football it was trained on — the playoff. But 122 of 134 teams are not in the
// bracket, so the default was wrong for almost everyone.
//
// The save can settle this. Bowl eligibility is arithmetic on the record and the schedule.
// Playoff membership is the CFP poll. So code decides what is at stake and hands over prose
// the writer may not contradict; the model still owns whether it MEANS anything.

import type { DynastyCalendar, SnapshotGame, TeamInfo } from "./client";

// ── Where the calendar is ───────────────────────────────────────────────────────

export interface WeekShape {
  inOffseason: boolean;
  inPostseason: boolean;
  /** 1-indexed postseason round, when in one. */
  round: number;
  /** Rounds the save says the postseason runs. */
  roundsTotal: number;
  confChampWeek: number;
}

/**
 * Read the calendar once. Both `computePhase` and the outlook need to know whether this is
 * a postseason week, and two copies of that rule WILL disagree eventually — the codebase
 * has already paid for that lesson once (see `teamsToLoad`, shared by the fetch and the
 * prompt so they can never diverge about which programs matter).
 */
export function weekShape(
  calendar: DynastyCalendar | null | undefined,
  weekPlayed: number | null | undefined
): WeekShape {
  const w = weekPlayed ?? 0;
  const confChampWeek = calendar?.confChampWeek ?? 16;
  const roundsTotal = calendar?.postSeasonWeeks ?? 4;
  const weekType = calendar?.weekType ?? null;
  const stage = calendar?.stage ?? null;

  const inOffseason =
    (!!stage && /off\s*season|offseason/i.test(stage)) ||
    (!!weekType && /off\s*season|offseason/i.test(weekType));

  const bowlMatch = weekType ? /^BowlSeason(\d+)$/i.exec(weekType) : null;
  const inPostseason = !inOffseason && (!!bowlMatch || w > confChampWeek);
  const round = bowlMatch ? Number(bowlMatch[1]) : Math.max(1, w - confChampWeek);

  return { inOffseason, inPostseason, round, roundsTotal, confChampWeek };
}

/** The 12-team field. Derived from the save's own postseason length where possible — four
 * rounds is the 12-team bracket — so a future format change follows the save, not a
 * constant nobody remembers to update. */
export function fieldSize(calendar: DynastyCalendar | null | undefined): number {
  const rounds = calendar?.postSeasonWeeks ?? 4;
  if (rounds >= 4) return 12;
  if (rounds === 3) return 8;
  return 4;
}

export type PlayoffStanding =
  /** In the CFP field as the poll currently stands. */
  | "in-field"
  /** Ranked and close enough that the field is a live argument. */
  | "contender"
  /** Ranked, but would need help it has no reason to expect. */
  | "longshot"
  /** Unranked. Not in the conversation, and no amount of narrative makes it one. */
  | "out";

export interface PostseasonOutlook {
  wins: number;
  losses: number;
  /** Regular-season games still on the schedule. */
  gamesLeft: number;
  /** The most wins still reachable. */
  maxWins: number;
  bowlEligible: boolean;
  /** Cannot reach six wins even by winning out. */
  bowlEliminated: boolean;
  winsToBowl: number | null;
  cfpRank: number | null;
  mediaRank: number | null;
  /** False before the committee's first release, when no team has a CFP number at all. */
  cfpReleased: boolean;
  standing: PlayoffStanding;
  /** True when the team is playing a POSTSEASON game and is not in the bracket — i.e. an
   * ordinary bowl game, which is what almost every postseason team is playing. */
  inNonPlayoffBowl: boolean;
  /** True when they are in the bracket and playing in it. */
  inPlayoffGame: boolean;
  /** The stakes, in prose the story may not contradict. */
  lines: string[];
}

export interface PostseasonInput {
  team: TeamInfo | null;
  games: SnapshotGame[];
  userRow: number | null | undefined;
  calendar: DynastyCalendar | null | undefined;
  week: number | null | undefined;
  /** True once the save says we are in a postseason week (computed by computePhase). */
  inPostseason: boolean;
  /**
   * Whether the CFP committee has released a poll at all yet. Before the first release every
   * team's rankCFP is null, which is NOT the same as being left out of it — treating it as
   * "unranked" had the press asking about a snub in September, weeks before the first
   * rankings existed. Defaults to true so an omitted flag keeps the old behaviour.
   */
  cfpReleased?: boolean;
}

const ranked = (n: number | null | undefined): number | null =>
  typeof n === "number" && n >= 1 && n <= 25 ? n : null;

export function postseasonOutlook(input: PostseasonInput): PostseasonOutlook | null {
  const t = input.team;
  if (!t) return null;

  const wins = t.wins ?? 0;
  const losses = t.losses ?? 0;
  const row = input.userRow;
  const confChamp = input.calendar?.confChampWeek ?? 16;
  const mine = row == null ? [] : input.games.filter((g) => g.homeRow === row || g.awayRow === row);
  // Only REGULAR-season games count toward the six-win line; a bowl win never made anyone
  // bowl eligible, and counting postseason games here would say a bowl team still has one
  // more chance to qualify for the bowl it is currently playing in.
  const gamesLeft = mine.filter((g) => !g.played && (g.week ?? 0) <= confChamp).length;
  const maxWins = wins + gamesLeft;

  const cfpRank = ranked(t.rankCFP);
  const mediaRank = ranked(t.rankMedia);
  const size = fieldSize(input.calendar);
  const cfpReleased = input.cfpReleased !== false;

  // Before the committee's first release the AP poll is the only field there is, so it stands
  // in as the proxy. After it, the CFP poll is the only one that decides anything.
  let standing: PlayoffStanding;
  if (cfpRank != null && cfpRank <= size) standing = "in-field";
  else if (!cfpReleased && mediaRank != null && mediaRank <= size) standing = "in-field";
  else if ((cfpRank != null && cfpRank <= size + 6) || (mediaRank != null && mediaRank <= size + 3)) {
    standing = "contender";
  } else if (cfpRank != null || mediaRank != null) standing = "longshot";
  else standing = "out";

  const inPlayoffGame = input.inPostseason && standing === "in-field";
  const inNonPlayoffBowl = input.inPostseason && !inPlayoffGame;

  const bowlEligible = wins >= 6;
  const bowlEliminated = maxWins < 6;
  const lines: string[] = [];

  lines.push(
    `Record ${wins}-${losses}` +
      (input.inPostseason
        ? "."
        : ` · ${gamesLeft} regular-season game${gamesLeft === 1 ? "" : "s"} left · ${maxWins} wins reachable at most.`)
  );

  // ── The bowl line ─────────────────────────────────────────────────────────────
  if (input.inPostseason) {
    lines.push("They are IN the postseason — bowl eligibility is settled and behind them.");
  } else if (bowlEligible) {
    lines.push(
      "BOWL: ALREADY BOWL ELIGIBLE (six wins are in hand) — they ARE going to a bowl. NEVER " +
        "write that they are fighting for, chasing, on the brink of, or one win from bowl " +
        "eligibility. That question is CLOSED; what's live is WHICH bowl, and seeding within it."
    );
  } else if (bowlEliminated) {
    lines.push(
      `BOWL: MATHEMATICALLY ELIMINATED — ${maxWins} wins is the ceiling and six is the line. ` +
        "There is no bowl to play for. Do not write a bowl push."
    );
  } else {
    const need = 6 - wins;
    lines.push(
      `BOWL: NOT yet eligible — ${need} more win${need === 1 ? "" : "s"} needed from ${gamesLeft} ` +
        "remaining. THIS is the live stakes; the playoff is not."
    );
  }

  // ── The playoff line ──────────────────────────────────────────────────────────
  const pollState =
    cfpRank != null
      ? `#${cfpRank} in the CFP rankings`
      : !cfpReleased
        ? mediaRank != null
          ? `#${mediaRank} in the AP poll — THE CFP RANKINGS HAVE NOT BEEN RELEASED YET this season, ` +
            "so nobody has a CFP number. Never write, ask, or imply that they were left out of, " +
            "snubbed by, or omitted from the CFP rankings; there is nothing yet to be left out of"
          : "UNRANKED in the AP poll — THE CFP RANKINGS HAVE NOT BEEN RELEASED YET this season, so " +
            "nobody has a CFP number. Never write, ask, or imply a CFP snub; there is nothing yet " +
            "to be left out of"
        : mediaRank != null
          ? `UNRANKED in the CFP rankings (#${mediaRank} in the AP poll)`
          : "UNRANKED in both the CFP rankings and the AP poll";

  if (inPlayoffGame) {
    lines.push(
      `PLAYOFF: they are ${pollState} and IN the ${size}-team field — this postseason game IS a ` +
        "playoff game."
    );
  } else if (inNonPlayoffBowl) {
    lines.push(
      `PLAYOFF: they are ${pollState} and are NOT in the ${size}-team field.`,
      "THIS IS AN ORDINARY BOWL GAME, NOT A PLAYOFF GAME. It is ONE game and the season ends " +
        "when it does, win or lose. There is no bracket, nothing to advance to, and nothing to " +
        "be eliminated from. NEVER call it a playoff game, a playoff round, a first-round or " +
        "opening-round matchup, a quarterfinal, a semifinal, a New Year's Six bowl, or a step " +
        "toward a national title. The playoff is happening WITHOUT this team.",
      "The bowl's NAME is not in the save. Call it \"the bowl game\" / \"their bowl\" — never " +
        "assert a specific named bowl."
    );
  } else if (standing === "out") {
    lines.push(
      `PLAYOFF: ${pollState}. They are NOT in the playoff race — not in the field, not on the ` +
        "bubble, not a New Year's Six candidate, and not a team the selection committee is " +
        "discussing. Do NOT write about a playoff push, playoff hopes, seeding, at-large bids, " +
        "résumé-building for the committee, or a New Year's Six berth. None of it applies here. " +
        "The postseason realistically on the table is a regular bowl game."
    );
  } else if (standing === "longshot") {
    lines.push(
      `PLAYOFF: ${pollState} — ranked, but well outside the ${size}-team field. Treat the playoff ` +
        "as a long shot that would need significant help, never as the working assumption. No " +
        "New Year's Six talk unless they climb."
    );
  } else if (standing === "contender") {
    lines.push(
      `PLAYOFF: ${pollState} — outside the ${size}-team field but close enough that it is a live ` +
        "argument. Frame it as a climb they have not made yet, never as a spot they hold."
    );
  } else {
    lines.push(
      `PLAYOFF: ${pollState} — inside the ${size}-team field as it stands today. That is a ` +
        "current standing, not a clinched berth."
    );
  }

  return {
    wins,
    losses,
    gamesLeft,
    maxWins,
    bowlEligible,
    bowlEliminated,
    winsToBowl: bowlEligible ? null : 6 - wins,
    cfpRank,
    mediaRank,
    cfpReleased,
    standing,
    inNonPlayoffBowl,
    inPlayoffGame,
    lines,
  };
}

/** The block as it appears in the shared context. */
export function postseasonBlock(outlook: PostseasonOutlook | null): string | null {
  if (!outlook) return null;
  return [
    "=== WHAT THEY ARE PLAYING FOR (computed from the record, the schedule and the polls —",
    "these are the stakes, and they are not open to interpretation) ===",
    ...outlook.lines.map((l) => `  ${l}`),
  ].join("\n");
}
