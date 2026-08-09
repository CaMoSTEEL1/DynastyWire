// The rules that decide whether a season has a STORY in it.
//
// The failure mode this file exists to prevent is not a crash — it is a detector that fires
// on an ordinary player. A board of four "storylines" nobody recognises is worse than an
// empty board, because it teaches the user that none of it is real. So most of what is
// pinned here is what must NOT be detected.

import { describe, expect, it } from "vitest";
import type { RosterPlayer, RosterStats } from "./client";
import type { SeasonRecord } from "./archive";
import {
  advanceArcs,
  arcsBlock,
  chapterOf,
  detectArcs,
  detectLeagueArcs,
  liveArcs,
  type ArcMemory,
  type PlayerArc,
} from "./arcs";

const stats = (over: Partial<RosterStats> = {}): RosterStats => ({
  side: "offense",
  gamesPlayed: 9,
  gamesStarted: 9,
  ...over,
});

const P = (name: string, position: string, over: Partial<RosterPlayer> = {}): RosterPlayer => ({
  name,
  position,
  year: "JR",
  overall: 85,
  jersey: null,
  ...over,
});

const input = (roster: RosterPlayer[], over: Partial<Parameters<typeof detectArcs>[0]> = {}) => ({
  roster,
  archive: [] as SeasonRecord[],
  awards: [],
  team: "Kansas State",
  ...over,
});

// A perfectly good starter who is not a story. Every detector must ignore him.
const ORDINARY = P("Dell Vickers", "WR", {
  stats: stats({ offense: { gamesPlayed: 9, gamesStarted: 9, recYds: 410, recCatches: 31, recTDs: 3 } }),
});

describe("the two-way arc", () => {
  const hunter = P("Cam Rivers", "WR", {
    stats: stats({
      twoWay: true,
      offense: { gamesPlayed: 9, gamesStarted: 9, recCatches: 44, recYds: 620, recTDs: 6 },
      defense: { gamesPlayed: 9, gamesStarted: 9, tackles: 31, ints: 4, deflections: 9 },
    }),
  });

  it("finds a man producing on BOTH sides", () => {
    const [arc] = detectArcs(input([hunter, ORDINARY]));
    expect(arc.kind).toBe("two-way");
    expect(arc.claim).toContain("Cam Rivers");
    expect(arc.evidence.join(" ")).toContain("44 catches for 620 yds");
    expect(arc.evidence.join(" ")).toContain("31 tackles");
  });

  it("ignores a two-way FLAG with nothing behind it", () => {
    // Every special-teams gunner logs snaps on both sides. That is not Travis Hunter, and a
    // detector that calls it one burns the whole feature's credibility on week one.
    const gunner = P("Ty Bess", "CB", {
      stats: stats({
        twoWay: true,
        offense: { gamesPlayed: 9, gamesStarted: 0, recYds: 12, recCatches: 1 },
        defense: { gamesPlayed: 9, gamesStarted: 2, tackles: 9 },
      }),
    });
    expect(detectArcs(input([gunner])).filter((a) => a.kind === "two-way")).toHaveLength(0);
  });
});

describe("the freshman arc", () => {
  it("fires when a true freshman leads the team in scrimmage yards", () => {
    const frosh = P("Jaylen Moss", "WR", {
      year: "FR",
      stats: stats({ offense: { gamesPlayed: 9, gamesStarted: 7, recYds: 780, recCatches: 52, recTDs: 9 } }),
    });
    const [arc] = detectArcs(input([frosh, ORDINARY]));
    expect(arc.kind).toBe("freshman-phenom");
    expect(arc.claim).toContain("leads this team");
  });

  it("does not fire for an upperclassman having a good year", () => {
    const jr = P("Marcus Vane", "HB", {
      year: "SR",
      stats: stats({ offense: { gamesPlayed: 9, gamesStarted: 9, rushYds: 900, rushTDs: 11 } }),
    });
    expect(detectArcs(input([jr])).filter((a) => a.kind === "freshman-phenom")).toHaveLength(0);
  });

  it("does not fire for a freshman with a handful of touches", () => {
    const bench = P("Kai Iverson", "WR", {
      year: "FR",
      stats: stats({ offense: { gamesPlayed: 6, gamesStarted: 0, recYds: 44, recCatches: 4 } }),
    });
    expect(detectArcs(input([bench, ORDINARY])).filter((a) => a.kind === "freshman-phenom")).toHaveLength(0);
  });
});

describe("the repeat-winner arc", () => {
  const season = (year: number, awards: { award: string; name: string }[]): SeasonRecord =>
    ({
      dynastyId: "d", year, team: "Kansas State", coachName: null, wins: 12, losses: 1,
      confWins: null, confLosses: null, finalRankMedia: null, finalRankCFP: null, prestige: null,
      result: null, champion: null, leaders: [], roster: [], games: [], ledger: [], archivedAt: 0,
      awards: awards.map((a) => ({ ...a, position: "WR", school: "Kansas State" })),
    }) as SeasonRecord;

  it("sees the same man win the same award twice", () => {
    // Only possible because the archive keeps each season's award list — the save itself
    // holds this year's winners and forgets last year's entirely.
    const arcs = detectArcs(
      input([ORDINARY], {
        archive: [season(2029, [{ award: "Heisman", name: "Cam Rivers" }])],
        awards: [{ award: "Heisman", name: "Cam Rivers", position: "WR", school: "Kansas State" }],
      })
    );
    const repeat = arcs.find((a) => a.kind === "repeat-winner")!;
    expect(repeat.claim).toContain("more than once");
    expect(repeat.evidence.join(" ")).toContain("2029");
  });

  it("does not call a first-time winner a repeat winner", () => {
    const arcs = detectArcs(
      input([ORDINARY], {
        awards: [{ award: "Heisman", name: "Cam Rivers", position: "WR", school: "Kansas State" }],
      })
    );
    expect(arcs.filter((a) => a.kind === "repeat-winner")).toHaveLength(0);
  });
});

describe("keeping the board honest", () => {
  it("tells one story per player, with the heavier framing", () => {
    // A freshman playing both ways is one story, not two, and the two-way framing is the
    // rarer one. Two entries for one man reads as the app padding the board.
    const both = P("Cam Rivers", "WR", {
      year: "FR",
      stats: stats({
        twoWay: true,
        offense: { gamesPlayed: 9, gamesStarted: 9, recCatches: 44, recYds: 900, recTDs: 8 },
        defense: { gamesPlayed: 9, gamesStarted: 9, tackles: 40, ints: 3 },
      }),
    });
    const arcs = detectArcs(input([both]));
    expect(arcs.filter((a) => a.player === "Cam Rivers")).toHaveLength(1);
    expect(arcs[0].kind).toBe("two-way");
  });

  it("finds nothing at all in an ordinary roster", () => {
    expect(detectArcs(input([ORDINARY, P("Ben Hoyt", "LB", { stats: stats({ defense: { gamesPlayed: 9, gamesStarted: 9, tackles: 40 } }) })]))).toEqual([]);
  });

  it("never returns more than four", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      P(`Frosh ${i}`, "WR", {
        year: "FR",
        stats: stats({ offense: { gamesPlayed: 9, gamesStarted: 9, recYds: 700 + i, recCatches: 40, recTDs: 8 } }),
      })
    );
    expect(detectArcs(input(many)).length).toBeLessThanOrEqual(4);
  });
});

// ── The branch ────────────────────────────────────────────────────────────────

describe("how an arc moves through its chapters", () => {
  const arc: PlayerArc = {
    team: "Kansas State", spin: "s", kind: "freshman-phenom", player: "Jaylen Moss", position: "WR", classYear: "FR",
    claim: "c", evidence: [], weight: 100, advancesIf: "a", collapsesIf: "b",
  };
  const mem = (over: Partial<ArcMemory> = {}): ArcMemory => ({
    key: "freshman-phenom::jaylen moss", firstSeenYear: 2030, firstSeenWeek: 2,
    weeksHeld: 1, peakWeight: 100, broken: false, lastSeenWeek: 2, lastSeenYear: 2030, ...over,
  });
  const ctx = { ranked: false, seasonOver: false };

  it("starts as a claim and earns its way up", () => {
    expect(chapterOf(arc, mem({ weeksHeld: 1 }), ctx)).toBe("claim");
    expect(chapterOf(arc, mem({ weeksHeld: 2 }), ctx)).toBe("proof");
    expect(chapterOf(arc, mem({ weeksHeld: 5 }), { ...ctx, ranked: true })).toBe("spotlight");
    expect(chapterOf(arc, mem({ weeksHeld: 8 }), ctx)).toBe("target");
  });

  it("a broken arc is a chapter, not a deletion", () => {
    // The fall is the most human part of the story. Dropping it silently makes the beat look
    // like it forgot a man it spent a month on.
    expect(chapterOf(arc, mem({ weeksHeld: 6, broken: true }), ctx)).toBe("broken");
  });

  it("counts weeks HELD, not weeks elapsed, and never twice for one week", () => {
    // A re-parse or a second visit in the same week must not age the story.
    let memory = advanceArcs([], [arc], { year: 2030, week: 3 });
    memory = advanceArcs(memory, [arc], { year: 2030, week: 3 });
    expect(memory[0].weeksHeld).toBe(1);
    memory = advanceArcs(memory, [arc], { year: 2030, week: 4 });
    expect(memory[0].weeksHeld).toBe(2);
  });

  it("breaks an established arc that stops appearing, and forgets one that never established", () => {
    let memory = advanceArcs([], [arc], { year: 2030, week: 3 });
    memory = advanceArcs(memory, [arc], { year: 2030, week: 4 });
    memory = advanceArcs(memory, [arc], { year: 2030, week: 5 });
    expect(memory[0].weeksHeld).toBe(3);

    const gone = advanceArcs(memory, [], { year: 2030, week: 6 });
    expect(gone[0].broken).toBe(true);

    // One hot Saturday and then nothing is not a collapse — it was never a story.
    const brief = advanceArcs(advanceArcs([], [arc], { year: 2030, week: 3 }), [], { year: 2030, week: 4 });
    expect(brief[0].broken).toBe(false);
  });
});

describe("what the newsroom is handed", () => {
  const arc: PlayerArc = {
    team: "Kansas State", spin: "s", kind: "two-way", player: "Cam Rivers", position: "WR", classYear: "SO",
    claim: "Cam Rivers is playing both ways — and producing on both.",
    evidence: ["Offense: 44 catches for 620 yds, 6 TD", "Defense: 31 tackles, 4 INT"],
    weight: 160, advancesIf: "the snaps hold", collapsesIf: "one side eats the other",
  };

  it("carries the chapter, the evidence and how to play it", () => {
    const live = liveArcs([arc], advanceArcs([], [arc], { year: 2030, week: 3 }), { ranked: false, seasonOver: false });
    const block = arcsBlock(live)!;
    expect(block).toContain("[The Claim]");
    expect(block).toContain("44 catches for 620 yds");
    expect(block).toContain("It grows if the snaps hold");
  });

  it("forbids inventing a different storyline player", () => {
    // Without this the model picks its own protagonist, and the whole point was that the
    // protagonist is the user's actual guy.
    const live = liveArcs([arc], [], { ranked: false, seasonOver: false });
    expect(arcsBlock(live)).toContain("he is not one of the season's stories");
  });

  it("says nothing at all when the season has no story in it", () => {
    expect(arcsBlock([])).toBeNull();
  });
});

// ── The league, not just your locker room ─────────────────────────────────────
// The opponent's roster is parsed every week anyway, so their stories cost nothing — and
// without them the rest of the country is scenery. With them, the team on the other sideline
// turns up carrying a season of its own, and some weeks the two collide.

describe("the other sideline", () => {
  const prodigy = P("Cade Whitlock", "QB", {
    year: "SO",
    stats: stats({ offense: { gamesPlayed: 9, gamesStarted: 9, passYds: 2900, passTDs: 28, passInts: 4 } }),
  });
  const safety = P("Deion Alcorn", "FS", {
    year: "FR",
    stats: stats({ side: "defense", defense: { gamesPlayed: 9, gamesStarted: 9, tackles: 52, ints: 5, deflections: 9 } }),
  });

  it("gives the opponent their own stories, marked as theirs", () => {
    const board = detectLeagueArcs({
      user: input([safety]),
      opponent: input([prodigy], { team: "Texas" }),
    });
    const theirs = board.find((a) => a.player === "Cade Whitlock")!;
    expect(theirs.opposing).toBe(true);
    expect(theirs.team).toBe("Texas");
    const mine = board.find((a) => a.player === "Deion Alcorn")!;
    expect(mine.opposing).toBe(false);
  });

  it("finds the collision when the two stories meet on the field", () => {
    // The week the beat writes itself: their quarterback, your secondary, same afternoon.
    const board = detectLeagueArcs({
      user: input([safety]),
      opponent: input([prodigy], { team: "Texas" }),
    });
    const meeting = board.find((a) => a.kind === "collision")!;
    expect(meeting.claim).toContain("Deion Alcorn");
    expect(meeting.claim).toContain("Cade Whitlock");
    // It leads, because it is the only story that exists for exactly one week.
    expect(board[0].kind).toBe("collision");
  });

  it("does not manufacture a collision out of two unrelated stories", () => {
    // A quarterback and a running back are not a matchup, they are two men in one game.
    const back = P("Rell Dozier", "HB", {
      stats: stats({ offense: { gamesPlayed: 9, gamesStarted: 9, rushAtt: 190, rushYds: 1020, rushTDs: 12 } }),
    });
    const board = detectLeagueArcs({
      user: input([back]),
      opponent: input([prodigy], { team: "Texas" }),
    });
    expect(board.filter((a) => a.kind === "collision")).toHaveLength(0);
  });

  it("keeps the opponent's board short — they are context, not the paper", () => {
    const loaded = [prodigy, P("Ty Bloom", "HB", { stats: stats({ offense: { gamesPlayed: 9, gamesStarted: 9, rushAtt: 200, rushYds: 1100, rushTDs: 14 } }) }),
      P("Sam Rooks", "EDGE", { stats: stats({ side: "defense", defense: { gamesPlayed: 9, gamesStarted: 9, sacks: 11, tfl: 16 } }) }),
      P("Jo Vance", "CB", { stats: stats({ side: "defense", defense: { gamesPlayed: 9, gamesStarted: 9, ints: 6, deflections: 12 } }) })];
    const board = detectLeagueArcs({ user: input([]), opponent: input(loaded, { team: "Texas" }) });
    expect(board.filter((a) => a.opposing).length).toBeLessThanOrEqual(2);
  });

  it("writes the two sidelines as different things", () => {
    const board = detectLeagueArcs({
      user: input([safety]),
      opponent: input([prodigy], { team: "Texas" }),
    });
    const block = arcsBlock(liveArcs(board, [], { ranked: false, seasonOver: false }))!;
    expect(block).toContain("THIS WEEK'S MEETING");
    expect(block).toContain("THE OTHER SIDELINE");
    expect(block).toContain("never celebrated as your own");
  });
});

describe("the program's own arcs", () => {
  const team = (over: Record<string, unknown> = {}) =>
    ({ row: 1, teamIndex: 1, name: "Kansas State", nickname: null, city: null, wins: 8, losses: 0,
       confWins: null, confLosses: null, rankMedia: 4, rankCoaches: null, rankCFP: null,
       prestige: 4, ratingOVR: null, ...over }) as never;

  it("calls an unbeaten season what it is", () => {
    const arcs = detectArcs(
      input([], { program: { team: team(), games: [], teams: {}, teamRow: 1, archive: [] } })
    );
    const zero = arcs.find((a) => a.kind === "unbeaten")!;
    expect(zero.claim).toContain("has not lost");
    expect(zero.evidence[0]).toContain("8-0");
  });

  it("does not call 2-0 a season", () => {
    const arcs = detectArcs(
      input([], { program: { team: team({ wins: 2, losses: 0 }), games: [], teams: {}, teamRow: 1, archive: [] } })
    );
    expect(arcs.filter((a) => a.kind === "unbeaten")).toHaveLength(0);
  });

  it("knows a low-prestige program ranked high is a story, and a blue blood is not", () => {
    const cinders = detectArcs(
      input([], { program: { team: team({ losses: 1, prestige: 3 }), games: [], teams: {}, teamRow: 1, archive: [] } })
    );
    expect(cinders.some((a) => a.kind === "cinderella")).toBe(true);

    const blueBlood = detectArcs(
      input([], { program: { team: team({ losses: 1, prestige: 9 }), games: [], teams: {}, teamRow: 1, archive: [] } })
    );
    expect(blueBlood.some((a) => a.kind === "cinderella")).toBe(false);
  });

  it("counts the years since a title, which only the archive can see", () => {
    const seasons = [2027, 2028, 2029, 2030].map((year) => ({
      dynastyId: "d", year, team: "Kansas State", coachName: null, wins: 9, losses: 3,
      confWins: null, confLosses: null, finalRankMedia: null, finalRankCFP: null, prestige: null,
      result: year === 2025 ? "national-champ" : "regular", champion: null,
      leaders: [], roster: [], games: [], ledger: [], archivedAt: 0,
    })) as unknown as SeasonRecord[];
    const arcs = detectArcs(
      input([], { program: { team: team({ wins: 6, losses: 3, rankMedia: null }), games: [], teams: {}, teamRow: 1, archive: seasons } })
    );
    expect(arcs.some((a) => a.kind === "drought")).toBe(true);
  });
});
