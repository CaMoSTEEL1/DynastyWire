// Regression tests for the deterministic recap core.
//
// These facts go straight into the front-page story a user reads, so every expectation is
// hand-computed from the fixture and a reader can check it without running anything. The
// quarter fixtures are deliberately asymmetric — a comeback and a collapse are the SAME
// scoreline from opposite sidelines, which is exactly the bug a symmetric fixture hides.

import { describe, expect, it } from "vitest";
import type { GameResult, RosterPlayer, SnapshotGame, TeamInfo } from "./client";
import {
  BAND_LABEL,
  castLine,
  gameFacts,
  marginBand,
  quarterSwing,
  recapBrief,
  recapCast,
  recapFacts,
  stakesFacts,
} from "./recap";

const P = (name: string, position: string, extra: Partial<RosterPlayer> = {}): RosterPlayer => ({
  name,
  position,
  year: "JR",
  overall: 80,
  jersey: null,
  ...extra,
});

const off = (line: Partial<NonNullable<RosterPlayer["stats"]>["offense"]>): RosterPlayer["stats"] => ({
  side: "offense",
  gamesPlayed: 8,
  gamesStarted: 8,
  offense: { gamesPlayed: 8, gamesStarted: 8, ...line },
});

const def = (line: Partial<NonNullable<RosterPlayer["stats"]>["defense"]>): RosterPlayer["stats"] => ({
  side: "defense",
  gamesPlayed: 8,
  gamesStarted: 8,
  defense: { gamesPlayed: 8, gamesStarted: 8, ...line },
});

const kick = (line: Partial<NonNullable<RosterPlayer["stats"]>["kicking"]>): RosterPlayer["stats"] => ({
  side: "kicking",
  gamesPlayed: 8,
  gamesStarted: 8,
  kicking: { gamesPlayed: 8, gamesStarted: 8, ...line },
});

const ROSTER: RosterPlayer[] = [
  P("Dorian Whitfield", "QB", { year: "SO", stats: off({ passYds: 2210, passTDs: 19, passInts: 5, passAtt: 280 }) }),
  P("Cale Rutherford", "QB", { stats: off({ passYds: 340, passTDs: 2, passInts: 1, passAtt: 44 }) }),
  P("Kellen Marsh", "HB", { stats: off({ rushYds: 940, rushTDs: 11, rushAtt: 168 }) }),
  P("Trey Vandiver", "WR", { stats: off({ recCatches: 52, recYds: 810, recTDs: 7 }) }),
  P("Isaiah Pruitt", "LB", { year: "SR", stats: def({ tackles: 74, sacks: 6, ints: 1 }) }),
  P("Bo Chastain", "K", { stats: kick({ fgMade: 14, fgAtt: 17, fgLong: 48 }) }),
];

const RESULT: GameResult = {
  week: 8,
  home: "Coastal Carolina",
  away: "Tulane",
  homeScore: 31,
  awayScore: 17,
  winner: "Coastal Carolina",
  loser: "Tulane",
  margin: 14,
  rankHome: null,
  rankAway: 9,
  userInvolved: true,
  simmed: false,
};

// Trailed 3-14 after one, level at half, took it in the fourth. A comeback from our side.
const GAME: SnapshotGame = {
  week: 8,
  year: 2029,
  homeRow: 1,
  awayRow: 2,
  homeScore: 31,
  awayScore: 17,
  played: true,
  simmed: false,
  homeQuarters: [3, 11, 7, 10],
  awayQuarters: [14, 0, 3, 0],
};

const USER_TEAM: TeamInfo = {
  row: 1,
  teamIndex: 1,
  name: "Coastal Carolina",
  nickname: "Chanticleers",
  city: null,
  wins: 6,
  losses: 2,
  confWins: 4,
  confLosses: 1,
  rankMedia: null,
  rankCoaches: null,
  rankCFP: null,
  prestige: null,
  ratingOVR: null,
};

const SCHEDULE: SnapshotGame[] = [
  { ...GAME, week: 5, homeQuarters: null, awayQuarters: null, homeScore: 10, awayScore: 24 }, // L
  { ...GAME, week: 6, homeQuarters: null, awayQuarters: null, homeScore: 28, awayScore: 21 }, // W
  { ...GAME, week: 7, homeQuarters: null, awayQuarters: null, homeScore: 35, awayScore: 14 }, // W
  GAME, // W, week 8
  { ...GAME, week: 9, played: false, homeScore: null, awayScore: null },
  { ...GAME, week: 10, played: false, homeScore: null, awayScore: null },
];

// ── The shape of the game ───────────────────────────────────────────────────────

describe("marginBand", () => {
  it("bands the margin the way a writer would", () => {
    expect(marginBand(3)).toBe("one-score");
    expect(marginBand(8)).toBe("one-score");
    expect(marginBand(14)).toBe("two-score");
    expect(marginBand(21)).toBe("comfortable");
    expect(marginBand(38)).toBe("runaway");
  });

  it("bands a loss by the same distance", () => {
    expect(marginBand(-14)).toBe(BAND_LABEL["two-score"] && "two-score");
  });
});

describe("quarterSwing", () => {
  it("reads a comeback from the trailing side", () => {
    const s = quarterSwing({ ours: [3, 11, 7, 10], theirs: [14, 0, 3, 0] })!;
    expect(s.running).toEqual([-11, 0, 4, 14]);
    expect(s.largestDeficit).toBe(11);
    expect(s.shape).toBe("comeback");
    expect(s.read).toContain("trailed by 11");
  });

  it("reads the SAME game from the other sideline as a collapse", () => {
    const s = quarterSwing({ ours: [14, 0, 3, 0], theirs: [3, 11, 7, 10] })!;
    expect(s.running).toEqual([11, 0, -4, -14]);
    expect(s.shape).toBe("collapse");
    expect(s.read).toContain("led by 11");
  });

  it("finds the quarter that actually moved the game", () => {
    const s = quarterSwing({ ours: [3, 11, 7, 10], theirs: [14, 0, 3, 0] })!;
    expect(s.biggestQuarter).toEqual({ quarter: 1, swing: -11 });
  });

  it("calls a wire-to-wire win what it is", () => {
    const s = quarterSwing({ ours: [10, 7, 7, 7], theirs: [0, 3, 0, 7] })!;
    expect(s.shape).toBe("wire-to-wire");
    expect(s.leadChanges).toBe(0);
    expect(s.read).toContain("never really in doubt");
  });

  it("counts lead changes for a back-and-forth", () => {
    const s = quarterSwing({ ours: [7, 0, 14, 0], theirs: [0, 14, 0, 10] })!;
    expect(s.running).toEqual([7, -7, 7, -3]);
    expect(s.leadChanges).toBe(3);
    expect(s.shape).toBe("back-and-forth");
  });

  it("returns null rather than guessing when quarters are missing", () => {
    expect(quarterSwing({ ours: [7, 7], theirs: [0, 3] })).toBeNull();
  });
});

describe("gameFacts", () => {
  const facts = gameFacts({ result: RESULT, userTeam: "Coastal Carolina", game: GAME });

  it("takes the user's perspective, not the home team's", () => {
    expect(facts.usScore).toBe(31);
    expect(facts.themScore).toBe(17);
    expect(facts.them).toBe("Tulane");
    expect(facts.won).toBe(true);
    expect(facts.location).toBe("home");
  });

  it("flags an unranked team beating a ranked one as an upset", () => {
    expect(facts.upset).toBe(true);
    expect(facts.upsetAgainst).toBe(false);
    expect(facts.themRank).toBe(9);
    expect(facts.usRank).toBeNull();
  });

  it("reads the game from the road team's side just as well", () => {
    const away = gameFacts({ result: RESULT, userTeam: "Tulane", game: GAME });
    expect(away.usScore).toBe(17);
    expect(away.won).toBe(false);
    expect(away.location).toBe("away");
    expect(away.upsetAgainst).toBe(true);
    expect(away.swing?.shape).toBe("collapse");
  });

  it("treats week 16 and later as a neutral site", () => {
    const bowl = gameFacts({
      result: { ...RESULT, week: 17 },
      userTeam: "Coastal Carolina",
      game: GAME,
      neutralSite: true,
    });
    expect(bowl.location).toBe("neutral");
  });

  it("notices overtime", () => {
    const ot = gameFacts({
      result: RESULT,
      userTeam: "Coastal Carolina",
      game: { ...GAME, homeOT: 7, awayOT: 0 },
    });
    expect(ot.overtime).toBe(true);
  });
});

// ── Stakes ──────────────────────────────────────────────────────────────────────

describe("stakesFacts", () => {
  const stakes = stakesFacts({ team: USER_TEAM, games: SCHEDULE, userRow: 1 });

  it("states the record and what is left, without inferring either from the week", () => {
    expect(stakes.record).toBe("6-2");
    expect(stakes.confRecord).toBe("4-1");
    expect(stakes.gamesPlayed).toBe(8);
    expect(stakes.gamesLeft).toBe(2);
  });

  it("computes the streak from the schedule", () => {
    expect(stakes.streak).toBe("three straight wins");
  });

  it("does the bowl math", () => {
    expect(stakes.bowlEligible).toBe(true);
    expect(stakes.winsToBowl).toBeNull();
    const short = stakesFacts({ team: { ...USER_TEAM, wins: 4, losses: 4 }, games: SCHEDULE, userRow: 1 });
    expect(short.winsToBowl).toBe(2);
  });

  it("says nothing rather than calling a single win a streak", () => {
    const oneGame = stakesFacts({ team: USER_TEAM, games: [SCHEDULE[3]], userRow: 1 });
    expect(oneGame.streak).toBeNull();
  });
});

// ── The cast ────────────────────────────────────────────────────────────────────

describe("recapCast", () => {
  const game = gameFacts({ result: RESULT, userTeam: "Coastal Carolina", game: GAME });

  it("picks the players the story could actually be about", () => {
    const cast = recapCast({ roster: ROSTER, team: "Coastal Carolina", game });
    const names = cast.map((c) => c.name);
    expect(names).toContain("Dorian Whitfield");
    expect(names).toContain("Kellen Marsh");
    expect(names).toContain("Trey Vandiver");
    expect(names).toContain("Isaiah Pruitt");
  });

  it("takes the starter over the backup at the same position", () => {
    const cast = recapCast({ roster: ROSTER, team: "Coastal Carolina", game });
    expect(cast.map((c) => c.name)).not.toContain("Cale Rutherford");
  });

  it("labels every number as a season total, never tonight's line", () => {
    const cast = recapCast({ roster: ROSTER, team: "Coastal Carolina", game });
    const qb = cast.find((c) => c.name === "Dorian Whitfield")!;
    expect(qb.seasonLine).toBe("SEASON TOTALS (not one game): 2210 pass yds, 19 TD, 5 INT");
    expect(qb.role).toBe("So quarterback");
  });

  it("also hands over the per-game average, which is the number a game story needs", () => {
    // The label alone has never been enough: a recap is about ONE game, the save has no box
    // score, and a writer with only a cumulative total on the page uses it as tonight's line
    // ("900+ yards in a single game with 100+ carries", from a real save). This is the true
    // number he can build that sentence on.
    const cast = recapCast({ roster: ROSTER, team: "Coastal Carolina", game });
    const rb = cast.find((c) => c.name === "Kellen Marsh")!;
    // Every figure states its own denominator: a back averaging 97.5 rush yards A GAME was
    // written up as "97.5 yards per carry", which is not a possible number.
    expect(rb.perGame).toContain("117.5 rush yds PER GAME");
    expect(rb.perGame).toContain("5.6 yds PER CARRY");
    expect(rb.perGame).toContain("never re-divide or re-label");
  });

  it("omits the average when one game cannot be told apart from the season", () => {
    const wk1 = [
      {
        ...ROSTER[2],
        stats: { side: "offense" as const, gamesPlayed: 1, gamesStarted: 1, offense: { gamesPlayed: 1, gamesStarted: 1, rushYds: 118, rushTDs: 2 } },
      },
    ];
    expect(recapCast({ roster: wk1, team: "Coastal Carolina", game })[0].perGame).toBeNull();
  });

  it("leaves the kicker out of a two-score game", () => {
    const cast = recapCast({ roster: ROSTER, team: "Coastal Carolina", game });
    expect(cast.map((c) => c.name)).not.toContain("Bo Chastain");
  });

  it("puts the kicker in the story when the margin is inside one score", () => {
    const tight = gameFacts({
      result: { ...RESULT, homeScore: 20, awayScore: 17 },
      userTeam: "Coastal Carolina",
      game: { ...GAME, homeScore: 20, awayScore: 17 },
    });
    const cast = recapCast({ roster: ROSTER, team: "Coastal Carolina", game: tight });
    expect(cast.map((c) => c.name)).toContain("Bo Chastain");
  });

  it("carries verified highlight plays through as this-game truth", () => {
    const cast = recapCast({
      roster: ROSTER,
      team: "Coastal Carolina",
      game,
      highlights: [{ text: "62-yard touchdown run", player: "Kellen Marsh" }],
    });
    const rb = cast.find((c) => c.name === "Kellen Marsh")!;
    expect(rb.verified).toEqual(["62-yard touchdown run"]);
    expect(castLine(rb)).toContain("verified in THIS game");
  });

  it("keeps an unavailable player on the list WITH the reason", () => {
    const cast = recapCast({
      roster: ROSTER,
      team: "Coastal Carolina",
      game,
      unavailable: [{ playerName: "Isaiah Pruitt", reason: "suspended, team discipline" }],
    });
    const lb = cast.find((c) => c.name === "Isaiah Pruitt")!;
    expect(lb.unavailable).toBe("suspended, team discipline");
    expect(castLine(lb)).toContain("OUT: suspended, team discipline");
  });
});

// ── The whole brief ─────────────────────────────────────────────────────────────

describe("recapFacts / recapBrief", () => {
  const facts = recapFacts({
    result: RESULT,
    userTeam: "Coastal Carolina",
    userTeamInfo: USER_TEAM,
    userRow: 1,
    games: SCHEDULE,
    roster: ROSTER,
    oppRoster: [P("Cortez Bly", "QB", { stats: off({ passYds: 2600, passTDs: 24, passAtt: 300 }) })],
    oppCoach: "Vincent Okafor",
    week: 8,
  });

  it("locks the score, the margin and how the game turned", () => {
    const brief = recapBrief(facts);
    expect(brief).toContain("beat #9 Tulane, 31-17, at home");
    expect(brief).toContain("Margin: 14 — a two-score game");
    expect(brief).toContain("How it turned:");
    expect(brief).toContain("trailed by 11");
  });

  it("states the record as final so it is never double-counted", () => {
    expect(recapBrief(facts)).toContain("This ALREADY includes this week's result");
  });

  it("tags every nameable person with the team that owns him", () => {
    const brief = recapBrief(facts);
    expect(brief).toContain("[Coastal Carolina] Kellen Marsh");
    expect(brief).toContain("[Tulane] Cortez Bly");
    expect(brief).toContain("Vincent Okafor — head coach");
  });

  it("keeps a verified play that could not be matched to a named player", () => {
    const withPlays = recapFacts({
      result: RESULT,
      userTeam: "Coastal Carolina",
      userTeamInfo: USER_TEAM,
      userRow: 1,
      games: SCHEDULE,
      roster: ROSTER,
      week: 8,
      highlights: [{ text: "blocked punt returned for a score" }, { text: "62-yard TD run", player: "Kellen Marsh" }],
    });
    const brief = recapBrief(withPlays);
    expect(brief).toContain("blocked punt returned for a score");
    expect(brief).toContain("62-yard TD run (Kellen Marsh)");
  });

  it("names the boundary of what anyone can know", () => {
    const brief = recapBrief(facts);
    expect(brief).toContain("SEASON TOTAL");
    expect(brief).toContain("Drive charts");
  });

  it("tells the writer to use roles when the opponent's roster is missing", () => {
    const blind = recapFacts({
      result: RESULT,
      userTeam: "Coastal Carolina",
      userTeamInfo: USER_TEAM,
      userRow: 1,
      games: SCHEDULE,
      roster: ROSTER,
      week: 8,
    });
    expect(recapBrief(blind)).toContain("never by name");
  });

  it("degrades to the stakes alone when there is no game this week", () => {
    const bye = recapFacts({
      result: null,
      userTeam: "Coastal Carolina",
      userTeamInfo: USER_TEAM,
      userRow: 1,
      games: SCHEDULE,
      roster: ROSTER,
    });
    expect(bye.game).toBeNull();
    expect(bye.stakes?.record).toBe("6-2");
    const brief = recapBrief(bye);
    // Wording must follow the week state. "already includes this week's result" alongside
    // "this game has not been played yet" is a contradiction the model refuses to write
    // through — it shipped once and produced a meta-refusal in place of an article.
    expect(brief).toContain("Record entering this week: 6-2");
    expect(brief).not.toContain("ALREADY includes");
    expect(brief).toContain("NO game has been played this week");
  });
});
