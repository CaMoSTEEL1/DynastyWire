// Deterministic pregame scouting math — the part of the scouting report that must NEVER be
// hallucinated. Everything here is computed in code from the real save (both rosters, the
// league-wide schedule, quarter-by-quarter scoring), so what a coach acts on is the save's
// own data. The model then writes the coaching prose AROUND these tables (buildScoutingSpec).
//
// RATINGS ARE NEVER SURFACED. Real staffs don't have an OVR column — they have film, class,
// production, and a jersey number. Ratings are used here only as an internal ordering signal
// and are translated into scouting language (tiers, unit grades, edge verdicts) before
// anything reaches the UI or the prompt. Keep it that way: no exported helper should return
// a rating, and nothing here should format one into a string.
//
// The rating-derived half is deliberately a rough read — an average of projected starters is
// a proxy for a matchup, not play-by-play truth. The UI says so. The schedule-derived half
// (recent form, common opponents, quarter splits) is hard fact.

import type { RosterPlayer, SnapshotGame, TeamInfo } from "./client";

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

// ── Scouting language ───────────────────────────────────────────────────────────
// Everything below converts an internal rating into how a staff would actually describe a
// player or a unit. These labels are the ONLY rating-derived thing allowed out of this file.

export type Tier =
  | "elite"
  | "all-conference"
  | "quality-starter"
  | "solid-starter"
  | "average-starter"
  | "shaky"
  | "liability";

export const TIER_LABEL: Record<Tier, string> = {
  elite: "elite",
  "all-conference": "all-conference",
  "quality-starter": "quality starter",
  "solid-starter": "solid starter",
  "average-starter": "average starter",
  shaky: "shaky",
  liability: "weak spot",
};

/** How a staff would grade this player on the board. */
export function tierFor(overall: number | null | undefined): Tier {
  const v = overall ?? 0;
  if (v >= 90) return "elite";
  if (v >= 85) return "all-conference";
  if (v >= 80) return "quality-starter";
  if (v >= 75) return "solid-starter";
  if (v >= 70) return "average-starter";
  if (v >= 65) return "shaky";
  return "liability";
}

/** Unit report-card grade. Staffs grade position groups A–F; so do we. */
export function unitGrade(avg: number | null): string | null {
  if (avg == null) return null;
  if (avg >= 90) return "A+";
  if (avg >= 87) return "A";
  if (avg >= 84) return "A-";
  if (avg >= 81) return "B+";
  if (avg >= 78) return "B";
  if (avg >= 75) return "B-";
  if (avg >= 72) return "C+";
  if (avg >= 69) return "C";
  if (avg >= 66) return "C-";
  if (avg >= 62) return "D";
  return "F";
}

/** Class as a staff writes it: Fr. / So. / Jr. / Sr.
 *
 * The parser maps SchoolYear to Fr/So/Jr/Sr but passes anything it doesn't recognise
 * through raw (e.g. "RedshirtFreshman"), so match on the word as well as the abbreviation. */
export function classAbbrev(year: string | null | undefined): string | null {
  const y = (year ?? "").trim().toLowerCase();
  if (!y) return null;
  const redshirt = y.includes("red") || y.startsWith("r");
  if (y.startsWith("fr") || y.includes("fresh")) return redshirt && !y.startsWith("fr") ? "RFr." : "Fr.";
  if (y.startsWith("so") || y.includes("soph")) return "So.";
  if (y.startsWith("jr") || y.startsWith("ju")) return "Jr.";
  if (y.startsWith("sr") || y.startsWith("se")) return "Sr.";
  return year ?? null;
}

const isUnderclass = (year: string | null | undefined) => {
  const a = classAbbrev(year);
  return a === "Fr." || a === "RFr." || a === "So.";
};
const isSenior = (year: string | null | undefined) => classAbbrev(year) === "Sr.";

/** A projected starter with his depth slot, e.g. CB2. */
export interface Starter {
  player: RosterPlayer;
  /** "CB2", "QB1", "LT1" — position plus depth index. */
  slot: string;
  position: string;
  /** Internal ordering signal only — never render this. Use `tier`. */
  overall: number;
  /** How a staff would describe him. This is what the UI and the prompt see. */
  tier: Tier;
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
        tier: tierFor(player.overall),
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

export type EdgeVerdict =
  | "decisive-edge"
  | "clear-edge"
  | "slight-edge"
  | "even"
  | "slight-disadvantage"
  | "clear-disadvantage"
  | "decisive-disadvantage";

export interface UnitEdge {
  unit: UnitKey;
  label: string;
  /** Report-card grades — what the UI shows in place of a rating. */
  myGrade: string | null;
  theirGrade: string | null;
  /** Internal only: mine − theirs in rating points. Never render this. */
  diff: number | null;
  verdict: EdgeVerdict | null;
}

function verdictFor(diff: number): EdgeVerdict {
  if (diff >= 9) return "decisive-edge";
  if (diff >= 5) return "clear-edge";
  if (diff >= 2) return "slight-edge";
  if (diff > -2) return "even";
  if (diff > -5) return "slight-disadvantage";
  if (diff > -9) return "clear-disadvantage";
  return "decisive-disadvantage";
}

/** Unit-by-unit comparison — the table a coach reads before picking a gameplan. Graded, not
 * numbered: a staff says "their line grades out a B+ against our C", not "81 vs 72". */
export function unitEdges(mine: RosterPlayer[], theirs: RosterPlayer[]): UnitEdge[] {
  return (Object.keys(UNIT_POSITIONS) as UnitKey[]).map((unit) => {
    const a = unitRating(mine, unit);
    const b = unitRating(theirs, unit);
    const diff = a != null && b != null ? a - b : null;
    return {
      unit,
      label: UNIT_LABEL[unit],
      myGrade: unitGrade(a),
      theirGrade: unitGrade(b),
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
  /** Graded, not numbered. */
  myGrade: string | null;
  theirGrade: string | null;
  /** Internal only: positive favours the user. Never render this. */
  diff: number | null;
  verdict: EdgeVerdict | null;
  /** The plain-English instruction that falls out of the matchup. */
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
      myGrade: unitGrade(r.ours),
      theirGrade: unitGrade(r.opp),
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
  /** Internal only: rating points in your favour. Never render this. */
  gap: number;
  /** How wide it is, in words: "glaring" | "clear" | "worth testing". */
  severity: "glaring" | "clear" | "worth-testing";
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
    if (gap >= 4) {
      out.push({
        mine: s,
        theirs: weakest,
        gap,
        severity: gap >= 15 ? "glaring" : gap >= 8 ? "clear" : "worth-testing",
      });
    }
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

// ── Schedule-derived scouting (hard fact, not rating math) ──────────────────────
// A real report opens with form and common opponents, not a ratings table. All of this comes
// off the league-wide SeasonGame list the parser already ships.

/** One played game from a given team's point of view. */
export interface FormGame {
  week: number | null;
  /** Opponent's display name, or null when the save has no row for them. */
  opponent: string | null;
  result: "W" | "L" | "T";
  pointsFor: number;
  pointsAgainst: number;
  margin: number;
  home: boolean;
  /** Opponent's poll rank at snapshot time, when they carry one. */
  oppRank: number | null;
}

const played = (g: SnapshotGame) =>
  g.played && g.homeScore != null && g.awayScore != null && g.homeRow != null && g.awayRow != null;

/** Every played game involving `row`, most recent first. */
function gamesFor(games: SnapshotGame[], row: number, teams: Record<string, TeamInfo>): FormGame[] {
  return games
    .filter((g) => played(g) && (g.homeRow === row || g.awayRow === row))
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || (b.week ?? 0) - (a.week ?? 0))
    .map((g) => {
      const home = g.homeRow === row;
      const pf = (home ? g.homeScore : g.awayScore) ?? 0;
      const pa = (home ? g.awayScore : g.homeScore) ?? 0;
      const oppRow = home ? g.awayRow : g.homeRow;
      const opp = oppRow != null ? teams[String(oppRow)] : null;
      return {
        week: g.week,
        opponent: opp?.name ?? null,
        result: pf > pa ? "W" : pf < pa ? "L" : "T",
        pointsFor: pf,
        pointsAgainst: pa,
        margin: pf - pa,
        home,
        oppRank: opp?.rankMedia ?? null,
      } as FormGame;
    });
}

export interface RecentForm {
  games: FormGame[];
  /** e.g. "W3" (three straight wins) or "L1". null with no games. */
  streak: string | null;
  pointsForPerGame: number | null;
  pointsAgainstPerGame: number | null;
  /** Average margin — the single best one-number read on how good they've looked. */
  averageMargin: number | null;
}

/** Their last N results, plus scoring averages across the whole season to date. */
export function recentForm(
  games: SnapshotGame[],
  teams: Record<string, TeamInfo>,
  row: number | null | undefined,
  limit = 4
): RecentForm {
  if (row == null) return { games: [], streak: null, pointsForPerGame: null, pointsAgainstPerGame: null, averageMargin: null };
  const all = gamesFor(games, row, teams);
  if (all.length === 0) return { games: [], streak: null, pointsForPerGame: null, pointsAgainstPerGame: null, averageMargin: null };

  let run = 0;
  for (const g of all) {
    if (g.result !== all[0].result) break;
    run++;
  }
  const avg = (pick: (g: FormGame) => number) =>
    Math.round((all.reduce((s, g) => s + pick(g), 0) / all.length) * 10) / 10;

  return {
    games: all.slice(0, limit),
    streak: `${all[0].result}${run}`,
    pointsForPerGame: avg((g) => g.pointsFor),
    pointsAgainstPerGame: avg((g) => g.pointsAgainst),
    averageMargin: avg((g) => g.margin),
  };
}

export interface CommonOpponent {
  opponent: string;
  /** Your result against them. */
  yours: FormGame;
  /** Their result against them. */
  theirs: FormGame;
  /** Your margin minus theirs — positive means you handled the shared opponent better. */
  swing: number;
}

/** The comparison every real staff runs first: how did each of us do against the same team?
 * Far more honest than comparing records, and it needs no ratings at all. */
export function commonOpponents(
  games: SnapshotGame[],
  teams: Record<string, TeamInfo>,
  myRow: number | null | undefined,
  theirRow: number | null | undefined,
  limit = 3
): CommonOpponent[] {
  if (myRow == null || theirRow == null) return [];
  const mineByOpp = new Map<string, FormGame>();
  for (const g of gamesFor(games, myRow, teams)) {
    // Skip games between the two of us — that's series history, not a common opponent.
    if (g.opponent && !mineByOpp.has(g.opponent)) mineByOpp.set(g.opponent, g);
  }
  const theirName = teams[String(theirRow)]?.name ?? null;
  const myName = teams[String(myRow)]?.name ?? null;

  const out: CommonOpponent[] = [];
  for (const g of gamesFor(games, theirRow, teams)) {
    if (!g.opponent || g.opponent === myName) continue;
    const mine = mineByOpp.get(g.opponent);
    if (!mine || g.opponent === theirName) continue;
    out.push({ opponent: g.opponent, yours: mine, theirs: g, swing: mine.margin - g.margin });
  }
  // Biggest divergence first — that's the informative one.
  return out.sort((a, b) => Math.abs(b.swing) - Math.abs(a.swing)).slice(0, limit);
}

/** Prior meetings between the two programs, most recent first. */
export function seriesHistory(
  games: SnapshotGame[],
  teams: Record<string, TeamInfo>,
  myRow: number | null | undefined,
  theirRow: number | null | undefined,
  limit = 3
): FormGame[] {
  if (myRow == null || theirRow == null) return [];
  return gamesFor(games, myRow, teams)
    .filter((g) => g.opponent === teams[String(theirRow)]?.name)
    .slice(0, limit);
}

export interface QuarterProfile {
  /** Points scored by quarter, per game, [Q1..Q4]. */
  scoredPerQuarter: number[];
  /** Points allowed by quarter, per game. */
  allowedPerQuarter: number[];
  /** Plain-English read: where in the game they actually beat you. */
  read: string | null;
  games: number;
}

/** When in a game they do their damage. Quarter scores are in the save and nobody reads
 * them — a team that outscores everyone in the first quarter and fades is a completely
 * different opponent than one that wins the fourth, and it changes how you manage the game. */
export function quarterProfile(
  games: SnapshotGame[],
  row: number | null | undefined
): QuarterProfile {
  const empty: QuarterProfile = { scoredPerQuarter: [], allowedPerQuarter: [], read: null, games: 0 };
  if (row == null) return empty;
  const rows = games.filter((g) => played(g) && (g.homeRow === row || g.awayRow === row));
  const scored = [0, 0, 0, 0];
  const allowed = [0, 0, 0, 0];
  let counted = 0;
  for (const g of rows) {
    const home = g.homeRow === row;
    const ours = (home ? g.homeQuarters : g.awayQuarters) ?? null;
    const them = (home ? g.awayQuarters : g.homeQuarters) ?? null;
    if (!ours || !them || ours.length < 4 || them.length < 4) continue;
    counted++;
    for (let q = 0; q < 4; q++) {
      scored[q] += ours[q] ?? 0;
      allowed[q] += them[q] ?? 0;
    }
  }
  if (counted === 0) return empty;
  const per = (arr: number[]) => arr.map((v) => Math.round((v / counted) * 10) / 10);
  const s = per(scored);
  const a = per(allowed);

  const firstHalf = s[0] + s[1] - (a[0] + a[1]);
  const secondHalf = s[2] + s[3] - (a[2] + a[3]);
  let read: string;
  if (firstHalf - secondHalf >= 7) {
    read = "Fast starters who fade — they build the lead early and stop scoring. Weather the first quarter and the game comes back to you.";
  } else if (secondHalf - firstHalf >= 7) {
    read = "A second-half team. They hang around, then take it late — do not assume a halftime lead is safe.";
  } else if (s[3] - a[3] >= 4) {
    read = "They win the fourth quarter. Bank points early and protect the ball late.";
  } else if (a[0] - s[0] >= 4) {
    read = "Slow starters — they get scored on in the first quarter. Script your openers and jump them.";
  } else {
    read = "Even across all four quarters — no obvious stretch where they beat you.";
  }
  return { scoredPerQuarter: s, allowedPerQuarter: a, read, games: counted };
}

export interface ExperienceProfile {
  starters: number;
  underclassmen: number;
  seniors: number;
  /** Plain-English read of how veteran the on-field group is. */
  read: string;
}

/** How experienced their starting group is. Young teams beat themselves; senior teams don't. */
export function experienceProfile(roster: RosterPlayer[]): ExperienceProfile {
  const starters = projectedStarters(roster);
  const under = starters.filter((s) => isUnderclass(s.player.year)).length;
  const seniors = starters.filter((s) => isSenior(s.player.year)).length;
  const n = starters.length;
  const share = n > 0 ? under / n : 0;
  const read =
    n === 0
      ? "No depth-chart information."
      : share >= 0.45
        ? `Young group — ${under} of ${n} projected starters are underclassmen. Pressure them early and they'll give you a possession.`
        : seniors / n >= 0.4
          ? `Veteran group — ${seniors} of ${n} projected starters are seniors. They won't beat themselves; you'll have to take it.`
          : `Balanced experience — ${under} underclassmen and ${seniors} seniors among ${n} projected starters.`;
  return { starters: n, underclassmen: under, seniors, read };
}

export interface DropOff {
  slot: string;
  starter: RosterPlayer;
  /** Always present — a spot with no known backup is skipped rather than guessed at. */
  backup: RosterPlayer;
  /** Internal only. */
  gap: number;
}

/** The spots where they cannot afford an injury — a big starter-to-backup fall-off. Real
 * staffs track this because it tells you who to hit and what happens if he leaves. */
export function depthDropOff(roster: RosterPlayer[], limit = 3): DropOff[] {
  const byPos = new Map<string, RosterPlayer[]>();
  for (const p of roster) {
    if (p.overall == null) continue;
    const k = pos(p);
    if (!k || k === "K" || k === "P") continue;
    const list = byPos.get(k);
    if (list) list.push(p);
    else byPos.set(k, [p]);
  }
  const out: DropOff[] = [];
  for (const [k, list] of byPos) {
    list.sort(byOvrDesc);
    const n = ON_FIELD[k] ?? 1;
    const starter = list[0];
    const backup = list[n]; // the first man NOT on the field
    // No backup in the data is NOT the same as no backup on the team: the parser caps a
    // roster at its top 70, so the depth behind a position can simply be cut off. Saying
    // "nothing behind him" off a truncated list would be inventing a weakness.
    if (!starter || !backup) continue;
    const gap = ovr(starter) - ovr(backup);
    // Only a real star with a real fall-off behind him is worth naming.
    if (ovr(starter) >= 80 && gap >= 10) {
      out.push({ slot: n > 1 ? `${k}1` : k, starter, backup, gap });
    }
  }
  return out.sort((a, b) => b.gap - a.gap).slice(0, limit);
}

// ── What they line up in ───────────────────────────────────────────────────────
// The save carries each program's actual system (CurrentOffensiveScheme /
// CurrentDefensiveScheme), and nothing was reading it — so a report could describe a triple-
// option team purely through its yardage. Naming the system is free, and pairing it against
// what they've ACTUALLY called is the useful part: a team in the Air Raid running it 55% of
// the time is a different opponent than the label suggests.

export interface SchemeRead {
  yourOffense: string | null;
  yourDefense: string | null;
  theirOffense: string | null;
  theirDefense: string | null;
  /** Defenders in their base box, from the front in the scheme name. null when unreadable. */
  theirBox: number | null;
  /** One line a coach can act on. Empty when the save gives us nothing. */
  notes: string[];
}

/** "4-2-5" -> 6, "Base 3-4" -> 7, "3-3-5 Tite" -> 6. The first two numbers ARE the front. */
export function boxCount(defScheme: string | null | undefined): number | null {
  const nums = (defScheme ?? "").match(/\d+/g);
  if (!nums || nums.length < 2) return null;
  const box = Number(nums[0]) + Number(nums[1]);
  return box >= 5 && box <= 9 ? box : null;
}

/** Names both systems and says where the label and the play-calling disagree. */
export function schemeRead(
  mineTeam: TeamInfo | null | undefined,
  theirsTeam: TeamInfo | null | undefined,
  theirTendencies: Tendencies
): SchemeRead {
  const theirOffense = theirsTeam?.offScheme ?? null;
  const theirDefense = theirsTeam?.defScheme ?? null;
  const box = boxCount(theirDefense);
  const notes: string[] = [];

  if (theirOffense) {
    const rate = theirTendencies.passRate;
    if (rate == null) {
      notes.push(`They run the ${theirOffense}. No snaps on tape yet this season to check it against.`);
    } else {
      // The label is what they installed; the rate is what they've actually called.
      const passFirst = /air raid|run and shoot|spread|veer/i.test(theirOffense) && !/option/i.test(theirOffense);
      const runFirst = /option|power|pistol|pro|smash/i.test(theirOffense);
      const matches = (passFirst && rate >= 52) || (runFirst && rate <= 48) || (!passFirst && !runFirst);
      notes.push(
        matches
          ? `They run the ${theirOffense} and the tape backs it up — ${rate}% of their plays are passes.`
          : `They're listed in the ${theirOffense}, but they've thrown it on only ${rate}% of their plays. ` +
              "Prepare for what they've called, not what they're supposed to be."
      );
    }
  }

  if (theirDefense) {
    notes.push(
      box == null
        ? `They play a ${theirDefense}.`
        : box <= 6
          ? `They play a ${theirDefense} — ${box} in the box. Light front: the run is there if your line holds up, ` +
            "and they're built to take away the pass."
          : `They play a ${theirDefense} — ${box} in the box. Heavy front: they'll crowd the run and dare you to throw.`
    );
  }

  return {
    yourOffense: mineTeam?.offScheme ?? null,
    yourDefense: mineTeam?.defScheme ?? null,
    theirOffense,
    theirDefense,
    theirBox: box,
    notes,
  };
}

/** Schedule context — the half of the report that needs no ratings at all. */
export interface ScheduleContext {
  form: RecentForm;
  common: CommonOpponent[];
  series: FormGame[];
  quarters: QuarterProfile;
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
  experience: ExperienceProfile;
  dropOffs: DropOff[];
  /** What both teams line up in. Present only when the caller supplies the schedule (which
   * is where the TeamInfo rows carrying the schemes come from). */
  schemes: SchemeRead | null;
  /** Present only when the caller supplies the schedule. */
  schedule: ScheduleContext | null;
  /** Internal only: overall on-field gap, user's perspective. Never render. */
  overallGap: number | null;
  /** The overall gap in words — this is what the UI shows. */
  overallVerdict: EdgeVerdict | null;
}

/** Optional league context so the report can open the way a real one does: form, common
 * opponents, series history, and when in a game they do their damage. */
export interface ScheduleInput {
  games: SnapshotGame[];
  teams: Record<string, TeamInfo>;
  myRow: number | null | undefined;
  theirRow: number | null | undefined;
}

/** Everything deterministic, in one pass — used by both the prompt and the UI so the two
 * can never disagree. */
export function scoutingMath(
  mine: RosterPlayer[],
  theirs: RosterPlayer[],
  schedule?: ScheduleInput
): ScoutingMath {
  const edges = unitEdges(mine, theirs);
  const diffs = edges.map((e) => e.diff).filter((d): d is number => d != null);
  const overallGap = diffs.length ? Math.round(diffs.reduce((s, d) => s + d, 0) / diffs.length) : null;
  const theirTendencies = tendencies(theirs);
  return {
    edges,
    matchups: phaseMatchups(mine, theirs),
    mismatches: bestMismatches(mine, theirs),
    weakLinks: weakLinks(theirs),
    threats: topThreats(theirs),
    injuries: injuries(theirs),
    tendencies: theirTendencies,
    specialTeams: specialTeams(theirs),
    experience: experienceProfile(theirs),
    dropOffs: depthDropOff(theirs),
    schemes: schedule
      ? schemeRead(
          schedule.myRow != null ? schedule.teams[String(schedule.myRow)] : null,
          schedule.theirRow != null ? schedule.teams[String(schedule.theirRow)] : null,
          theirTendencies
        )
      : null,
    schedule: schedule
      ? {
          form: recentForm(schedule.games, schedule.teams, schedule.theirRow),
          common: commonOpponents(schedule.games, schedule.teams, schedule.myRow, schedule.theirRow),
          series: seriesHistory(schedule.games, schedule.teams, schedule.myRow, schedule.theirRow),
          quarters: quarterProfile(schedule.games, schedule.theirRow),
        }
      : null,
    overallGap,
    overallVerdict: overallGap == null ? null : verdictFor(overallGap),
  };
}

export const EDGE_LABEL: Record<EdgeVerdict, string> = {
  "decisive-edge": "Decisive edge",
  "clear-edge": "Clear edge",
  "slight-edge": "Slight edge",
  even: "Even",
  "slight-disadvantage": "Slight disadvantage",
  "clear-disadvantage": "Clear disadvantage",
  "decisive-disadvantage": "Decisive disadvantage",
};

export const SEVERITY_LABEL: Record<Mismatch["severity"], string> = {
  glaring: "glaring",
  clear: "clear",
  "worth-testing": "worth testing",
};

/** How a staff writes a player on a call sheet: jersey, name, class. No rating, ever. */
export function playerLine(p: RosterPlayer): string {
  const jersey = p.jersey != null ? `#${p.jersey} ` : "";
  const cls = classAbbrev(p.year);
  return `${jersey}${p.name}${cls ? ` (${cls})` : ""}`;
}

/** Starter as the report names him: slot, jersey, name, class. Pass `withTier` for the
 * board grade in words — never a number. */
export function starterLine(s: Starter, withTier = false): string {
  const base = `${s.slot} ${playerLine(s.player)}`;
  return withTier ? `${base} — ${TIER_LABEL[s.tier]}` : base;
}

/** A form game as a staff writes it: "W 34-17 vs Tulane" / "L 21-28 at #12 Georgia". */
export function formLine(g: FormGame): string {
  const rank = g.oppRank ? `#${g.oppRank} ` : "";
  const where = g.home ? "vs" : "at";
  return `${g.result} ${g.pointsFor}-${g.pointsAgainst} ${where} ${rank}${g.opponent ?? "—"}`;
}
