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
