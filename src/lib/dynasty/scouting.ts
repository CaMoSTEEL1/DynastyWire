// Deterministic pregame scouting math — the part of the scouting report that must NEVER be
// hallucinated. Everything here is computed in code from the two real rosters in the save
// (yours and the opponent's), so the numbers a coach acts on are the save's own numbers.
// The model then writes the coaching prose AROUND these tables (see buildScoutingSpec).
//
// Deliberately a rough read: it compares OVR averages of projected starters, which is a
// proxy for a matchup, not play-by-play truth. The UI says so — an honest crude edge beats a
// confident invented one.

import type { RosterPlayer } from "./client";

/** One side's stat block (offense / defense / kicking all share this shape). */
type StatsSide = NonNullable<NonNullable<RosterPlayer["stats"]>["offense"]>;

// How many bodies at a position are actually ON THE FIELD. This models the personnel a coach
// sees on a given snap — nickel base (CB 3), 3-WR sets, a two-back rotation — so it runs
// wider than the ingest sidecar's STARTERS_AT, which answers a different question (who is
// buried on the depth chart).
const ON_FIELD: Record<string, number> = {
  QB: 1, HB: 2, RB: 2, FB: 1, WR: 3, TE: 1,
  LT: 1, LG: 1, C: 1, RG: 1, RT: 1, OL: 5,
  LE: 1, RE: 1, DE: 1, DT: 2,
  LOLB: 1, MLB: 1, ROLB: 1, LB: 3,
  CB: 3, FS: 1, SS: 1, S: 2,
  K: 1, P: 1,
};

export type UnitKey = "QB" | "RB" | "WR/TE" | "OL" | "DL" | "LB" | "CB" | "S";

const UNIT_POSITIONS: Record<UnitKey, string[]> = {
  QB: ["QB"],
  RB: ["HB", "RB", "FB"],
  "WR/TE": ["WR", "TE"],
  OL: ["LT", "LG", "C", "RG", "RT", "OL"],
  DL: ["LE", "RE", "DE", "DT"],
  LB: ["LOLB", "MLB", "ROLB", "LB"],
  CB: ["CB"],
  S: ["FS", "SS", "S"],
};

const UNIT_LABEL: Record<UnitKey, string> = {
  QB: "Quarterback",
  RB: "Running backs",
  "WR/TE": "Receivers / TE",
  OL: "Offensive line",
  DL: "Defensive line",
  LB: "Linebackers",
  CB: "Cornerbacks",
  S: "Safeties",
};

const pos = (p: RosterPlayer) => (p.position ?? "").toUpperCase();
const ovr = (p: RosterPlayer) => p.overall ?? 0;
const byOvrDesc = (a: RosterPlayer, b: RosterPlayer) => ovr(b) - ovr(a);

/** A projected starter with his depth slot, e.g. CB2. */
export interface Starter {
  player: RosterPlayer;
  /** "CB2", "QB1", "LT1" — position plus depth index. */
  slot: string;
  position: string;
  overall: number;
}

/** Who's on the field: the top N at each position, N from ON_FIELD. Positions the save
 * doesn't carry are simply absent — never padded with invented bodies. */
export function projectedStarters(roster: RosterPlayer[]): Starter[] {
  const byPos = new Map<string, RosterPlayer[]>();
  for (const p of roster) {
    if (p.overall == null) continue;
    const k = pos(p);
    if (!k) continue;
    const list = byPos.get(k);
    if (list) list.push(p);
    else byPos.set(k, [p]);
  }
  const out: Starter[] = [];
  for (const [k, list] of byPos) {
    const n = ON_FIELD[k] ?? 1;
    list.sort(byOvrDesc);
    list.slice(0, n).forEach((player, i) => {
      out.push({
        player,
        slot: n > 1 ? `${k}${i + 1}` : k,
        position: k,
        overall: ovr(player),
      });
    });
  }
  return out.sort((a, b) => b.overall - a.overall);
}

function unitOf(position: string): UnitKey | null {
  for (const [unit, list] of Object.entries(UNIT_POSITIONS) as [UnitKey, string[]][]) {
    if (list.includes(position)) return unit;
  }
  return null;
}

/** Average OVR of a unit's on-field bodies. null when the save has nobody there. */
export function unitRating(roster: RosterPlayer[], unit: UnitKey): number | null {
  const wanted = UNIT_POSITIONS[unit];
  const guys = projectedStarters(roster).filter((s) => wanted.includes(s.position));
  if (guys.length === 0) return null;
  return Math.round(guys.reduce((sum, s) => sum + s.overall, 0) / guys.length);
}

export type EdgeVerdict = "big-edge" | "edge" | "even" | "their-edge" | "their-big-edge";

export interface UnitEdge {
  unit: UnitKey;
  label: string;
  mine: number | null;
  theirs: number | null;
  /** mine − theirs, in OVR points. null when either side is unknown. */
  diff: number | null;
  verdict: EdgeVerdict | null;
}

function verdictFor(diff: number): EdgeVerdict {
  if (diff >= 7) return "big-edge";
  if (diff >= 3) return "edge";
  if (diff > -3) return "even";
  if (diff > -7) return "their-edge";
  return "their-big-edge";
}

/** Unit-by-unit rating comparison — the table a coach reads before picking a gameplan. */
export function unitEdges(mine: RosterPlayer[], theirs: RosterPlayer[]): UnitEdge[] {
  return (Object.keys(UNIT_POSITIONS) as UnitKey[]).map((unit) => {
    const a = unitRating(mine, unit);
    const b = unitRating(theirs, unit);
    const diff = a != null && b != null ? a - b : null;
    return {
      unit,
      label: UNIT_LABEL[unit],
      mine: a,
      theirs: b,
      diff,
      verdict: diff == null ? null : verdictFor(diff),
    };
  });
}

/** Average of several units together (a "phase" — e.g. the whole front seven). */
function phaseRating(roster: RosterPlayer[], units: UnitKey[]): number | null {
  const vals = units.map((u) => unitRating(roster, u)).filter((v): v is number => v != null);
  if (vals.length === 0) return null;
  return Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
}

export interface PhaseMatchup {
  /** e.g. "Your pass game vs their coverage" */
  label: string;
  /** Which way the ball is going — drives how the UI groups these. */
  side: "yours" | "theirs";
  mine: number | null;
  theirs: number | null;
  diff: number | null;
  verdict: EdgeVerdict | null;
  /** The plain-English instruction that falls out of the number. */
  call: string;
}

/** The four matchups that decide how you should actually play the game.
 *
 * Every number and every verdict here is from the USER's point of view — positive is good
 * for the user on all four rows, including the two about the opponent's offense. The advice
 * fields are named userGood/userBad for the same reason: naming them win/lose invites
 * exactly the inversion that would tell a coach he owns a line of scrimmage he is losing. */
export function phaseMatchups(mine: RosterPlayer[], theirs: RosterPlayer[]): PhaseMatchup[] {
  const rows: Array<{
    label: string;
    side: "yours" | "theirs";
    /** The user's unit in this matchup. */
    ours: number | null;
    /** The opponent's unit in this matchup. */
    opp: number | null;
    userGood: string;
    userBad: string;
    even: string;
  }> = [
    {
      label: "Your pass game vs their coverage",
      side: "yours",
      ours: phaseRating(mine, ["QB", "WR/TE"]),
      opp: phaseRating(theirs, ["CB", "S"]),
      userGood: "Throw it. Your receivers out-class their secondary — take shots early.",
      userBad: "Their coverage is better than your passing game. Play-action and short, safe throws; don't force it.",
      even: "Even through the air — take what the coverage gives you.",
    },
    {
      label: "Your run game vs their front",
      side: "yours",
      ours: phaseRating(mine, ["OL", "RB"]),
      opp: phaseRating(theirs, ["DL", "LB"]),
      userGood: "Run it. You can move their front — lean on the ground game and shorten the game.",
      userBad: "Their front wins up front. Don't grind into it; use tempo, motion, and quick passes instead of straight runs.",
      even: "Run game is a coin flip — stay balanced and take the better look.",
    },
    {
      label: "Their pass game vs your coverage",
      side: "theirs",
      ours: phaseRating(mine, ["CB", "S"]),
      opp: phaseRating(theirs, ["QB", "WR/TE"]),
      userGood: "Your coverage out-classes their passing game — press up and make them earn it.",
      userBad: "They can beat you deep. Keep a safety back and avoid all-out blitzes on early downs.",
      even: "Even in the air — mix coverages so their QB doesn't get comfortable.",
    },
    {
      label: "Their run game vs your front",
      side: "theirs",
      ours: phaseRating(mine, ["DL", "LB"]),
      opp: phaseRating(theirs, ["OL", "RB"]),
      userGood: "You own the line of scrimmage — force them into third-and-long and hunt the QB.",
      userBad: "They can run on you. Commit an extra body to the box and make them throw.",
      even: "They'll test the run — win first down and the rest follows.",
    },
  ];

  return rows.map((r) => {
    const diff = r.ours != null && r.opp != null ? r.ours - r.opp : null;
    return {
      label: r.label,
      side: r.side,
      mine: r.ours,
      theirs: r.opp,
      diff,
      verdict: diff == null ? null : verdictFor(diff),
      call: diff == null ? "" : diff >= 3 ? r.userGood : diff <= -3 ? r.userBad : r.even,
    };
  });
}

export interface Mismatch {
  /** Your guy. */
  mine: Starter;
  /** The man across from him. */
  theirs: Starter;
  /** OVR points in your favour. */
  gap: number;
}

/** Your best individual mismatches: your skill starters against the weakest body at the
 * position that covers them. This is the line a player actually uses in-game — "go at CB3". */
export function bestMismatches(mine: RosterPlayer[], theirs: RosterPlayer[], limit = 3): Mismatch[] {
  const myStarters = projectedStarters(mine);
  const theirStarters = projectedStarters(theirs);
  // Who defends whom, loosely: receivers are covered by the secondary, backs by the box.
  const coveredBy: Partial<Record<UnitKey, UnitKey[]>> = {
    "WR/TE": ["CB", "S"],
    RB: ["LB", "DL"],
    OL: ["DL"],
  };
  const out: Mismatch[] = [];
  for (const s of myStarters) {
    const unit = unitOf(s.position);
    const defUnits = unit ? coveredBy[unit] : undefined;
    if (!defUnits) continue;
    const defenders = theirStarters.filter((d) => {
      const u = unitOf(d.position);
      return u != null && defUnits.includes(u);
    });
    const weakest = defenders.sort((a, b) => a.overall - b.overall)[0];
    if (!weakest) continue;
    const gap = s.overall - weakest.overall;
    if (gap >= 4) out.push({ mine: s, theirs: weakest, gap });
  }
  return out.sort((a, b) => b.gap - a.gap).slice(0, limit);
}

/** Their softest on-field spots — where to aim. Kickers/punters excluded. */
export function weakLinks(roster: RosterPlayer[], limit = 4): Starter[] {
  return projectedStarters(roster)
    .filter((s) => s.position !== "K" && s.position !== "P")
    .sort((a, b) => a.overall - b.overall)
    .slice(0, limit);
}

/** Their most dangerous on-field players. */
export function topThreats(roster: RosterPlayer[], limit = 5): Starter[] {
  return projectedStarters(roster)
    .filter((s) => s.position !== "K" && s.position !== "P")
    .slice(0, limit);
}

const HEALTHY = /^(healthy|none|active|no injury)$/i;

/** Who's banged up. The save's InjuryStatus, reported only when it says something real. */
export function injuries(roster: RosterPlayer[]): Array<{ player: RosterPlayer; status: string }> {
  return roster
    .filter((p) => {
      const s = (p.injury ?? "").trim();
      return s.length > 0 && !HEALTHY.test(s);
    })
    .sort(byOvrDesc)
    .map((p) => ({ player: p, status: (p.injury ?? "").trim() }));
}

export interface Tendencies {
  /** Estimated games played — the most any single player has appeared in. */
  games: number | null;
  passAtt: number;
  rushAtt: number;
  /** Share of called plays that were passes, 0-100. null when there's no volume yet. */
  passRate: number | null;
  identity: "pass-heavy" | "run-heavy" | "balanced";
  passYds: number;
  rushYds: number;
  /** Yards per attempt / per carry — efficiency, not volume. */
  yardsPerAtt: number | null;
  yardsPerCarry: number | null;
  completionPct: number | null;
  passTDs: number;
  passInts: number;
  rushTDs: number;
  /** Per-game defensive production. */
  sacksPerGame: number | null;
  takeawaysPerGame: number | null;
  tflPerGame: number | null;
  pointsFor: null;
}

const sum = (roster: RosterPlayer[], pick: (p: RosterPlayer) => number | null | undefined) =>
  roster.reduce((s, p) => s + (pick(p) ?? 0), 0);

/** Play-calling identity and efficiency, from the opponent's real season production.
 *
 * Attempts (not yards) drive `passRate` — that's what a play-caller's tendency actually is;
 * a run-heavy team with one long TD pass would look pass-first if you went by yards. */
export function tendencies(roster: RosterPlayer[]): Tendencies {
  const off = (p: RosterPlayer) => p.stats?.offense ?? p.stats ?? null;
  const def = (p: RosterPlayer) => p.stats?.defense ?? p.stats ?? null;

  const passAtt = sum(roster, (p) => off(p)?.passAtt);
  const rushAtt = sum(roster, (p) => off(p)?.rushAtt);
  const passYds = sum(roster, (p) => off(p)?.passYds);
  const rushYds = sum(roster, (p) => off(p)?.rushYds);
  const passComp = sum(roster, (p) => off(p)?.passComp);
  const plays = passAtt + rushAtt;
  const games = roster.reduce<number | null>((m, p) => {
    const gp = p.stats?.gamesPlayed ?? null;
    return gp != null && (m == null || gp > m) ? gp : m;
  }, null);

  const passRate = plays > 0 ? Math.round((passAtt / plays) * 100) : null;
  const identity =
    passRate == null
      ? passYds > rushYds * 1.4
        ? "pass-heavy"
        : rushYds > passYds * 1.1
          ? "run-heavy"
          : "balanced"
      : passRate >= 58
        ? "pass-heavy"
        : passRate <= 42
          ? "run-heavy"
          : "balanced";

  const sacks = sum(roster, (p) => def(p)?.sacks);
  const ints = sum(roster, (p) => def(p)?.ints);
  const ff = sum(roster, (p) => def(p)?.forcedFumbles);
  const tfl = sum(roster, (p) => def(p)?.tfl);
  const per = (v: number) => (games && games > 0 ? Math.round((v / games) * 10) / 10 : null);

  return {
    games,
    passAtt,
    rushAtt,
    passRate,
    identity,
    passYds,
    rushYds,
    yardsPerAtt: passAtt > 0 ? Math.round((passYds / passAtt) * 10) / 10 : null,
    yardsPerCarry: rushAtt > 0 ? Math.round((rushYds / rushAtt) * 10) / 10 : null,
    completionPct: passAtt > 0 ? Math.round((passComp / passAtt) * 100) : null,
    passTDs: sum(roster, (p) => off(p)?.passTDs),
    passInts: sum(roster, (p) => off(p)?.passInts),
    rushTDs: sum(roster, (p) => off(p)?.rushTDs),
    sacksPerGame: per(sacks),
    takeawaysPerGame: per(ints + ff),
    tflPerGame: per(tfl),
    pointsFor: null,
  };
}

export interface SpecialTeams {
  kicker: { name: string; overall: number | null; fgMade: number; fgAtt: number; fgLong: number | null; made50: number | null; att50: number | null } | null;
  punter: { name: string; overall: number | null; punts: number; avg: number | null; in20: number | null } | null;
  returnThreats: Array<{ name: string; position: string | null; kickRetTDs: number; puntRetTDs: number; retYds: number }>;
}

/** Kicker range, punt game, and return threats — the facts behind 4th-down and kickoff
 * decisions. Season kicking stats only exist for players the parser depth-limits into the
 * stat slice, so any of these may legitimately come back null. */
export function specialTeams(roster: RosterPlayer[]): SpecialTeams {
  // Kicking numbers arrive either nested under `kicking` or flattened onto the stats object
  // (same either/or gen.ts handles). Both fit the per-side shape, so read them as one.
  const kickStats = (p: RosterPlayer): StatsSide | null =>
    p.stats?.kicking ?? (p.stats?.side === "kicking" ? p.stats : null);

  const kickers = roster.filter((p) => pos(p) === "K").sort(byOvrDesc);
  const punters = roster.filter((p) => pos(p) === "P").sort(byOvrDesc);
  const k = kickers[0] ?? null;
  const pu = punters[0] ?? null;
  const ks = k ? kickStats(k) : null;
  const ps = pu ? kickStats(pu) : null;

  const returnThreats = roster
    .map((p) => {
      const s = p.stats?.offense ?? p.stats ?? null;
      const kickRetTDs = s?.kickRetTDs ?? 0;
      const puntRetTDs = s?.puntRetTDs ?? 0;
      const retYds = (s?.kickRetYds ?? 0) + (s?.puntRetYds ?? 0);
      return { name: p.name, position: p.position, kickRetTDs, puntRetTDs, retYds };
    })
    .filter((r) => r.kickRetTDs > 0 || r.puntRetTDs > 0 || r.retYds >= 200)
    .sort((a, b) => b.kickRetTDs + b.puntRetTDs - (a.kickRetTDs + a.puntRetTDs) || b.retYds - a.retYds)
    .slice(0, 2);

  const punts = ps?.punts ?? 0;
  const puntYds = ps?.puntYds ?? 0;

  return {
    kicker: k
      ? {
          name: k.name,
          overall: k.overall,
          fgMade: ks?.fgMade ?? 0,
          fgAtt: ks?.fgAtt ?? 0,
          fgLong: ks?.fgLong ?? null,
          made50: ks?.fgMade50Plus ?? null,
          att50: ks?.fgAtt50Plus ?? null,
        }
      : null,
    punter: pu
      ? {
          name: pu.name,
          overall: pu.overall,
          punts,
          avg: punts > 0 ? Math.round((puntYds / punts) * 10) / 10 : null,
          in20: ps?.puntIn20 ?? null,
        }
      : null,
    returnThreats,
  };
}

export interface ScoutingMath {
  edges: UnitEdge[];
  matchups: PhaseMatchup[];
  mismatches: Mismatch[];
  weakLinks: Starter[];
  threats: Starter[];
  injuries: Array<{ player: RosterPlayer; status: string }>;
  tendencies: Tendencies;
  specialTeams: SpecialTeams;
  /** Overall on-field rating gap (all units averaged), user's perspective. */
  overallGap: number | null;
}

/** Everything deterministic, in one pass — used by both the prompt and the UI so the two
 * can never disagree about the numbers. */
export function scoutingMath(mine: RosterPlayer[], theirs: RosterPlayer[]): ScoutingMath {
  const edges = unitEdges(mine, theirs);
  const diffs = edges.map((e) => e.diff).filter((d): d is number => d != null);
  return {
    edges,
    matchups: phaseMatchups(mine, theirs),
    mismatches: bestMismatches(mine, theirs),
    weakLinks: weakLinks(theirs),
    threats: topThreats(theirs),
    injuries: injuries(theirs),
    tendencies: tendencies(theirs),
    specialTeams: specialTeams(theirs),
    overallGap: diffs.length ? Math.round(diffs.reduce((s, d) => s + d, 0) / diffs.length) : null,
  };
}

export const EDGE_LABEL: Record<EdgeVerdict, string> = {
  "big-edge": "Big edge",
  edge: "Edge",
  even: "Even",
  "their-edge": "Their edge",
  "their-big-edge": "Their big edge",
};

/** Compact starter line for prompts and the copyable call sheet. */
export function starterLine(s: Starter): string {
  const p = s.player;
  return `${s.slot} ${p.name} (${s.overall} OVR${p.year ? `, ${p.year}` : ""})`;
}
