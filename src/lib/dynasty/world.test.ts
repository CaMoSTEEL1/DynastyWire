// The league's own life. Fixtures are copied from a REAL dynasty save (DYNASTY-SKISWORLD):
// 61 headlines, 143 awards, 60 conference title games, 122 carousel moves.
//
// The thing worth breaking here is the honesty of it: these tables carry no year column, and a
// block that lets a story date one of them is handing the model a fact it will get wrong.

import { describe, expect, it } from "vitest";
import type { CoachMove, ConferenceTitle, LeagueAward, WorldData, WorldHeadline } from "./client";
import type { SeasonRecord } from "./archive";
import {
  anniversaries,
  awardLabel,
  carouselBlock,
  headCoachMoves,
  headlineBlock,
  predecessor,
  recordBook,
  recordBookBlock,
  relevantHeadlines,
  worldBlock,
} from "./world";

const H = (over: Partial<WorldHeadline>): WorldHeadline => ({
  headline: "New Name At The Top",
  summary: "Tennessee HB Nate Gumbs is now the all-time team leader in Rushing Yards",
  category: "POW_INFO", week: 17, seasonWeek: 33, year: 3, priority: 70,
  topStory: false, breaking: false, teamRow: 1, team: "Tennessee", ...over,
});

const WORLD: WorldData = {
  headlines: [
    H({}),
    H({ team: "Ohio State", headline: "And Then There Were 8", summary: "The Buckeyes are fully focused on their second-round matchup", priority: 99, week: 18 }),
    H({ team: "Kansas State", headline: "Record, Wrong Result", summary: "K-State sets a school record in a loss", priority: 10, week: 17 }),
    H({ team: "LSU", headline: "Barely Made It", summary: "LSU survives", priority: 50, week: 5 }),
  ],
  awards: [
    { award: "BEST_HC", name: "Ryan Day", position: "HC", school: "Ohio State" },
    { award: "BEST_POTY", name: "Byrum Brown", position: "QB", school: "Auburn" },
    { award: "BEST_FRESHMAN_POTY", name: "Cole Reeves", position: "QB", school: "Kansas State" },
  ] as LeagueAward[],
  confChampions: [
    { conference: "Big 12", winner: "Kansas State", winnerCoach: "Ski Miller", winnerScore: 45, winnerRecord: "12-1", loser: "Texas Tech", loserScore: 24, loserRecord: "10-3" },
    { conference: "ACC", winner: "Miami", winnerCoach: "Lou Hernandez", winnerScore: 30, winnerRecord: "12-1", loser: "Louisville", loserScore: 6, loserRecord: "11-2" },
  ] as ConferenceTitle[],
  carousel: [
    { coach: "Steve Sarkisian", from: "USC", to: "Nebraska", fromRole: "HeadCoach", toRole: "HeadCoach", year: 5, week: 18, stage: "NFLSeason", contractYears: 5, status: "Last_Pending" },
    { coach: "Hal Brennan", from: "Kansas State", to: "Auburn", fromRole: "HeadCoach", toRole: "HeadCoach", year: 3, week: 17, stage: "NFLSeason", contractYears: 4, status: "First_Pending" },
    { coach: "Some Coordinator", from: "Rice", to: "Tulane", fromRole: "DefensiveCoordinator", toRole: "DefensiveCoordinator", year: 5, week: 17, stage: "NFLSeason", contractYears: 1, status: "First_Pending" },
  ] as CoachMove[],
};

describe("the game's own wire", () => {
  it("puts your own program and this week at the top, whatever the priority", () => {
    const out = relevantHeadlines(WORLD, { week: 17, focusTeams: ["Kansas State"] });
    expect(out[0].team).toBe("Kansas State");
  });

  it("otherwise defers to the game's own priority", () => {
    const out = relevantHeadlines(WORLD, {});
    expect(out[0].team).toBe("Ohio State");
  });

  it("tells the writer these are real and forbids inventing a record", () => {
    const b = headlineBlock(relevantHeadlines(WORLD, {}))!;
    expect(b).toContain("really happened");
    expect(b).toContain("never invent a school record");
    expect(b).toContain("all-time team leader in Rushing Yards");
  });

  it("is null when the save carries none", () => {
    expect(headlineBlock(relevantHeadlines(undefined, {}))).toBeNull();
  });
});

describe("the record book", () => {
  it("separates your program's honours from the league's", () => {
    const b = recordBook(WORLD, "Kansas State");
    expect(b.ours.map((a) => a.name)).toEqual(["Cole Reeves"]);
    expect(b.ourTitles.map((t) => t.conference)).toEqual(["Big 12"]);
    expect(b.league.some((a) => a.school === "Kansas State")).toBe(false);
  });

  it("translates the save's enums into broadcast words", () => {
    expect(awardLabel("BEST_HC")).toBe("Coach of the Year");
    expect(awardLabel("BEST_FRESHMAN_POTY")).toBe("Freshman of the Year");
    expect(awardLabel(null)).toBe("an award");
  });

  it("forbids dating history the save does not date", () => {
    // The two history tables have no year column. A story that attaches a season to one is
    // inventing it.
    const b = recordBookBlock(recordBook(WORLD, "Kansas State"), "Kansas State")!;
    expect(b).toContain("carry NO year");
    expect(b).toContain("never attach a season");
  });
});

describe("the carousel", () => {
  it("keeps head coaches and drops coordinator churn", () => {
    expect(headCoachMoves(WORLD).map((m) => m.coach)).toEqual(["Steve Sarkisian", "Hal Brennan"]);
  });

  it("finds the man who had your job", () => {
    expect(predecessor(WORLD, "Kansas State")?.coach).toBe("Hal Brennan");
    expect(predecessor(WORLD, "Ohio State")).toBeNull();
  });

  it("names him as the comparison, once", () => {
    const b = carouselBlock(headCoachMoves(WORLD), predecessor(WORLD, "Kansas State"), "Kansas State")!;
    expect(b).toContain("THE MAN WHO HAD THIS JOB: Hal Brennan");
    expect(b).toContain("Auburn");
    // and he must not also appear as a plain carousel line
    expect(b.match(/Hal Brennan/g)).toHaveLength(1);
  });
});

describe("anniversaries", () => {
  const archive: SeasonRecord[] = [
    {
      dynastyId: "d1", year: 2028, team: "Kansas State", coachName: "Ski Miller",
      wins: 9, losses: 3, confWins: null, confLosses: null, finalRankMedia: null,
      finalRankCFP: null, prestige: null, result: "regular", champion: null,
      leaders: [], roster: [], ledger: [], archivedAt: 0,
      games: [{ week: 7, opponent: "Texas Tech", us: 21, them: 24, won: false }],
    },
  ];

  it("finds the same week in a previous season", () => {
    expect(anniversaries(archive, 2029, 7)[0]).toContain("1 year ago this week: lost to Texas Tech 21-24");
  });

  it("says nothing for a week with no history", () => {
    expect(anniversaries(archive, 2029, 12)).toEqual([]);
    expect(anniversaries(undefined, 2029, 7)).toEqual([]);
  });
});

describe("worldBlock", () => {
  it("joins everything that has something to say", () => {
    const b = worldBlock({ world: WORLD, school: "Kansas State", week: 17, currentYear: 2029 })!;
    expect(b).toContain("THE LEAGUE'S OWN WIRE");
    expect(b).toContain("THE RECORD BOOK");
    expect(b).toContain("THE COACHING CAROUSEL");
  });

  it("is null when the save gives nothing", () => {
    expect(worldBlock({ world: undefined, school: "Kansas State" })).toBeNull();
  });
});
