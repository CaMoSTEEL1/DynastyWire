// Fixture tests for the deterministic core's fact-checker.
//
// The validator is pure logic over known inputs, so every case here is a hand-written piece
// of generated text plus the exact violations it should produce. Two halves, and the second
// matters more than the first: catching a fabricated running back is easy, and a checker
// that also flags the fictional beat writer, the invented 3rd-and-8, or the fan with a
// strong opinion is WORSE than no checker at all — it would drive repairs that strip the
// voice out of the product.

import { describe, expect, it } from "vitest";
import type { DynastySnapshot, RosterPlayer, TeamInfo, WeekDelta } from "./client";
import {
  buildGroundTruth,
  collectText,
  configFor,
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

const P = (name: string, position: string, overall = 80): RosterPlayer => ({
  name,
  position,
  year: "JR",
  overall,
  jersey: null,
});

const OURS: RosterPlayer[] = [
  P("Dorian Whitfield", "QB", 87),
  P("Kellen Marsh", "HB", 84),
  P("Trey Vandiver", "WR", 82),
  P("Isaiah Pruitt", "LB", 85),
];

const THEIRS: RosterPlayer[] = [P("Jamal Reed", "LB", 88), P("Cortez Bly", "QB", 86)];

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

// ── Honest reporting ────────────────────────────────────────────────────────────

describe("report", () => {
  it("says when a check could not run instead of reporting a clean piece", () => {
    const blind = buildGroundTruth({ snapshot: SNAPSHOT, delta: null });
    const report = validateGeneration("recap-lead", recap("Somebody Nobody rushed for 100 yards."), blind);
    expect(report.violations).toHaveLength(0);
    expect(report.skipped).toEqual([
      "names (no roster in the save)",
      "scores (no result this week)",
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
