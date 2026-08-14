// Which facts win, and which facts get sent.
//
// The base module (lore.ts) stores the world and states it. This one decides two things it
// deliberately left alone, because both are judgement calls rather than storage:
//
//   CONFLICT — "canon outranks generated" was, until now, ordering plus an instruction. Put
//   canon first, tell the model it wins, hope. That is fine right up until the app has
//   promoted a fact that flatly contradicts one the user wrote, at which point the prompt
//   contains both and the instruction is doing all the work. Here the loser is removed
//   before the prompt is built, so the contradiction never reaches the model at all.
//
//   SELECTION — a world bible grows forever and the context window does not. Newest-first is
//   the wrong rule once it starts overflowing: the fact about this week's opponent might be
//   two seasons old, and the fact about a player who transferred out last year is recent and
//   useless. So entries are scored against WHO IS ACTUALLY IN THIS WEEK and the budget is
//   spent on what the week is about.
//
// What this module will NOT do is pretend to detect contradiction in general. There is no
// deterministic test for whether two sentences of prose disagree. What there IS a test for
// is a narrow, checkable class: two entries handing the SAME ROLE to DIFFERENT PEOPLE. One
// offensive coordinator, one starting quarterback, one beat writer. That is the class users
// will actually hit, because it is what promoting generated coverage produces — the app
// invents a coordinator, the user already named one, and now there are two. Everything
// outside that class is left to the prompt, honestly labelled as weighting rather than
// enforcement.

import {
  ENTRY_BUDGET,
  entryKey,
  rankEntries,
  renderLore,
  type LoreEntry,
  type LoreState,
} from "./lore";

// ── Roles ─────────────────────────────────────────────────────────────────────
//
// A deliberately small vocabulary. Every entry here is a role a program has exactly ONE of,
// which is the whole basis of the check — adding "linebacker" or "booster" would be wrong,
// because a team has many and two entries naming two of them is not a contradiction.

const ROLE_ALIASES: Array<[RegExp, string]> = [
  [/\b(?:offensive coordinator|offensive co-ordinator|\bOC\b)\b/i, "offensive coordinator"],
  [/\b(?:defensive coordinator|defensive co-ordinator|\bDC\b)\b/i, "defensive coordinator"],
  [/\b(?:head coach|head football coach)\b/i, "head coach"],
  [/\b(?:athletic director|\bAD\b)\b/i, "athletic director"],
  [/\b(?:beat writer|beat reporter|reporter of record)\b/i, "beat writer"],
  [/\b(?:starting quarterback|starter at quarterback|\bQB1\b)\b/i, "starting quarterback"],
  [/\b(?:team captain|captain)\b/i, "team captain"],
  [/\b(?:rival head coach|rival coach)\b/i, "rival head coach"],
  [/\b(?:special teams coordinator)\b/i, "special teams coordinator"],
  [/\b(?:strength coach|head trainer)\b/i, "strength coach"],
];

/**
 * A capitalised name at the front of a claim.
 *
 * Kept strict on purpose. This drives a check that DELETES a fact from the prompt, so a
 * loose match that mistakes an ordinary capitalised word for a person would silently drop
 * something the user wrote — a far worse outcome than missing a conflict and letting the
 * prompt's own instruction handle it.
 */
const NAME = /^([A-Z][\w'’-]*(?:\s+(?:[A-Z][\w'’-]*|de|van|von|da|del|la))*)\s/;

export interface RoleClaim {
  entry: LoreEntry;
  role: string;
  subject: string;
}

/**
 * "Marcus Hale is my offensive coordinator" → { subject: "Marcus Hale", role: "offensive
 * coordinator" }. Anything that is not plainly of that shape returns null and is simply not
 * subject to the conflict check.
 */
export function roleClaim(entry: LoreEntry): RoleClaim | null {
  const text = entry.text.trim();
  const nameMatch = NAME.exec(text);
  if (!nameMatch) return null;
  const subject = nameMatch[1].trim();
  // The claim has to be an assignment — "X is/was/remains <role>" — not a passing mention.
  // "Marcus Hale hates the offensive coordinator" names a role without claiming it.
  const rest = text.slice(nameMatch[0].length);
  if (!/^(?:is|was|remains|stays|becomes|has been|will be)\b/i.test(rest.trim())) return null;
  for (const [pattern, role] of ROLE_ALIASES) {
    if (pattern.test(rest)) return { entry, role, subject };
  }
  return null;
}

export interface LoreConflict {
  role: string;
  /** The claim that stands. */
  winner: RoleClaim;
  /** The claim that is withheld from the prompt. */
  loser: RoleClaim;
  /** Why the winner won, for the UI to explain rather than just assert. */
  reason: "canon-beats-generated" | "newer-canon" | "newer-generated";
}

const sameSubject = (a: string, b: string) => entryKey(a) === entryKey(b);

/**
 * Every place two entries hand one role to two different people.
 *
 * Precedence: what the user wrote beats what the app wrote, always. Between two entries of
 * the same source the newer one wins, because a user who states a new offensive coordinator
 * has replaced their coordinator — that is a hire, not a mistake.
 */
export function findConflicts(entries: LoreEntry[]): LoreConflict[] {
  const claims = entries.map(roleClaim).filter((c): c is RoleClaim => c !== null);
  const byRole = new Map<string, RoleClaim[]>();
  for (const c of claims) {
    const list = byRole.get(c.role) ?? [];
    list.push(c);
    byRole.set(c.role, list);
  }

  const out: LoreConflict[] = [];
  for (const [role, list] of byRole) {
    if (list.length < 2) continue;
    // Best claim first: canon over promoted, then newest.
    const ordered = [...list].sort((a, b) => {
      if (a.entry.source !== b.entry.source) return a.entry.source === "canon" ? -1 : 1;
      return b.entry.addedAt - a.entry.addedAt;
    });
    const winner = ordered[0];
    for (const loser of ordered.slice(1)) {
      // Two entries naming the SAME person in the same role agree with each other. Only a
      // different name is a contradiction.
      if (sameSubject(winner.subject, loser.subject)) continue;
      out.push({
        role,
        winner,
        loser,
        reason:
          winner.entry.source !== loser.entry.source
            ? "canon-beats-generated"
            : winner.entry.source === "canon"
              ? "newer-canon"
              : "newer-generated",
      });
    }
  }
  return out;
}

/** Ids withheld from the prompt because a higher-precedence fact contradicts them. */
export function overriddenIds(entries: LoreEntry[]): Set<string> {
  return new Set(findConflicts(entries).map((c) => c.loser.entry.id));
}

// ── Relevance ─────────────────────────────────────────────────────────────────

export interface LoreContext {
  /** This week's opponent, if there is a game. */
  opponent?: string | null;
  /** The user's own program. */
  team?: string | null;
  /** People who are actually in this week — both rosters, plus the recurring cast. */
  names?: string[];
}

/** Word-boundary, case-insensitive containment. Avoids "Al" matching inside "Alabama". */
function mentions(haystack: string, needle: string): boolean {
  const n = needle.trim();
  if (n.length < 3) return false;
  const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(haystack);
}

/**
 * How much this fact has to do with the week being written about.
 *
 * Direction matters here: this asks whether names FROM THE WEEK appear in the entry, rather
 * than trying to pull names out of the entry and match them against the week. Extracting
 * people from free prose is guesswork; checking whether a known roster name appears in a
 * sentence is not. The scoring is coarse on purpose — it decides ordering, not truth.
 */
export function relevance(entry: LoreEntry, ctx: LoreContext): number {
  let score = 0;
  const t = entry.text;
  if (ctx.opponent && mentions(t, ctx.opponent)) score += 6;
  if (ctx.team && mentions(t, ctx.team)) score += 2;
  for (const n of ctx.names ?? []) {
    if (mentions(t, n)) {
      score += 3;
      // One relevant person is the signal; ten is usually a long entry that happens to list
      // a lot of names, and letting it run away would crowd out everything else.
      if (score >= 15) break;
    }
  }
  return score;
}

export interface Selection {
  /** In prompt order. */
  kept: LoreEntry[];
  /** Fit nowhere — reported to the user rather than silently swallowed. */
  dropped: LoreEntry[];
  /** Withheld because a higher-precedence fact contradicts them. */
  overridden: LoreEntry[];
}

/**
 * What actually goes in the prompt.
 *
 * Canon is still tried first and in full — the user's own words are the last thing that
 * should ever be cut. Relevance decides the order WITHIN a source, so when promoted facts
 * overflow, the ones about this week's opponent and this week's players survive and the ones
 * about a player who left two seasons ago are the ones that go.
 */
export function selectLore(
  state: LoreState,
  ctx: LoreContext,
  budget: number
): Selection {
  const overrides = overriddenIds(state.entries);
  const overridden = state.entries.filter((e) => overrides.has(e.id));
  const live = state.entries.filter((e) => !overrides.has(e.id));

  // rankEntries gives the stable base order (canon first, then kind, then newest). Relevance
  // reorders inside that, never across it — a wildly relevant promoted fact must not displace
  // a piece of canon, because precedence is the whole contract of this feature.
  const base = rankEntries(live);
  const scored = base.map((e, i) => ({ e, i, r: relevance(e, ctx) }));
  scored.sort((a, b) => {
    const aCanon = a.e.source === "canon";
    const bCanon = b.e.source === "canon";
    if (aCanon !== bCanon) return aCanon ? -1 : 1;
    if (a.r !== b.r) return b.r - a.r;
    return a.i - b.i;
  });

  const kept: LoreEntry[] = [];
  const dropped: LoreEntry[] = [];
  let used = 0;
  for (const { e } of scored) {
    const cost = e.text.length + 8;
    if (used + cost > budget) {
      dropped.push(e);
      continue;
    }
    used += cost;
    kept.push(e);
  }
  return { kept, dropped, overridden };
}

/**
 * The whole pipeline: resolve conflicts, spend the budget on what this week is about, render.
 *
 * This is what generation calls. `loreBlock` in lore.ts is the context-free version.
 */
export function loreBlockFor(
  state: LoreState | null | undefined,
  ctx: LoreContext,
  budget = ENTRY_BUDGET
): string[] {
  if (!state) return [];
  if (!state.freeform.trim() && state.entries.length === 0) return [];
  const { kept } = selectLore(state, ctx, budget);
  return renderLore(state.freeform, kept);
}
