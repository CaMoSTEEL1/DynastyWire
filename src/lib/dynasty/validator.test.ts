// Fixture tests for the deterministic core's fact-checker.
//
// The validator is pure logic over known inputs, so every case here is a hand-written piece
// of generated text plus the exact violations it should produce. Two halves, and the second
// matters more than the first: catching a fabricated running back is easy, and a checker
// that also flags the fictional beat writer, the invented 3rd-and-8, or the fan with a
// strong opinion is WORSE than no checker at all — it would drive repairs that strip the
// voice out of the product.

import { describe, expect, it } from "vitest";
import type {
  DynastySnapshot,
  RosterPlayer,
  RosterStats,
  RosterStatsSide,
  TeamInfo,
  WeekDelta,
} from "./client";
import {
  buildGroundTruth,
  collectText,
  configFor,
  statClaims,
  validateGeneration,
  type GroundTruth,
} from "./validator";

// ── Fixture save ────────────────────────────────────────────────────────────────
// Coastal Carolina (the user, 6-2, ranked #22 by the media poll and unranked in the CFP)
// beat #9 Tulane 31-17 in Week 8. Both rosters are known.

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

// Season-to-date lines, in the parser's real shape: the active side is written BOTH nested
// and flattened onto the wrapper.
const stats = (side: RosterStats["side"], vals: Partial<RosterStatsSide>): RosterStats => {
  const block: RosterStatsSide = { gamesPlayed: 8, gamesStarted: 8, ...vals };
  return {
    side,
    gamesPlayed: 8,
    gamesStarted: 8,
    offense: side === "offense" ? block : null,
    defense: side === "defense" ? block : null,
    kicking: side === "kicking" ? block : null,
    ...vals,
  };
};

const P = (
  name: string,
  position: string,
  overall = 80,
  line: RosterStats | null = null
): RosterPlayer => ({
  name,
  position,
  year: "JR",
  overall,
  jersey: null,
  stats: line,
});

const OURS: RosterPlayer[] = [
  P("Dorian Whitfield", "QB", 87, stats("offense", { passYds: 2588, passTDs: 21, passInts: 6, rushYds: 210, rushTDs: 3 })),
  P("Kellen Marsh", "HB", 84, stats("offense", { rushYds: 984, rushAtt: 214, rushTDs: 11, recCatches: 22, recYds: 180 })),
  P("Trey Vandiver", "WR", 82, stats("offense", { recYds: 712, recTDs: 7, recCatches: 48 })),
  P("Isaiah Pruitt", "LB", 85, stats("defense", { tackles: 71, sacks: 6, ints: 2 })),
];

const THEIRS: RosterPlayer[] = [
  P("Jamal Reed", "LB", 88, stats("defense", { tackles: 63, sacks: 9 })),
  P("Cortez Bly", "QB", 86, stats("offense", { passYds: 1900, passTDs: 14 })),
];

const SNAPSHOT: DynastySnapshot = {
  week: 8,
  year: 2029,
  dynastyYear: 3,
  calendar: null,
  coachName: "Ray Deleon",
  coach: null,
  tableCount: 0,
  userTeamRow: 1,
  userTeam: team({
    row: 1,
    name: "Coastal Carolina",
    nickname: "Chanticleers",
    wins: 6,
    losses: 2,
    rankMedia: 22,
  }),
  teams: {
    "1": team({
      row: 1,
      name: "Coastal Carolina",
      nickname: "Chanticleers",
      wins: 6,
      losses: 2,
      rankMedia: 22,
    }),
    "2": team({ row: 2, name: "Tulane", nickname: "Green Wave", wins: 7, losses: 1, rankMedia: 9, rankCFP: 9 }),
    "3": team({ row: 3, name: "Appalachian State", nickname: "Mountaineers", wins: 4, losses: 4 }),
  },
  games: [],
  headCoaches: { "2": "Vincent Okafor", "3": "Hal Brennan" },
};

const DELTA: WeekDelta = {
  weekPlayed: 8,
  userTeam: "Coastal Carolina",
  gamesPlayed: 2,
  userResult: {
    week: 8,
    home: "Coastal Carolina",
    away: "Tulane",
    homeScore: 31,
    awayScore: 17,
    winner: "Coastal Carolina",
    loser: "Tulane",
    margin: 14,
    rankHome: 22,
    rankAway: 9,
    userInvolved: true,
    simmed: false,
  },
  results: [],
  rankingMoves: [],
};

const truth: GroundTruth = buildGroundTruth({
  snapshot: SNAPSHOT,
  delta: DELTA,
  roster: OURS,
  oppRoster: THEIRS,
  cast: ["Wendell Pace"], // the coach's recurring beat writer
});

const kinds = (payload: unknown, kind = "recap-lead") =>
  validateGeneration(kind, payload, truth).violations.map((v) => v.kind);

const recap = (body: string) => ({ headline: "Chants hold on", byline: "Wendell Pace", body });

// ── Ground truth ────────────────────────────────────────────────────────────────

describe("buildGroundTruth", () => {
  it("resolves the opponent from this week's result", () => {
    expect(truth.opponent).toBe("Tulane");
    expect(truth.userTeam).toBe("Coastal Carolina");
  });

  it("knows both rosters and which side each player is on", () => {
    expect(truth.peopleByName.get("kellen marsh")?.[0].team).toBe("Coastal Carolina");
    expect(truth.peopleByName.get("jamal reed")?.[0].team).toBe("Tulane");
  });

  it("accepts every poll a team legitimately holds", () => {
    const tulane = truth.teams.find((t) => t.name === "Tulane");
    expect(tulane?.ranks).toEqual([9, 9]);
    const coastal = truth.teams.find((t) => t.name === "Coastal Carolina");
    expect(coastal?.ranks).toEqual([22]);
  });

  it("pulls other programs' real head coaches from the save", () => {
    expect(truth.peopleByName.get("vincent okafor")?.[0].team).toBe("Tulane");
  });

  it("stores the week's score in both orders", () => {
    expect(truth.legalScores.has("31-17")).toBe(true);
    expect(truth.legalScores.has("17-31")).toBe(true);
  });
});

// ── Payload walk ────────────────────────────────────────────────────────────────

describe("collectText", () => {
  it("lifts persona fields out of the prose stream and keeps their names", () => {
    const { fields, personas } = collectText(
      { posts: [{ handle: "@chantsguy", displayName: "Big Ron", type: "fan", body: "WE ARE BACK" }] },
      configFor("social")
    );
    expect(personas).toContain("Big Ron");
    expect(fields.map((f) => f.key)).toEqual(["body"]);
  });

  it("paths every prose leaf so a violation points at the exact field", () => {
    const { fields } = collectText({ takes: [{ title: "A", body: "The defense travelled." }] }, configFor("shows"));
    expect(fields.some((f) => f.path === "takes[0].body")).toBe(true);
  });
});

// ── Contradictions the validator must catch ─────────────────────────────────────

describe("catches contradictions", () => {
  it("flags a player who is not on either roster", () => {
    const v = validateGeneration(
      "recap-lead",
      recap("Running back Marcus Tillery carried it 24 times for the Chanticleers."),
      truth
    ).violations;
    expect(v).toHaveLength(1);
    expect(v[0].kind).toBe("unknown-person");
    expect(v[0].claim).toBe("Marcus Tillery");
    expect(v[0].repair).toBe("demote-to-role");
  });

  it("flags a real player put on the wrong sideline", () => {
    const v = validateGeneration(
      "recap-lead",
      recap("Tulane's Kellen Marsh rushed for two scores."),
      truth
    ).violations;
    expect(v.map((x) => x.kind)).toContain("misattributed-person");
    expect(v[0].truth).toBe("Kellen Marsh plays for Coastal Carolina");
  });

  it("flags a score that never happened", () => {
    expect(kinds(recap("Coastal Carolina won 28-24 to stay alive."))).toContain("wrong-score");
  });

  it("flags a record the save does not hold", () => {
    expect(kinds(recap("Coastal Carolina improves to 7-1 with the win."))).toContain("wrong-record");
  });

  it("flags a poll number on an unranked team", () => {
    expect(kinds(recap("The win came a week after #14 Appalachian State went down."))).toContain("phantom-rank");
  });

  it("flags the wrong poll number on a ranked team", () => {
    expect(kinds(recap("#4 Tulane came in expecting a walkover."))).toContain("wrong-rank");
  });

  it("flags an appositive misattribution written without an apostrophe", () => {
    const v = validateGeneration(
      "recap-lead",
      recap("Tulane linebacker Kellen Marsh was everywhere in the second half."),
      truth
    ).violations;
    expect(v.map((x) => x.kind)).toEqual(["misattributed-person"]);
  });

  it("checks social posts, which keep the take but not the roster error", () => {
    const payload = {
      posts: [
        { handle: "@cocky", displayName: "Chant Nation", type: "fan", body: "Tulane's Kellen Marsh rushed all over us and I am sick about it" },
        { handle: "@wavefan", displayName: "Wave Watcher", type: "rival", body: "we got robbed, worst officiating I have ever seen" },
      ],
    };
    const report = validateGeneration("social", payload, truth);
    expect(report.violations.map((v) => v.field)).toEqual(["posts[0].body"]);
  });
});

// ── Regressions from the first run against real saves ───────────────────────────
// Every case below is a false positive the validator produced on real generated copy.
// Fixture tests written from imagination did not catch any of them.

describe("false positives found on real generated copy", () => {
  it("does not read a Title Case headline as a cast of people", () => {
    expect(
      kinds({
        headline: "Stitser's Arm Quiet, Hurley's Legs Louder: K-State Buries Kansas in Season Opener",
        body: "The quarterback was efficient.",
      })
    ).toEqual([]);
  });

  it("does not treat a single letter in a team abbreviation as a position", () => {
    expect(kinds(recap("K-State Never Trails, Never Blinks, Never Lets Tulane Back In"))).toEqual([]);
  });

  it("does not flag a player for being named in the same sentence as the opponent", () => {
    expect(
      kinds(recap("Kellen Marsh ran for 120 yards against Tulane and never came off the field."))
    ).toEqual([]);
  });

  it("does not read 'improves to 2-0' as a wrong score when both teams are named", () => {
    expect(
      kinds(recap("Coastal Carolina beat Tulane and improves to 6-2 on the season."))
    ).toEqual([]);
  });

  it("does not read a scoring run as a claim about the final", () => {
    expect(kinds(recap("A 16-0 run in the third quarter is what won it."))).toEqual([]);
  });

  it("counts one invented player once, however often the piece names him", () => {
    const v = validateGeneration(
      "recap-lead",
      recap(
        "Starting MLB Marcus Talton was everywhere. Talton finished with a sack. " +
          "Marcus Talton had the play of the night when he blitzed off the edge."
      ),
      truth
    ).violations;
    expect(v).toHaveLength(1);
    expect(v[0].claim).toBe("Marcus Talton");
  });

  it("refuses to resolve a nickname two programs share", () => {
    const shared = buildGroundTruth({
      snapshot: {
        ...SNAPSHOT,
        teams: {
          ...SNAPSHOT.teams,
          "4": team({ row: 4, name: "Northwestern", nickname: "Chanticleers", wins: 2, losses: 6 }),
        },
      },
      delta: DELTA,
      roster: OURS,
    });
    // "Chanticleers" now names two programs, so it names neither — and must not produce a
    // confident rank verdict about whichever one happened to be written last.
    expect(shared.teamByAlias.has("chanticleers")).toBe(false);
    expect(
      validateGeneration("recap-lead", recap("The #7 Chanticleers were never threatened."), shared)
        .violations
    ).toEqual([]);
  });
});

// ── Inventions the validator must leave alone ───────────────────────────────────

describe("never punishes invention", () => {
  it("leaves a fictional beat writer's byline alone", () => {
    expect(kinds(recap("Dorian Whitfield threw for three scores."))).toEqual([]);
  });

  it("leaves invented in-game texture alone", () => {
    expect(
      kinds(
        recap(
          "On third-and-eight from the 42, the student section stood on the bleachers and " +
            "Dorian Whitfield checked into a slant. Kellen Marsh finished the drive."
        )
      )
    ).toEqual([]);
  });

  it("leaves invented fans, callers and pundits alone", () => {
    expect(
      kinds(
        recap(
          "A fan named Delores Hatchett called the radio show to say the coordinator should be fired."
        )
      )
    ).toEqual([]);
  });

  it("leaves a wrong OPINION alone — only wrong facts count", () => {
    expect(
      kinds(recap("Coastal Carolina is a fraud and will lose every remaining game on the schedule."))
    ).toEqual([]);
  });

  it("accepts the real score, record and rank", () => {
    expect(
      kinds(
        recap(
          "Coastal Carolina beat #9 Tulane 31-17 on Saturday. The Chanticleers are 6-2 and #22 " +
            "in the media poll."
        )
      )
    ).toEqual([]);
  });

  it("does not read a halftime score as a wrong final", () => {
    expect(kinds(recap("It was 14-10 at half before the Chanticleers pulled away."))).toEqual([]);
  });

  it("does not read a recruit's national rank as a poll number", () => {
    expect(kinds({ body: "The staff is chasing the #3 safety in the country." }, "recruit-dossier")).toEqual([]);
  });

  it("does not flag the recurring cast the user invented", () => {
    expect(kinds(recap("Booster Wendell Pace was in the coach's ear about the play calling."))).toEqual([]);
  });

  it("leaves other programs' real head coaches alone", () => {
    expect(kinds(recap("Tulane head coach Vincent Okafor had no answers after the game."))).toEqual([]);
  });

  it("stays silent on coach-backstory, which is where the cast is created", () => {
    expect(
      kinds({ bio: "Athletic director Priya Raman hired him after Lester Coombs was run off." }, "coach-backstory")
    ).toEqual([]);
  });

  it("stays silent on highlights-extract, whose output BECOMES ground truth", () => {
    expect(kinds({ highlights: [{ text: "Tavaris Nunn housed the kickoff" }] }, "highlights-extract")).toEqual([]);
  });
});

// ── Stat consistency ────────────────────────────────────────────────────────────
// "Mixed stats" is the complaint recap-lead actually earned, and until this check landed
// nothing tested it. The hard part is not catching a wrong number — it is NOT catching the
// invented per-game line, which is exactly what the house style asks the writer for. The
// save has season totals and a final score; it has no box score.

describe("stat consistency", () => {
  const claims = (body: string) =>
    validateGeneration("recap-lead", recap(body), truth).violations;

  // Every "stays silent" case below is only meaningful if the phrase was actually PARSED.
  // A pattern that quietly matches nothing makes all of them pass for the wrong reason —
  // which is how the pre-baseline fixtures managed to catch none of the real bugs.
  it("binds the number to the category the verb states", () => {
    expect(statClaims("Whitfield has thrown for 2,600 yards this season")).toEqual([
      expect.objectContaining({ cat: "passYds", value: 2600 }),
    ]);
    expect(statClaims("Marsh ran for 120 yards on the night")).toEqual([
      expect.objectContaining({ cat: "rushYds", value: 120 }),
    ]);
    expect(statClaims("Pruitt had two sacks in the win")).toEqual([
      expect.objectContaining({ cat: "sacks", value: 2 }),
    ]);
    expect(statClaims("Marsh is nearly 1,400 rushing yards into this season")).toEqual([]);
  });

  it("flags a number that is actually another player's season total", () => {
    const v = claims("Whitfield threw for 1,900 yards, and the offense finally looked whole.");
    expect(v).toHaveLength(1);
    expect(v[0].kind).toBe("mixed-stat");
    expect(v[0].truth).toContain("Cortez Bly");
    expect(v[0].repair).toBe("correct-number");
  });

  it("flags a season-framed line that contradicts the player's season total", () => {
    const v = claims("Marsh has 1,400 rushing yards this season, and the line deserves half of it.");
    expect(v).toHaveLength(1);
    expect(v[0].kind).toBe("wrong-stat");
    expect(v[0].truth).toBe("Kellen Marsh has 984 rushing yards this season");
  });

  it("flags a spelled-out season count", () => {
    expect(claims("On the season Whitfield has thrown for four touchdowns.").map((v) => v.kind))
      .toEqual(["wrong-stat"]);
  });

  it("stays silent on an invented per-game line — the save has no box score", () => {
    expect(claims("Marsh ran for 120 yards on the night and never came off the field.")).toEqual([]);
    expect(claims("Pruitt had two sacks in the win.")).toEqual([]);
  });

  // The single most-reported error in the app, verbatim from a tester: "my running back had
  // 900+ yards in a single game with 100+ carries."
  it("flags a season total written as what a player did in one game", () => {
    const v = claims("Marsh ran for 984 yards on the night, carrying it 214 times.");
    expect(v.map((x) => x.kind)).toEqual(["season-stat-as-game", "season-stat-as-game"]);
    expect(v[0].truth).toContain("SEASON total (8 games)");
    expect(v[0].truth).toContain("average game is 123");
  });

  it("catches it through a rounded retelling too", () => {
    expect(claims("Whitfield threw for 2,600 yards in the win.").map((x) => x.kind)).toEqual([
      "season-stat-as-game",
    ]);
  });

  it("does not fire on a season-framed statement of the same number", () => {
    expect(claims("Marsh has 984 rushing yards this season.")).toEqual([]);
  });

  it("does not fire before a season total and a game line can differ", () => {
    // Week one: his season total IS his game line, and flagging that would be nonsense.
    const wk1 = buildGroundTruth({
      snapshot: SNAPSHOT,
      delta: DELTA,
      roster: [P("Kellen Marsh", "HB", 84, { ...stats("offense", { rushYds: 118 }), gamesPlayed: 1 })],
    });
    expect(
      validateGeneration("recap-lead", recap("Marsh ran for 118 yards on the night."), wk1).violations
    ).toEqual([]);
  });

  it("stays silent when the writer rounds", () => {
    expect(claims("Whitfield has thrown for 2,600 yards this season.")).toEqual([]);
  });

  it("stays silent on a hedged number", () => {
    expect(claims("Marsh is nearly 1,400 rushing yards into this season.")).toEqual([]);
  });

  it("stays silent on a PRIOR season — the archive makes those legitimate now", () => {
    expect(claims("Marsh ran for 1,450 yards last season before the injury.")).toEqual([]);
    expect(claims("Whitfield threw for 900 yards as a freshman.")).toEqual([]);
  });

  it("stays silent when two players share the sentence and the line can't be assigned", () => {
    expect(claims("Whitfield and Vandiver combined for 96 receiving yards this season.")).toEqual([]);
  });

  it("stays silent when the save carries no line for that category", () => {
    // Pruitt is a defender; the save has no passing line for him to contradict.
    expect(claims("Pruitt has 300 passing yards this season.")).toEqual([]);
  });

  it("reports the stat check as skipped rather than clean when no stat lines exist", () => {
    const blind = buildGroundTruth({ snapshot: SNAPSHOT, delta: DELTA, roster: [P("Dorian Whitfield", "QB")] });
    const report = validateGeneration("recap-lead", recap("Whitfield has 4,000 passing yards this season."), blind);
    expect(report.violations).toHaveLength(0);
    expect(report.skipped).toContain("stats (no season stat lines in the save)");
  });
});

// ── Honest reporting ────────────────────────────────────────────────────────────

describe("report", () => {
  it("says when a check could not run instead of reporting a clean piece", () => {
    const blind = buildGroundTruth({ snapshot: SNAPSHOT, delta: null });
    const report = validateGeneration("recap-lead", recap("Somebody Nobody rushed for 100 yards."), blind);
    expect(report.violations).toHaveLength(0);
    expect(report.skipped).toEqual([
      "names (no roster in the save)",
      "scores (no result this week)",
      "stats (no season stat lines in the save)",
    ]);
  });

  it("counts units so social's 15 posts normalize against a single recap", () => {
    const report = validateGeneration(
      "social",
      { posts: [{ body: "one" }, { body: "two" }, { body: "three" }] },
      truth
    );
    expect(report.units).toBe(3);
  });
});

// ── False positives found in a real session ─────────────────────────────────────
// A live baseline read 1.13 violations/piece. Six of seventeen were the checker, not the
// model: "San Jos" (a program cut at its accent) four times, and award phrases twice. A
// checker that inflates its own number is worse than no number.

describe("checker false positives from the field", () => {
  it("does not cut a program at its accent and report the fragment as a person", () => {
    const withAccent = buildGroundTruth({
      snapshot: {
        ...SNAPSHOT,
        teams: { ...SNAPSHOT.teams, "4": team({ row: 4, name: "San José State", nickname: "Spartans" }) },
      },
      delta: DELTA,
      roster: OURS,
      oppRoster: THEIRS,
    });
    const v = validateGeneration(
      "recap-lead",
      recap("San José State linebacker Jamal Reed chased him down."),
      withAccent
    ).violations;
    expect(v.map((x) => x.claim)).not.toContain("San Jos");
    expect(v.filter((x) => x.kind === "unknown-person")).toHaveLength(0);
  });

  it("does not read an award as a person", () => {
    for (const line of [
      "The linebacker was a First Team All-American selection.",
      "He is a Team All-American at his position.",
    ]) {
      expect(kinds(recap(line))).not.toContain("unknown-person");
    }
  });
});
