// The coach's board — who is where, and who is behind him.
//
// ONE THING TO BE CLEAR ABOUT, BECAUSE THE PAGE SAYS IT TOO: this is ordered by RATING, not
// by the depth chart you set in-game.
//
// The save does carry a depth-chart table (`ForcedDepthChartEntry`), and the parser reads it
// — but only in Road to Glory, and the sidecar's own note says the semantics are unverified:
// a real save had two QB entries, (depth 0, locked 0) and (depth 5, locked 1), with nothing
// obviously saying which one governs. Shipping that as "your depth chart" would put a
// confident wrong answer on screen, which is the failure this codebase keeps paying for.
//
// So the board is built from ratings, which is what the game itself defaults to, and the page
// says so plainly. If someone verifies the table against a save where the answer is known,
// this module is where the real order plugs in and nothing above it has to change.

import type { RosterPlayer } from "./client";

export type UnitKey =
  | "QB" | "RB" | "WR" | "TE" | "OL"
  | "DL" | "LB" | "CB" | "S"
  | "ST" | "OTHER";

export interface DepthSpot {
  /** The label on the board — "QB", "LT", "CB". */
  position: string;
  unit: UnitKey;
  /** Best first. Ties broken by name so the board never reshuffles between renders. */
  players: RosterPlayer[];
  /** How many of these are on the field at once — the line between starter and backup. */
  starters: number;
}

export interface DepthUnit {
  key: UnitKey;
  label: string;
  side: "offense" | "defense" | "special" | "other";
  spots: DepthSpot[];
}

/**
 * How many bodies at a spot count as starters.
 *
 * A depth chart question, not a personnel-package one: three corners are on the field in
 * nickel, but a board shows CB1 and CB2 above the fold. Kept separate from scouting.ts's
 * ON_FIELD for exactly that reason — same words, different question.
 */
const STARTERS_AT: Record<string, number> = {
  QB: 1, HB: 1, RB: 1, FB: 1, WR: 3, TE: 1,
  LT: 1, LG: 1, C: 1, RG: 1, RT: 1, OL: 5,
  LE: 1, RE: 1, DE: 2, DT: 2,
  LOLB: 1, MLB: 1, ROLB: 1, LB: 3,
  CB: 2, FS: 1, SS: 1, S: 2,
  K: 1, P: 1, KR: 1, PR: 1, LS: 1,
};

/** Board order — the way a coach reads it: offense down, defense down, teams last. */
const UNIT_OF: Record<string, UnitKey> = {
  QB: "QB",
  HB: "RB", RB: "RB", FB: "RB",
  WR: "WR",
  TE: "TE",
  LT: "OL", LG: "OL", C: "OL", RG: "OL", RT: "OL", OL: "OL",
  LE: "DL", RE: "DL", DE: "DL", DT: "DL",
  LOLB: "LB", MLB: "LB", ROLB: "LB", LB: "LB",
  CB: "CB",
  FS: "S", SS: "S", S: "S",
  K: "ST", P: "ST", KR: "ST", PR: "ST", LS: "ST",
};

const UNIT_META: Record<UnitKey, { label: string; side: DepthUnit["side"] }> = {
  QB: { label: "Quarterbacks", side: "offense" },
  RB: { label: "Backs", side: "offense" },
  WR: { label: "Receivers", side: "offense" },
  TE: { label: "Tight Ends", side: "offense" },
  OL: { label: "Offensive Line", side: "offense" },
  DL: { label: "Defensive Line", side: "defense" },
  LB: { label: "Linebackers", side: "defense" },
  CB: { label: "Cornerbacks", side: "defense" },
  S: { label: "Safeties", side: "defense" },
  ST: { label: "Special Teams", side: "special" },
  OTHER: { label: "Unlisted", side: "other" },
};

const UNIT_ORDER: UnitKey[] = ["QB", "RB", "WR", "TE", "OL", "DL", "LB", "CB", "S", "ST", "OTHER"];

/** Spot order within a unit, so the line reads left to right like a line. */
const SPOT_ORDER: string[] = [
  "QB",
  "HB", "RB", "FB",
  "WR", "TE",
  "LT", "LG", "C", "RG", "RT", "OL",
  "LE", "DT", "RE", "DE",
  "LOLB", "MLB", "ROLB", "LB",
  "CB", "FS", "SS", "S",
  "K", "P", "LS", "KR", "PR",
];

export const normPos = (p: string | null | undefined): string =>
  (p ?? "").trim().toUpperCase();

export function unitFor(position: string): UnitKey {
  return UNIT_OF[normPos(position)] ?? "OTHER";
}

/**
 * Best first, with a deterministic tiebreak.
 *
 * Two 78-overall guards must not swap places every time the page re-renders — a board that
 * reorders itself while you look at it reads as a bug even when the data is right.
 */
function byDepth(a: RosterPlayer, b: RosterPlayer): number {
  const d = (b.overall ?? 0) - (a.overall ?? 0);
  if (d !== 0) return d;
  return (a.name ?? "").localeCompare(b.name ?? "");
}

/**
 * The whole board.
 *
 * Nobody is dropped. A player whose position the save spells in a way this module has never
 * seen lands in "Unlisted" rather than vanishing — a depth chart that quietly loses players
 * is worse than one with an odd heading on it.
 */
export function buildDepthChart(roster: RosterPlayer[]): DepthUnit[] {
  const bySpot = new Map<string, RosterPlayer[]>();
  for (const p of roster) {
    const spot = normPos(p.position) || "—";
    const list = bySpot.get(spot) ?? [];
    list.push(p);
    bySpot.set(spot, list);
  }

  const byUnit = new Map<UnitKey, DepthSpot[]>();
  for (const [position, players] of bySpot) {
    const unit = unitFor(position);
    const spot: DepthSpot = {
      position,
      unit,
      players: [...players].sort(byDepth),
      starters: STARTERS_AT[position] ?? 1,
    };
    const list = byUnit.get(unit) ?? [];
    list.push(spot);
    byUnit.set(unit, list);
  }

  const rank = (s: string) => {
    const i = SPOT_ORDER.indexOf(s);
    return i === -1 ? SPOT_ORDER.length : i;
  };

  return UNIT_ORDER.filter((u) => byUnit.has(u)).map((key) => ({
    key,
    label: UNIT_META[key].label,
    side: UNIT_META[key].side,
    spots: (byUnit.get(key) ?? []).sort(
      (a, b) => rank(a.position) - rank(b.position) || a.position.localeCompare(b.position)
    ),
  }));
}

/** Surname only — what actually goes on a slate. Handles suffixes and particles. */
export function lastName(full: string): string {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? "";
  const SUFFIX = /^(jr|sr|ii|iii|iv|v)\.?$/i;
  let i = parts.length - 1;
  // "Deion Sanders Jr." is a Sanders, not a Jr.
  while (i > 0 && SUFFIX.test(parts[i])) i--;
  // Walk the whole particle chain, not just one word back: "De La Cruz" is three tokens and
  // stopping at one gives "La Cruz", which is not anybody's name.
  const PARTICLE = /^(de|del|de|della|la|le|van|von|da|di|du|dos|st|st\.|mc|mac)$/i;
  let start = i;
  while (start > 0 && PARTICLE.test(parts[start - 1])) start--;
  return parts.slice(start, i + 1).join(" ");
}

/** Is he unavailable? Injuries and suspensions belong on a board — that IS the news. */
export function isOut(p: RosterPlayer): boolean {
  const inj = (p.injury ?? "").trim();
  return !!inj && !/^(healthy|none|no)$/i.test(inj);
}

export interface DepthTotals {
  players: number;
  spots: number;
  /** Spots with nobody behind the starter — the thin ones a coach actually worries about. */
  thin: string[];
}

export function depthTotals(units: DepthUnit[]): DepthTotals {
  let players = 0;
  let spots = 0;
  const thin: string[] = [];
  for (const u of units) {
    for (const s of u.spots) {
      spots++;
      players += s.players.length;
      if (u.key !== "OTHER" && s.players.length <= s.starters) thin.push(s.position);
    }
  }
  return { players, spots, thin };
}
