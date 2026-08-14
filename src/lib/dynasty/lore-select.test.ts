import { describe, expect, it } from "vitest";
import { newLore, type LoreEntry, type LoreState } from "./lore";
import {
  findConflicts,
  loreBlockFor,
  overriddenIds,
  relevance,
  roleClaim,
  selectLore,
} from "./lore-select";

let seq = 0;
const E = (over: Partial<LoreEntry> = {}): LoreEntry => ({
  id: `e${seq++}`,
  source: "promoted",
  kind: "fact",
  text: "something",
  addedAt: seq,
  ...over,
});

const stateOf = (entries: LoreEntry[], freeform = ""): LoreState => ({
  ...newLore(),
  freeform,
  entries,
});

describe("reading a role claim", () => {
  it("pulls the person and the job out of a plain assignment", () => {
    const c = roleClaim(E({ text: "Marcus Hale is my offensive coordinator and my brother-in-law" }));
    expect(c?.subject).toBe("Marcus Hale");
    expect(c?.role).toBe("offensive coordinator");
  });

  it("handles abbreviations and past tense", () => {
    expect(roleClaim(E({ text: "Dana Reyes was our DC" }))?.role).toBe("defensive coordinator");
    expect(roleClaim(E({ text: "Tim Boyle is QB1" }))?.role).toBe("starting quarterback");
  });

  it("ignores a role that is only MENTIONED, not assigned", () => {
    // "hates the offensive coordinator" names the job without claiming it. Treating this as
    // a claim would let an unrelated grumble override something the user wrote.
    expect(roleClaim(E({ text: "Marcus Hale hates the offensive coordinator" }))).toBeNull();
  });

  it("ignores a sentence that does not start with a name", () => {
    expect(roleClaim(E({ text: "the offensive coordinator is under pressure" }))).toBeNull();
  });

  it("ignores facts with no role in them at all", () => {
    expect(roleClaim(E({ text: "Marcus Hale is from Ohio" }))).toBeNull();
  });
});

describe("conflicts", () => {
  it("lets what the user wrote beat what the app wrote", () => {
    const canon = E({ source: "canon", text: "Marcus Hale is my offensive coordinator", addedAt: 1 });
    const promoted = E({ source: "promoted", text: "Rick Deakins is my offensive coordinator", addedAt: 99 });
    const [c] = findConflicts([promoted, canon]);
    expect(c.winner.entry.id).toBe(canon.id);
    expect(c.loser.entry.id).toBe(promoted.id);
    expect(c.reason).toBe("canon-beats-generated");
    // Even though the app's version is far newer. Precedence is not recency.
  });

  it("treats a newer piece of canon as a hire, not a mistake", () => {
    const old = E({ source: "canon", text: "Marcus Hale is my offensive coordinator", addedAt: 1 });
    const fresh = E({ source: "canon", text: "Rick Deakins is my offensive coordinator", addedAt: 50 });
    const [c] = findConflicts([old, fresh]);
    expect(c.winner.entry.id).toBe(fresh.id);
    expect(c.reason).toBe("newer-canon");
  });

  it("does not call two entries about the SAME person a conflict", () => {
    const a = E({ source: "canon", text: "Marcus Hale is my offensive coordinator", addedAt: 1 });
    const b = E({ source: "promoted", text: "Marcus Hale is the offensive coordinator here", addedAt: 2 });
    expect(findConflicts([a, b])).toHaveLength(0);
  });

  it("does not confuse two different roles", () => {
    const a = E({ text: "Marcus Hale is my offensive coordinator" });
    const b = E({ text: "Rick Deakins is my defensive coordinator" });
    expect(findConflicts([a, b])).toHaveLength(0);
  });

  it("keeps the loser out of the prompt entirely", () => {
    // The point of doing this in code rather than in the prompt: the model never sees the
    // contradiction, so it cannot resolve it the wrong way.
    const canon = E({ source: "canon", text: "Marcus Hale is my offensive coordinator", addedAt: 1 });
    const promoted = E({ source: "promoted", text: "Rick Deakins is my offensive coordinator", addedAt: 9 });
    const block = loreBlockFor(stateOf([canon, promoted]), {}).join("\n");
    expect(block).toContain("Marcus Hale");
    expect(block).not.toContain("Rick Deakins");
  });

  it("reports what it withheld rather than hiding it", () => {
    const canon = E({ source: "canon", text: "Marcus Hale is my offensive coordinator", addedAt: 1 });
    const promoted = E({ source: "promoted", text: "Rick Deakins is my offensive coordinator", addedAt: 9 });
    const sel = selectLore(stateOf([canon, promoted]), {}, 6000);
    expect(sel.overridden.map((e) => e.id)).toEqual([promoted.id]);
    expect(overriddenIds([canon, promoted]).has(promoted.id)).toBe(true);
  });
});

describe("relevance", () => {
  it("scores this week's opponent highest", () => {
    const e = E({ text: "We have never beaten Tulane in Shreveport" });
    expect(relevance(e, { opponent: "Tulane" })).toBeGreaterThan(relevance(e, { opponent: "Rice" }));
  });

  it("scores a fact about someone playing this week", () => {
    const e = E({ text: "Tim Boyle transferred in from a junior college" });
    expect(relevance(e, { names: ["Tim Boyle"] })).toBeGreaterThan(0);
    expect(relevance(e, { names: ["Someone Else"] })).toBe(0);
  });

  it("does not match a name inside a longer word", () => {
    // "Al" must not hit inside "Alabama", or every entry looks relevant to everything.
    const e = E({ text: "Alabama beat us in 2029" });
    expect(relevance(e, { names: ["Al"] })).toBe(0);
  });

  it("caps a long entry that happens to list many names", () => {
    const many = Array.from({ length: 20 }, (_, i) => `Player${i} Smith`);
    const e = E({ text: many.join(", ") });
    expect(relevance(e, { names: many })).toBeLessThanOrEqual(15);
  });
});

describe("selection under budget", () => {
  it("spends the budget on the week rather than on the calendar", () => {
    // The old rule was newest-first, which is exactly wrong when it overflows: a fact about
    // this week's opponent can be two seasons old, and a fact about a player who left can be
    // recent and useless.
    const stale = Array.from({ length: 60 }, (_, i) =>
      E({ text: `An old note about nobody in particular, number ${i} ${"z".repeat(90)}`, addedAt: 1000 + i })
    );
    const relevant = E({ text: "We have never won at Tulane", addedAt: 1 });
    const sel = selectLore(stateOf([...stale, relevant]), { opponent: "Tulane" }, 900);
    expect(sel.kept.map((e) => e.id)).toContain(relevant.id);
    expect(sel.dropped.length).toBeGreaterThan(0);
  });

  it("never lets a relevant promoted fact displace canon", () => {
    // Precedence is the contract of the feature. Relevance orders WITHIN a source, never
    // across it — otherwise a hot promoted fact could push out the user's own words.
    const canon = E({ source: "canon", text: "The stadium holds twenty thousand", addedAt: 1 });
    const hot = E({ source: "promoted", text: "Tulane are our biggest rival", addedAt: 2 });
    const sel = selectLore(stateOf([hot, canon]), { opponent: "Tulane" }, 60);
    expect(sel.kept.map((e) => e.id)).toEqual([canon.id]);
    expect(sel.dropped.map((e) => e.id)).toEqual([hot.id]);
  });

  it("still carries the user's own account", () => {
    const block = loreBlockFor(stateOf([], "Year two of the rebuild."), {}).join("\n");
    expect(block).toContain("Year two of the rebuild.");
  });

  it("says nothing when there is no lore", () => {
    expect(loreBlockFor(stateOf([]), {})).toEqual([]);
    expect(loreBlockFor(null, {})).toEqual([]);
  });
});
