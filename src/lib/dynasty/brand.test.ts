// The athlete's brand.
//
// The number is the product here, so the tests are about the number being defensible: it must
// move for reasons that actually happened, it must decay when nothing does, the first start
// must be the spike, and a week must never be able to pay itself twice.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mem = new Map<string, unknown>();
vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: class {
    async get<T>(k: string): Promise<T | null> { return (mem.get(k) as T) ?? null; }
    async set(k: string, v: unknown) { mem.set(k, v); }
    async save() {}
  },
}));

import {
  applyPost,
  applyWeek,
  brandBlock,
  brandTier,
  fmtFollowers,
  followerDelta,
  loadBrand,
  postDelta,
  saveBrand,
  STARTING_FOLLOWERS,
  type BrandState,
} from "./brand";
import type { PlayingTime, WeekLine } from "./rtg";

const time = (state: PlayingTime["state"]): PlayingTime => ({
  state, gamesPlayed: 3, gamesStarted: 1, gamesSinceBaseline: 1, hasBaseline: true,
});
const line = (over: Partial<WeekLine> = {}): WeekLine => ({
  passYds: 0, passTDs: 0, passInts: 0, passComp: 0, passAtt: 0,
  rushYds: 0, rushAtt: 0, rushTDs: 0, recYds: 0, recCatches: 0, recTDs: 0,
  tackles: 0, sacks: 0, ints: 0, ...over,
});

beforeEach(() => mem.clear());

describe("followerDelta", () => {
  it("bleeds followers on a week he didn't play", () => {
    const r = followerDelta({ followers: 10_000, time: time("did-not-play"), line: null });
    expect(r.delta).toBeLessThan(0);
    expect(r.reason).toContain("didn't play");
  });

  it("makes the first start the spike of his career so far", () => {
    const start = followerDelta({ followers: 2_000, time: time("first-start"), line: line({ passYds: 240, passTDs: 2 }) });
    const routine = followerDelta({ followers: 2_000, time: time("starter"), line: line({ passYds: 240, passTDs: 2 }) });
    expect(start.delta).toBeGreaterThan(routine.delta * 3);
    expect(start.reason).toContain("first career start");
  });

  it("scales with the size of the account, not just the performance", () => {
    const small = followerDelta({ followers: 500, time: time("starter"), line: line({ passTDs: 3 }) });
    const big = followerDelta({ followers: 200_000, time: time("starter"), line: line({ passTDs: 3 }) });
    expect(big.delta).toBeGreaterThan(small.delta * 5);
  });

  it("pays for touchdowns and charges for turnovers", () => {
    const clean = followerDelta({ followers: 5_000, time: time("starter"), line: line({ passTDs: 3 }) });
    const messy = followerDelta({ followers: 5_000, time: time("starter"), line: line({ passTDs: 3, passInts: 2 }) });
    expect(messy.delta).toBeLessThan(clean.delta);
    expect(messy.reason).toContain("interception");
  });

  it("lets the team's result amplify or dampen the same game", () => {
    const won = followerDelta({ followers: 5_000, time: time("starter"), line: line({ passTDs: 1 }), teamWon: true });
    const lost = followerDelta({ followers: 5_000, time: time("starter"), line: line({ passTDs: 1 }), teamWon: false });
    expect(won.delta).toBeGreaterThan(lost.delta);
  });

  it("holds the count when it cannot read the week", () => {
    for (const s of ["unknown", "multi-week-gap"] as const) {
      const r = followerDelta({ followers: 5_000, time: time(s), line: null });
      expect(r.delta).toBe(0);
      expect(r.followers).toBe(5_000);
    }
  });

  it("never drives the count below zero", () => {
    expect(followerDelta({ followers: 3, time: time("did-not-play"), line: null }).followers).toBeGreaterThanOrEqual(0);
  });
});

describe("postDelta", () => {
  it("rewards reach and punishes a post that lands badly", () => {
    const viral = postDelta({ followers: 10_000, reach: "viral", backlash: false });
    const bad = postDelta({ followers: 10_000, reach: "viral", backlash: true });
    expect(viral.delta).toBeGreaterThan(0);
    expect(bad.delta).toBeLessThan(0);
    expect(bad.reason).toContain("did not land well");
  });

  it("makes an ignored post nearly free", () => {
    const r = postDelta({ followers: 10_000, reach: "ignored", backlash: false });
    expect(Math.abs(r.delta)).toBeLessThan(100);
  });
});

describe("tiers and formatting", () => {
  it("names the reach", () => {
    expect(brandTier(300)).toBe("unknown");
    expect(brandTier(3_000)).toBe("local");
    expect(brandTier(20_000)).toBe("known");
    expect(brandTier(90_000)).toBe("star");
    expect(brandTier(900_000)).toBe("national");
  });

  it("formats the way a profile does", () => {
    expect(fmtFollowers(380)).toBe("380");
    expect(fmtFollowers(4_200)).toBe("4.2K");
    expect(fmtFollowers(48_000)).toBe("48K");
    expect(fmtFollowers(2_400_000)).toBe("2.4M");
  });
});

describe("brandBlock", () => {
  const state: BrandState = {
    followers: 4_200,
    posts: [{ text: "we good", year: 2029, week: 5, followersBefore: 4000, delta: 200, at: 0 }],
    history: [],
  };

  it("locks the count and forbids inventing another", () => {
    const b = brandBlock({ state, week: { delta: 1200, followers: 4200, reason: "His first career start." } });
    expect(b).toContain("4.2K");
    expect(b).toContain("+1,200 followers");
    expect(b).toContain("NEVER state a follower count other than the one above");
  });

  it("hands his own words back as his own words", () => {
    expect(brandBlock({ state })).toContain('"we good"');
    expect(brandBlock({ state })).toContain("react to them as his actual words");
  });
});

describe("the store", () => {
  it("starts a new athlete with a believable following, not zero", async () => {
    expect((await loadBrand("d1")).followers).toBe(STARTING_FOLLOWERS);
  });

  it("round-trips", async () => {
    await saveBrand("d1", { followers: 9_000, posts: [], history: [] });
    expect((await loadBrand("d1")).followers).toBe(9_000);
  });

  it("refuses to pay the same week twice", () => {
    // The provider remounts on every tab switch; a compounding week would be silent and wrong.
    const base: BrandState = { followers: 1_000, posts: [], history: [] };
    const once = applyWeek(base, 2029, 5, { delta: 500, followers: 1_500, reason: "x" });
    const twice = applyWeek(once, 2029, 5, { delta: 500, followers: 2_000, reason: "x" });
    expect(twice.followers).toBe(1_500);
    expect(twice.history).toHaveLength(1);
  });

  it("records a post against the count it was made at", () => {
    const s = applyPost({ followers: 1_000, posts: [], history: [] }, {
      text: "locked in", year: 2029, week: 6, followersBefore: 1_000, delta: -50, at: 0,
    });
    expect(s.followers).toBe(950);
    expect(s.posts).toHaveLength(1);
  });
});

// ── What the writer is handed ───────────────────────────────────────────────────

describe("the posting prompt", () => {
  const gen = () => import("./gen");
  const ctx = () =>
    ({
      school: "Oregon State",
      snapshot: { player: { name: "Skiyzer San-Locus", classYear: "Freshman", position: "QB" }, schoolInterest: [] },
    }) as never;

  it("makes 'ignored' the default and viral genuinely rare", async () => {
    const { buildSpec } = await gen();
    const p = buildSpec("rtg-post", ctx(), { text: "locked in", brand: { followers: 380, posts: [], history: [] } }).prompt;
    expect(p).toContain('"ignored" is the DEFAULT');
    expect(p).toContain("Do not hand it out for a normal post");
    expect(p).toContain("Almost nobody follows him");
  });

  it("caps reach by who he actually is", async () => {
    const { buildSpec } = await gen();
    const p = buildSpec("rtg-post", ctx(), { text: "hi", brand: { followers: 380, posts: [], history: [] } }).prompt;
    expect(p).toContain("Reach is capped by who he actually is");
  });

  it("refuses to let a post change his playing time", async () => {
    const { buildSpec } = await gen();
    const p = buildSpec("rtg-post", ctx(), { text: "hi", brand: { followers: 380, posts: [], history: [] } }).prompt;
    expect(p).toContain("never claim the post".replace("never", "Never"));
  });

  it("scales the whole social feed to his real reach", async () => {
    const { buildSpec } = await gen();
    const brand = { followers: 4200, posts: [], history: [] };
    const p = buildSpec("rtg-social", {
      school: "Oregon State", week: 6, phase: { label: "REGULAR SEASON" },
      snapshot: { player: { name: "Skiyzer San-Locus", classYear: "Freshman", position: "QB", stats: null }, schoolInterest: [] },
      backstory: null, history: null, world: null, outlook: null, userContext: "",
    } as never, { brand }).prompt;
    expect(p).toContain("SCALE EVERY LIKE AND REPOST TO HIS ACTUAL REACH");
    expect(p).toContain("4.2K");
  });
});
