// WHY he's a threat, and WHERE to go at him.
//
// The save carries every player's archetype ("DT_SpeedRusher", "CB_MantoMan") and 50+ trait
// ratings. A rating number on its own is the thing we deliberately stopped showing — but the
// SHAPE of a man's ratings is exactly what a scouting report is for. This module turns those
// numbers into the sentences a position coach would actually say: "burner", "gets beat in
// man — motion him and take the top off", "rattles under pressure".
//
// Same contract as the rest of the scouting stack: numbers go in, language comes out. No
// exported function here returns a rating, and no tag string contains one.

import type { RosterPlayer, RosterRatings } from "./client";

// Rating bands, calibrated against real CFB27 rosters: starters sit 70-90, elite traits run
// 88+, and anything at or under 55 is a hole you can scheme at.
const ELITE = 88;
const STRONG = 82;
const WEAK = 58;
const BAD = 48;

// Backs and receivers are split deliberately. Lumping them made the engine tell a coach to
// "press" a running back and "challenge the catch point" on a between-the-tackles runner —
// receiver notes on a man who never runs a route.
type Group = "QB" | "BACK" | "RECEIVER" | "OL" | "DL" | "LB" | "DB" | "K" | "P";

const POS_GROUP: Record<string, Group> = {
  QB: "QB",
  HB: "BACK", RB: "BACK", FB: "BACK",
  WR: "RECEIVER", TE: "RECEIVER",
  LT: "OL", LG: "OL", C: "OL", RG: "OL", RT: "OL", OL: "OL",
  LE: "DL", RE: "DL", DE: "DL", DT: "DL",
  LOLB: "LB", MLB: "LB", ROLB: "LB", LB: "LB",
  CB: "DB", FS: "DB", SS: "DB", S: "DB",
  K: "K", P: "P",
};

function groupOf(p: RosterPlayer): Group | null {
  return POS_GROUP[(p.position ?? "").toUpperCase()] ?? null;
}

// ── Archetype ───────────────────────────────────────────────────────────────────

// Codes that don't survive a naive CamelCase split, or that read better in coach-speak.
// Every key below was observed on a real CFB27 roster — a bare "zone" or "power" tells a
// coach nothing, so the position is written back into the label.
const ARCHETYPE_OVERRIDES: Record<string, string> = {
  // Secondary
  CB_MantoMan: "man-coverage corner",
  CB_Zone: "zone corner",
  CB_Slot: "slot corner",
  S_Hybrid: "hybrid safety",
  S_Zone: "centerfield safety",
  S_RunSupport: "box safety",
  // Front seven
  DE_PowerRusher: "power rusher",
  DE_RunStopper: "run-stopping end",
  DE_SmallerSpeedRusher: "undersized speed rusher",
  DT_PowerRusher: "interior power rusher",
  DT_PurePower: "pure power nose",
  DT_SpeedRusher: "penetrating three-technique",
  MLB_RunStopper: "downhill run-stopper",
  MLB_FieldGeneral: "field general",
  MLB_PassCoverage: "coverage linebacker",
  OLB_PassCoverage: "coverage outside backer",
  OLB_PowerRusher: "power-rushing outside backer",
  OLB_RunStopper: "run-stopping outside backer",
  // Offensive line
  OT_Agile: "agile tackle",
  OT_Power: "mauling tackle",
  OT_PassProtector: "pass-protecting tackle",
  G_Agile: "agile guard",
  G_Power: "mauling guard",
  G_PassProtector: "pass-protecting guard",
  G_WellRounded: "well-rounded guard",
  C_Agile: "agile center",
  C_Power: "mauling center",
  C_PassProtector: "pass-protecting center",
  // Skill
  QB_FieldGeneral: "pocket field general",
  QB_Improviser: "improviser",
  QB_PureScrambler: "pure scrambler",
  QB_PurePasser: "pocket passer",
  QB_DualThreat: "dual threat",
  QB_BackfieldCreator: "backfield creator",
  HB_ElusiveBack: "elusive back",
  HB_ElusivePower: "elusive power back",
  HB_PowerBack: "power back",
  HB_PowerBlocking: "blocking back",
  HB_ReceivingBack: "receiving back",
  FB_Utility: "utility fullback",
  WR_DeepThreat: "deep threat",
  WR_Physical: "physical receiver",
  WR_PhysicalBlocker: "blocking receiver",
  WR_PhysicalRouteRunner: "physical route runner",
  WR_ElusiveRouteRunner: "elusive route runner",
  WR_Playmaker: "playmaker",
  TE_Blocking: "blocking tight end",
  TE_PossessionBlocking: "possession/blocking tight end",
  TE_PhysicalRouteRunner: "physical route-running tight end",
  TE_VerticalThreat: "vertical-threat tight end",
  // Specialists — one code covers both K and P, so the position decides the wording.
  KP_Power: "big leg",
  KP_Accurate: "accuracy specialist",
};

/**
 * Plain-English archetype. Falls back to decoding the save's own CamelCase code so an
 * archetype this build has never seen still reads sensibly instead of vanishing — the game
 * ships more of these than any hard-coded table would keep up with.
 */
export function archetypeLabel(
  archetype: string | null | undefined,
  position?: string | null
): string | null {
  const raw = (archetype ?? "").trim();
  if (!raw || raw === "Invalid_" || raw === "None") return null;
  // One KP_ code covers kickers and punters, so "accuracy specialist" would land on a
  // punter who has never attempted a field goal. The position breaks the tie.
  if (raw.startsWith("KP_") && (position ?? "").toUpperCase() === "P") {
    return raw === "KP_Power" ? "big leg" : "placement punter";
  }
  const override = ARCHETYPE_OVERRIDES[raw];
  if (override) return override;
  // "DT_SpeedRusher" → "speed rusher"; "WR_PhysicalRouteRunner" → "physical route runner".
  const body = raw.includes("_") ? raw.slice(raw.indexOf("_") + 1) : raw;
  const words = body
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .trim();
  return words || null;
}

// ── Threats: why he hurts you ───────────────────────────────────────────────────

interface Rule {
  /** Which position groups this rule is meaningful for. */
  groups: Group[];
  test: (r: RosterRatings) => boolean;
  tag: string;
}

const THREAT_RULES: Rule[] = [
  { groups: ["BACK", "RECEIVER", "DB"], test: (r) => (r.speed ?? 0) >= 94, tag: "true burner — nobody catches him" },
  { groups: ["BACK", "RECEIVER", "DB", "LB"], test: (r) => (r.speed ?? 0) >= ELITE && (r.speed ?? 0) < 94, tag: "runs away from bad angles" },
  { groups: ["RECEIVER"], test: (r) => (r.routeDeep ?? 0) >= ELITE, tag: "deep threat — takes the top off" },
  { groups: ["RECEIVER"], test: (r) => (r.catchTraffic ?? 0) >= ELITE, tag: "wins the ball in traffic" },
  { groups: ["RECEIVER"], test: (r) => (r.release ?? 0) >= STRONG && (r.routeShort ?? 0) >= STRONG, tag: "beats press and separates early" },
  { groups: ["BACK", "RECEIVER"], test: (r) => (r.breakTackle ?? 0) >= STRONG || (r.trucking ?? 0) >= STRONG, tag: "breaks the first tackle" },
  { groups: ["BACK"], test: (r) => (r.juke ?? 0) >= ELITE || (r.vision ?? 0) >= ELITE, tag: "makes the first man miss in space" },
  { groups: ["BACK"], test: (r) => (r.catching ?? 0) >= STRONG && (r.routeShort ?? 0) >= 70, tag: "a real threat out of the backfield" },
  { groups: ["DL", "LB"], test: (r) => (r.powerMoves ?? 0) >= STRONG, tag: "bull rush — walks blockers back" },
  { groups: ["DL", "LB"], test: (r) => (r.finesseMoves ?? 0) >= STRONG, tag: "speed rush off the edge" },
  { groups: ["DL", "LB"], test: (r) => (r.blockShed ?? 0) >= STRONG, tag: "sheds blocks and finds the ball" },
  { groups: ["DL", "LB", "DB"], test: (r) => (r.tackle ?? 0) >= STRONG && (r.hitPower ?? 0) >= STRONG, tag: "big hitter — jars the ball loose" },
  { groups: ["LB", "DB"], test: (r) => (r.playRec ?? 0) >= ELITE, tag: "diagnoses it before you do" },
  { groups: ["DB"], test: (r) => (r.manCover ?? 0) >= STRONG, tag: "locks up in man" },
  { groups: ["DB", "LB"], test: (r) => (r.zoneCover ?? 0) >= STRONG, tag: "reads the quarterback in zone" },
  { groups: ["DB"], test: (r) => (r.press ?? 0) >= STRONG, tag: "presses and disrupts the route" },
  { groups: ["DB"], test: (r) => (r.catching ?? 0) >= STRONG, tag: "catches what you throw at him" },
  { groups: ["QB"], test: (r) => (r.throwDeep ?? 0) >= STRONG, tag: "big arm — hits the shot plays" },
  { groups: ["QB"], test: (r) => (r.throwRun ?? 0) >= STRONG, tag: "dangerous throwing on the move" },
  { groups: ["QB"], test: (r) => (r.throwPressure ?? 0) >= STRONG, tag: "doesn't rattle under pressure" },
  { groups: ["QB"], test: (r) => (r.speed ?? 0) >= STRONG, tag: "runs — a spy problem" },
  { groups: ["OL"], test: (r) => (r.passBlock ?? 0) >= STRONG, tag: "holds up in protection" },
  { groups: ["OL"], test: (r) => (r.runBlock ?? 0) >= STRONG, tag: "moves people in the run game" },
  // Field-goal language belongs to the kicker only. The save gives punters a high KickPower
  // too, which had the engine crediting a punter with "doesn't miss inside 45".
  { groups: ["K"], test: (r) => (r.kickPower ?? 0) >= 90, tag: "leg for 55-plus" },
  { groups: ["K"], test: (r) => (r.kickAccuracy ?? 0) >= 90, tag: "doesn't miss inside 45" },
  { groups: ["P"], test: (r) => (r.kickPower ?? 0) >= 90, tag: "flips the field" },
];

// ── Weaknesses: where to go at him ──────────────────────────────────────────────
// Each one names the hole AND the answer, because "bad at zone" is trivia until it's
// "flood his zone with two receivers".

const WEAKNESS_RULES: Rule[] = [
  { groups: ["DB"], test: (r) => (r.manCover ?? 99) <= WEAK, tag: "beat in man — isolate him and run vertical" },
  { groups: ["DB"], test: (r) => (r.zoneCover ?? 99) <= WEAK, tag: "lost in zone — flood his area with two" },
  { groups: ["DB"], test: (r) => (r.press ?? 99) <= BAD, tag: "can't jam — your receiver gets a free release" },
  { groups: ["DB"], test: (r) => (r.speed ?? 99) <= 80, tag: "no recovery speed — take the top off him" },
  { groups: ["DB", "LB"], test: (r) => (r.playRec ?? 99) <= WEAK, tag: "slow to diagnose — play-action and misdirection" },
  { groups: ["LB"], test: (r) => (r.zoneCover ?? 99) <= WEAK, tag: "liability in coverage — send the tight end up the seam" },
  { groups: ["LB", "DL"], test: (r) => (r.pursuit ?? 99) <= WEAK, tag: "poor pursuit — get outside and make him run" },
  { groups: ["DL", "LB"], test: (r) => (r.blockShed ?? 99) <= WEAK, tag: "gets swallowed by blocks — run right at him" },
  { groups: ["DL"], test: (r) => (r.powerMoves ?? 99) <= WEAK && (r.finesseMoves ?? 99) <= WEAK, tag: "no pass rush — your QB has time" },
  { groups: ["DL", "LB", "DB"], test: (r) => (r.tackle ?? 99) <= WEAK, tag: "poor tackler — get your back to the second level" },
  { groups: ["OL"], test: (r) => (r.passBlock ?? 99) <= WEAK, tag: "protection breaks down — bring pressure at him" },
  { groups: ["OL"], test: (r) => (r.runBlock ?? 99) <= WEAK, tag: "can't move anybody — stack the front on his side" },
  { groups: ["QB"], test: (r) => (r.throwPressure ?? 99) <= WEAK, tag: "rattles under pressure — bring heat" },
  { groups: ["QB"], test: (r) => (r.throwDeep ?? 99) <= WEAK, tag: "can't drive it deep — squat on the underneath" },
  { groups: ["QB"], test: (r) => (r.awareness ?? 99) <= WEAK, tag: "forces throws — disguise the coverage" },
  { groups: ["RECEIVER"], test: (r) => (r.catching ?? 99) <= WEAK, tag: "drops it — challenge the catch point" },
  { groups: ["RECEIVER"], test: (r) => (r.release ?? 99) <= WEAK, tag: "struggles off the line — press him" },
  // Backs get back language: whether he can be arm-tackled, and whether he's a runner only.
  { groups: ["BACK"], test: (r) => (r.breakTackle ?? 99) <= WEAK && (r.trucking ?? 99) <= WEAK, tag: "goes down on first contact" },
  { groups: ["BACK"], test: (r) => (r.catching ?? 99) <= WEAK, tag: "no receiving threat — he's a runner, play the run on his downs" },
];

function applyRules(rules: Rule[], p: RosterPlayer, limit: number): string[] {
  const r = p.ratings;
  const g = groupOf(p);
  if (!r || !g) return [];
  return rules
    .filter((rule) => rule.groups.includes(g) && rule.test(r))
    .map((rule) => rule.tag)
    .slice(0, limit);
}

/** Why this man hurts you — at most `limit` reasons, strongest first. */
export function threatTags(p: RosterPlayer, limit = 3): string[] {
  return applyRules(THREAT_RULES, p, limit);
}

/** Where he can be attacked, each with the answer attached. */
export function weaknessTags(p: RosterPlayer, limit = 2): string[] {
  return applyRules(WEAKNESS_RULES, p, limit);
}

export interface PlayerProfile {
  /** e.g. "speed rusher" — the save's own archetype, in English. */
  archetype: string | null;
  threats: string[];
  weaknesses: string[];
}

export function playerProfile(p: RosterPlayer): PlayerProfile {
  return {
    archetype: archetypeLabel(p.archetype, p.position),
    threats: threatTags(p),
    weaknesses: weaknessTags(p),
  };
}

/** One compact line: archetype plus what makes him that. Empty string when the save gave us
 * nothing to say — better silent than padded with filler. */
export function profileLine(p: RosterPlayer): string {
  const prof = playerProfile(p);
  const bits = [prof.archetype, ...prof.threats];
  return bits.filter(Boolean).join(" · ");
}

/** The attack line: archetype plus where to go at him. */
export function attackLine(p: RosterPlayer): string {
  const prof = playerProfile(p);
  if (prof.weaknesses.length === 0) return prof.archetype ?? "";
  return [prof.archetype, ...prof.weaknesses].filter(Boolean).join(" · ");
}
