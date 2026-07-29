// The trait engine turns a player's archetype and ratings into the reason a coach acts:
// why he's a threat, where to go at him. Wrong language here is worse than silence — it
// sends someone to press a running back or throw at a corner who can actually cover.
//
// Every archetype code asserted below was observed on a real CFB27 roster.

import { describe, expect, it } from "vitest";
import type { RosterPlayer, RosterRatings } from "./client";
import { archetypeLabel, attackLine, playerProfile, profileLine, threatTags, weaknessTags } from "./traits";

const P = (
  position: string,
  ratings: RosterRatings,
  archetype: string | null = null
): RosterPlayer => ({
  name: "Test Man", position, year: "Jr", overall: 80, jersey: 9, archetype, ratings,
});

describe("archetypeLabel", () => {
  it("reads the save's real codes as coach-speak", () => {
    expect(archetypeLabel("DE_SmallerSpeedRusher")).toBe("undersized speed rusher");
    expect(archetypeLabel("CB_MantoMan")).toBe("man-coverage corner");
    expect(archetypeLabel("MLB_RunStopper")).toBe("downhill run-stopper");
    expect(archetypeLabel("WR_DeepThreat")).toBe("deep threat");
    expect(archetypeLabel("QB_PureScrambler")).toBe("pure scrambler");
  });

  it("writes the position back into codes that would otherwise be one bare word", () => {
    expect(archetypeLabel("CB_Zone")).toBe("zone corner");
    expect(archetypeLabel("S_Zone")).toBe("centerfield safety");
    expect(archetypeLabel("G_Power")).toBe("mauling guard");
    expect(archetypeLabel("OLB_PassCoverage")).toBe("coverage outside backer");
  });

  // One KP_ code covers both specialists; a punter must never be credited with field goals.
  it("tells a punter from a kicker on the shared specialist codes", () => {
    expect(archetypeLabel("KP_Accurate", "K")).toBe("accuracy specialist");
    expect(archetypeLabel("KP_Accurate", "P")).toBe("placement punter");
    expect(archetypeLabel("KP_Power", "P")).toBe("big leg");
  });

  it("decodes an archetype it has never seen rather than dropping it", () => {
    expect(archetypeLabel("LB_ThumperSpecialist")).toBe("thumper specialist");
    expect(archetypeLabel("XX_SomeNewType")).toBe("some new type");
  });

  it("says nothing for an empty or invalid archetype", () => {
    expect(archetypeLabel(null)).toBeNull();
    expect(archetypeLabel("")).toBeNull();
    expect(archetypeLabel("Invalid_")).toBeNull();
    expect(archetypeLabel("None")).toBeNull();
  });
});

describe("threatTags — why he hurts you", () => {
  it("calls a 95-speed receiver a burner", () => {
    expect(threatTags(P("WR", { speed: 95 }))).toContain("true burner — nobody catches him");
  });

  it("separates a deep threat from a possession receiver", () => {
    expect(threatTags(P("WR", { routeDeep: 92 }))).toContain("deep threat — takes the top off");
    expect(threatTags(P("WR", { routeDeep: 60 }))).not.toContain("deep threat — takes the top off");
  });

  it("distinguishes a bull rusher from a speed rusher", () => {
    expect(threatTags(P("RE", { powerMoves: 89 }))).toContain("bull rush — walks blockers back");
    expect(threatTags(P("RE", { finesseMoves: 89 }))).toContain("speed rush off the edge");
  });

  it("reads coverage type on a defensive back", () => {
    expect(threatTags(P("CB", { manCover: 87 }))).toContain("locks up in man");
    expect(threatTags(P("CB", { zoneCover: 87 }))).toContain("reads the quarterback in zone");
  });

  it("flags a running quarterback as a spy problem", () => {
    expect(threatTags(P("QB", { speed: 88 }))).toContain("runs — a spy problem");
  });

  // Receiver language must not land on a running back, and vice versa.
  it("never gives a back receiver-only tags", () => {
    const back = threatTags(P("HB", { routeDeep: 95, catchTraffic: 95, release: 95, routeShort: 95 }));
    expect(back).not.toContain("deep threat — takes the top off");
    expect(back).not.toContain("wins the ball in traffic");
  });

  it("gives a back his own language", () => {
    expect(threatTags(P("HB", { juke: 90 }))).toContain("makes the first man miss in space");
    expect(threatTags(P("HB", { catching: 85, routeShort: 75 }))).toContain("a real threat out of the backfield");
  });

  // The live-roster bug: punters share KickPower with kickers and were being credited with
  // field-goal range they will never attempt.
  it("keeps field-goal claims off punters", () => {
    expect(threatTags(P("P", { kickPower: 95, kickAccuracy: 95 }))).toEqual(["flips the field"]);
    expect(threatTags(P("K", { kickPower: 95, kickAccuracy: 95 }))).toEqual([
      "leg for 55-plus",
      "doesn't miss inside 45",
    ]);
  });

  it("says nothing when the save carries no ratings", () => {
    expect(threatTags({ name: "X", position: "WR", year: null, overall: 80, jersey: null })).toEqual([]);
  });

  it("caps how much it says about one man", () => {
    const loaded = P("CB", { speed: 96, manCover: 95, zoneCover: 95, press: 95, catching: 95 });
    expect(threatTags(loaded).length).toBeLessThanOrEqual(3);
  });
});

describe("weaknessTags — where to go at him, with the answer attached", () => {
  it("names the hole AND the call", () => {
    const tags = weaknessTags(P("CB", { manCover: 40 }));
    expect(tags[0]).toBe("beat in man — isolate him and run vertical");
    expect(tags[0]).toContain("—"); // the answer, not just the diagnosis
  });

  it("tells a man-coverage hole from a zone hole", () => {
    expect(weaknessTags(P("CB", { manCover: 40, zoneCover: 90 }))[0]).toMatch(/beat in man/);
    expect(weaknessTags(P("CB", { manCover: 90, zoneCover: 40 }))[0]).toMatch(/lost in zone/);
  });

  it("finds the linebacker you attack up the seam", () => {
    expect(weaknessTags(P("MLB", { zoneCover: 45 }))).toContain(
      "liability in coverage — send the tight end up the seam"
    );
  });

  it("finds the lineman to rush", () => {
    expect(weaknessTags(P("LT", { passBlock: 50 }))).toContain(
      "protection breaks down — bring pressure at him"
    );
  });

  it("finds the quarterback to pressure", () => {
    expect(weaknessTags(P("QB", { throwPressure: 50 }))).toContain("rattles under pressure — bring heat");
  });

  it("gives a back back-language, not receiver-language", () => {
    const tags = weaknessTags(P("HB", { catching: 40, release: 40, breakTackle: 40, trucking: 40 }));
    expect(tags).not.toContain("struggles off the line — press him");
    expect(tags.join(" ")).toMatch(/first contact|no receiving threat/);
  });

  it("stays quiet on a player with no exploitable hole", () => {
    expect(weaknessTags(P("CB", { manCover: 90, zoneCover: 90, press: 90, speed: 92, playRec: 90, tackle: 85 }))).toEqual([]);
  });
});

describe("profileLine / attackLine", () => {
  it("leads with the archetype then why he hurts you", () => {
    const line = profileLine(P("RE", { powerMoves: 90, blockShed: 90 }, "DE_PowerRusher"));
    expect(line).toBe("power rusher · bull rush — walks blockers back · sheds blocks and finds the ball");
  });

  it("leads with the archetype then where to go at him", () => {
    const line = attackLine(P("CB", { manCover: 40 }, "CB_Zone"));
    expect(line).toBe("zone corner · beat in man — isolate him and run vertical");
  });

  it("falls back to the archetype alone when there's no hole", () => {
    expect(attackLine(P("CB", { manCover: 95, zoneCover: 95 }, "CB_MantoMan"))).toBe("man-coverage corner");
  });

  it("returns an empty string rather than filler when the save gave us nothing", () => {
    expect(profileLine({ name: "X", position: "WR", year: null, overall: 70, jersey: null })).toBe("");
    expect(attackLine({ name: "X", position: "WR", year: null, overall: 70, jersey: null })).toBe("");
  });

  it("never prints a rating number", () => {
    const p = P("CB", { speed: 95, manCover: 40, zoneCover: 88, press: 79 }, "CB_Zone");
    const text = `${profileLine(p)} ${attackLine(p)} ${JSON.stringify(playerProfile(p))}`;
    expect(text).not.toMatch(/\b(95|40|88|79)\b/);
    expect(text).not.toMatch(/\bOVR\b/i);
  });
});
