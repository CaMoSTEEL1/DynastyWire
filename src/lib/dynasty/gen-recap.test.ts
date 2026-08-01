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
