// Regression tests for the Situation Room's deterministic half.
//
// Every pressure point this module raises becomes a storyline the user reads as true about
// their team, so each rule needs a real fact behind it. These tests pin the rules to the
// save fields they claim to read, and pin the silence: a quiet roster must produce an empty
// board rather than a manufactured grievance.

import { describe, expect, it } from "vitest";
import type { RosterPlayer } from "./client";
import {
  kindLabel,
  playerStandings,
  pressureBoard,
  pressureLine,
  standingFor,
  type StandingInput,
} from "./pressure";

const P = (
  name: string,
  position: string,
  overall: number,
  extra: Partial<RosterPlayer> = {}
): RosterPlayer => ({ name, position, year: "Jr", overall, jersey: null, ...extra });

/** A settled roster: everyone plays, nobody is underpaid, no volatility. */
const CALM: RosterPlayer[] = [
  P("Quiet QB", "QB", 84, { personality: "Leader", confidence: 80 }),
  P("Quiet HB", "HB", 80, { personality: "TeamPlayer", confidence: 75 }),
  P("Quiet WR", "WR", 79, { personality: "TeamPlayer", confidence: 75 }),
];

describe("pressureBoard — only real grievances", () => {
  it("says nothing about a settled roster", () => {
    expect(pressureBoard(CALM)).toEqual([]);
  });

  it("says nothing about an empty roster", () => {
    expect(pressureBoard([])).toEqual([]);
  });

  it("finds a good player buried behind a starter", () => {
    const roster = [
      P("Starter QB", "QB", 88),
      P("Buried QB", "QB", 82, { jersey: 12 }),
      ...CALM.filter((p) => p.position !== "QB"),
    ];
    const board = pressureBoard(roster);
    const hit = board.find((b) => b.player.name === "Buried QB");
    expect(hit?.kind).toBe("buried-star");
    expect(hit?.why).toContain("Starter QB");
  });

  it("turns up the heat when the save says playing time is his dealbreaker", () => {
    const base = [P("Starter QB", "QB", 88), P("Buried QB", "QB", 82)];
    const cool = pressureBoard(base).find((b) => b.player.name === "Buried QB")!;
    const hot = pressureBoard([
      base[0],
      P("Buried QB", "QB", 82, { dealbreaker: "PlayingTime", personality: "Intense" }),
    ]).find((b) => b.player.name === "Buried QB")!;
    expect(hot.heat).toBeGreaterThan(cool.heat);
    expect(hot.why).toMatch(/playing time/i);
  });

  it("leaves an ordinary backup alone", () => {
    const roster = [P("Starter QB", "QB", 88), P("Scrub QB", "QB", 62)];
    expect(pressureBoard(roster).some((b) => b.player.name === "Scrub QB")).toBe(false);
  });

  it("flags a star paid far under what the save values him at", () => {
    const roster = [P("Underpaid", "WR", 90, { nilBaseValue: 500, nilComp: 100 })];
    const hit = pressureBoard(roster).find((b) => b.player.name === "Underpaid");
    expect(hit?.kind).toBe("nil-grievance");
    expect(hit?.heat).toBe(3); // paid under 35% of worth
    expect(hit?.why).toContain("500K");
    expect(hit?.why).toContain("100K");
  });

  it("leaves a fairly paid star alone", () => {
    const roster = [P("Paid", "WR", 90, { nilBaseValue: 500, nilComp: 450 })];
    expect(pressureBoard(roster)).toEqual([]);
  });

  it("flags a senior who stayed and isn't playing", () => {
    const roster = [P("Star WR", "WR", 88), P("Old Head", "WR", 76, { year: "Sr" }), P("WR3", "WR", 80), P("WR4", "WR", 78)];
    const hit = pressureBoard(roster).find((b) => b.player.name === "Old Head");
    expect(hit?.kind).toBe("senior-snubbed");
  });

  it("flags a starter whose confidence has cratered", () => {
    const roster = [P("Shaken", "QB", 85, { confidence: 18, personality: "Unpredictable" })];
    const hit = pressureBoard(roster).find((b) => b.player.name === "Shaken");
    expect(hit?.kind).toBe("confidence-crash");
    expect(hit?.heat).toBe(3);
    expect(hit?.why).toContain("Unpredictable");
  });

  it("ignores low confidence on a player who isn't starting", () => {
    const roster = [P("Starter", "QB", 90), P("Benched", "QB", 60, { confidence: 10 })];
    expect(pressureBoard(roster).some((b) => b.player.name === "Benched")).toBe(false);
  });

  it("never raises two points about the same player", () => {
    // Underpaid AND volatile AND shaken — still one entry.
    const roster = [
      P("Everything", "QB", 90, {
        nilBaseValue: 500,
        nilComp: 50,
        confidence: 10,
        personality: "Unpredictable",
      }),
    ];
    const board = pressureBoard(roster);
    expect(board.filter((b) => b.player.name === "Everything")).toHaveLength(1);
  });

  it("sorts hottest first and honours the limit", () => {
    const roster = [
      P("Cold", "TE", 84, { personality: "Intense" }), // volatile-star, heat 1
      P("Hot", "WR", 90, { nilBaseValue: 900, nilComp: 100 }), // nil-grievance, heat 3
    ];
    const board = pressureBoard(roster);
    expect(board[0].player.name).toBe("Hot");
    expect(pressureBoard(roster, 1)).toHaveLength(1);
  });

  it("renders a prompt line with no rating in it", () => {
    const roster = [P("Underpaid", "WR", 90, { jersey: 8, nilBaseValue: 500, nilComp: 100 })];
    const line = pressureLine(pressureBoard(roster)[0]);
    expect(line).toContain("#8 Underpaid");
    expect(line).toContain("BOILING");
    expect(line).not.toMatch(/\bOVR\b/i);
    expect(line).not.toMatch(/(?<![#\d-])\b90\b/); // his rating must not appear
  });

  it("labels every kind it can emit", () => {
    const kinds = [
      "buried-star", "nil-grievance", "senior-snubbed",
      "confidence-crash", "academic-watch", "volatile-star", "freshman-surge",
    ] as const;
    for (const k of kinds) expect(kindLabel(k).length).toBeGreaterThan(0);
  });
});

describe("playerStandings — the room remembers", () => {
  const d = (
    playerName: string | null,
    tone: string,
    week: number,
    extra: Partial<StandingInput> = {}
  ): StandingInput => ({
    playerName,
    week,
    year: 2026,
    headline: `Something in week ${week}`,
    decision: "A call",
    tone,
    ...extra,
  });

  it("counts protecting a player as backing him", () => {
    const [s] = playerStandings([d("Marcus", "protective", 2)]);
    expect(s.standing).toBe("backed");
  });

  it("counts coming down hard as burning him", () => {
    const [s] = playerStandings([d("Marcus", "hardline", 2)]);
    expect(s.standing).toBe("burned");
  });

  it("treats a suspension as an extra strike", () => {
    const [s] = playerStandings([d("Marcus", "measured", 2, { suspended: true })]);
    expect(s.score).toBe(-1);
    expect(s.standing).toBe("mixed");
  });

  it("nets opposing decisions out over a season", () => {
    const [s] = playerStandings([
      d("Marcus", "protective", 2),
      d("Marcus", "hardline", 7),
    ]);
    expect(s.score).toBe(0);
    expect(s.standing).toBe("neutral");
  });

  it("keeps each player's history most recent first", () => {
    const [s] = playerStandings([d("Marcus", "protective", 2), d("Marcus", "protective", 9)]);
    expect(s.history.map((h) => h.week)).toEqual([9, 2]);
  });

  it("ignores decisions with no player attached", () => {
    expect(playerStandings([d(null, "hardline", 3)])).toEqual([]);
  });

  it("sorts the strongest feelings first", () => {
    const out = playerStandings([
      d("Mild", "measured", 1, { suspended: true }),
      d("Strong", "protective", 1),
      d("Strong", "protective", 2),
    ]);
    expect(out[0].name).toBe("Strong");
  });

  it("maps scores to standings at the documented thresholds", () => {
    expect(standingFor(2)).toBe("backed");
    expect(standingFor(1)).toBe("mixed");
    expect(standingFor(0)).toBe("neutral");
    expect(standingFor(-1)).toBe("mixed");
    expect(standingFor(-2)).toBe("burned");
  });
});
