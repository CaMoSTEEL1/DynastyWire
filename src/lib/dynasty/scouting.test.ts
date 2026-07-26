// Regression tests for the deterministic half of the pregame scouting report.
//
// This math produces coaching advice the user acts on with a controller in hand, so every
// expectation below is hand-computed from the fixture rosters — a reader can check the
// arithmetic without running anything. The fixtures are built so the two teams are
// deliberately lopsided in OPPOSITE directions (they win up front, we win on the outside),
// which is what makes a perspective bug visible instead of accidentally symmetric.

import { describe, expect, it } from "vitest";
import type { RosterPlayer, RosterStats, RosterStatsSide } from "./client";
import {
  bestMismatches,
  injuries,
  phaseMatchups,
  projectedStarters,
  scoutingMath,
  specialTeams,
  tendencies,
  topThreats,
  unitEdges,
  weakLinks,
} from "./scouting";

const GAMES = 8;

const P = (
  name: string,
  position: string,
  overall: number,
  extra: Partial<RosterPlayer> = {}
): RosterPlayer => ({ name, position, year: "JR", overall, jersey: null, ...extra });

const stats = (side: RosterStats["side"], line: Partial<RosterStatsSide>): RosterStats => ({
  side,
  gamesPlayed: GAMES,
  gamesStarted: GAMES,
  [side]: { gamesPlayed: GAMES, gamesStarted: GAMES, ...line },
});

// ── The opponent: elite front seven, soft corners, pass-first offense ────────────
const THEIRS: RosterPlayer[] = [
  P("Opp QB", "QB", 88, {
    stats: stats("offense", { passYds: 2400, passAtt: 300, passComp: 201, passTDs: 22, passInts: 6, rushYds: 90, rushAtt: 30 }),
  }),
  P("Opp HB1", "HB", 84, { stats: stats("offense", { rushYds: 700, rushAtt: 140, rushTDs: 8 }) }),
  P("Opp HB2", "HB", 74),
  P("Opp WR1", "WR", 90, {
    stats: stats("offense", { recYds: 900, recCatches: 60, recTDs: 9, kickRetYds: 260, kickRetTDs: 1 }),
  }),
  P("Opp WR2", "WR", 80),
  P("Opp WR3", "WR", 76),
  P("Opp WR4", "WR", 60), // 4th receiver — must never reach the field in a 3-WR set
  P("Opp TE", "TE", 78),
  P("Opp LT", "LT", 85), P("Opp LG", "LG", 80), P("Opp C", "C", 79), P("Opp RG", "RG", 78), P("Opp RT", "RT", 84),
  P("Opp LE", "LE", 90), P("Opp RE", "RE", 88), P("Opp DT1", "DT", 86), P("Opp DT2", "DT", 84),
  P("Opp MLB", "MLB", 89, {
    stats: stats("defense", { tackles: 80, sacks: 4, tfl: 10, ints: 1, forcedFumbles: 2 }),
  }),
  P("Opp LOLB", "LOLB", 85, { stats: stats("defense", { tackles: 50, sacks: 8, tfl: 12, forcedFumbles: 1 }) }),
  P("Opp ROLB", "ROLB", 83),
  P("Opp CB1", "CB", 74), P("Opp CB2", "CB", 70), P("Opp CB3", "CB", 66),
  P("Opp FS", "FS", 75),
  P("Opp SS", "SS", 73, { injury: "Questionable" }),
  P("Opp K", "K", 72, { stats: stats("kicking", { fgMade: 12, fgAtt: 15, fgLong: 51, fgMade50Plus: 1, fgAtt50Plus: 2 }) }),
  P("Opp P", "P", 70, { stats: stats("kicking", { punts: 30, puntYds: 1320, puntIn20: 11 }) }),
  P("Opp Hurt Star", "WR", 87, { injury: "Out" }),
  P("Opp Healthy Note", "TE", 71, { injury: "Healthy" }), // "Healthy" is not an injury
];

// ── Us: elite receivers, weak in the trenches ───────────────────────────────────
const MINE: RosterPlayer[] = [
  P("My QB", "QB", 90),
  P("My HB1", "HB", 82), P("My HB2", "HB", 76),
  P("My WR1", "WR", 93), P("My WR2", "WR", 88), P("My WR3", "WR", 84), P("My TE", "TE", 80),
  P("My LT", "LT", 74), P("My LG", "LG", 70), P("My C", "C", 72), P("My RG", "RG", 69), P("My RT", "RT", 73),
  P("My LE", "LE", 72), P("My RE", "RE", 70), P("My DT1", "DT", 71), P("My DT2", "DT", 68),
  P("My MLB", "MLB", 75), P("My LOLB", "LOLB", 73), P("My ROLB", "ROLB", 72),
  P("My CB1", "CB", 80), P("My CB2", "CB", 78), P("My CB3", "CB", 74),
  P("My FS", "FS", 79), P("My SS", "SS", 77),
];

describe("projectedStarters — who is actually on the field", () => {
  const starters = projectedStarters(THEIRS);
  const at = (position: string) => starters.filter((s) => s.position === position);

  it("fields three receivers and leaves the fourth off", () => {
    expect(at("WR")).toHaveLength(3);
    expect(at("WR").map((s) => s.player.name)).not.toContain("Opp WR4");
  });

  it("fields three corners (nickel is the base look) and two tackles", () => {
    expect(at("CB")).toHaveLength(3);
    expect(at("DT")).toHaveLength(2);
  });

  it("numbers the depth slots by rating and drops the index for single-body spots", () => {
    expect(at("WR").map((s) => s.slot)).toEqual(["WR1", "WR2", "WR3"]);
    expect(at("WR")[0].player.name).toBe("Opp WR1"); // 90 tops the injured 87
    expect(at("QB")[0].slot).toBe("QB");
  });

  it("sorts the whole group best-first", () => {
    const overalls = starters.map((s) => s.overall);
    expect([...overalls].sort((a, b) => b - a)).toEqual(overalls);
  });
});

describe("unitEdges — hand-checkable rating averages", () => {
  const edges = unitEdges(MINE, THEIRS);
  const edge = (unit: string) => edges.find((e) => e.unit === unit)!;

  it("reads our corner advantage", () => {
    // ours 80+78+74 = 232/3 = 77.3 → 77; theirs 74+70+66 = 210/3 = 70
    expect(edge("CB").mine).toBe(77);
    expect(edge("CB").theirs).toBe(70);
    expect(edge("CB").diff).toBe(7);
    expect(edge("CB").verdict).toBe("big-edge");
  });

  it("reads their line advantage", () => {
    // theirs 85+80+79+78+84 = 406/5 = 81.2 → 81; ours 74+70+72+69+73 = 358/5 = 71.6 → 72
    expect(edge("OL").theirs).toBe(81);
    expect(edge("OL").mine).toBe(72);
    expect(edge("OL").diff).toBe(-9);
    expect(edge("OL").verdict).toBe("their-big-edge");
  });

  it("covers every unit and never invents one", () => {
    expect(edges.map((e) => e.unit)).toEqual(["QB", "RB", "WR/TE", "OL", "DL", "LB", "CB", "S"]);
  });
});

describe("phaseMatchups — the number is ALWAYS from the user's side", () => {
  const matchups = phaseMatchups(MINE, THEIRS);
  const row = (prefix: string) => matchups.find((m) => m.label.startsWith(prefix))!;

  it("tells us to throw it when our receivers out-class their secondary", () => {
    const pass = row("Your pass game");
    expect(pass.diff).toBeGreaterThan(0);
    expect(pass.call).toMatch(/^Throw it/);
  });

  it("warns us off the ground game when their front is better", () => {
    const run = row("Your run game");
    expect(run.diff).toBeLessThan(0);
    expect(run.call).toMatch(/Don't grind into it/);
  });

  // The regression this suite exists for: on the two opponent-offense rows, a positive number
  // still has to mean "good for us". Getting this backwards told the coach he owned a line of
  // scrimmage he was in fact losing by nine.
  it("keeps our perspective on their run game (they are better, so the number is negative)", () => {
    const theirRun = row("Their run game");
    expect(theirRun.diff).toBeLessThan(0);
    expect(theirRun.call).toMatch(/They can run on you/);
    expect(theirRun.call).not.toMatch(/You own the line/);
  });

  it("keeps our perspective on their pass game", () => {
    const theirPass = row("Their pass game");
    // their QB+WR (88, and 90/80/76/78 receivers) beats our CB+S — bad for us
    expect(theirPass.diff).toBeLessThan(0);
    expect(theirPass.call).toMatch(/beat you deep/);
  });

  it("reports mine/theirs as our unit vs their unit on every row", () => {
    const theirRun = row("Their run game");
    expect(theirRun.mine).toBeLessThan(theirRun.theirs!); // our front is the weaker one
    expect(theirRun.diff).toBe(theirRun.mine! - theirRun.theirs!);
  });

  it("flips the advice when the rosters are swapped", () => {
    const swapped = phaseMatchups(THEIRS, MINE).find((m) => m.label.startsWith("Their run game"))!;
    expect(swapped.diff).toBeGreaterThan(0);
    expect(swapped.call).toMatch(/You own the line/);
  });
});

describe("bestMismatches — the individual matchup to go hunt", () => {
  const mismatches = bestMismatches(MINE, THEIRS);

  it("pairs our best receiver with their weakest defensive back", () => {
    expect(mismatches[0].mine.player.name).toBe("My WR1");
    expect(mismatches[0].theirs.player.name).toBe("Opp CB3");
    expect(mismatches[0].gap).toBe(93 - 66);
  });

  it("orders by gap and honours the limit", () => {
    const gaps = mismatches.map((m) => m.gap);
    expect([...gaps].sort((a, b) => b - a)).toEqual(gaps);
    expect(bestMismatches(MINE, THEIRS, 1)).toHaveLength(1);
  });

  it("claims nothing when we have no advantage anywhere", () => {
    // Our line and backs are outclassed, so a mismatch hunt from their side finds our weak spots
    // — but from ours, only the receiver edge qualifies.
    expect(bestMismatches([P("Scrub", "WR", 60)], THEIRS)).toEqual([]);
  });
});

describe("weakLinks and topThreats", () => {
  it("names their softest on-field body first", () => {
    expect(weakLinks(THEIRS)[0].player.name).toBe("Opp CB3");
  });

  it("excludes the kicker and punter from both lists", () => {
    const names = [...weakLinks(THEIRS, 10), ...topThreats(THEIRS, 10)].map((s) => s.position);
    expect(names).not.toContain("K");
    expect(names).not.toContain("P");
  });

  it("leads the threat list with their best player", () => {
    expect(topThreats(THEIRS)[0].overall).toBe(90);
  });
});

describe("injuries", () => {
  it("reports only real statuses, worst-rated player first", () => {
    expect(injuries(THEIRS).map((i) => [i.player.name, i.status])).toEqual([
      ["Opp Hurt Star", "Out"],
      ["Opp SS", "Questionable"],
    ]);
  });

  it("treats Healthy / None / blank as not an injury", () => {
    const roster = [
      P("A", "WR", 80, { injury: "Healthy" }),
      P("B", "WR", 80, { injury: "None" }),
      P("C", "WR", 80, { injury: "  " }),
      P("D", "WR", 80),
    ];
    expect(injuries(roster)).toEqual([]);
  });
});

describe("tendencies — attempts drive the identity, not yards", () => {
  const t = tendencies(THEIRS);

  it("counts volume off the real stat lines", () => {
    expect(t.games).toBe(8);
    expect(t.passAtt).toBe(300);
    expect(t.rushAtt).toBe(170); // 140 HB + 30 QB
  });

  it("derives the play-calling split from attempts", () => {
    expect(t.passRate).toBe(64); // 300 / 470
    expect(t.identity).toBe("pass-heavy");
  });

  it("computes efficiency rates", () => {
    expect(t.yardsPerAtt).toBe(8); // 2400 / 300
    expect(t.completionPct).toBe(67); // 201 / 300
    expect(t.yardsPerCarry).toBe(4.6); // 790 / 170
    expect(t.passTDs).toBe(22);
    expect(t.passInts).toBe(6);
  });

  it("computes per-game defensive production", () => {
    expect(t.sacksPerGame).toBe(1.5); // 12 / 8
    expect(t.takeawaysPerGame).toBe(0.5); // (1 INT + 3 FF) / 8
    expect(t.tflPerGame).toBe(2.8); // 22 / 8
  });

  it("does not call a run-heavy team pass-first off one long completion", () => {
    const runTeam = [
      P("RT QB", "QB", 80, { stats: stats("offense", { passAtt: 10, passComp: 6, passYds: 400 }) }),
      P("RT HB", "HB", 85, { stats: stats("offense", { rushAtt: 200, rushYds: 900 }) }),
    ];
    const rt = tendencies(runTeam);
    expect(rt.passYds).toBeGreaterThan(0);
    expect(rt.passRate).toBe(5);
    expect(rt.identity).toBe("run-heavy");
  });

  it("returns nulls rather than dividing by zero on a statless roster", () => {
    const t0 = tendencies([P("Nobody", "QB", 70)]);
    expect(t0.passRate).toBeNull();
    expect(t0.yardsPerAtt).toBeNull();
    expect(t0.sacksPerGame).toBeNull();
    expect(t0.identity).toBe("balanced");
  });
});

describe("specialTeams — the facts behind fourth-down math", () => {
  const st = specialTeams(THEIRS);

  it("reads the kicker's record and range", () => {
    expect(st.kicker).toMatchObject({ name: "Opp K", fgMade: 12, fgAtt: 15, fgLong: 51, made50: 1, att50: 2 });
  });

  it("averages the punter", () => {
    expect(st.punter).toMatchObject({ name: "Opp P", punts: 30, avg: 44, in20: 11 }); // 1320 / 30
  });

  it("flags a return threat", () => {
    expect(st.returnThreats[0]).toMatchObject({ name: "Opp WR1", kickRetTDs: 1, retYds: 260 });
  });

  it("returns nulls when the save carries no kicking numbers", () => {
    const st0 = specialTeams([P("K only", "K", 70)]);
    expect(st0.kicker).toMatchObject({ name: "K only", fgAtt: 0, fgLong: null });
    expect(st0.punter).toBeNull();
    expect(st0.returnThreats).toEqual([]);
  });
});

describe("scoutingMath — the aggregate the prompt and the UI both read", () => {
  it("agrees with the individual helpers", () => {
    const m = scoutingMath(MINE, THEIRS);
    expect(m.edges).toEqual(unitEdges(MINE, THEIRS));
    expect(m.matchups).toEqual(phaseMatchups(MINE, THEIRS));
    expect(m.tendencies).toEqual(tendencies(THEIRS));
    expect(typeof m.overallGap).toBe("number");
  });

  it("claims no edge at all when a roster is missing", () => {
    for (const m of [scoutingMath([], []), scoutingMath(MINE, []), scoutingMath([], THEIRS)]) {
      expect(m.edges.every((e) => e.diff === null && e.verdict === null)).toBe(true);
      expect(m.matchups.every((x) => x.diff === null && x.call === "")).toBe(true);
      expect(m.overallGap).toBeNull();
      expect(m.mismatches).toEqual([]);
    }
  });

  it("survives players with no rating or position", () => {
    const junk = [
      { name: "No OVR", position: "WR", year: null, overall: null, jersey: null },
      { name: "No pos", position: null, year: null, overall: 80, jersey: null },
    ];
    expect(() => scoutingMath(junk, junk)).not.toThrow();
    expect(projectedStarters(junk)).toEqual([]);
  });
});
