// Deterministic core for the national desk — the v2 port of the worst-measured surface.
//
// The first real fact-check run scored `national-wire` at 10 violations in a single piece,
// every one an invented person, against 0.5 for the ported recap. The cause was not the
// model: `buildNationalWireSpec` told it to "INVENT realistic fictional ones" for any name
// it wasn't given, while SYSTEM_PROMPT calls an unlisted other-team name a hard error. The
// surface was following one instruction and violating the other.
//
// This module removes the need to invent. The save holds every program's roster and every
// program's real head coach, so code picks which teams the wire will cover and hands the
// writer their actual people. What it cannot supply, it says plainly — and the prompt falls
// back to role-only rather than invention.
//
// Same contract as scouting.ts and recap.ts: code owns the names, the model owns the story.

import type { DynastySnapshot, GameResult, RosterPlayer, TeamInfo, WeekDelta } from "./client";
import { classAbbrev } from "./scouting";

/** A program the wire is licensed to write about this week, and why it's in the news. */
export interface CoveredTeam {
  name: string;
  teamIndex: number | null;
  record: string;
  rank: number | null;
  headCoach: string | null;
  /** Why code selected it — the angle that is legitimately available. */
  why: string;
  /** Real players, when a roster was supplied for this team. */
  cast: { name: string; role: string; line: string | null }[];
}

export interface NationalInput {
  snapshot: DynastySnapshot;
  delta: WeekDelta | null;
  /** The user's own program — the wire never covers it; the rest of the app does. */
  userTeam: string | null;
  /** teamIndex -> that team's roster, for whichever teams the caller could afford to load.
   * Missing teams are still coverable, by role only. */
  rosters?: Record<string, RosterPlayer[]>;
  /** How many programs the wire may name people from. Each roster costs a full save parse,
   * so this is a real budget, not a formality. */
  limit?: number;
}

const num = (v: number | null | undefined) => (typeof v === "number" ? v : 0);

function rankOf(t: TeamInfo): number | null {
  const r = t.rankMedia ?? t.rankCoaches ?? t.rankCFP;
  return typeof r === "number" && r >= 1 && r <= 25 ? r : null;
}

/** The head coach the save says runs a program. Never guessed. */
function coachOf(snapshot: DynastySnapshot, t: TeamInfo): string | null {
  if (t.teamIndex == null) return null;
  return snapshot.headCoaches?.[String(t.teamIndex)] ?? null;
}

function roleOf(p: RosterPlayer): string {
  const cls = classAbbrev(p.year);
  const year = cls ? `${cls.replace(".", "")} ` : "";
  const pos = (p.position ?? "").toUpperCase();
  const label: Record<string, string> = {
    QB: "quarterback", HB: "running back", RB: "running back", FB: "fullback",
    WR: "receiver", TE: "tight end", LT: "left tackle", RT: "right tackle",
    LG: "guard", RG: "guard", C: "center", LE: "defensive end", RE: "defensive end",
    DE: "defensive end", DT: "defensive tackle", MLB: "linebacker", LOLB: "linebacker",
    ROLB: "linebacker", LB: "linebacker", CB: "cornerback", FS: "safety", SS: "safety",
    S: "safety", K: "kicker", P: "punter",
  };
  return `${year}${label[pos] ?? (pos ? pos.toLowerCase() : "player")}`.trim();
}

/** Season production, explicitly labelled — the save has no per-game box score. */
function lineOf(p: RosterPlayer): string | null {
  const s = p.stats;
  if (!s) return null;
  const o = s.offense ?? (s.side === "offense" ? s : null);
  const d = s.defense ?? (s.side === "defense" ? s : null);
  const bits: string[] = [];
  if (o) {
    if (num(o.passAtt)) bits.push(`${num(o.passYds)} pass yds, ${num(o.passTDs)} TD`);
    if (num(o.rushAtt) || num(o.rushYds)) bits.push(`${num(o.rushYds)} rush yds, ${num(o.rushTDs)} TD`);
    if (num(o.recCatches)) bits.push(`${num(o.recCatches)} rec, ${num(o.recYds)} yds`);
  }
  if (d) {
    const dd: string[] = [];
    if (num(d.tackles)) dd.push(`${num(d.tackles)} tkl`);
    if (num(d.sacks)) dd.push(`${num(d.sacks)} sacks`);
    if (num(d.ints)) dd.push(`${num(d.ints)} INT`);
    if (dd.length) bits.push(dd.join(", "));
  }
  return bits.length ? `season: ${bits.join("; ")}` : null;
}

/** The handful of players from one program the wire could plausibly write about. */
function castOf(roster: RosterPlayer[], limit = 4): CoveredTeam["cast"] {
  const best = (key: (p: RosterPlayer) => number) =>
    roster.filter((p) => key(p) > 0).sort((a, b) => key(b) - key(a))[0];
  const picked = new Map<string, RosterPlayer>();
  const take = (p?: RosterPlayer) => {
    if (p && !picked.has(p.name)) picked.set(p.name, p);
  };
  const side = (p: RosterPlayer, k: "offense" | "defense") =>
    p.stats?.[k] ?? (p.stats?.side === k ? p.stats : null);

  take(best((p) => num(side(p, "offense")?.passYds)));
  take(best((p) => num(side(p, "offense")?.rushYds)));
  take(best((p) => num(side(p, "offense")?.recYds)));
  take(best((p) => num(side(p, "defense")?.sacks) * 10 + num(side(p, "defense")?.tackles)));
  // Early season, or any program whose stat table the save didn't carry: fall back to the
  // depth chart. These are still real names — better than licensing invention.
  if (picked.size < 2) {
    for (const p of [...roster].sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0)).slice(0, limit)) {
      take(p);
    }
  }
  return [...picked.values()]
    .slice(0, limit)
    .map((p) => ({ name: p.name, role: roleOf(p), line: lineOf(p) }));
}

export interface NationalFacts {
  covered: CoveredTeam[];
  /** This week's real results between ranked teams, for items that cite an outcome. */
  results: GameResult[];
  /** Programs the wire may mention but has no roster for — role-only. */
  rosterless: string[];
}

/**
 * Which programs the wire covers this week, and who it may name in each. Selection is by
 * newsworthiness the save can actually prove: the top of the poll, and whoever was involved
 * in a ranked result this week.
 */
export function nationalFacts(input: NationalInput): NationalFacts {
  const { snapshot, delta, userTeam } = input;
  const limit = input.limit ?? 6;
  const teams = Object.values(snapshot.teams ?? {}).filter((t) => t?.name && t.name !== userTeam);

  const picked = new Map<string, { team: TeamInfo; why: string }>();
  const take = (t: TeamInfo | undefined, why: string) => {
    if (!t?.name || t.name === userTeam || picked.has(t.name)) return;
    picked.set(t.name, { team: t, why });
  };

  // Teams that played a ranked opponent this week lead — those items can cite a real result.
  const results = (delta?.results ?? []).filter(
    (r) => (r.rankHome != null && r.rankHome <= 25) || (r.rankAway != null && r.rankAway <= 25)
  );
  for (const r of results) {
    const upset =
      (r.rankAway == null && r.rankHome != null && r.winner === r.away) ||
      (r.rankHome == null && r.rankAway != null && r.winner === r.home);
    for (const name of [r.winner, r.loser]) {
      take(teams.find((t) => t.name === name), upset ? "in a ranked upset this week" : "played a ranked game this week");
    }
  }
  // Then the top of the poll — always news, result or not.
  for (const t of teams.filter((t) => rankOf(t) != null).sort((a, b) => (rankOf(a) ?? 99) - (rankOf(b) ?? 99))) {
    take(t, `#${rankOf(t)} in the poll`);
  }

  const rosters = input.rosters ?? {};
  const covered: CoveredTeam[] = [];
  const rosterless: string[] = [];
  for (const { team, why } of [...picked.values()].slice(0, limit)) {
    const roster = team.teamIndex != null ? rosters[String(team.teamIndex)] : undefined;
    const cast = roster?.length ? castOf(roster) : [];
    if (!cast.length) rosterless.push(team.name);
    covered.push({
      name: team.name,
      teamIndex: team.teamIndex,
      record: `${team.wins ?? 0}-${team.losses ?? 0}`,
      rank: rankOf(team),
      headCoach: coachOf(snapshot, team),
      why,
      cast,
    });
  }
  return { covered, results, rosterless };
}

/** The teams whose rosters are worth loading, in priority order — what the caller should
 * fetch before generating. Exported so the fetch and the prompt can never disagree about
 * which programs matter this week. */
export function teamsToLoad(input: NationalInput): number[] {
  return nationalFacts({ ...input, rosters: {} })
    .covered.map((c) => c.teamIndex)
    .filter((i): i is number => i != null);
}

/** The locked block the national-wire prompt is built around. */
export function nationalBrief(facts: NationalFacts): string {
  const parts: string[] = [];
  parts.push("=== THE PROGRAMS IN THE NEWS THIS WEEK (real, from the save) ===");
  parts.push(
    "  These are the ONLY people you may name for these programs. A name not listed here does",
    "  not exist — write the role instead (\"their quarterback\", \"the head coach at Tulane\")."
  );
  for (const c of facts.covered) {
    const head = `  ${c.rank ? `#${c.rank} ` : ""}${c.name} (${c.record}) — ${c.why}`;
    parts.push(head);
    if (c.headCoach) parts.push(`      HC ${c.headCoach}`);
    for (const m of c.cast) {
      parts.push(`      ${m.name} — ${m.role}${m.line ? ` · ${m.line}` : ""}`);
    }
    if (!c.cast.length) parts.push("      (no roster loaded — refer to their players by role only)");
  }
  if (facts.rosterless.length) {
    parts.push("");
    parts.push(
      `  NO PLAYER NAMES EXIST for: ${facts.rosterless.join(", ")}. Cover them by role only.`
    );
  }
  parts.push("");
  parts.push("=== INVENTED PEOPLE ARE STILL YOURS ===");
  parts.push(
    "  Reporters, sources, boosters, fans, agents and analysts are fiction and always were —",
    "  invent them freely. The restriction above is ONLY about players and coaches, who are",
    "  real people in this save."
  );
  return parts.join("\n");
}
