// Week state decides two things that must never disagree: how every generator frames its
// prompt, and whether the podium takeover says "Post-Game" or "Pregame". A wrong answer here
// is the phantom-score bug — a screen announcing a result for a game that hasn't kicked off.

import { describe, expect, it } from "vitest";
import type { DynastySnapshot, GameResult, SnapshotGame, TeamInfo, WeekDelta } from "./client";
import { nextOpponent, nextScheduledGame, weekStateOf } from "./week-state";

const team = (row: number, name: string, wins = 0, losses = 0, rankMedia: number | null = null): TeamInfo => ({
  row, teamIndex: row, name, nickname: null, city: null, wins, losses,
  confWins: null, confLosses: null, rankMedia, rankCoaches: null, rankCFP: null,
  prestige: null, ratingOVR: null,
});

const game = (week: number, homeRow: number, awayRow: number, played: boolean): SnapshotGame => ({
  week, year: 2026, homeRow, awayRow,
  homeScore: played ? 24 : null, awayScore: played ? 17 : null,
  played, simmed: false,
});

const snap = (wins: number, losses: number, games: SnapshotGame[]): DynastySnapshot => ({
  week: 5, year: 2026, dynastyYear: 1, calendar: null, coachName: "Coach", coach: null,
  tableCount: 0, userTeamRow: 1, userTeam: team(1, "Us", wins, losses),
  teams: { "1": team(1, "Us", wins, losses), "2": team(2, "Them", 4, 1, 12) },
  games,
});

const result: GameResult = {
  week: 5, home: "Us", away: "Them", homeScore: 31, awayScore: 20,
  winner: "Us", loser: "Them", margin: 11, rankHome: null, rankAway: 12,
  userInvolved: true, simmed: false,
};

const delta = (weekPlayed: number | null, userResult: GameResult | null = null): WeekDelta => ({
  weekPlayed, userTeam: "Us", gamesPlayed: 1, userResult, results: [], rankingMoves: [],
});

describe("weekStateOf", () => {
  it("is a game week whenever a result came in", () => {
    expect(weekStateOf(snap(3, 1, []), delta(5, result))).toBe("game");
  });

  it("is preseason before anyone has played", () => {
    expect(weekStateOf(snap(0, 0, [game(1, 1, 2, false)]), delta(0))).toBe("preseason");
  });

  it("is PREGAME when this week's matchup is scheduled but unplayed", () => {
    const s = snap(3, 1, [game(5, 1, 2, false)]);
    expect(weekStateOf(s, delta(5))).toBe("pregame");
  });

  it("is a bye when the next game is a different week", () => {
    const s = snap(3, 1, [game(7, 1, 2, false)]);
    expect(weekStateOf(s, delta(5))).toBe("bye");
  });

  it("is season-over late with nothing left on the schedule", () => {
    expect(weekStateOf(snap(9, 3, []), delta(17))).toBe("season-over");
  });

  // A scheduled week-18 game still outranks the week-17 cutoff: a playoff game is a game.
  it("prefers pregame over season-over when a late game is actually scheduled", () => {
    const s = snap(11, 1, [game(18, 1, 2, false)]);
    expect(weekStateOf(s, delta(18))).toBe("pregame");
  });

  it("ignores played games when looking for what's next", () => {
    const s = snap(3, 1, [game(4, 1, 2, true), game(5, 2, 1, false)]);
    expect(weekStateOf(s, delta(5))).toBe("pregame");
  });

  it("survives a missing snapshot or delta", () => {
    expect(weekStateOf(null, null)).toBe("preseason");
    expect(weekStateOf(undefined, undefined)).toBe("preseason");
  });
});

describe("nextScheduledGame / nextOpponent", () => {
  it("returns the earliest unplayed game", () => {
    const s = snap(3, 1, [game(9, 1, 2, false), game(6, 2, 1, false), game(4, 1, 2, true)]);
    expect(nextScheduledGame(s)?.week).toBe(6);
  });

  it("resolves the opponent and which side is home", () => {
    const s = snap(3, 1, [game(6, 2, 1, false)]); // they host us
    const next = nextOpponent(s);
    expect(next?.opp.name).toBe("Them");
    expect(next?.userIsHome).toBe(false);
  });

  it("returns null when the schedule is exhausted", () => {
    expect(nextScheduledGame(snap(3, 1, [game(4, 1, 2, true)]))).toBeNull();
    expect(nextOpponent(snap(3, 1, []))).toBeNull();
  });

  it("returns null when the save has no user row", () => {
    const s = { ...snap(3, 1, [game(6, 1, 2, false)]), userTeamRow: null };
    expect(nextScheduledGame(s)).toBeNull();
  });
});
