// Year-over-year memory, tested the way every other deterministic-core module is: the claim
// under test is what the model is HANDED, so the rendered block is asserted directly.
//
// The failure that matters most here is not a missing callback — it's the block claiming
// something the archive doesn't support. A revenge frame on a game the program won, or the
// current season leaking into "history", is worse than having no memory at all.

import { describe, expect, it } from "vitest";
import type { CoachInfo, RosterPlayer } from "./client";
import type { SeasonPlayerLine, SeasonRecord } from "./archive";
import {
  coachResumeBlock,
  jobSecurityLine,
  opponentHistory,
  priorSeasons,
  priorSeasonsBlock,
  programArc,
  returningPlayers,
  seasonLine,
} from "./history";

const line = (over: Partial<SeasonPlayerLine> & { name: string }): SeasonPlayerLine => ({
  position: null,
  classYear: null,
  overall: null,
  gamesPlayed: 12,
  gamesStarted: 12,
  passYds: 0, passTDs: 0, passInts: 0,
  rushYds: 0, rushTDs: 0,
  recYds: 0, recTDs: 0, recCatches: 0,
  tackles: 0, tfl: 0, sacks: 0, ints: 0,
  fgMade: 0, fgAtt: 0,
  summary: "",
  ...over,
});

const season = (over: Partial<SeasonRecord> & { year: number }): SeasonRecord => ({
  dynastyId: "d1",
  team: "Coastal Carolina",
  coachName: "Ray Deleon",
  wins: 8,
  losses: 4,
  confWins: 5,
  confLosses: 3,
  finalRankMedia: null,
  finalRankCFP: null,
  prestige: 5,
  result: "regular",
  champion: "Georgia",
  leaders: [],
  roster: [],
  games: [],
  ledger: [],
  archivedAt: 0,
  ...over,
});

const P = (name: string, position: string): RosterPlayer => ({
  name,
  position,
  year: "SR",
  overall: 85,
  jersey: null,
});

const ARCHIVE: SeasonRecord[] = [
  season({
    year: 2027,
    wins: 6,
    losses: 6,
    games: [{ week: 7, opponent: "Tulane", us: 14, them: 34, won: false }],
    roster: [line({ name: "Dorian Whitfield", position: "QB", passYds: 1980, passTDs: 12, summary: "1980 pass yds, 12 TD" })],
  }),
  season({
    year: 2028,
    wins: 9,
    losses: 3,
    finalRankMedia: 18,
    result: "made-postseason",
    games: [{ week: 6, opponent: "Tulane", us: 21, them: 24, won: false }],
    roster: [
      line({ name: "Dorian Whitfield", position: "QB", passYds: 2588, passTDs: 21, summary: "2588 pass yds, 21 TD" }),
      line({ name: "Kellen Marsh", position: "HB", rushYds: 984, rushTDs: 11, summary: "984 rush yds, 11 TD" }),
      line({ name: "Departed Guy", position: "WR", recYds: 1200, summary: "1200 rec yds" }),
    ],
    ledger: [
      { headline: "Star back cited", decision: "Suspended him for the bowl", outcome: "Locker room split", week: 13 },
    ],
  }),
  // The season currently being played — checkpointed into the same store, and it must never
  // be fed back as "history".
  season({ year: 2029, wins: 6, losses: 2, games: [{ week: 8, opponent: "Tulane", us: 31, them: 17, won: true }] }),
];

const ROSTER = [P("Dorian Whitfield", "QB"), P("Kellen Marsh", "HB"), P("Trey Vandiver", "WR")];

describe("priorSeasons", () => {
  it("excludes the season being played", () => {
    expect(priorSeasons(ARCHIVE, 2029).map((s) => s.year)).toEqual([2027, 2028]);
  });

  it("returns nothing in year one", () => {
    expect(priorSeasons([season({ year: 2027 })], 2027)).toEqual([]);
  });
});

describe("seasonLine", () => {
  it("states the record, the finish and who won the title", () => {
    expect(seasonLine(ARCHIVE[1])).toBe(
      "2028: 9-3 · (5-3 conf) · finished #18 · reached the postseason · national champion: Georgia"
    );
  });

  it("says unranked rather than leaving the rank blank", () => {
    expect(seasonLine(ARCHIVE[0])).toContain("finished unranked");
  });
});

describe("programArc", () => {
  it("counts the run of winning seasons", () => {
    const prior = priorSeasons(ARCHIVE, 2029);
    expect(programArc(prior, null)).toBeNull(); // 2027 was 6-6, so the run is 1
    expect(programArc([ARCHIVE[1], season({ year: 2029, wins: 10, losses: 2 })], null)).toContain(
      "2 straight winning seasons"
    );
  });

  it("compares this season against last year's win total", () => {
    expect(programArc(priorSeasons(ARCHIVE, 2029), { wins: 10, losses: 1 })).toContain(
      "already past last year's 9-3 win total"
    );
  });
});

describe("opponentHistory", () => {
  const prior = priorSeasons(ARCHIVE, 2029);

  it("collects every archived meeting and the series record", () => {
    const h = opponentHistory(prior, "Tulane")!;
    expect(h.meetings.map((m) => m.year)).toEqual([2027, 2028]);
    expect([h.wins, h.losses]).toEqual([0, 2]);
  });

  it("infers a rivalry from repeat matchups, since the save doesn't flag them", () => {
    expect(opponentHistory(prior, "Tulane")!.rivalry).toBe(true);
  });

  it("earns the revenge angle only when the last meeting was a loss", () => {
    expect(opponentHistory(prior, "Tulane")!.revenge).toBe(true);
    const won = opponentHistory(
      [season({ year: 2028, games: [{ week: 4, opponent: "Tulane", us: 30, them: 10, won: true }] })],
      "Tulane"
    )!;
    expect(won.revenge).toBe(false);
    expect(won.rivalry).toBe(false);
  });

  it("is null for an opponent never played", () => {
    expect(opponentHistory(prior, "Ohio State")).toBeNull();
    expect(opponentHistory(prior, null)).toBeNull();
  });
});

describe("returningPlayers", () => {
  const prior = priorSeasons(ARCHIVE, 2029);

  it("keeps only players still on the roster, at their most recent prior line", () => {
    const r = returningPlayers(prior, ROSTER);
    expect(r.map((p) => p.name)).toEqual(["Dorian Whitfield", "Kellen Marsh"]);
    expect(r[0].year).toBe(2028);
    expect(r[0].line).toBe("2588 pass yds, 21 TD");
  });

  it("drops players who have left, whatever they did", () => {
    expect(returningPlayers(prior, ROSTER).some((p) => p.name === "Departed Guy")).toBe(false);
  });

  it("respects the cap", () => {
    expect(returningPlayers(prior, ROSTER, 1)).toHaveLength(1);
  });
});

// ── The coach's résumé ──────────────────────────────────────────────────────────
// The fixture is a real save (SKISWORLD / Kansas State, dumped from CareerCoachStats):
// 14-0, one conference title, one bowl win, one playoff win, no national titles, first
// season at the school. The zeroes matter as much as the wins — "no titles" has to be
// stated, because a header with nothing under it invites the model to fill one in.

const coach = (over: Partial<CoachInfo> = {}, career: Partial<NonNullable<CoachInfo["career"]>> = {}): CoachInfo => ({
  teamIndex: 38,
  coachName: "Ski Miller",
  position: "HeadCoach",
  jobSecurity: null,
  fireReported: null,
  performanceLevel: null,
  age: 36,
  awardPoints: 0,
  careerWinSeasons: 0,
  careerPlayoffs: 1,
  careerLongWinStreak: 14,
  yearsCoaching: 1,
  seasonsWithTeam: 0,
  prestige: "B",
  prestigeScore: 715,
  contractYearsRemaining: 3,
  contractExpectation: "Win8Games",
  ...over,
  career: {
    wins: 14, losses: 0,
    winsAtSchool: 14, lossesAtSchool: 0,
    natTitles: 0, natTitleLosses: 0, recentTitleYear: -2,
    confTitles: 1, confTitleLosses: 0,
    bowlWins: 1, bowlLosses: 0,
    playoffWins: 1, playoffLosses: 0,
    top25Wins: 4, top25Losses: 0,
    rivalWins: 1, rivalLosses: 0,
    timesFired: 0, top5Classes: 0, draftPicks: 0, firstRoundPicks: 0,
    ...career,
  },
});

describe("jobSecurityLine", () => {
  // The bug: the parser read SeasonStartJobSecurityStatus, which is stale and reads the
  // sentinel "Invalid" for part of the league. A 14-0 coach at 100% security reached the
  // generators as "unknown", and unknown is where hot-seat drama gets invented.
  it("reads the live status", () => {
    expect(jobSecurityLine(coach({ jobSecurity: "Safe", jobSecurityPct: 100 }))).toContain("SAFE");
    expect(jobSecurityLine(coach({ jobSecurity: "HotSeat", jobSecurityPct: 12 }))).toContain("HOT SEAT");
    expect(jobSecurityLine(coach({ jobSecurity: "SafeForNow", jobSecurityPct: 62 }))).toContain("SAFE FOR NOW");
    expect(jobSecurityLine(coach({ jobSecurity: "Low", jobSecurityPct: 30 }))).toContain("SHAKY");
  });

  it("includes the percentage the status came from", () => {
    expect(jobSecurityLine(coach({ jobSecurity: "Safe", jobSecurityPct: 100 }))).toContain("100% job security");
  });

  it("falls back to the percentage when the status is missing", () => {
    expect(jobSecurityLine(coach({ jobSecurity: null, jobSecurityPct: 90 }))).toContain("SAFE");
    expect(jobSecurityLine(coach({ jobSecurity: null, jobSecurityPct: 10 }))).toContain("HOT SEAT");
  });

  it("forbids speculation instead of saying 'unknown' when the save is silent", () => {
    const line = jobSecurityLine(coach({ jobSecurity: null, jobSecurityPct: null }));
    expect(line).toContain("NOT STATED IN THE SAVE");
    expect(line).toContain("do NOT speculate");
    expect(line).not.toContain("unknown");
  });

  it("never reports a perfect season as a job in danger", () => {
    const line = jobSecurityLine(coach({ jobSecurity: "Safe", jobSecurityPct: 100 }));
    expect(line).not.toMatch(/hot seat|danger|shaky/i);
  });
});

describe("coachResumeBlock", () => {
  it("tells the room whether the coach is safe", () => {
    expect(coachResumeBlock(coach({ jobSecurity: "Safe", jobSecurityPct: 100 }), "Kansas State")).toContain(
      "JOB SECURITY: SAFE"
    );
  });

  it("states the career record and the record at THIS school separately", () => {
    const b = coachResumeBlock(coach({}, { wins: 96, losses: 40, winsAtSchool: 14, lossesAtSchool: 0 }), "Kansas State")!;
    expect(b).toContain("CAREER RECORD (everywhere he has coached): 96-40");
    expect(b).toContain("RECORD AT KANSAS STATE: 14-0");
  });

  it("says plainly when he has never won a national title", () => {
    const b = coachResumeBlock(coach(), "Kansas State")!;
    expect(b).toContain("NATIONAL TITLES: NONE");
    expect(b).toContain("never call him a champion");
  });

  it("counts the titles when he has them, and dates the most recent", () => {
    const b = coachResumeBlock(coach({}, { natTitles: 5, recentTitleYear: 2034 }), "Kansas State")!;
    expect(b).toContain("NATIONAL TITLES: 5");
    expect(b).toContain("5-time national champion");
    expect(b).toContain("most recently in 2034");
  });

  it("uses the singular for one", () => {
    expect(coachResumeBlock(coach({}, { natTitles: 1 }), "Kansas State")).toContain("is a national champion");
  });

  it("does not date a title he never won (the save stores -2 for none)", () => {
    expect(coachResumeBlock(coach(), "Kansas State")).not.toContain("most recently");
  });

  it("treats a first season as a fact, not a blank", () => {
    const b = coachResumeBlock(coach({ seasonsWithTeam: 0 }), "Kansas State")!;
    expect(b).toContain("FIRST season at Kansas State");
    expect(b).toContain("no history here");
  });

  it("counts tenure from completed seasons", () => {
    expect(coachResumeBlock(coach({ seasonsWithTeam: 3 }), "Kansas State")).toContain(
      "fourth season at Kansas State"
    );
  });

  it("carries conference titles, playoff, bowl, ranked and rivalry records", () => {
    const b = coachResumeBlock(coach(), "Kansas State")!;
    expect(b).toContain("CONFERENCE TITLES: 1");
    expect(b).toContain("Playoff record: 1-0");
    expect(b).toContain("Bowl record: 1-0");
    expect(b).toContain("Against ranked teams: 4-0");
    expect(b).toContain("In rivalry games: 1-0");
  });

  it("mentions being fired only when it happened", () => {
    expect(coachResumeBlock(coach(), "Kansas State")).not.toContain("FIRED");
    expect(coachResumeBlock(coach({}, { timesFired: 2 }), "Kansas State")).toContain("FIRED 2 time(s)");
  });

  it("forbids inventing anything the save doesn't carry", () => {
    const b = coachResumeBlock(coach(), "Kansas State")!;
    expect(b).toContain("NEVER invent");
    expect(b).toContain("is UNKNOWN");
  });

  it("is null when there is no coach, or nothing but a name", () => {
    expect(coachResumeBlock(null, "Kansas State")).toBeNull();
    expect(
      coachResumeBlock(
        { teamIndex: null, coachName: "Nobody", jobSecurity: null, fireReported: null, performanceLevel: null, age: null, awardPoints: null, careerWinSeasons: null, careerPlayoffs: null, careerLongWinStreak: null },
        "Kansas State"
      )
    ).toBeNull();
  });

  it("survives a save parsed by an older sidecar, which has no career block", () => {
    const old: CoachInfo = {
      teamIndex: 38, coachName: "Ski Miller", jobSecurity: null, fireReported: null,
      performanceLevel: null, age: 36, awardPoints: 0, careerWinSeasons: 0,
      careerPlayoffs: 1, careerLongWinStreak: 14, seasonsWithTeam: 2,
    };
    const b = coachResumeBlock(old, "Kansas State")!;
    expect(b).toContain("third season at Kansas State");
    expect(b).not.toContain("CAREER RECORD");
    expect(b).not.toContain("NATIONAL TITLES");
  });
});

describe("priorSeasonsBlock", () => {
  const block = priorSeasonsBlock({
    archive: ARCHIVE,
    currentYear: 2029,
    opponent: "Tulane",
    roster: ROSTER,
    current: { wins: 6, losses: 2 },
  })!;

  it("is null in year one so the model is never handed an empty history to fill in", () => {
    expect(priorSeasonsBlock({ archive: [season({ year: 2029 })], currentYear: 2029 })).toBeNull();
    expect(priorSeasonsBlock({ archive: [], currentYear: 2029 })).toBeNull();
  });

  it("states the past as fixed fact and forbids inventing the rest", () => {
    expect(block).toContain("NEVER invent a past record");
    expect(block).toContain("is UNKNOWN");
  });

  it("carries the ledger, the series and the returning players", () => {
    expect(block).toContain("2027: 6-6");
    expect(block).toContain("2028: 9-3");
    expect(block).toContain("REVENGE ANGLE IS EARNED");
    expect(block).toContain("Dorian Whitfield — 2028: 2588 pass yds, 21 TD");
    expect(block).toContain("Suspended him for the bowl");
  });

  it("never leaks the season being played into the history", () => {
    expect(block).not.toContain("2029");
    expect(block).not.toContain("31-17");
  });

  it("blocks a revenge frame when the program won the last meeting", () => {
    const won = priorSeasonsBlock({
      archive: [season({ year: 2028, games: [{ week: 4, opponent: "Tulane", us: 30, them: 10, won: true }] })],
      currentYear: 2029,
      opponent: "Tulane",
    })!;
    expect(won).toContain("do NOT write this as a revenge game");
    expect(won).not.toContain("REVENGE ANGLE IS EARNED");
  });
});
