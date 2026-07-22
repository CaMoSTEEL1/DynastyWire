// Player market valuation — DynastyWire's own NIL estimate. The save's BaseNILValue badly
// under-credits stars (a national-champion starting QB read at ~$185K), so we compute a
// market value from the signals that actually drive NIL: rating, POSITION (quarterbacks
// command a class of their own), real production, class/experience, and how good — and how
// visible — the program is. The save's own value is only ever a floor.
//
// Everything is transparent and deterministic: the same player on the same team always
// values the same. Output is in thousands of dollars ($K), matching the NIL page.

import type { RosterPlayer, RosterStats, TeamInfo } from "./client";

// Rating → base value ($K). NIL scales super-linearly with talent: role players are cheap,
// blue-chip starters are exponentially pricier. Anchored so a 90 OVR ≈ $540K base before
// any position/program premium, a 99 ≈ ~$2M base.
function baseFromOverall(ovr: number): number {
  const clamped = Math.max(40, Math.min(99, ovr));
  return 3 * Math.pow(1.16, clamped - 55);
}

// Position premium. Quarterbacks are the face of the program and the NIL market reflects it;
// skill positions and edge rushers follow; interior/role positions and specialists trail.
const POSITION_MULT: Record<string, number> = {
  QB: 2.6,
  WR: 1.45,
  HB: 1.3, RB: 1.3,
  TE: 1.1,
  LE: 1.2, RE: 1.2, EDGE: 1.2,
  CB: 1.2,
  DT: 1.05,
  LOLB: 1.05, MLB: 1.05, ROLB: 1.05, LB: 1.05,
  FS: 1.0, SS: 1.0, S: 1.0,
  LT: 0.95, RT: 0.95, LG: 0.85, RG: 0.85, C: 0.85, OL: 0.9,
  FB: 0.7,
  K: 0.5, P: 0.45,
};

function positionMult(pos: string | null | undefined): number {
  if (!pos) return 1;
  return POSITION_MULT[pos.toUpperCase()] ?? 1;
}

// Program premium — a title contender's players are on national TV every week, so their
// NIL runs hot. Blends poll visibility with program prestige.
function programMult(team: TeamInfo | null | undefined): number {
  if (!team) return 1;
  let m = 1;
  const rank = team.rankCFP ?? team.rankMedia ?? null;
  if (rank != null && rank >= 1) {
    if (rank === 1) m += 0.6;
    else if (rank <= 4) m += 0.4;
    else if (rank <= 10) m += 0.25;
    else if (rank <= 25) m += 0.12;
  }
  if (team.prestige != null) m += (Math.max(0, Math.min(10, team.prestige)) - 5) * 0.03; // ±0.15
  const gp = team.wins + team.losses;
  if (gp > 0) m += ((team.wins / gp) - 0.5) * 0.3; // undefeated ≈ +0.15, winless ≈ −0.15
  return Math.max(0.7, m);
}

// Class factor — an established upperclassman has a real brand; true freshmen (unless elite)
// haven't cashed in yet. Kept mild so it never dominates talent.
function classMult(year: string | null | undefined): number {
  if (!year) return 1;
  const y = year.toUpperCase();
  if (/(^|\b)(SR|SENIOR|RS SR|RS-SR)/.test(y)) return 1.12;
  if (/(^|\b)(JR|JUNIOR|RS JR|RS-JR)/.test(y)) return 1.08;
  if (/(^|\b)(SO|SOPH|RS SO|RS-SO)/.test(y)) return 1.0;
  if (/(^|\b)(FR|FRESH)/.test(y)) return 0.88;
  return 1;
}

// Production premium — real output this season lifts value on top of raw rating, so a
// productive starter outvalues an equally-rated backup. Returns a small multiplier (≤ ~1.5x).
function productionMult(stats: RosterStats | null | undefined): number {
  if (!stats) return 1;
  const o = stats.offense ?? stats;
  const d = stats.defense ?? stats;
  let score = 0;
  score += (o.passYds ?? 0) / 3000;       // a 3,000-yard passer ≈ +1.0
  score += (o.passTDs ?? 0) / 30;
  score += (o.rushYds ?? 0) / 1200;
  score += (o.rushTDs ?? 0) / 15;
  score += (o.recYds ?? 0) / 1100;
  score += (o.recTDs ?? 0) / 12;
  score += (d.sacks ?? 0) / 10;
  score += (d.ints ?? 0) / 5;
  score += (d.tackles ?? 0) / 100;
  return 1 + Math.min(0.5, score * 0.18); // cap the production lift at +50%
}

// Round to a clean, readable figure ($K): finer steps when small, coarser as it grows.
function niceRound(k: number): number {
  if (k < 50) return Math.max(1, Math.round(k / 5) * 5);
  if (k < 200) return Math.round(k / 10) * 10;
  if (k < 1000) return Math.round(k / 25) * 25;
  return Math.round(k / 50) * 50;
}

/**
 * DynastyWire's estimated NIL market value for a player, in $K. Never returns less than the
 * save's own BaseNILValue — our estimate is a floor-raising correction, not a downgrade.
 */
export function playerMarketValue(p: RosterPlayer, team: TeamInfo | null | undefined): number {
  const ovr = p.overall ?? 60;
  const raw =
    baseFromOverall(ovr) *
    positionMult(p.position) *
    programMult(team) *
    classMult(p.year) *
    productionMult(p.stats);
  const computed = niceRound(raw);
  const floor = p.nilBaseValue ?? 0;
  return Math.max(computed, floor);
}
