// DYNASTY LORE — the world the user brings, alongside the world the save describes.
//
// Every other locked fact in this app is computed: the box score comes from the save, the
// standings come from the save, the arcs are derived from numbers nobody typed. This module
// is the one place where the LOCKED COLUMN IS AUTHORED. The user says a thing is true about
// their dynasty and it becomes as binding as the final score.
//
// The shape is deliberately the same as everything else, because the thesis is the same:
// state the facts, forbid contradiction, and leave the writing free. Lore does NOT script
// coverage. It says who exists and what has already happened; the media universe still
// invents the reporters, the arguments, the quotes and the controversies around it.
//
// Two sources, and the difference matters on conflict:
//   canon    — the user wrote it. Outranks everything, including the app's own past output.
//   promoted — the app wrote it and the user pressed "Add to Dynasty Lore", promoting it
//              from a disposable line in one week's issue to a permanent part of the world.
//
// The honest limit, stated here because it should be stated in the UI too: this is CONTEXT,
// not a validator. A wrong number can be caught because there is a table to check it
// against; there is no table for "does this story contradict my lore". Putting canon in
// front of the model makes it very likely to be respected. It does not make it enforced.

/** Where a fact came from. `canon` beats `promoted` whenever the two disagree. */
export type LoreSource = "canon" | "promoted";

/**
 * What kind of thing a fact is about. Used for grouping in the UI and for ordering in the
 * prompt — people and relationships before events, because knowing WHO exists changes more
 * sentences than knowing what happened in year two.
 */
export type LoreKind = "person" | "relationship" | "event" | "fact";

export interface LoreEntry {
  id: string;
  source: LoreSource;
  kind: LoreKind;
  /** The thing that is true, in one or two sentences. */
  text: string;
  /** For promoted entries: the surface it came off. "Week 6 recap", "The Forum". */
  from?: string | null;
  /** When it entered the world, so "three seasons ago" can be said accurately. */
  year?: number | null;
  week?: number | null;
  /** Wall clock, for ordering within a season and for stable sort. */
  addedAt: number;
}

export interface LoreState {
  /**
   * The user's own words about their dynasty, unstructured and unparsed. This is the whole
   * of step one: someone running a custom story alongside their save can paste their
   * characters, their program's culture and where the story currently stands, and every
   * generator sees it.
   */
  freeform: string;
  entries: LoreEntry[];
  updatedAt: number;
}

export function newLore(): LoreState {
  return { freeform: "", entries: [], updatedAt: 0 };
}

/**
 * Caps. Both exist for the same reason and neither is arbitrary.
 *
 * The world bible rides inside the shared context, which becomes the prompt-cached prefix —
 * so it is written once per week and read almost free by every generator that week. What it
 * is NOT free of is the context window, which is already carrying a roster, a box score, a
 * league block and an archive. Lore that crowds those out makes the app worse at the job it
 * already does well.
 *
 * These are generous enough that no realistic first-season user will meet them, and they
 * are enforced visibly (see `loreOverflow`) rather than by silently dropping the tail.
 */
export const FREEFORM_MAX = 4000;
export const ENTRY_MAX = 400;
export const ENTRY_BUDGET = 6000;

/**
 * The order facts are offered to the model in, best first.
 *
 * Canon before promoted, because the user's own words outrank the app's. Within canon,
 * people and relationships before events, because a cast list changes more sentences than a
 * date does. Within a kind, NEWEST first — a world bible is a living document and the recent
 * state of it is what this week is about. The oldest entries are the ones that get dropped
 * when the budget runs out, which is the right thing to lose: "we won the 2031 title" is
 * already in the season archive, whereas "the QB and the DC still aren't speaking" is not
 * recoverable from anywhere else.
 */
const KIND_RANK: Record<LoreKind, number> = { person: 0, relationship: 1, event: 2, fact: 3 };

export function rankEntries(entries: LoreEntry[]): LoreEntry[] {
  return [...entries].sort((a, b) => {
    if (a.source !== b.source) return a.source === "canon" ? -1 : 1;
    if (a.kind !== b.kind) return KIND_RANK[a.kind] - KIND_RANK[b.kind];
    return b.addedAt - a.addedAt;
  });
}

/**
 * A normalised fingerprint, so the same line cannot be promoted twice.
 *
 * Worth more than it looks: the button sits on generated content, and generated content is
 * re-read. Someone scrolling back through week six and pressing it again should not get a
 * second copy of the same sentence competing for the same budget.
 */
export function entryKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    // Trim BEFORE stripping punctuation, not after: a trailing space would otherwise stop
    // the punctuation from matching the end anchor and "the thing. " would fingerprint
    // differently from "the thing", which is the exact duplicate this is here to catch.
    .trim()
    .replace(/[.,;:!?"']+$/g, "")
    .trim();
}

export function hasEntry(state: LoreState, text: string): boolean {
  const key = entryKey(text);
  return state.entries.some((e) => entryKey(e.text) === key);
}

/** Trim a promoted line to something that reads as a fact rather than a paragraph. */
export function tidy(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > ENTRY_MAX ? `${t.slice(0, ENTRY_MAX - 1).trimEnd()}…` : t;
}

export interface AddLoreInput {
  source: LoreSource;
  kind: LoreKind;
  text: string;
  from?: string | null;
  year?: number | null;
  week?: number | null;
  /** Injected rather than read from the clock, so the pure core stays testable. */
  now: number;
  /** Injected for the same reason. */
  id: string;
}

/**
 * Add a fact. Returns the state unchanged if the text is empty or already present, so
 * callers can treat "add" as idempotent and the UI can show an already-added state without
 * a separate existence check.
 */
export function addEntry(state: LoreState, input: AddLoreInput): LoreState {
  const text = tidy(input.text);
  if (!text) return state;
  if (hasEntry(state, text)) return state;
  const entry: LoreEntry = {
    id: input.id,
    source: input.source,
    kind: input.kind,
    text,
    from: input.from ?? null,
    year: input.year ?? null,
    week: input.week ?? null,
    addedAt: input.now,
  };
  return { ...state, entries: [...state.entries, entry], updatedAt: input.now };
}

export function removeEntry(state: LoreState, id: string, now: number): LoreState {
  const entries = state.entries.filter((e) => e.id !== id);
  if (entries.length === state.entries.length) return state;
  return { ...state, entries, updatedAt: now };
}

export function setFreeform(state: LoreState, text: string, now: number): LoreState {
  const freeform = text.slice(0, FREEFORM_MAX);
  if (freeform === state.freeform) return state;
  return { ...state, freeform, updatedAt: now };
}

/** How many entries the budget cannot fit, for the UI to report honestly. */
export function loreOverflow(state: LoreState): number {
  const ranked = rankEntries(state.entries);
  let used = 0;
  let kept = 0;
  for (const e of ranked) {
    const cost = e.text.length + 8;
    if (used + cost > ENTRY_BUDGET) break;
    used += cost;
    kept++;
  }
  return ranked.length - kept;
}

export function isEmpty(state: LoreState | null | undefined): boolean {
  if (!state) return true;
  return !state.freeform.trim() && state.entries.length === 0;
}

function stamp(e: LoreEntry): string {
  if (e.year != null && e.week != null) return ` (${e.year}, week ${e.week})`;
  if (e.year != null) return ` (${e.year})`;
  return "";
}

const KIND_HEADING: Record<LoreKind, string> = {
  person: "People who exist in this world",
  relationship: "Relationships and rivalries",
  event: "Things that have already happened",
  fact: "Established facts",
};

/**
 * The world bible as the model sees it.
 *
 * The framing is doing real work here and is worth reading rather than skimming. Two
 * instructions are in tension and both are needed: never contradict this, and do not merely
 * recite it. A model given a block of facts and no further guidance will dutifully restate
 * them, which turns a world bible into a script and makes every article read like a
 * character sheet being read aloud. The way out is to say explicitly what the facts are FOR:
 * they are the ground the invented coverage stands on, not the coverage.
 */
export function loreBlock(state: LoreState | null | undefined): string[] {
  if (isEmpty(state)) return [];
  const s = state as LoreState;
  // Budget-only selection, no week context. lore-select.ts has the relevance-aware version
  // that generation actually calls; this remains for callers with no week to be relevant to.
  const ranked = rankEntries(s.entries);
  const kept: LoreEntry[] = [];
  let used = 0;
  for (const e of ranked) {
    const cost = e.text.length + 8;
    if (used + cost > ENTRY_BUDGET) break;
    used += cost;
    kept.push(e);
  }
  return renderLore(s.freeform, kept);
}

/**
 * The world bible as the model sees it, given a decided set of facts.
 *
 * Split from selection so the two questions stay separate: WHICH facts go in is a judgement
 * about budget and relevance (lore-select.ts), HOW they are stated is a judgement about
 * prompting. Mixing them is how a change to one quietly breaks the other.
 */
export function renderLore(freeform: string, entries: LoreEntry[]): string[] {
  if (!freeform.trim() && entries.length === 0) return [];
  const s = { freeform, entries } as LoreState;
  const parts: string[] = [];

  parts.push("=== DYNASTY LORE (the user's own world — treat as fact, never contradict) ===");
  parts.push(
    "Everything in this block is TRUE in this dynasty. The user established it. It outranks",
    "your own assumptions and anything you have written before. If a fact here disagrees with",
    "what seems likely, the fact wins."
  );
  parts.push(
    "This is NOT a script. Do not recite it, summarise it, or write stories whose point is to",
    "restate it. It is the ground you build on: invent the reporters, the arguments, the",
    "quotes, the fan reactions and the controversies FREELY, and make them consistent with",
    "this world. Reference lore the way a beat writer references things everyone already",
    "knows — in passing, assumed, unexplained."
  );
  parts.push("");

  const free = s.freeform.trim();
  if (free) {
    parts.push("--- The user's own account of their dynasty (their words, highest authority) ---");
    parts.push(free);
    parts.push("");
  }

  if (entries.length) {
    const kept = entries;
    const canon = kept.filter((e) => e.source === "canon");
    const promoted = kept.filter((e) => e.source === "promoted");

    const writeGroup = (list: LoreEntry[]) => {
      const kinds: LoreKind[] = ["person", "relationship", "event", "fact"];
      for (const k of kinds) {
        const inKind = list.filter((e) => e.kind === k);
        if (!inKind.length) continue;
        parts.push(`  ${KIND_HEADING[k]}:`);
        for (const e of inKind) parts.push(`    - ${e.text}${stamp(e)}`);
      }
    };

    if (canon.length) {
      parts.push("--- Established canon (the user wrote these; they are not negotiable) ---");
      writeGroup(canon);
      parts.push("");
    }
    if (promoted.length) {
      parts.push(
        "--- Part of the world (coverage the user kept; these people and events are real now) ---"
      );
      writeGroup(promoted);
      parts.push(
        "  Anyone named here already exists — use them again rather than inventing someone new",
        "  to fill the same role."
      );
      parts.push("");
    }
  }

  return parts;
}
