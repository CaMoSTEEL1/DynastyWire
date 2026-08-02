// The tester report this module exists for, from one real first season:
//
//   "the wire will not stop referring to my bowl game (New Orleans Bowl) as a first round
//    playoff matchup. Wouldn't stop bringing up that the team was 'fighting for bowl
//    eligibility' while we were already Bowl Eligible, and seemed to think my, at the time,
//    7-3 Sun Belt team was 'fighting for a playoff spot' while unranked the entire season,
//    and would always try and say we're pushing for a New Years Six Bowl appearance when
//    we're nowhere even close."
//
// Every case below is that save. The fixture is deliberately an unranked Group of Five team,
// because that is the majority case the old default got wrong.

import { describe, expect, it } from "vitest";
import type { DynastyCalendar, SnapshotGame, TeamInfo } from "./client";
import { fieldSize, postseasonBlock, postseasonOutlook, weekShape } from "./postseason";

const team = (over: Partial<TeamInfo> = {}): TeamInfo => ({
  row: 1,
  teamIndex: 1,
  name: "Louisiana",
  nickname: "Ragin' Cajuns",
  city: null,
  wins: 7,
  losses: 3,
  confWins: 5,
  confLosses: 1,
  rankMedia: null,
  rankCoaches: null,
  rankCFP: null,
  prestige: 4,
  ratingOVR: null,
  ...over,
});

const REGULAR: DynastyCalendar = {
  weekType: "RegularSeason",
  stage: null,
  postSeasonWeeks: 4,
  regularSeasonLastWeek: 15,
  confChampWeek: 16,
  offseasonStage: null,
  offseasonNumStages: null,
};
const BOWL: DynastyCalendar = { ...REGULAR, weekType: "BowlSeason1" };

const game = (week: number, played: boolean): SnapshotGame => ({
  week,
  year: 2029,
  homeRow: 1,
  awayRow: 9,
  homeScore: played ? 28 : null,
  awayScore: played ? 21 : null,
  played,
  simmed: false,
});

// 10 played, 2 regular-season games left.
const SCHEDULE: SnapshotGame[] = [
  ...Array.from({ length: 10 }, (_, i) => game(i + 1, true)),
  game(11, false),
  game(12, false),
];

const outlook = (t: Partial<TeamInfo>, calendar = REGULAR, games = SCHEDULE, week = 10) =>
  postseasonOutlook({
    team: team(t),
    games,
    userRow: 1,
    calendar,
    week,
    inPostseason: weekShape(calendar, week).inPostseason,
  })!;

describe("weekShape", () => {
  it("reads a bowl week off the save's own week type", () => {
    expect(weekShape(BOWL, 17).inPostseason).toBe(true);
    expect(weekShape(REGULAR, 10).inPostseason).toBe(false);
  });

  it("treats the offseason as neither", () => {
    const off = weekShape({ ...REGULAR, stage: "OffSeason" }, 20);
    expect(off.inOffseason).toBe(true);
    expect(off.inPostseason).toBe(false);
  });

  it("derives the field from the save's postseason length", () => {
    expect(fieldSize(REGULAR)).toBe(12);
    expect(fieldSize({ ...REGULAR, postSeasonWeeks: 2 })).toBe(4);
  });
});

describe("a postseason week is a BOWL week for almost everybody", () => {
  it("does not put an unranked team in the playoff just because it is bowl season", () => {
    const o = outlook({}, BOWL, SCHEDULE, 17);
    expect(o.inPlayoffGame).toBe(false);
    expect(o.inNonPlayoffBowl).toBe(true);
  });

  it("forbids every way the bowl was being written up as a playoff round", () => {
    const text = postseasonBlock(outlook({}, BOWL, SCHEDULE, 17))!;
    expect(text).toContain("ORDINARY BOWL GAME, NOT A PLAYOFF GAME");
    expect(text).toContain("first-round");
    expect(text).toContain("New Year's Six");
    expect(text).toContain("never assert a specific named bowl");
  });

  it("still calls a playoff game a playoff game for a team actually in the field", () => {
    const o = outlook({ rankCFP: 6, rankMedia: 6 }, BOWL, SCHEDULE, 17);
    expect(o.inPlayoffGame).toBe(true);
    expect(o.standing).toBe("in-field");
    expect(postseasonBlock(o)).toContain("IN the 12-team field");
  });
});

describe("bowl eligibility is arithmetic, not a narrative", () => {
  it("states a 7-3 team is ALREADY eligible and forbids the chase", () => {
    const text = postseasonBlock(outlook({}))!;
    expect(text).toContain("ALREADY BOWL ELIGIBLE");
    expect(text).toContain("NEVER");
    expect(text).toContain("one win from bowl eligibility");
  });

  it("counts only regular-season games toward the six-win line", () => {
    // A scheduled bowl game must not read as another chance to become bowl eligible.
    const withBowl = [...SCHEDULE, game(17, false)];
    expect(outlook({ wins: 4, losses: 6 }, REGULAR, withBowl).gamesLeft).toBe(2);
  });

  it("says so when six wins is no longer reachable", () => {
    const o = outlook({ wins: 3, losses: 7 });
    expect(o.bowlEliminated).toBe(true);
    expect(postseasonBlock(o)).toContain("MATHEMATICALLY ELIMINATED");
  });

  it("names the live stakes when the team is still chasing it", () => {
    const o = outlook({ wins: 5, losses: 5 });
    expect(o.winsToBowl).toBe(1);
    expect(postseasonBlock(o)).toContain("1 more win needed");
  });
});

describe("an unranked team is not in the playoff race", () => {
  it("says it outright, and rules out the committee and the NY6", () => {
    const o = outlook({});
    expect(o.standing).toBe("out");
    const text = postseasonBlock(o)!;
    expect(text).toContain("NOT in the playoff race");
    expect(text).toContain("New Year's Six");
    expect(text).toContain("UNRANKED in both");
  });

  it("scales honestly with where a ranked team actually sits", () => {
    expect(outlook({ rankCFP: 8 }).standing).toBe("in-field");
    expect(outlook({ rankCFP: 16 }).standing).toBe("contender");
    expect(outlook({ rankCFP: 24 }).standing).toBe("longshot");
    expect(outlook({ rankMedia: 21 }).standing).toBe("longshot");
  });

  it("does not treat an AP ranking as a CFP berth", () => {
    const o = outlook({ rankMedia: 22 });
    expect(o.inPlayoffGame).toBe(false);
    expect(postseasonBlock(o)).toContain("UNRANKED in the CFP rankings (#22 in the AP poll)");
  });
});

describe("outlook is null when there is nothing to compute from", () => {
  it("returns null without a user team rather than guessing", () => {
    expect(
      postseasonOutlook({ team: null, games: [], userRow: null, calendar: REGULAR, week: 5, inPostseason: false })
    ).toBeNull();
    expect(postseasonBlock(null)).toBeNull();
  });
});
