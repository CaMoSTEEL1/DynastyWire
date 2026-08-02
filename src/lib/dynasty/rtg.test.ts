// The Road to Glory core.
//
// The two things worth breaking here are the two that carry the mode: that a week with no
// appearance is stated as a hard fact rather than left blank, and that a per-game line is only
// produced when it is genuinely attributable to one game. The second is the RTG version of the
// bug that shipped "900+ yards in a single game" on the dynasty side.

import { describe, expect, it } from "vitest";
import type { RosterStats, RtgPlayer, SchoolInterest } from "./client";
import {
  playingTime,
  recruitmentBoard,
  rtgBrief,
  rtgFacts,
  weekLine,
  weekLineText,
} from "./rtg";

const stats = (over: Partial<NonNullable<RosterStats["offense"]>> & { gamesPlayed: number; gamesStarted: number }): RosterStats => {
  const block = { ...over };
  // The parser writes the active side BOTH nested and flattened onto the wrapper.
  return {
    side: "offense",
    offense: block,
    defense: null,
    kicking: null,
    ...block,
  } as RosterStats;
};

const P = (over: Partial<RtgPlayer> = {}): RtgPlayer => ({
  name: "Skiyzer San-Locus",
  teamIndex: 73,
  position: "QB",
  classYear: "Freshman",
  prospectStars: "TWO_STAR",
  redshirt: "Eligible",
  homeState: "Georgia",
  overall: 71,
  confidence: 60,
  legacyScore: 110,
  experiencePoints: 8681,
  performLevel: 100,
  awardCount: 0,
  hotCold: "Neutral",
  injuryStatus: "Uninjured",
  draftRound: null,
  draftPick: null,
  transferChance: -1,
  nilValue: 0,
  nilComp: 0,
  idealPitch: "Prestigious",
  dealbreaker: "Invalid",
  stats: null,
  ...over,
});

describe("playingTime", () => {
  it("says it does not know without a baseline", () => {
    const t = playingTime(P({ stats: stats({ gamesPlayed: 3, gamesStarted: 1 }) }), null);
    expect(t.state).toBe("unknown");
    expect(t.hasBaseline).toBe(false);
  });

  it("detects a week with no appearance", () => {
    const s = stats({ gamesPlayed: 3, gamesStarted: 0 });
    expect(playingTime(P({ stats: s }), P({ stats: s })).state).toBe("did-not-play");
  });

  it("separates coming off the bench from starting", () => {
    const before = P({ stats: stats({ gamesPlayed: 2, gamesStarted: 0 }) });
    const played = P({ stats: stats({ gamesPlayed: 3, gamesStarted: 0 }) });
    expect(playingTime(played, before).state).toBe("played-off-bench");
  });

  it("calls the first start what it is, once", () => {
    const before = P({ stats: stats({ gamesPlayed: 2, gamesStarted: 0 }) });
    const first = P({ stats: stats({ gamesPlayed: 3, gamesStarted: 1 }) });
    expect(playingTime(first, before).state).toBe("first-start");

    const later = P({ stats: stats({ gamesPlayed: 4, gamesStarted: 2 }) });
    expect(playingTime(later, first).state).toBe("starter");
  });

  it("refuses to attribute a week when more than one game has passed", () => {
    const before = P({ stats: stats({ gamesPlayed: 1, gamesStarted: 0 }) });
    const after = P({ stats: stats({ gamesPlayed: 4, gamesStarted: 2 }) });
    expect(playingTime(after, before).state).toBe("multi-week-gap");
  });
});

describe("weekLine", () => {
  // The thing dynasty could never do: one player, two snapshots, a real game line.
  it("computes what he actually did in THIS game", () => {
    const before = P({ stats: stats({ gamesPlayed: 1, gamesStarted: 1, passYds: 187, passTDs: 3, passAtt: 30, passComp: 20, rushYds: 255, rushAtt: 16, rushTDs: 2 }) });
    const after = P({ stats: stats({ gamesPlayed: 2, gamesStarted: 2, passYds: 400, passTDs: 5, passAtt: 55, passComp: 38, rushYds: 300, rushAtt: 24, rushTDs: 2 }) });
    const t = playingTime(after, before);
    const line = weekLine(after, before, t)!;
    expect(line.passYds).toBe(213);
    expect(line.passTDs).toBe(2);
    expect(line.rushYds).toBe(45);
    expect(weekLineText(line)).toBe("18/25, 213 yds, 2 TD; 8 car, 45 yds, 0 TD");
  });

  it("returns nothing when he did not play", () => {
    const s = stats({ gamesPlayed: 2, gamesStarted: 1, passYds: 400 });
    const t = playingTime(P({ stats: s }), P({ stats: s }));
    expect(weekLine(P({ stats: s }), P({ stats: s }), t)).toBeNull();
  });

  it("refuses to present a multi-game total as one performance", () => {
    // The RTG version of "900+ yards in a single game".
    const before = P({ stats: stats({ gamesPlayed: 1, gamesStarted: 1, passYds: 187 }) });
    const after = P({ stats: stats({ gamesPlayed: 4, gamesStarted: 4, passYds: 1200 }) });
    const t = playingTime(after, before);
    expect(t.state).toBe("multi-week-gap");
    expect(weekLine(after, before, t)).toBeNull();
  });

  it("returns nothing without a baseline rather than treating the season as a game", () => {
    const after = P({ stats: stats({ gamesPlayed: 3, gamesStarted: 3, passYds: 900 }) });
    expect(weekLine(after, null, playingTime(after, null))).toBeNull();
  });
});

describe("recruitmentBoard", () => {
  const S = (over: Partial<SchoolInterest>): SchoolInterest => ({
    teamRow: 1, school: "Ohio State", offerStatus: "None", score: 100, tier: "Bronze",
    coachTrust: 0, teamNeed: 0, brandBonus: 0, decommitted: false, ...over,
  });

  it("splits real offers from mere interest", () => {
    const b = recruitmentBoard([
      S({ school: "Ohio State", offerStatus: "Offered" }),
      S({ school: "Georgia", offerStatus: "None" }),
      S({ school: "Alabama", offerStatus: "Invalid" }),
    ]);
    expect(b.offers.map((o) => o.school)).toEqual(["Ohio State"]);
    expect(b.interested.map((o) => o.school)).toEqual(["Georgia", "Alabama"]);
  });

  it("remembers a decommitment", () => {
    expect(recruitmentBoard([S({ school: "Miami", decommitted: true })]).decommittedFrom).toHaveLength(1);
  });

  it("survives a dynasty save with no interest data at all", () => {
    expect(recruitmentBoard(undefined).total).toBe(0);
  });
});

describe("rtgFacts", () => {
  const before = P({ stats: stats({ gamesPlayed: 2, gamesStarted: 0, passYds: 100 }) });

  it("states a week with no appearance as a hard fact, not a gap", () => {
    const same = P({ stats: stats({ gamesPlayed: 2, gamesStarted: 0, passYds: 100 }) });
    const f = rtgFacts({ player: same, baseline: before, school: "Oregon State" });
    const brief = rtgBrief(f);
    expect(brief).toContain("did NOT play");
    expect(brief).toContain("recorded NOTHING this week");
    expect(brief).toContain("Do not give him a stat");
  });

  it("hands over the real game line when there is one", () => {
    const after = P({ stats: stats({ gamesPlayed: 3, gamesStarted: 1, passYds: 320 }) });
    const brief = rtgBrief(rtgFacts({ player: after, baseline: before, school: "Oregon State" }));
    expect(brief).toContain("FIRST career start");
    expect(brief).toContain("HIS LINE IN THIS GAME");
    expect(brief).toContain("220 yds");
  });

  it("keeps what he WAS rated separate from what he is", () => {
    const brief = rtgBrief(rtgFacts({ player: before, baseline: before, school: "Oregon State" }));
    expect(brief).toContain("two star");
    expect(brief).toContain("not what he is now");
  });

  it("admits when it cannot attribute a week", () => {
    const after = P({ stats: stats({ gamesPlayed: 6, gamesStarted: 3 }) });
    const brief = rtgBrief(rtgFacts({ player: after, baseline: before, school: "Oregon State" }));
    expect(brief).toContain("cannot be attributed to a single week");
  });

  it("admits when it has no baseline at all", () => {
    const brief = rtgBrief(rtgFacts({ player: before, baseline: null, school: "Oregon State" }));
    expect(brief).toContain("never claim he did or did not play");
  });
});

// ── What the writer is actually handed ──────────────────────────────────────────
// The RTG port makes the same claim every other port makes: it is about the PROMPT. The
// load-bearing case is the week he didn't play, so that is the one asserted hardest.

describe("The Week prompt", () => {
  const gen = () => import("./gen");

  it("frames a no-appearance week as its own story and forbids inventing snaps", async () => {
    const { buildSpec } = await gen();
    const s = stats({ gamesPlayed: 2, gamesStarted: 0, passYds: 100, passAtt: 14, passComp: 9 });
    const ctx = {
      school: "Oregon State",
      week: 6,
      phase: { label: "REGULAR SEASON" },
      snapshot: { player: P({ stats: s }), schoolInterest: [] },
      backstory: null,
      history: null,
      outlook: null,
    } as never;
    const p = buildSpec("rtg-week", ctx, { baselinePlayer: P({ stats: s }) }).prompt;
    expect(p).toContain("HE DID NOT PLAY THIS WEEK");
    expect(p).toContain("Do NOT invent a snap");
    expect(p).toContain("recorded NOTHING this week");
    expect(p).toContain("NOT THE CENTRE OF THIS PROGRAM YET");
    // and it must not have quietly handed over a season total as the week's line
    expect(p).not.toContain("HIS LINE IN THIS GAME");
  });

  it("hands over the real game line on a week he played", async () => {
    const { buildSpec } = await gen();
    const before = P({ stats: stats({ gamesPlayed: 1, gamesStarted: 0, passYds: 100, passAtt: 14, passComp: 9 }) });
    const after = P({ stats: stats({ gamesPlayed: 2, gamesStarted: 1, passYds: 340, passAtt: 44, passComp: 30 }) });
    const ctx = {
      school: "Oregon State",
      week: 7,
      phase: { label: "REGULAR SEASON" },
      snapshot: { player: after, schoolInterest: [] },
      backstory: null,
      history: null,
      outlook: null,
    } as never;
    const p = buildSpec("rtg-week", ctx, { baselinePlayer: before }).prompt;
    expect(p).toContain("FIRST CAREER START");
    expect(p).toContain("HIS LINE IN THIS GAME");
    expect(p).toContain("240 yds");
  });
});

describe("The RTG social feed", () => {
  const gen = () => import("./gen");
  const ctxFor = (player: RtgPlayer, over: Record<string, unknown> = {}) =>
    ({
      school: "Oregon State",
      week: 6,
      phase: { label: "REGULAR SEASON" },
      snapshot: { player, schoolInterest: [], week: 6 },
      backstory: null,
      history: null,
      world: null,
      outlook: null,
      userContext: "",
      ...over,
    }) as never;

  it("keeps the internet off a freshman who did not play", async () => {
    const { buildSpec } = await gen();
    const s = stats({ gamesPlayed: 2, gamesStarted: 0, passYds: 100, passAtt: 14, passComp: 9 });
    const p = buildSpec("rtg-social", ctxFor(P({ stats: s })), { baselinePlayer: P({ stats: s }) }).prompt;
    expect(p).toContain("ATTENTION LEVEL: ALMOST NONE");
    expect(p).toContain("NOBODY national is discussing him");
    expect(p).toContain("MOST OF THIS FEED IS NOT ABOUT HIM");
    // engagement has to match reality, or the feed reads as fake
    expect(p).toContain("3-80 likes");
  });

  it("turns the volume up only when he earns it", async () => {
    const { buildSpec } = await gen();
    const before = P({ stats: stats({ gamesPlayed: 1, gamesStarted: 0, passYds: 100, passAtt: 14, passComp: 9 }) });
    const after = P({ stats: stats({ gamesPlayed: 2, gamesStarted: 1, passYds: 340, passAtt: 44, passComp: 30 }) });
    const p = buildSpec("rtg-social", ctxFor(after), { baselinePlayer: before }).prompt;
    expect(p).toContain("THIS IS THE SPIKE");
  });

  it("hands the recruiting accounts his real high-school ranking", async () => {
    const { buildSpec } = await gen();
    const s = stats({ gamesPlayed: 1, gamesStarted: 0 });
    const p = buildSpec("rtg-social", ctxFor(P({ stats: s })), { baselinePlayer: P({ stats: s }) }).prompt;
    expect(p).toContain("two star");
    expect(p).toContain("what he WAS rated, not what he is");
  });

  it("is a player's feed, not a program's", async () => {
    const { buildSpec } = await gen();
    const s = stats({ gamesPlayed: 1, gamesStarted: 0 });
    const p = buildSpec("rtg-social", ctxFor(P({ stats: s })), { baselinePlayer: P({ stats: s }) }).prompt;
    expect(p).toContain("hometown and high school");
    expect(p).toContain("Depth-chart obsessives");
  });
});

describe("the position room", () => {
  const R = (name: string, position: string, over: Record<string, number> = {}) => ({
    name, position, year: "JR", overall: 80, jersey: null,
    stats: stats({ gamesPlayed: 4, gamesStarted: 0, ...over }),
  });

  it("orders by who the staff actually plays, then by production", async () => {
    const { positionRoom } = await import("./rtg");
    const room = positionRoom(
      [
        R("Backup Guy", "QB", { passYds: 900 }),
        R("The Starter", "QB", { gamesStarted: 4, passYds: 500 }),
        R("Skiyzer San-Locus", "QB", { passYds: 120 }),
        R("A Receiver", "WR", { recYds: 800 }),
      ] as never,
      P({ position: "QB" })
    );
    expect(room.map((r) => r.name)).toEqual(["The Starter", "Backup Guy", "Skiyzer San-Locus"]);
    expect(room.find((r) => r.isUser)?.name).toBe("Skiyzer San-Locus");
  });

  it("tells the writer where he sits and never shows a rating", async () => {
    const { positionRoom, roomBlock, depthOf } = await import("./rtg");
    const room = positionRoom(
      [R("The Starter", "QB", { gamesStarted: 4, passYds: 500 }), R("Skiyzer San-Locus", "QB", { passYds: 120 })] as never,
      P({ position: "QB" })
    );
    expect(depthOf(room)).toBe(2);
    const b = roomBlock(room, "QB")!;
    expect(b).toContain("← HIM");
    expect(b).toContain("He is 2 of 2 in the room");
    expect(b).not.toMatch(/\b\d{2}\s*OVR\b/);
    expect(b).not.toMatch(/\boverall\b/i);
  });

  it("says nothing rather than guessing when he isn't in the room", async () => {
    const { positionRoom, roomBlock } = await import("./rtg");
    const room = positionRoom([R("Someone Else", "QB")] as never, P({ position: "QB" }));
    expect(roomBlock(room, "QB")).toContain("do not claim a depth position");
  });
});

describe("his podium", () => {
  it("asks about not playing, and lets him be nineteen about it", async () => {
    const { buildSpec } = await import("./gen");
    const s = stats({ gamesPlayed: 2, gamesStarted: 0 });
    const ctx = {
      school: "Oregon State", week: 6, phase: { label: "REGULAR SEASON" },
      snapshot: { player: P({ stats: s }), schoolInterest: [] },
      roster: [], backstory: null, history: null, world: null, outlook: null, userContext: "",
    } as never;
    const p = buildSpec("rtg-podium", ctx, { baselinePlayer: P({ stats: s }) }).prompt;
    expect(p).toContain("HE DID NOT PLAY");
    expect(p).toContain("should not have a good answer to all of them");
    expect(p).toContain("must sound NINETEEN");
    expect(p).toContain("failure mode of this surface");
    expect(p).toContain("THESE DO NOT MOVE TOGETHER");
  });
});

describe("who he is", () => {
  it("opens the form mostly answered instead of as a blank wall", async () => {
    const { seedFromSave } = await import("./rtg-character");
    const seeded = seedFromSave(
      P({ prospectStars: "FOUR_STAR", homeState: "Georgia" }),
      [{ teamRow: 1, school: "Alabama", offerStatus: "Offered", score: 1, tier: null, coachTrust: null, teamNeed: null, brandBonus: null, decommitted: false }],
      "Oregon State"
    );
    expect(seeded.arc).toBe("blue-chip");
    expect(seeded.hometown).toBe("Georgia");
    expect(seeded.bio).toContain("four star");
    expect(seeded.bio).toContain("Alabama");
  });

  it("reads an unranked kid as overlooked", async () => {
    const { seedFromSave } = await import("./rtg-character");
    expect(seedFromSave(P({ prospectStars: "TWO_STAR" }), [], "Oregon State").arc).toBe("underrated");
  });

  it("needs a person, not every field, before the mode unlocks", async () => {
    const { isComplete, EMPTY_CHARACTER } = await import("./rtg-character");
    expect(isComplete(EMPTY_CHARACTER)).toBe(false);
    expect(isComplete(null)).toBe(false);
    expect(
      isComplete({ ...EMPTY_CHARACTER, hometown: "Valdosta", bio: "b", positionCoach: "Coach Reyes", home: "his mother" })
    ).toBe(true);
  });

  it("hands the cast over as recurring, not decoration", async () => {
    const { characterBlock, EMPTY_CHARACTER } = await import("./rtg-character");
    const b = characterBlock(
      { ...EMPTY_CHARACTER, arc: "underrated", hometown: "Valdosta", bio: "Walked on.", positionCoach: "Coach Reyes", home: "his mother Renee", reporter: "Dana Whitt" }
    )!;
    expect(b).toContain("Coach Reyes — his position coach");
    expect(b).toContain("his mother Renee — home");
    expect(b).toContain("These people RECUR");
    expect(b).toContain("never invent replacements");
  });

  it("says nothing at all until there is a person", async () => {
    const { characterBlock, EMPTY_CHARACTER } = await import("./rtg-character");
    expect(characterBlock(EMPTY_CHARACTER)).toBeNull();
  });

  it("reaches every RTG prompt", async () => {
    const { buildSpec } = await import("./gen");
    const character = {
      arc: "underrated" as const, hometown: "Valdosta", bio: "Walked on.",
      positionCoach: "Coach Reyes", aheadOfHim: "", teammate: "", reporter: "", home: "his mother", goal: "Play.",
    };
    const s = stats({ gamesPlayed: 2, gamesStarted: 0 });
    const ctx = {
      school: "Oregon State", week: 6, phase: { label: "REGULAR SEASON" },
      snapshot: { player: P({ stats: s }), schoolInterest: [] },
      roster: [], backstory: null, history: null, world: null, outlook: null, userContext: "",
    } as never;
    for (const kind of ["rtg-week", "rtg-social", "rtg-podium"]) {
      const p = buildSpec(kind, ctx, { baselinePlayer: P({ stats: s }), character, text: "hi", brand: { followers: 380, posts: [], history: [] } }).prompt;
      expect(p, kind).toContain("Coach Reyes");
    }
  });
});

// ── Regressions from THE GATE (real generations, real save) ─────────────────────
// All three test pieces invented the football around him — "Oregon State up big enough",
// "a 1-0 record that nobody in Corvallis will forget", "the game was 14-10, their way".
// Nothing in the brief locked the team's game, so the writer supplied one.

describe("the gate's findings", () => {
  const before = P({ stats: stats({ gamesPlayed: 2, gamesStarted: 0 }) });

  it("forbids inventing the team's score, lead or record", () => {
    const brief = rtgBrief(rtgFacts({ player: before, baseline: before, school: "Oregon State" }));
    expect(brief).toContain("THE TEAM'S SCORE, RESULT, LEAD AND RECORD");
    expect(brief).toContain("Do NOT write that the team");
    expect(brief).toContain("the game around him is");
  });

  it("states the real result when there is one", () => {
    const brief = rtgBrief(
      rtgFacts({ player: before, baseline: before, school: "Oregon State", teamResult: "Oregon State 31, Cal 17 — won. Record: 3-1." })
    );
    expect(brief).toContain("Oregon State 31, Cal 17");
  });

  it("makes the byline the named beat writer, never a generic title", async () => {
    const { buildSpec } = await import("./gen");
    const s = stats({ gamesPlayed: 2, gamesStarted: 0 });
    const ctx = {
      school: "Oregon State", week: 6, phase: { label: "REGULAR SEASON" },
      snapshot: { player: P({ stats: s }), schoolInterest: [], userTeam: { name: "Oregon State", wins: 3, losses: 1 } },
      delta: null, roster: [], backstory: null, history: null, world: null, outlook: null, userContext: "",
    } as never;
    const character = { reporter: "Dana Whitt", hometown: "V", bio: "b", positionCoach: "Coach Reyes", home: "mum", arc: "underrated" as const, aheadOfHim: "", teammate: "", goal: "" };
    const p = buildSpec("rtg-week", ctx, { baselinePlayer: P({ stats: s }), character }).prompt;
    expect(p).toContain("You ARE Dana Whitt");
    expect(p).toContain("never a generic title");
    // and with no game this week, the brief must say so rather than leave it open
    expect(p).toContain("NO game result is available for this week");
  });
});
