import { describe, expect, it } from "vitest";
import {
  ENTRY_BUDGET,
  ENTRY_MAX,
  FREEFORM_MAX,
  addEntry,
  entryKey,
  hasEntry,
  isEmpty,
  loreBlock,
  loreOverflow,
  newLore,
  rankEntries,
  removeEntry,
  setFreeform,
  tidy,
  type LoreEntry,
  type LoreState,
} from "./lore";

const add = (state: LoreState, text: string, over: Partial<Parameters<typeof addEntry>[1]> = {}) =>
  addEntry(state, {
    source: "canon",
    kind: "fact",
    text,
    now: 1,
    id: text.slice(0, 12),
    ...over,
  });

describe("adding facts", () => {
  it("keeps what was added", () => {
    const s = add(newLore(), "The stadium is named after the coach's father.");
    expect(s.entries).toHaveLength(1);
    expect(s.entries[0].text).toBe("The stadium is named after the coach's father.");
  });

  it("refuses a duplicate rather than letting the same line compete with itself", () => {
    let s = add(newLore(), "Dana Reyes covers this program.");
    s = add(s, "Dana Reyes covers this program.", { id: "second" });
    expect(s.entries).toHaveLength(1);
  });

  it("treats trivially different spellings of the same line as the same line", () => {
    // The button sits on generated content, which gets re-read and re-pressed. Trailing
    // punctuation and smart quotes must not create a second copy.
    let s = add(newLore(), "Dana Reyes covers this program");
    s = add(s, "  Dana Reyes  covers this program.  ", { id: "second" });
    expect(s.entries).toHaveLength(1);
  });

  it("ignores an empty add", () => {
    const s = add(newLore(), "   ");
    expect(s.entries).toHaveLength(0);
  });

  it("truncates a paragraph down to a fact", () => {
    const long = "x".repeat(ENTRY_MAX + 200);
    const s = add(newLore(), long);
    expect(s.entries[0].text.length).toBeLessThanOrEqual(ENTRY_MAX);
    expect(s.entries[0].text.endsWith("…")).toBe(true);
  });

  it("removes by id", () => {
    let s = add(newLore(), "One");
    s = add(s, "Two", { id: "two" });
    s = removeEntry(s, "two", 5);
    expect(s.entries.map((e) => e.text)).toEqual(["One"]);
  });

  it("leaves state alone when removing something that is not there", () => {
    const s = add(newLore(), "One");
    expect(removeEntry(s, "nope", 5)).toBe(s);
  });
});

describe("the free-form account", () => {
  it("stores what was written", () => {
    const s = setFreeform(newLore(), "Year two of the rebuild. The QB is my son.", 3);
    expect(s.freeform).toContain("Year two");
    expect(s.updatedAt).toBe(3);
  });

  it("caps a runaway paste instead of shipping it to every generator", () => {
    const s = setFreeform(newLore(), "y".repeat(FREEFORM_MAX + 5000), 3);
    expect(s.freeform).toHaveLength(FREEFORM_MAX);
  });

  it("does not churn state when nothing changed", () => {
    const s = setFreeform(newLore(), "same", 3);
    expect(setFreeform(s, "same", 9)).toBe(s);
  });
});

describe("ranking", () => {
  const e = (over: Partial<LoreEntry>): LoreEntry => ({
    id: "x",
    source: "promoted",
    kind: "fact",
    text: "t",
    addedAt: 0,
    ...over,
  });

  it("puts the user's own canon ahead of the app's promoted output", () => {
    const ranked = rankEntries([
      e({ id: "p", source: "promoted" }),
      e({ id: "c", source: "canon" }),
    ]);
    expect(ranked[0].id).toBe("c");
  });

  it("puts people ahead of events, because a cast list changes more sentences", () => {
    const ranked = rankEntries([
      e({ id: "ev", kind: "event" }),
      e({ id: "pe", kind: "person" }),
    ]);
    expect(ranked[0].id).toBe("pe");
  });

  it("puts newer facts of the same kind first", () => {
    const ranked = rankEntries([
      e({ id: "old", addedAt: 1 }),
      e({ id: "new", addedAt: 99 }),
    ]);
    expect(ranked[0].id).toBe("new");
  });
});

describe("the prompt block", () => {
  it("says nothing at all when there is no lore", () => {
    expect(loreBlock(null)).toEqual([]);
    expect(loreBlock(newLore())).toEqual([]);
    expect(isEmpty(newLore())).toBe(true);
  });

  it("carries the user's words and their facts", () => {
    let s = setFreeform(newLore(), "The rivalry with State is personal.", 1);
    s = add(s, "Dana Reyes is the beat writer.", { kind: "person" });
    const text = loreBlock(s).join("\n");
    expect(text).toContain("The rivalry with State is personal.");
    expect(text).toContain("Dana Reyes is the beat writer.");
  });

  it("tells the model the lore outranks its own assumptions", () => {
    const s = add(newLore(), "The program has never won a title.");
    const text = loreBlock(s).join("\n");
    expect(text).toMatch(/never contradict/i);
    expect(text).toMatch(/the fact wins/i);
  });

  it("forbids reciting it, which is what turns a world bible into a script", () => {
    // The whole point of the feature is that the model invents AROUND the lore. A block of
    // facts with no such instruction gets dutifully restated, and every article turns into a
    // character sheet read aloud.
    const s = add(newLore(), "The stadium holds 20,000.");
    const text = loreBlock(s).join("\n");
    expect(text).toMatch(/not a script/i);
    expect(text).toMatch(/invent/i);
  });

  it("separates what the user wrote from what the app wrote", () => {
    let s = add(newLore(), "Canon thing", { source: "canon", id: "c" });
    s = add(s, "Promoted thing", { source: "promoted", id: "p" });
    const text = loreBlock(s).join("\n");
    const canonAt = text.indexOf("Canon thing");
    const promotedAt = text.indexOf("Promoted thing");
    expect(canonAt).toBeGreaterThan(-1);
    expect(promotedAt).toBeGreaterThan(canonAt);
    expect(text).toMatch(/not negotiable/i);
  });

  it("dates a fact when it knows the season", () => {
    const s = add(newLore(), "Won the conference", { kind: "event", year: 2031, week: 14 });
    expect(loreBlock(s).join("\n")).toContain("(2031, week 14)");
  });

  it("stays inside its budget when the world bible gets big", () => {
    let s = newLore();
    for (let i = 0; i < 400; i++) {
      s = add(s, `Fact number ${i} ${"z".repeat(80)}`, { id: `f${i}`, now: i });
    }
    const body = loreBlock(s).join("\n");
    expect(body.length).toBeLessThan(ENTRY_BUDGET + 2000);
    expect(loreOverflow(s)).toBeGreaterThan(0);
  });

  it("spends the budget on canon before promoted output", () => {
    let s = newLore();
    for (let i = 0; i < 200; i++) {
      s = add(s, `Promoted ${i} ${"z".repeat(80)}`, { id: `p${i}`, source: "promoted", now: i });
    }
    s = add(s, "The one thing the user actually wrote", { id: "canon", source: "canon", now: 0 });
    const text = loreBlock(s).join("\n");
    expect(text).toContain("The one thing the user actually wrote");
  });

  it("reports overflow as zero while everything fits", () => {
    const s = add(newLore(), "Short");
    expect(loreOverflow(s)).toBe(0);
  });
});

describe("helpers", () => {
  it("normalises for comparison", () => {
    expect(entryKey("  The  Thing. ")).toBe(entryKey("the thing"));
  });

  it("knows what it already holds", () => {
    const s = add(newLore(), "Held");
    expect(hasEntry(s, "held")).toBe(true);
    expect(hasEntry(s, "not held")).toBe(false);
  });

  it("collapses whitespace when tidying", () => {
    expect(tidy("a\n\n  b")).toBe("a b");
  });
});
