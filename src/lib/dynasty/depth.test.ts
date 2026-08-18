import { describe, expect, it } from "vitest";
import type { RosterPlayer } from "./client";
import { buildDepthChart, depthTotals, isOut, lastName, unitFor } from "./depth";

const P = (name: string, position: string, overall: number, over: Partial<RosterPlayer> = {}): RosterPlayer =>
  ({ name, position, overall, year: "Jr", jersey: null, ...over }) as RosterPlayer;

describe("grouping the board", () => {
  it("puts each position under the unit a coach reads it in", () => {
    expect(unitFor("LT")).toBe("OL");
    expect(unitFor("MLB")).toBe("LB");
    expect(unitFor("FS")).toBe("S");
    expect(unitFor("HB")).toBe("RB");
    expect(unitFor("K")).toBe("ST");
  });

  it("never drops a player whose position it does not recognise", () => {
    // A board that quietly loses people is worse than one with an odd heading. Reported-style
    // failure this guards against: a roster of 85 rendering 81 slates and nobody noticing.
    const units = buildDepthChart([P("Odd Duck", "ATH", 70), P("Cade Klubnik", "QB", 88)]);
    const all = units.flatMap((u) => u.spots.flatMap((s) => s.players));
    expect(all).toHaveLength(2);
    expect(units.find((u) => u.key === "OTHER")?.spots[0].players[0].name).toBe("Odd Duck");
  });

  it("keeps a player with no position at all", () => {
    const units = buildDepthChart([P("Nameless Spot", "", 60)]);
    expect(units.flatMap((u) => u.spots.flatMap((s) => s.players))).toHaveLength(1);
  });

  it("orders each spot best first", () => {
    const units = buildDepthChart([P("Backup", "QB", 74), P("Starter", "QB", 91), P("Third", "QB", 68)]);
    const qb = units[0].spots[0];
    expect(qb.players.map((p) => p.name)).toEqual(["Starter", "Backup", "Third"]);
  });

  it("breaks ties by name so the board does not reshuffle on re-render", () => {
    const a = buildDepthChart([P("Zeb Young", "RG", 78), P("Al Baker", "RG", 78)]);
    const b = buildDepthChart([P("Al Baker", "RG", 78), P("Zeb Young", "RG", 78)]);
    expect(a[0].spots[0].players.map((p) => p.name)).toEqual(b[0].spots[0].players.map((p) => p.name));
    expect(a[0].spots[0].players[0].name).toBe("Al Baker");
  });

  it("treats a missing overall as the bottom of the room, not the top", () => {
    const units = buildDepthChart([P("Unrated", "QB", null as never), P("Rated", "QB", 70)]);
    expect(units[0].spots[0].players[0].name).toBe("Rated");
  });

  it("reads the line left to right", () => {
    const units = buildDepthChart([
      P("E", "RT", 70), P("A", "LT", 70), P("C", "C", 70), P("B", "LG", 70), P("D", "RG", 70),
    ]);
    const ol = units.find((u) => u.key === "OL")!;
    expect(ol.spots.map((s) => s.position)).toEqual(["LT", "LG", "C", "RG", "RT"]);
  });

  it("puts offense before defense before special teams", () => {
    const units = buildDepthChart([P("K", "K", 70), P("Corner", "CB", 70), P("Passer", "QB", 70)]);
    expect(units.map((u) => u.key)).toEqual(["QB", "CB", "ST"]);
  });
});

describe("what goes on a slate", () => {
  it("uses the surname", () => {
    expect(lastName("Cade Klubnik")).toBe("Klubnik");
  });

  it("does not put 'Jr.' on the slate", () => {
    expect(lastName("Deion Sanders Jr.")).toBe("Sanders");
    expect(lastName("Ollie Gordon II")).toBe("Gordon");
  });

  it("keeps a particle attached to the name it belongs to", () => {
    expect(lastName("Jordan De La Cruz")).toBe("De La Cruz");
    expect(lastName("Marcus Van Dyke")).toBe("Van Dyke");
  });

  it("survives a single name or an empty one", () => {
    expect(lastName("Prime")).toBe("Prime");
    expect(lastName("")).toBe("");
  });
});

describe("availability", () => {
  it("flags a real injury and ignores the ways a save says 'fine'", () => {
    expect(isOut(P("Hurt", "QB", 80, { injury: "Knee — 4 weeks" }))).toBe(true);
    expect(isOut(P("Fine", "QB", 80, { injury: "Healthy" }))).toBe(false);
    expect(isOut(P("Fine", "QB", 80, { injury: "" }))).toBe(false);
    expect(isOut(P("Fine", "QB", 80))).toBe(false);
  });
});

describe("what the board tells you at a glance", () => {
  it("counts everyone and names the thin spots", () => {
    const units = buildDepthChart([
      P("Only QB", "QB", 80),
      P("RB1", "HB", 80), P("RB2", "HB", 70),
    ]);
    const t = depthTotals(units);
    expect(t.players).toBe(3);
    expect(t.thin).toContain("QB");
    expect(t.thin).not.toContain("HB");
  });

  it("does not call the Unlisted bucket thin", () => {
    const units = buildDepthChart([P("Odd", "ATH", 70)]);
    expect(depthTotals(units).thin).toEqual([]);
  });
});
