// Regression tests for the deterministic half of the pregame scouting report.
//
// This math produces coaching advice the user acts on with a controller in hand, so every
// expectation below is hand-computed from the fixture rosters — a reader can check the
// arithmetic without running anything. The fixtures are built so the two teams are
// deliberately lopsided in OPPOSITE directions (they win up front, we win on the outside),
// which is what makes a perspective bug visible instead of accidentally symmetric.

import { describe, expect, it } from "vitest";
import type { RosterPlayer, RosterStats, RosterStatsSide, SnapshotGame, TeamInfo } from "./client";
import {
  EDGE_LABEL,
  SEVERITY_LABEL,
  bestMismatches,
  classAbbrev,
  commonOpponents,
  depthDropOff,
  experienceProfile,
  formLine,
  injuries,
  phaseMatchups,
  playerLine,
  projectedStarters,
  quarterProfile,
  recentForm,
  scoutingMath,
  seriesHistory,
  specialTeams,
  starterLine,
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
    jersey: 11,
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
  P("Opp CB1", "CB", 74, { jersey: 2 }), P("Opp CB2", "CB", 70, { jersey: 21 }), P("Opp CB3", "CB", 66, { jersey: 33 }),
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

describe("unitEdges — graded, never numbered", () => {
  const edges = unitEdges(MINE, THEIRS);
  const edge = (unit: string) => edges.find((e) => e.unit === unit)!;

  it("reads our corner advantage as a grade gap", () => {
    // ours 80+78+74 = 232/3 = 77.3 → 77 → B-; theirs 74+70+66 = 210/3 = 70 → C
    expect(edge("CB").myGrade).toBe("B-");
    expect(edge("CB").theirGrade).toBe("C");
    expect(edge("CB").verdict).toBe("clear-edge");
  });

  it("reads their line advantage", () => {
    // theirs 85+80+79+78+84 = 406/5 = 81.2 → 81 → B+; ours 358/5 = 71.6 → 72 → C+
    expect(edge("OL").theirGrade).toBe("B+");
    expect(edge("OL").myGrade).toBe("C+");
    expect(edge("OL").verdict).toBe("decisive-disadvantage");
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

  it("grades our unit against theirs on every row", () => {
    const theirRun = row("Their run game");
    // our front: DL 70 + LB 73 → 72 (C+); their ground game: OL 81 + RB 79 → 80 (B)
    expect(theirRun.myGrade).toBe("C+");
    expect(theirRun.theirGrade).toBe("B");
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

// ── Schedule-derived scouting ───────────────────────────────────────────────────
// Rows: 1 = us, 2 = the opponent, 3/4 = shared opponents, 5 = a team only they played.
const TEAMS: Record<string, TeamInfo> = {
  "1": { row: 1, teamIndex: 1, name: "Us", nickname: null, city: null, wins: 3, losses: 1, confWins: null, confLosses: null, rankMedia: null, rankCoaches: null, rankCFP: null, prestige: null, ratingOVR: null },
  "2": { row: 2, teamIndex: 2, name: "Them", nickname: null, city: null, wins: 3, losses: 1, confWins: null, confLosses: null, rankMedia: 12, rankCoaches: null, rankCFP: null, prestige: null, ratingOVR: null },
  "3": { row: 3, teamIndex: 3, name: "Shared A", nickname: null, city: null, wins: 2, losses: 2, confWins: null, confLosses: null, rankMedia: null, rankCoaches: null, rankCFP: null, prestige: null, ratingOVR: null },
  "4": { row: 4, teamIndex: 4, name: "Shared B", nickname: null, city: null, wins: 1, losses: 3, confWins: null, confLosses: null, rankMedia: null, rankCoaches: null, rankCFP: null, prestige: null, ratingOVR: null },
  "5": { row: 5, teamIndex: 5, name: "Only Theirs", nickname: null, city: null, wins: 0, losses: 4, confWins: null, confLosses: null, rankMedia: null, rankCoaches: null, rankCFP: null, prestige: null, ratingOVR: null },
};

const game = (
  week: number,
  homeRow: number,
  awayRow: number,
  homeScore: number,
  awayScore: number,
  quarters?: { home: number[]; away: number[] }
): SnapshotGame => ({
  week,
  year: 2026,
  homeRow,
  awayRow,
  homeScore,
  awayScore,
  played: true,
  simmed: false,
  homeQuarters: quarters?.home ?? null,
  awayQuarters: quarters?.away ?? null,
});

const SCHEDULE: SnapshotGame[] = [
  // Us
  game(1, 1, 3, 24, 21), // beat Shared A by 3
  game(2, 4, 1, 10, 31), // beat Shared B by 21, on the road
  // Them — front-loaded scoring, they fade
  game(1, 2, 3, 45, 10, { home: [21, 17, 7, 0], away: [3, 0, 0, 7] }), // beat Shared A by 35
  game(2, 2, 5, 38, 14, { home: [14, 14, 3, 7], away: [0, 7, 0, 7] }),
  game(3, 4, 2, 28, 24, { home: [7, 7, 7, 7], away: [10, 7, 0, 7] }), // LOST to Shared B
  game(4, 2, 5, 31, 17, { home: [17, 7, 7, 0], away: [0, 3, 7, 7] }),
  // A prior meeting between us
  game(5, 1, 2, 17, 20, { home: [7, 3, 7, 0], away: [0, 10, 3, 7] }), // we lost to them
  // An unplayed future game must be ignored everywhere
  { week: 9, year: 2026, homeRow: 1, awayRow: 2, homeScore: null, awayScore: null, played: false, simmed: null },
];

describe("recentForm", () => {
  const form = recentForm(SCHEDULE, TEAMS, 2);

  it("lists their played games most recent first", () => {
    expect(form.games.map((g) => g.week)).toEqual([5, 4, 3, 2]);
  });

  it("states each result from THEIR side", () => {
    const wk3 = form.games.find((g) => g.week === 3)!;
    expect(wk3.result).toBe("L"); // they lost 24-28 at Shared B
    expect(wk3.pointsFor).toBe(24);
    expect(wk3.home).toBe(false);
    expect(formLine(wk3)).toBe("L 24-28 at Shared B");
  });

  it("computes the streak and scoring averages over the whole season", () => {
    expect(form.streak).toBe("W2"); // weeks 5 and 4 were both wins
    expect(form.pointsForPerGame).toBe(31.6); // (20+31+24+38+45)/5 = 158/5
    expect(form.pointsAgainstPerGame).toBe(17.2); // (17+17+28+14+10)/5 = 86/5
    expect(form.averageMargin).toBe(14.4); // (+3 +14 −4 +24 +35)/5 = 72/5
  });

  it("ignores unplayed games and unknown rows", () => {
    expect(form.games.every((g) => g.pointsFor + g.pointsAgainst > 0)).toBe(true);
    expect(recentForm(SCHEDULE, TEAMS, null).games).toEqual([]);
  });

  it("marks a ranked opponent in the line", () => {
    const ours = recentForm(SCHEDULE, TEAMS, 1).games.find((g) => g.opponent === "Them")!;
    expect(formLine(ours)).toBe("L 17-20 vs #12 Them");
  });
});

describe("commonOpponents — the comparison a real staff runs first", () => {
  const common = commonOpponents(SCHEDULE, TEAMS, 1, 2);

  it("finds only teams BOTH of us played", () => {
    expect(common.map((c) => c.opponent).sort()).toEqual(["Shared A", "Shared B"]);
  });

  it("excludes games between the two of us", () => {
    expect(common.map((c) => c.opponent)).not.toContain("Them");
    expect(common.map((c) => c.opponent)).not.toContain("Us");
  });

  it("computes the swing from our margin minus theirs", () => {
    const a = common.find((c) => c.opponent === "Shared A")!;
    expect(a.yours.margin).toBe(3); // we won by 3
    expect(a.theirs.margin).toBe(35); // they won by 35
    expect(a.swing).toBe(-32); // badly in their favour
  });

  it("sorts by the biggest divergence", () => {
    expect(common[0].opponent).toBe("Shared A"); // |−32| beats |+25|
  });

  it("returns nothing without both rows", () => {
    expect(commonOpponents(SCHEDULE, TEAMS, null, 2)).toEqual([]);
  });
});

describe("seriesHistory", () => {
  it("returns prior meetings from our point of view", () => {
    const series = seriesHistory(SCHEDULE, TEAMS, 1, 2);
    expect(series).toHaveLength(1);
    expect(formLine(series[0])).toBe("L 17-20 vs #12 Them");
  });
});

describe("quarterProfile — when they actually beat you", () => {
  const q = quarterProfile(SCHEDULE, 2);

  it("averages points by quarter over games that carry quarter data", () => {
    expect(q.games).toBe(5); // all five of their played games carry quarters
    // Q1 scored: 21 + 14 + 10 (away wk3) + 17 + 0 (away wk5) = 62 / 5
    expect(q.scoredPerQuarter[0]).toBe(12.4);
    expect(q.scoredPerQuarter[3]).toBe(4.2); // 0 + 7 + 7 + 0 + 7 = 21 / 5
    // Allowed Q1: 3 + 0 + 7 + 0 + 7 = 17 / 5
    expect(q.allowedPerQuarter[0]).toBe(3.4);
  });

  it("calls out a fast-starting team that fades", () => {
    expect(q.read).toMatch(/Fast starters who fade/);
  });

  it("says nothing when the save has no quarter data", () => {
    const noQuarters = quarterProfile([game(1, 1, 2, 20, 10)], 1);
    expect(noQuarters.games).toBe(0);
    expect(noQuarters.read).toBeNull();
  });
});

describe("experienceProfile", () => {
  it("flags a young starting group", () => {
    const young = [P("A", "QB", 80, { year: "FR" }), P("B", "HB", 80, { year: "SO" })];
    expect(experienceProfile(young).read).toMatch(/Young group/);
  });

  it("flags a veteran group", () => {
    const old = [P("A", "QB", 80, { year: "SR" }), P("B", "HB", 80, { year: "SR" })];
    expect(experienceProfile(old).read).toMatch(/Veteran group/);
  });

  it("counts only projected starters", () => {
    expect(experienceProfile(THEIRS).starters).toBe(projectedStarters(THEIRS).length);
  });

  // The parser passes unrecognised SchoolYear values through raw, so the full words have to
  // resolve too — otherwise a redshirt freshman reads as an upperclassman.
  it("understands the save's spelled-out class values", () => {
    const spelled = [
      P("A", "QB", 80, { year: "RedshirtFreshman" }),
      P("B", "HB", 80, { year: "Sophomore" }),
      P("C", "WR", 80, { year: "Senior" }),
    ];
    const prof = experienceProfile(spelled);
    expect(prof.underclassmen).toBe(2);
    expect(prof.seniors).toBe(1);
    expect(classAbbrev("RedshirtFreshman")).toBe("RFr.");
    expect(classAbbrev("Sophomore")).toBe("So.");
    expect(classAbbrev("Jr")).toBe("Jr.");
  });
});

describe("depthDropOff — who they cannot afford to lose", () => {
  it("names a star with a steep fall-off behind him", () => {
    const roster = [P("Star", "QB", 92), P("Backup", "QB", 60), P("Even", "HB", 80), P("Also", "HB", 79)];
    const drops = depthDropOff(roster);
    expect(drops.map((d) => d.starter.name)).toEqual(["Star"]);
    expect(drops[0].backup.name).toBe("Backup");
  });

  it("ignores spots with a capable backup and ignores specialists", () => {
    const roster = [P("K1", "K", 95), P("K2", "K", 50), P("Deep", "QB", 88), P("Deep2", "QB", 85)];
    expect(depthDropOff(roster)).toEqual([]);
  });

  // The parser caps a roster at its top 70, so a missing backup is missing DATA, not a
  // missing player — claiming "nothing behind him" off that would invent a weakness.
  it("stays silent when the roster carries no backup at all", () => {
    expect(depthDropOff([P("Lonely Star", "QB", 95)])).toEqual([]);
  });
});

// The whole point of this change: a coach never sees a 0-99 rating. If a rendered string can
// carry one, this catches it.
describe("no ratings ever reach a rendered string", () => {
  const m = scoutingMath(MINE, THEIRS, { games: SCHEDULE, teams: TEAMS, myRow: 1, theirRow: 2 });

  const rendered = [
    ...projectedStarters(THEIRS).map((s) => starterLine(s, true)),
    ...m.mismatches.flatMap((x) => [starterLine(x.mine), starterLine(x.theirs, true), SEVERITY_LABEL[x.severity]]),
    ...m.weakLinks.map((s) => starterLine(s)),
    ...m.threats.map((s) => starterLine(s, true)),
    ...m.injuries.map((i) => playerLine(i.player)),
    ...m.dropOffs.map((d) => playerLine(d.starter)),
    ...m.edges.flatMap((e) => [e.myGrade, e.theirGrade, e.verdict ? EDGE_LABEL[e.verdict] : null]),
    ...m.matchups.flatMap((x) => [x.call, x.myGrade, x.theirGrade]),
    m.experience.read,
    m.schedule?.quarters.read ?? null,
    ...(m.schedule?.form.games ?? []).map(formLine),
  ].filter((s): s is string => typeof s === "string");

  it("never prints the letters OVR", () => {
    expect(rendered.filter((s) => /\bOVR\b/i.test(s))).toEqual([]);
  });

  it("never prints a bare two-digit rating for any player on either roster", () => {
    const ratings = [...MINE, ...THEIRS].map((p) => p.overall).filter((v): v is number => v != null);
    const offenders = rendered.filter((line) => {
      // Jersey numbers are written #12 and scores are written 24-28; a rating would appear as
      // a standalone number with neither marker.
      const bare = line.match(/(?<![#\d-])\b\d{2}\b(?!-)/g) ?? [];
      return bare.some((n) => ratings.includes(Number(n)));
    });
    expect(offenders).toEqual([]);
  });

  it("does describe players by jersey, name and class instead", () => {
    const wr1 = projectedStarters(THEIRS).find((s) => s.slot === "WR1")!;
    expect(starterLine(wr1, true)).toBe("WR1 #11 Opp WR1 (Jr.) — elite");
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
