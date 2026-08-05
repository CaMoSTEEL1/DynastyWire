// The two pure helpers in the save parser that decide what the app believes about a week.
//
// The scores in a save do not mean what they look like. Verified against a real week-18 file:
// Kansas State sat at 13-0 with FOURTEEN scored rows on their schedule, and every one of the
// twelve quarterfinal rows in the league carried a final. The bracket is written before it is
// played. Reading a score as proof the game happened opened the playoff already recapping it.

import { describe, expect, it } from "vitest";
import { schemeLabel, unplayFutureGames } from "./snapshot.js";

const g = (week, homeRow, awayRow, played, year = 6) => ({
  week,
  year,
  homeRow,
  awayRow,
  homeScore: played ? 24 : 0,
  awayScore: played ? 17 : 0,
  played,
});

const team = (wins, losses) => ({ wins, losses });

describe("unplayFutureGames", () => {
  it("un-plays the pre-scored playoff row a team's record cannot account for", () => {
    // Both teams are 3-0 off three regular-season rows, and the bracket row they share
    // already carries a score. Neither record can account for a fourth game.
    const games = [
      g(1, 1, 2, true), g(2, 1, 3, true), g(3, 1, 4, true),
      g(1, 5, 6, true), g(2, 5, 7, true), g(3, 5, 8, true),
      g(18, 1, 5, true),
    ];
    const teams = {
      1: team(3, 0), 2: team(0, 1), 3: team(0, 1), 4: team(0, 1),
      5: team(3, 0), 6: team(0, 1), 7: team(0, 1), 8: team(0, 1),
    };
    const out = unplayFutureGames(games, teams).filter((x) => x.homeRow === 1 || x.awayRow === 1);
    expect(out.filter((x) => x.played).map((x) => x.week)).toEqual([1, 2, 3]);
    expect(out.find((x) => x.week === 18).played).toBe(false);
  });

  it("leaves an honest schedule alone", () => {
    const games = [g(1, 1, 2, true), g(2, 1, 3, true), g(3, 1, 4, false)];
    const teams = { 1: team(2, 0), 2: team(0, 1), 3: team(0, 1), 4: team(0, 0) };
    expect(unplayFutureGames(games, teams).map((x) => x.played)).toEqual([true, true, false]);
  });

  it("needs BOTH teams to disown a game before it is erased", () => {
    // 1's record covers only one game, but 2's covers both — so week 2 survives on 2's vote.
    // One team's bookkeeping is not enough to delete a game from the other's season.
    const games = [g(1, 1, 2, true), g(2, 1, 2, true)];
    const teams = { 1: team(1, 0), 2: team(1, 1) };
    expect(unplayFutureGames(games, teams).filter((x) => x.played)).toHaveLength(2);
  });

  it("lets FCS opponents abstain instead of voting every game away", () => {
    // FCS programs carry no record at all (0-0 forever). Counting that as "they have played
    // nothing" would un-play every game they appear in.
    const games = [g(1, 1, 99, true)];
    const teams = { 1: team(1, 0), 99: team(0, 0) };
    expect(unplayFutureGames(games, teams)[0].played).toBe(true);
  });

  it("only judges the current season", () => {
    const games = [g(1, 1, 2, true, 5), g(1, 1, 3, true, 6)];
    const teams = { 1: team(1, 0), 2: team(0, 1), 3: team(0, 1) };
    // Last year's row is not measured against this year's record.
    expect(unplayFutureGames(games, teams).filter((x) => x.played)).toHaveLength(2);
  });
});

describe("schemeLabel", () => {
  it("reads the save's scheme constants as football", () => {
    expect(schemeLabel("OFF_AIR_RAID")).toBe("Air Raid");
    expect(schemeLabel("OFF_SPREAD_OPTION")).toBe("Spread Option");
    expect(schemeLabel("DEF_4_2_5")).toBe("4-2-5");
    expect(schemeLabel("DEF_3_3_5_TITE")).toBe("3-3-5 Tite");
    // The digit glued to the word is the one that bit: BASE3_4 is a 3-4, not a "Base3 4".
    expect(schemeLabel("DEF_BASE3_4")).toBe("Base 3-4");
    expect(schemeLabel("DEF_3_4_MULTIPLE")).toBe("3-4 Multiple");
  });

  it("returns null rather than guessing at nothing", () => {
    expect(schemeLabel(null)).toBeNull();
    expect(schemeLabel("")).toBeNull();
    expect(schemeLabel("OFF_")).toBeNull();
  });
});
