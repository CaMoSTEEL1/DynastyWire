// Regression tests for the national desk's deterministic core.
//
// This surface measured worst on the first real fact-check run — 10 invented people in one
// piece — so the cases below are written around the one guarantee that matters: the desk
// can only name people the save actually contains, and says so plainly when it can't.

import { describe, expect, it } from "vitest";
import type { DynastySnapshot, GameResult, RosterPlayer, TeamInfo, WeekDelta } from "./client";
import { nationalBrief, nationalFacts, teamsToLoad } from "./national";

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

const P = (name: string, position: string, extra: Partial<RosterPlayer> = {}): RosterPlayer => ({
  name,
  position,
  year: "JR",
  overall: 80,
  jersey: null,
  ...extra,
});

const SNAPSHOT: DynastySnapshot = {
  week: 8,
  year: 2032,
  dynastyYear: 6,
  calendar: null,
  coachName: "Ski Miller",
  coach: null,
  tableCount: 0,
  userTeamRow: 1,
  userTeam: team({ row: 1, name: "Kansas State", wins: 6, losses: 0, rankMedia: 5 }),
  teams: {
    "1": team({ row: 1, name: "Kansas State", wins: 6, losses: 0, rankMedia: 5 }),
    "2": team({ row: 2, name: "Oregon", wins: 7, losses: 0, rankMedia: 1 }),
    "3": team({ row: 3, name: "Michigan", wins: 6, losses: 1, rankMedia: 8 }),
    "4": team({ row: 4, name: "Vanderbilt", wins: 4, losses: 3 }),
    "5": team({ row: 5, name: "Tulane", wins: 5, losses: 2, rankMedia: 22 }),
  },
  games: [],
  headCoaches: { "2": "Dana Prentiss", "3": "Hal Brennan", "4": "Ray Colquitt" },
};

// Vanderbilt (unranked) beat #8 Michigan — a real upset the wire should lead with.
const UPSET: GameResult = {
  week: 8,
  home: "Vanderbilt",
  away: "Michigan",
  homeScore: 24,
  awayScore: 21,
  winner: "Vanderbilt",
  loser: "Michigan",
  margin: 3,
  rankHome: null,
  rankAway: 8,
  userInvolved: false,
  simmed: true,
};

const DELTA: WeekDelta = {
  weekPlayed: 8,
  userTeam: "Kansas State",
  gamesPlayed: 2,
  userResult: null,
  results: [UPSET],
  rankingMoves: [],
};

const base = { snapshot: SNAPSHOT, delta: DELTA, userTeam: "Kansas State" };

describe("nationalFacts", () => {
  it("never covers the user's own program — the rest of the app does that", () => {
    const facts = nationalFacts(base);
    expect(facts.covered.map((c) => c.name)).not.toContain("Kansas State");
  });

  it("leads with the teams in a ranked upset, ahead of the poll", () => {
    const facts = nationalFacts(base);
    expect(facts.covered.slice(0, 2).map((c) => c.name).sort()).toEqual(["Michigan", "Vanderbilt"]);
    expect(facts.covered.find((c) => c.name === "Vanderbilt")?.why).toContain("upset");
  });

  it("carries each program's REAL head coach from the save", () => {
    const facts = nationalFacts(base);
    expect(facts.covered.find((c) => c.name === "Oregon")?.headCoach).toBe("Dana Prentiss");
  });

  it("names players only for programs whose roster was supplied", () => {
    const facts = nationalFacts({
      ...base,
      rosters: {
        "3": [
          P("Elias Danner", "QB", {
            stats: { side: "offense", gamesPlayed: 7, gamesStarted: 7, offense: { gamesPlayed: 7, gamesStarted: 7, passYds: 1900, passTDs: 15, passAtt: 240 } },
          }),
        ],
      },
    });
    expect(facts.covered.find((c) => c.name === "Michigan")?.cast.map((m) => m.name)).toEqual(["Elias Danner"]);
    expect(facts.covered.find((c) => c.name === "Oregon")?.cast).toEqual([]);
    expect(facts.rosterless).toContain("Oregon");
  });

  it("falls back to the depth chart when a roster carries no stats", () => {
    const facts = nationalFacts({
      ...base,
      rosters: { "2": [P("Cal Whitmore", "QB", { overall: 92 }), P("Deon Rafferty", "WR", { overall: 88 })] },
    });
    const oregon = facts.covered.find((c) => c.name === "Oregon")!;
    expect(oregon.cast.map((m) => m.name)).toEqual(["Cal Whitmore", "Deon Rafferty"]);
    expect(facts.rosterless).not.toContain("Oregon");
  });

  it("respects the roster budget — each one is a full save parse", () => {
    expect(nationalFacts({ ...base, limit: 2 }).covered).toHaveLength(2);
    expect(teamsToLoad({ ...base, limit: 2 })).toHaveLength(2);
  });
});

describe("nationalBrief", () => {
  const facts = nationalFacts({
    ...base,
    rosters: { "3": [P("Elias Danner", "QB", { overall: 90 })] },
  });
  const brief = nationalBrief(facts);

  it("states the one rule that was missing: no invented players or coaches", () => {
    expect(brief).toContain("A name not listed here does");
    expect(brief).toContain("not exist");
  });

  it("tags every nameable person with the program that owns him", () => {
    expect(brief).toContain("Michigan");
    expect(brief).toContain("Elias Danner");
    expect(brief).toContain("HC Hal Brennan");
  });

  it("tells the desk which programs it must cover by role only", () => {
    expect(brief).toContain("NO PLAYER NAMES EXIST for");
    expect(brief).toContain("Oregon");
  });

  it("keeps the fiction the desk is SUPPOSED to invent", () => {
    expect(brief).toContain("Reporters, sources, boosters, fans, agents and analysts are fiction");
  });
});
