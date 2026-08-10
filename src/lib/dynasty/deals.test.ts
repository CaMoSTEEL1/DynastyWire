// A deal is a contract, not a gift.
//
// The economy's whole weight rests on the bar being real: a brand that pays the same whatever
// happens is a slot machine, and one that renegotiates over a single game is worse. So most of
// what is pinned here is the BANDS — what is comfortably above the bar, what is comfortably
// below it, and the wide middle where a deal simply runs as agreed.

import { describe, expect, it } from "vitest";
import {
  expectationFor,
  judge,
  maxConcurrentDeals,
  midRunBump,
  nextStanding,
  programFactor,
  scaleStipend,
  standingMultiplier,
  type ActiveDeal,
  type BrandHistory,
} from "./deals";

const deal = (over: Partial<ActiveDeal> = {}): ActiveDeal => ({
  brand: "Volt Energy",
  pointsPerWeek: 5,
  weeks: 5,
  startYear: 2030,
  startWeek: 1,
  paidKeys: [],
  signedAt: 0,
  reputation: "clean",
  recordAtSigning: { wins: 0, losses: 0 },
  ...over,
});

describe("what a brand asks for", () => {
  it("asks for more the more it pays", () => {
    expect(expectationFor("clean").winRate).toBeLessThan(expectationFor("edgy").winRate);
    expect(expectationFor("edgy").winRate).toBeLessThan(expectationFor("controversial").winRate);
  });

  it("judges a run by rate, so a short deal and a long one ask the same standard", () => {
    const e = expectationFor("edgy"); // 0.6
    expect(judge(e, { wins: 4, losses: 1 })).toBe("exceeded");
    expect(judge(e, { wins: 8, losses: 2 })).toBe("exceeded");
  });

  it("has a band on both sides, so one game does not renegotiate a contract", () => {
    const e = expectationFor("edgy"); // 0.6, band ±0.15
    expect(judge(e, { wins: 3, losses: 2 })).toBe("met"); // 0.60 — exactly the bar
    expect(judge(e, { wins: 7, losses: 3 })).toBe("met"); // 0.70 — above, not clear of the band
    expect(judge(e, { wins: 1, losses: 3 })).toBe("failed"); // 0.25
  });

  it("does not judge a run that has not started", () => {
    expect(judge(expectationFor("clean"), { wins: 0, losses: 0 })).toBe("met");
  });
});

describe("the raise", () => {
  const e = expectationFor("clean"); // 0.4

  it("raises the rate when the run is clearly going well", () => {
    // The tester's exact case: 5 a week, start 3-1, the brand comes back with more.
    const raised = midRunBump(deal(), e, { wins: 3, losses: 1 });
    expect(raised).toBe(8);
  });

  it("does not raise on a two-game sample", () => {
    expect(midRunBump(deal(), e, { wins: 2, losses: 0 })).toBeNull();
  });

  it("does not raise twice", () => {
    expect(midRunBump(deal({ bumped: true }), e, { wins: 5, losses: 0 })).toBeNull();
  });

  it("does not raise a run that is merely fine", () => {
    expect(midRunBump(deal(), e, { wins: 2, losses: 2 })).toBeNull();
  });
});

describe("what a brand remembers", () => {
  const hist = (over: Partial<BrandHistory> = {}): BrandHistory => ({
    brand: "Volt Energy", standing: "neutral", exceeded: 0, met: 0, failed: 0,
    lastYear: 2030, lastWeek: 5, ...over,
  });

  it("comes back eager after a run that beat the bar", () => {
    expect(nextStanding(undefined, "exceeded")).toBe("eager");
    expect(standingMultiplier("eager")).toBeGreaterThan(1);
  });

  it("sours after one failure and cuts the next offer", () => {
    expect(nextStanding(undefined, "failed")).toBe("burned");
    expect(standingMultiplier("burned")).toBeLessThan(1);
  });

  it("stops calling after a second failure", () => {
    // One bad year a sponsor will wear. Twice is a pattern, and a brand that keeps coming
    // back after being embarrassed makes the whole economy weightless.
    expect(nextStanding(hist({ failed: 1, standing: "burned" }), "failed")).toBe("gone");
  });

  it("lets a delivered run repair a burned relationship", () => {
    expect(nextStanding(hist({ failed: 1, standing: "burned" }), "met")).toBe("neutral");
  });
});

describe("how many sponsors a program can carry", () => {
  it("scales with the program, and is never unlimited", () => {
    // Stacking without limit is free money — which is what the cap exists to stop.
    expect(maxConcurrentDeals(1)).toBe(1);
    expect(maxConcurrentDeals(5)).toBe(2);
    expect(maxConcurrentDeals(10)).toBe(4);
  });
});

describe("the money stays program-shaped", () => {
  it("pays a blue blood more than a rebuild for the same offer", () => {
    expect(scaleStipend(60, "clean", 10)).toBeGreaterThan(scaleStipend(60, "clean", 2));
  });

  it("cannot be blown up by a hallucinated number", () => {
    // The model only picks where inside the band a deal lands; it never sets the ceiling.
    expect(scaleStipend(6000, "clean", 5)).toBeLessThanOrEqual(Math.ceil(60 * programFactor(5)));
  });
});
