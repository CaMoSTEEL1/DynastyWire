// What the recap writer is actually handed.
//
// The v2 port is a claim about the PROMPT — that code now settles how the game turned and
// who may be named, and the model gets a short locked table instead of a 40-player dump it
// has to reason over. That claim belongs under test, so this file builds the real prompt
// through the real context builder and asserts on it.
//
// gen.ts reaches the Tauri bridge for its transport, which does not exist in node; the two
// mocks below stand in for it. Nothing here makes a network call.

import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: class {
    async get() {
      return null;
    }
    async set() {}
    async save() {}
  },
}));

import type { DynastySnapshot, RosterPlayer, SnapshotGame, TeamInfo, WeekDelta } from "./client";
import type { SeasonRecord } from "./archive";

type Gen = typeof import("./gen");
let gen: Gen;
beforeAll(async () => {
  gen = await import("./gen");
});

const P = (name: string, position: string, extra: Partial<RosterPlayer> = {}): RosterPlayer => ({
  name,
  position,
  year: "JR",
  overall: 80,
  jersey: null,
  ...extra,
});

// Forty players, which is exactly what the old prompt shipped in full.
const ROSTER: RosterPlayer[] = [
  P("Dorian Whitfield", "QB", {
    stats: { side: "offense", gamesPlayed: 8, gamesStarted: 8, offense: { gamesPlayed: 8, gamesStarted: 8, passYds: 2210, passTDs: 19, passInts: 5, passAtt: 280 } },
  }),
  P("Kellen Marsh", "HB", {
    stats: { side: "offense", gamesPlayed: 8, gamesStarted: 8, offense: { gamesPlayed: 8, gamesStarted: 8, rushYds: 940, rushTDs: 11, rushAtt: 168 } },
  }),
  P("Isaiah Pruitt", "LB", {
    stats: { side: "defense", gamesPlayed: 8, gamesStarted: 8, defense: { gamesPlayed: 8, gamesStarted: 8, tackles: 74, sacks: 6 } },
  }),
  ...Array.from({ length: 37 }, (_, i) => P(`Depth Player${i}`, i % 2 ? "WR" : "CB")),
];

const team = (over: Partial<TeamInfo> & { row: number; name: string }): TeamInfo => ({
  teamIndex: over.row,
  nickname: null,
  city: null,
  wins: 0,
  losses: 0,
  confWins: null,
  confLosses: null,
  rankMedia: null,
  rankCoaches: null,
  rankCFP: null,
  prestige: null,
  ratingOVR: null,
  ...over,
});

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

const SNAPSHOT: DynastySnapshot = {
  week: 8,
  year: 2029,
  dynastyYear: 3,
  calendar: { weekType: "RegularSeason", stage: null, postSeasonWeeks: 4, regularSeasonLastWeek: 15, confChampWeek: 15 },
  coachName: "Ray Deleon",
  coach: null,
  tableCount: 0,
  userTeamRow: 1,
  userTeam: team({ row: 1, name: "Coastal Carolina", wins: 6, losses: 2, confWins: 4, confLosses: 1 }),
  teams: {
    "1": team({ row: 1, name: "Coastal Carolina", wins: 6, losses: 2, confWins: 4, confLosses: 1 }),
    "2": team({ row: 2, name: "Tulane", wins: 7, losses: 1, rankMedia: 9 }),
  },
  games: [GAME, { ...GAME, week: 9, played: false, homeScore: null, awayScore: null }],
  headCoaches: { "2": "Vincent Okafor" },
};

const DELTA: WeekDelta = {
  weekPlayed: 8,
  userTeam: "Coastal Carolina",
  gamesPlayed: 1,
  userResult: {
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
  },
  results: [],
  rankingMoves: [],
};

const opts = { roster: ROSTER, oppRoster: [P("Cortez Bly", "QB")] };

const gamePrompt = () =>
  gen.buildSpec("recap-lead", gen.buildMediaContext(DELTA, SNAPSHOT, opts), {}).prompt;

describe("recap-lead, ported to the deterministic core", () => {
  it("hands over the computed result, margin and swing as locked facts", () => {
    const p = gamePrompt();
    expect(p).toContain("LOCKED FACTS");
    expect(p).toContain("beat #9 Tulane, 31-17, at home");
    expect(p).toContain("Margin: 14 — a two-score game");
    expect(p).toContain("trailed by 11");
  });

  it("stops asking the writer to work out how the game turned", () => {
    expect(gamePrompt()).toContain("HOW IT TURNED is computed for you");
  });

  it("replaces the 40-player dump with a short tagged cast", () => {
    const p = gamePrompt();
    expect(p).not.toContain("=== YOUR ROSTER");
    expect(p).toContain("THE ONLY PEOPLE YOU MAY NAME");
    expect(p).toContain("[Coastal Carolina] Kellen Marsh");
    expect(p).not.toContain("Depth Player30");
  });

  it("keeps the opponent's real head coach and drops the invented-name risk", () => {
    expect(gamePrompt()).toContain("Vincent Okafor — head coach");
  });

  it("still hands over the voice — house style and the beat writer survive the port", () => {
    const p = gamePrompt();
    expect(p).toContain("HOUSE STYLE");
    expect(p).toContain("veteran beat writer");
    expect(p).toContain("yours to see and report");
  });

  it("states the boundary of the save instead of hoping the model infers it", () => {
    const p = gamePrompt();
    expect(p).toContain("NOT IN THE SAVE");
    expect(p).toContain("SEASON TOTAL");
  });

  it("is materially shorter than the shared context it replaced", () => {
    const ctx = gen.buildMediaContext(DELTA, SNAPSHOT, opts);
    const ported = gen.buildSpec("recap-lead", ctx, {}).prompt.length;
    // The old prompt was the same instructions plus the whole shared blob.
    const before = ported + ctx.userContext.length;
    expect(ported).toBeLessThan(before * 0.7);
  });
});

describe("recap-lead on a week with no game", () => {
  const byeDelta: WeekDelta = { ...DELTA, userResult: null, weekPlayed: 9 };
  const byeSnapshot: DynastySnapshot = {
    ...SNAPSHOT,
    week: 9,
    games: [{ ...GAME, week: 9, played: false, homeScore: null, awayScore: null }],
  };
  const byePrompt = () =>
    gen.buildSpec("recap-lead", gen.buildMediaContext(byeDelta, byeSnapshot, opts), {}).prompt;

  it("keeps the shared context, which still carries the material", () => {
    expect(byePrompt()).toContain("=== YOUR ROSTER");
  });

  it("but locks the record and the streak, which is what gets miscounted in a column", () => {
    const p = byePrompt();
    expect(p).toContain("LOCKED FACTS");
    expect(p).toContain("Record entering this week: 6-2");
  });

  it("never tells a no-game week that the record includes this week's result", () => {
    // Shipped once: the prompt said the game had not been played AND that the record
    // already included its result. The model refused to write and explained why, and the
    // refusal was rendered as the article.
    const p = byePrompt();
    expect(p).not.toContain("ALREADY includes");
    expect(p).toContain("NO game has been played this week");
  });

  it("states the season year so nothing dates itself to a real-world year", () => {
    expect(gamePrompt()).toContain("Season: 2029");
  });

  it("never claims a game happened", () => {
    expect(byePrompt()).not.toContain("31-17");
  });
});

// ── No ratings, anywhere ────────────────────────────────────────────────────────
// A rating number in an article is the loudest possible tell that a video game wrote it.
// Nobody in football says "our 87 overall left tackle". The save's 0-99 stays in the app for
// sorting and math and must never reach a prompt — the scouting report has graded in words
// since v0.1.9, and this asserts the same rule now holds on every other surface.

describe("the media never sees a rating number", () => {
  const RATED: RosterPlayer[] = [
    P("Dorian Whitfield", "QB", { overall: 92 }),
    P("Kellen Marsh", "HB", { overall: 78 }),
    P("Isaiah Pruitt", "LB", { overall: 63 }),
  ];
  const ctx = () =>
    gen.buildMediaContext(DELTA, SNAPSHOT, { roster: RATED, oppRoster: [P("Cortez Bly", "QB", { overall: 88 })] });

  it("grades the roster in words instead of numbers", () => {
    const c = ctx().userContext;
    expect(c).toContain("Dorian Whitfield (QB, JR, elite");
    expect(c).toContain("Kellen Marsh (HB, JR, solid starter");
    expect(c).toContain("Isaiah Pruitt (LB, JR, weak spot");
  });

  it("grades the opponent in words too", () => {
    expect(ctx().userContext).toContain("Cortez Bly (QB, JR, all-conference");
  });

  it("puts no rating number anywhere in the shared context", () => {
    const c = ctx().userContext;
    expect(c).not.toMatch(/\b\d{2}\s*OVR\b/);
    expect(c).not.toMatch(/\b\d{2}\s+overall\b/i);
    // The tell that started it: the format line used to advertise an OVR column.
    expect(c).not.toContain("Name (Pos, Year, OVR");
  });

  it("tells every generator the numbers do not exist in this universe", () => {
    const spec = gen.buildSpec("social", ctx(), {});
    const system = spec.system ?? ctx().systemPrompt;
    expect(system).toContain("NEVER write a player rating");
    expect(system).toContain("Real football language ONLY");
  });
});

// ── What the team is playing for ────────────────────────────────────────────────
// From a tester's first full season, one save, three complaints — a bowl game written as "a
// first round playoff matchup", "fighting for bowl eligibility" weeks after clinching it,
// and a "New Year's Six push" for a team that was unranked all year. The fixture below is
// that team: 6-2, unranked, Group of Five.

describe("the postseason picture is computed, not narrated", () => {
  const ctxFor = (snap: DynastySnapshot, delta: WeekDelta) => gen.buildMediaContext(delta, snap, opts);

  const BOWL_CAL = { ...SNAPSHOT.calendar!, weekType: "BowlSeason1" };
  const bowlSnap: DynastySnapshot = { ...SNAPSHOT, week: 17, calendar: BOWL_CAL };
  const bowlDelta: WeekDelta = { ...DELTA, weekPlayed: 17 };

  it("calls an unranked team's postseason game a bowl game, not a playoff round", () => {
    const ctx = ctxFor(bowlSnap, bowlDelta);
    expect(ctx.phase.playoffGame).toBe(false);
    expect(ctx.phase.roundName).toBe("Bowl Game");
    expect(ctx.userContext).toContain("ORDINARY BOWL GAME, NOT A PLAYOFF GAME");
    expect(ctx.userContext).not.toContain("Playoff First Round");
    expect(ctx.userContext).not.toContain("THE PLAYOFF FIELD IS SET");
  });

  it("carries that into the recap, which does not receive the shared context", () => {
    const p = gen.buildSpec("recap-lead", ctxFor(bowlSnap, bowlDelta), {}).prompt;
    expect(p).toContain("THIS IS A BOWL GAME, NOT A PLAYOFF GAME");
    expect(p).not.toContain("a win ADVANCES them");
  });

  it("still writes a real playoff game as a playoff game", () => {
    const inField: DynastySnapshot = {
      ...bowlSnap,
      userTeam: { ...SNAPSHOT.userTeam!, rankCFP: 6, rankMedia: 6 },
    };
    const ctx = ctxFor(inField, bowlDelta);
    expect(ctx.phase.playoffGame).toBe(true);
    expect(ctx.phase.roundName).toBe("Playoff First Round");
    expect(ctx.userContext).toContain("IN the 12-team field");
  });

  it("states bowl eligibility as settled once it is settled", () => {
    const ctx = ctxFor(SNAPSHOT, DELTA);
    expect(ctx.outlook?.bowlEligible).toBe(true);
    expect(ctx.userContext).toContain("ALREADY BOWL ELIGIBLE");
    expect(ctx.userContext).toContain("one win from bowl eligibility");
  });

  it("rules the playoff, the committee and the New Year's Six out for an unranked team", () => {
    const ctx = ctxFor(SNAPSHOT, DELTA);
    expect(ctx.outlook?.standing).toBe("out");
    expect(ctx.userContext).toContain("NOT in the playoff race");
    expect(ctx.userContext).toContain("New Year's Six");
  });

  it("stops asking the rankings desk for a playoff take on a team with no playoff case", () => {
    const p = gen.buildSpec("rankings", ctxFor(SNAPSHOT, DELTA), {}).prompt;
    expect(p).toContain("UNRANKED and NOT in the playoff race");
    expect(p).not.toContain("Analyze Coastal Carolina's playoff/ranking picture");
  });
});

// ── Season totals are not game lines ────────────────────────────────────────────

describe("season totals are labelled, and the writer is given the number he needs", () => {
  const ctx = () => gen.buildMediaContext(DELTA, SNAPSHOT, opts);

  it("welds the label to the number instead of leaving it in a header", () => {
    expect(ctx().userContext).toContain("SEASON TOTALS across 8 games (NOT one game)");
  });

  it("hands over a per-game average, which is what a story about ONE game needs", () => {
    // Reported: "my running back had 900+ yards in a single game with 100+ carries." With
    // only a cumulative total on the page, the total is the only number there is to use.
    expect(ctx().userContext).toContain("HIS AVERAGE GAME");
    expect(ctx().userContext).toContain("117.5 rush yds");
  });

  it("puts the same average in the ported recap's cast", () => {
    const p = gen.buildSpec("recap-lead", ctx(), {}).prompt;
    expect(p).toContain("his AVERAGE game");
  });
});

// ── Year-over-year memory ───────────────────────────────────────────────────────
// The port's standing cost: a ported surface no longer receives the shared blob, so every
// piece of context added to the shared context has to be handed to it a SECOND time or it
// is silently lost. That already happened once, with the season year. These tests exist so
// it cannot happen quietly again with the program's history.

describe("year-over-year memory reaches the surfaces", () => {
  const ARCHIVE: SeasonRecord[] = [
    {
      dynastyId: "d1",
      year: 2028,
      team: "Coastal Carolina",
      coachName: "Ray Deleon",
      wins: 4,
      losses: 8,
      confWins: 2,
      confLosses: 6,
      finalRankMedia: null,
      finalRankCFP: null,
      prestige: 4,
      result: "regular",
      champion: "Georgia",
      leaders: [],
      roster: [
        {
          name: "Dorian Whitfield",
          position: "QB",
          classYear: "SO",
          overall: 78,
          gamesPlayed: 12, gamesStarted: 9,
          passYds: 1740, passTDs: 9, passInts: 14,
          rushYds: 0, rushTDs: 0,
          recYds: 0, recTDs: 0, recCatches: 0,
          tackles: 0, tfl: 0, sacks: 0, ints: 0,
          fgMade: 0, fgAtt: 0,
          summary: "1740 pass yds, 9 TD, 14 INT",
        },
      ],
      games: [{ week: 8, opponent: "Tulane", us: 10, them: 41, won: false }],
      ledger: [],
      archivedAt: 0,
    },
  ];
  const withHistory = { ...opts, priorSeasons: ARCHIVE };
  const promptFor = (kind: string, delta = DELTA, snap = SNAPSHOT) =>
    gen.buildSpec(kind, gen.buildMediaContext(delta, snap, withHistory), {}).prompt;

  it("hands the game-week recap its history even though it lost the shared blob", () => {
    const p = promptFor("recap-lead");
    expect(p).toContain("PRIOR SEASONS");
    expect(p).toContain("2028: 4-8");
    expect(p).toContain("REVENGE ANGLE IS EARNED");
  });

  it("gives the presser a comparison question grounded in the archive", () => {
    const p = promptFor("press-conference");
    expect(p).toContain("COVERED YOU FOR YEARS");
    expect(p).toContain("2028: 4-8");
  });

  it("lets fans remember, and social carries the archive to back them up", () => {
    const p = promptFor("social");
    expect(p).toContain("LONG MEMORY");
    expect(p).toContain("Dorian Whitfield — 2028");
  });

  it("says nothing about the past in year one", () => {
    const p = gen.buildSpec("recap-lead", gen.buildMediaContext(DELTA, SNAPSHOT, opts), {}).prompt;
    expect(p).not.toContain("PRIOR SEASONS");
    expect(p).not.toContain("covered this program for years");
  });

  it("tells every surface who the coach is, straight from the save", () => {
    // Unlike the archive this needs no seasons played through the app — it comes off the
    // save, so it works on a mid-dynasty install and in year one.
    const withCoach: DynastySnapshot = {
      ...SNAPSHOT,
      coach: {
        teamIndex: 1,
        coachName: "Ray Deleon",
        position: "HeadCoach",
        jobSecurity: null,
        fireReported: null,
        performanceLevel: null,
        age: 44,
        awardPoints: 0,
        careerWinSeasons: 6,
        careerPlayoffs: 3,
        careerLongWinStreak: 11,
        yearsCoaching: 9,
        seasonsWithTeam: 3,
        career: {
          wins: 71, losses: 38, winsAtSchool: 24, lossesAtSchool: 13,
          natTitles: 2, natTitleLosses: 1, recentTitleYear: 2027,
          confTitles: 3, confTitleLosses: 1,
          bowlWins: 5, bowlLosses: 2, playoffWins: 6, playoffLosses: 3,
          top25Wins: 18, top25Losses: 14, rivalWins: 7, rivalLosses: 2,
          timesFired: 1, top5Classes: 2, draftPicks: 19, firstRoundPicks: 4,
        },
      },
    };
    const ctx = gen.buildMediaContext(DELTA, withCoach, opts);
    expect(ctx.resume).toContain("2-time national champion");
    expect(ctx.userContext).toContain("RECORD AT COASTAL CAROLINA: 24-13");
    expect(ctx.userContext).toContain("CAREER RECORD (everywhere he has coached): 71-38");

    // The press box is told to write like it knows.
    expect(gen.buildSpec("press-conference", ctx, {}).prompt).toContain("KNOWS HIS RÉSUMÉ");
    // And the ported recap, which does not receive the shared blob, gets it handed over.
    const recap = gen.buildSpec("recap-lead", ctx, {}).prompt;
    expect(recap).toContain("2-time national champion");
    expect(recap).toContain("fourth season at Coastal Carolina");
  });

  it("says outright when the coach has never won a title, rather than leaving a blank", () => {
    const firstYear: DynastySnapshot = {
      ...SNAPSHOT,
      coach: {
        teamIndex: 1, coachName: "Ray Deleon", position: "HeadCoach", jobSecurity: null,
        fireReported: null, performanceLevel: null, age: 36, awardPoints: 0,
        careerWinSeasons: 0, careerPlayoffs: 0, careerLongWinStreak: 6,
        yearsCoaching: 1, seasonsWithTeam: 0,
        career: {
          wins: 6, losses: 2, winsAtSchool: 6, lossesAtSchool: 2,
          natTitles: 0, natTitleLosses: 0, recentTitleYear: -2,
          confTitles: 0, confTitleLosses: 0, bowlWins: 0, bowlLosses: 0,
          playoffWins: 0, playoffLosses: 0, top25Wins: 1, top25Losses: 1,
          rivalWins: 0, rivalLosses: 1, timesFired: 0, top5Classes: 0,
          draftPicks: 0, firstRoundPicks: 0,
        },
      },
    };
    const ctx = gen.buildMediaContext(DELTA, firstYear, opts);
    expect(ctx.userContext).toContain("NATIONAL TITLES: NONE");
    expect(ctx.userContext).toContain("FIRST season at Coastal Carolina");
    expect(ctx.userContext).not.toContain("most recently in");
  });

  it("says nothing about the coach when the save carries nothing", () => {
    const ctx = gen.buildMediaContext(DELTA, SNAPSHOT, opts);
    expect(ctx.resume).toBeNull();
    expect(ctx.userContext).not.toContain("RÉSUMÉ");
  });

  it("never feeds the season being played back as history", () => {
    const ctx = gen.buildMediaContext(DELTA, SNAPSHOT, {
      ...opts,
      priorSeasons: [...ARCHIVE, { ...ARCHIVE[0], year: 2029, wins: 6, losses: 2, games: [] }],
    });
    const history = ctx.history ?? "";
    expect(history).toContain("2028: 4-8");
    expect(history).not.toContain("2029: 6-2");
  });
});
