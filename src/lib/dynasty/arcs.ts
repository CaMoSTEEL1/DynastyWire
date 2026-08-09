// STORYLINES+ — the arcs a season actually produces, found rather than invented.
//
// The Situation Room (pressure.ts) handles what goes wrong off the field. This handles the
// other half of a real season: the one or two players whose year becomes a STORY. Not a
// generated "rising star" template — the specific, verifiable anomalies that make people
// argue about a player for months.
//
// The reference cases are real and recent, and each is a different SHAPE:
//   - Travis Hunter: a man who plays both ways at a level that shouldn't be possible.
//   - Jeremiah Smith / Malachi Toney: a true freshman who is immediately the best option
//     on the field, which the sport is supposed to make impossible.
//   - Back-to-back award winners: the story stops being "is he good" and becomes "where
//     does he rank all-time", which is a completely different kind of coverage.
//
// Every arc here is COMPUTED. The claim comes with the numbers that prove it, and the model
// writes around them. That is the whole difference between a storyline that makes a user say
// "that's MY guy" and one that makes them say "the AI wrote something."
//
// The branching is deterministic too, and it is the point of the "+". An arc is not a fact,
// it is a fact that has SURVIVED — three weeks of holding up is a different story from one
// hot Saturday, and a collapse is the most interesting chapter of all. See chapterOf().

import type { LeagueAward, RosterPlayer, RosterStats, RosterStatsSide } from "./client";
import type { SeasonRecord } from "./archive";

export type ArcKind =
  | "two-way"
  | "freshman-phenom"
  | "repeat-winner"
  | "unrecruited"
  | "iron-man"
  | "resurrection";

/**
 * Where an arc is in its life. This is what makes it a storyline instead of a stat.
 *
 * Ordering matters — a chapter never goes backwards except through `broken`, because a
 * story that quietly downgrades itself reads as the app forgetting what it said last week.
 */
export type ArcChapter = "claim" | "proof" | "spotlight" | "target" | "broken" | "legend";

export const CHAPTER_LABEL: Record<ArcChapter, string> = {
  claim: "The Claim",
  proof: "The Proof",
  spotlight: "The Spotlight",
  target: "The Target",
  broken: "The Reckoning",
  legend: "The Legend",
};

/** How the beat is supposed to treat this chapter. Written for a writer, not a database. */
const CHAPTER_ANGLE: Record<ArcChapter, string> = {
  claim:
    "Brand new. The number is real but nobody has decided what it MEANS yet — the take is " +
    "half disbelief, half small-sample caution, and somebody is definitely saying it won't last.",
  proof:
    "It has held. The doubters need a new argument, and the story shifts from whether it is " +
    "real to how far it goes.",
  spotlight:
    "National. He is no longer this program's story, he is the sport's — and that changes who " +
    "is writing about him and how his own locker room talks about it.",
  target:
    "Everyone is game-planning him now and he is still doing it. The angle is the weight: " +
    "what it costs to be the thing every defensive coordinator spends their week on.",
  broken:
    "It stopped. That is a REAL chapter, not a failure to write about — the fall is the most " +
    "human part of the story, and the coverage should treat it seriously rather than gloating.",
  legend:
    "Settled. This is no longer a season story, it is a program-history story, and it gets " +
    "compared to the past rather than to the present.",
};

export interface PlayerArc {
  kind: ArcKind;
  player: string;
  position: string | null;
  classYear: string | null;
  /** The claim, stated as fact because it is one. */
  claim: string;
  /** Every number behind it. The writer may not exceed these. */
  evidence: string[];
  /** Rarity. Orders the board and decides how loudly this gets played. */
  weight: number;
  /** What pushes it forward — the branch the user can actually affect. */
  advancesIf: string;
  /** What kills it. Stated so a collapse is a chapter rather than a silence. */
  collapsesIf: string;
}

/** What we remember about an arc between weeks. Small on purpose — it is a save file. */
export interface ArcMemory {
  key: string;
  firstSeenYear: number;
  firstSeenWeek: number;
  /** Weeks the arc has been detected, not weeks elapsed. A bye does not age a story. */
  weeksHeld: number;
  /** Highest weight it ever reached, so a dip does not erase what it was. */
  peakWeight: number;
  /** True once it has failed to appear after being established. */
  broken: boolean;
  lastSeenWeek: number;
  lastSeenYear: number;
}

export interface LiveArc extends PlayerArc {
  chapter: ArcChapter;
  /** How the beat should play this chapter. */
  angle: string;
  weeksHeld: number;
}

export const arcKey = (a: { kind: ArcKind; player: string }): string => `${a.kind}::${a.player.toLowerCase()}`;

// ── The numbers ────────────────────────────────────────────────────────────────

const n = (v: number | null | undefined): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

const FRESHMAN = /^(fr|rs fr|freshman|redshirt freshman)/i;

function scrimmageYards(s: RosterStats | null | undefined): number {
  if (!s) return 0;
  const o = s.offense ?? s;
  return n(o.rushYds) + n(o.recYds);
}

function totalTDs(s: RosterStats | null | undefined): number {
  if (!s) return 0;
  const o = s.offense ?? s;
  return n(o.rushTDs) + n(o.recTDs) + n(o.passTDs) + n(s.kickRetTDs) + n(s.puntRetTDs);
}

function defProduction(s: RosterStats | null | undefined): number {
  if (!s) return 0;
  const d = s.defense ?? s;
  return n(d.tackles) + n(d.sacks) * 3 + n(d.ints) * 5 + n(d.deflections);
}

const games = (s: RosterStats | null | undefined): number => Math.max(1, n(s?.gamesPlayed));

// ── The detectors ──────────────────────────────────────────────────────────────
//
// Each returns at most a handful, and each requires a genuinely unusual number. A detector
// that fires on half the roster produces a "storyline" nobody believes, which is worse than
// no storyline at all — so the thresholds are deliberately mean.

/**
 * A man playing both ways, at a level that means it. The parser already flags `twoWay` when
 * a player logged games on both sides; that alone is a special-teams gunner, so the bar here
 * is real production on BOTH — the thing that made Travis Hunter an argument rather than a
 * curiosity.
 */
function twoWay(roster: RosterPlayer[]): PlayerArc[] {
  return roster
    .filter((p) => p.stats?.twoWay && scrimmageYards(p.stats) >= 150 && defProduction(p.stats) >= 25)
    .map((p) => {
      const s = p.stats!;
      const off: RosterStatsSide = s.offense ?? s;
      const def: RosterStatsSide = s.defense ?? s;
      return {
        kind: "two-way" as const,
        player: p.name,
        position: p.position,
        classYear: p.year,
        claim: `${p.name} is playing both ways — and producing on both.`,
        evidence: [
          `Offense: ${n(off.recCatches) ? `${n(off.recCatches)} catches for ${n(off.recYds)} yds` : `${n(off.rushYds)} rush yds`}, ${n(off.recTDs) + n(off.rushTDs)} TD`,
          `Defense: ${n(def.tackles)} tackles${n(def.ints) ? `, ${n(def.ints)} INT` : ""}${n(def.sacks) ? `, ${n(def.sacks)} sacks` : ""}${n(def.deflections) ? `, ${n(def.deflections)} PBU` : ""}`,
          `${n(s.gamesPlayed)} games played`,
        ],
        weight: 100 + Math.floor(scrimmageYards(s) / 20) + defProduction(s),
        advancesIf: "he keeps the snap count on both sides while the production holds",
        collapsesIf: "one side of the ball starts eating the other — the yards or the tackles fall away",
      };
    });
}

/**
 * A true freshman who is already the best option on the field. The sport is built to make
 * this rare: a freshman is supposed to be developing, not leading. When one leads the team
 * outright, that IS the story of the season.
 */
function freshmanPhenom(roster: RosterPlayer[]): PlayerArc[] {
  const teamBestScrimmage = Math.max(0, ...roster.map((p) => scrimmageYards(p.stats)));
  return roster
    .filter((p) => FRESHMAN.test(p.year ?? "") && p.stats)
    .filter((p) => {
      const yds = scrimmageYards(p.stats);
      // Either he leads the team, or he is putting up a number that would lead most teams.
      return (yds > 0 && yds >= teamBestScrimmage) || yds >= 600 || totalTDs(p.stats) >= 6;
    })
    .map((p) => {
      const s = p.stats!;
      const yds = scrimmageYards(s);
      const leads = yds >= teamBestScrimmage && yds > 0;
      return {
        kind: "freshman-phenom" as const,
        player: p.name,
        position: p.position,
        classYear: p.year,
        claim: leads
          ? `${p.name} is a true freshman and leads this team in yards from scrimmage.`
          : `${p.name} is a true freshman putting up numbers freshmen do not put up.`,
        evidence: [
          `${yds} yards from scrimmage, ${totalTDs(s)} total TD, in ${n(s.gamesPlayed)} games`,
          leads ? "That is the most on the roster — ahead of every upperclassman." : `${Math.round(yds / games(s))} yards a game.`,
          `Class: ${p.year ?? "freshman"}.`,
        ],
        weight: 80 + Math.floor(yds / 25) + totalTDs(s) * 4 + (leads ? 25 : 0),
        advancesIf: "he stays the first option as the schedule gets harder",
        collapsesIf: "the touches dry up, or the production falls off once teams adjust to him",
      };
    });
}

/**
 * The same man winning the same thing twice. Once he has done that, the conversation stops
 * being about this season — it becomes about where he sits in the program's history, which
 * is a different beat entirely.
 */
function repeatWinner(awards: LeagueAward[], archive: SeasonRecord[], team: string): PlayerArc[] {
  // From the ARCHIVE's own award list, not its stat leaders. The save carries only this
  // year's winners, so a previous season's are knowable only because we kept them.
  const priorWins = new Map<string, { award: string; years: number[] }>();
  for (const season of archive) {
    for (const won of season.awards ?? []) {
      if (!won?.name || !won.award) continue;
      const key = `${won.name}::${won.award}`;
      const held = priorWins.get(key) ?? { award: won.award, years: [] };
      held.years.push(season.year);
      priorWins.set(key, held);
    }
  }

  const out: PlayerArc[] = [];
  for (const a of awards) {
    if (!a.name || !a.award) continue;
    if (a.school && team && a.school !== team) continue;
    const prior = priorWins.get(`${a.name}::${a.award}`);
    if (!prior?.years.length) continue;
    const years = [...new Set(prior.years)].sort();
    out.push({
      kind: "repeat-winner",
      player: a.name,
      position: a.position,
      classYear: null,
      claim: `${a.name} has now won the ${a.award} more than once.`,
      evidence: [
        `Previous: ${years.join(", ")}.`,
        `And again this season.`,
        a.position ? `Position: ${a.position}.` : "",
      ].filter(Boolean),
      weight: 140 + years.length * 20,
      advancesIf: "he finishes the season without anyone catching him",
      collapsesIf: "nothing — this one is already in the record book. It only grows.",
    });
  }
  return out;
}

/**
 * The anomaly. A player whose production has no relationship to what he was supposed to be —
 * the walk-on, the two-star, the man nobody wanted who is now the best player on the field.
 * Detected on the gap between his rating and his output rather than on either alone, because
 * a highly-rated star producing is not a story.
 */
function unrecruited(roster: RosterPlayer[]): PlayerArc[] {
  return roster
    .filter((p) => p.stats && n(p.overall) > 0 && n(p.overall) <= 78)
    .map((p) => {
      const yds = scrimmageYards(p.stats);
      const def = defProduction(p.stats);
      return { p, yds, def, score: Math.max(yds / 8, def) };
    })
    .filter((x) => x.score >= 60)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map(({ p, yds, def }) => ({
      kind: "unrecruited" as const,
      player: p.name,
      position: p.position,
      classYear: p.year,
      claim: `${p.name} is producing like a star nobody projected as one.`,
      evidence: [
        yds >= def ? `${yds} yards from scrimmage, ${totalTDs(p.stats)} TD` : `${n(p.stats?.defense?.tackles)} tackles, ${n(p.stats?.defense?.sacks)} sacks, ${n(p.stats?.defense?.ints)} INT`,
        `He is doing it while the depth chart says he is not one of the headline names.`,
        `${n(p.stats?.gamesPlayed)} games, ${n(p.stats?.gamesStarted)} starts.`,
      ],
      weight: 70 + Math.floor(Math.max(yds / 10, def)),
      advancesIf: "he keeps producing once he is scouted as a starter rather than a surprise",
      collapsesIf: "the tape gets out and the production stops",
    }));
}

/**
 * The man who never comes off the field. Snap counts are in the save per game, and an
 * outlier there is a real, physical story — the thing that gets brought up every time he
 * makes a mistake in the fourth quarter.
 */
function ironMan(roster: RosterPlayer[]): PlayerArc[] {
  const snapsOf = (p: RosterPlayer) => n(p.gameLine?.snaps as number | undefined);
  const ranked = roster.filter((p) => snapsOf(p) > 0).sort((a, b) => snapsOf(b) - snapsOf(a));
  const top = ranked[0];
  if (!top || snapsOf(top) < 110) return [];
  return [
    {
      kind: "iron-man",
      player: top.name,
      position: top.position,
      classYear: top.year,
      claim: `${top.name} barely leaves the field.`,
      evidence: [
        `${snapsOf(top)} snaps in the most recent game — the most on the roster.`,
        ranked[1] ? `Next-closest: ${ranked[1].name} at ${snapsOf(ranked[1])}.` : "",
      ].filter(Boolean),
      weight: 55 + Math.floor(snapsOf(top) / 4),
      advancesIf: "the workload holds up deep into the season",
      collapsesIf: "he breaks down, or the staff finally takes him off the field",
    },
  ];
}

/**
 * The comeback. Someone who was nothing in the archive and is everything now — the arc that
 * needs year-over-year memory to see at all, which is exactly why it never got written before.
 */
function resurrection(roster: RosterPlayer[], archive: SeasonRecord[]): PlayerArc[] {
  const lastSeason = [...archive].sort((a, b) => b.year - a.year)[0];
  if (!lastSeason) return [];
  const before = new Map(
    (lastSeason.roster ?? []).map((r) => [r.name.toLowerCase(), r])
  );
  return roster
    .filter((p) => p.stats)
    .map((p) => ({ p, was: before.get(p.name.toLowerCase()) }))
    .filter(({ p, was }) => {
      if (!was) return false;
      const thenYds = n(was.rushYds) + n(was.recYds);
      const nowYds = scrimmageYards(p.stats);
      // Nothing last year, a real load this year. Both halves matter — a player who was
      // already good is not a resurrection, he is just good.
      return thenYds < 150 && nowYds >= 500;
    })
    .slice(0, 2)
    .map(({ p, was }) => ({
      kind: "resurrection" as const,
      player: p.name,
      position: p.position,
      classYear: p.year,
      claim: `${p.name} was an afterthought last season and is carrying this one.`,
      evidence: [
        `${lastSeason.year}: ${n(was!.rushYds) + n(was!.recYds)} yards from scrimmage in ${n(was!.gamesPlayed)} games.`,
        `This season: ${scrimmageYards(p.stats)} yards, ${totalTDs(p.stats)} TD.`,
      ],
      weight: 75 + Math.floor(scrimmageYards(p.stats) / 25),
      advancesIf: "the new version of him is the real one and it lasts the season",
      collapsesIf: "he reverts to what the archive says he was",
    }));
}

export interface ArcInput {
  roster: RosterPlayer[];
  archive: SeasonRecord[];
  awards: LeagueAward[];
  team: string;
}

/**
 * Every arc this roster genuinely supports, best first.
 *
 * Capped hard. A board of nine "storylines" is a board of none — the point is that a user
 * reads this and recognises the one or two guys their season is actually about.
 */
export function detectArcs(input: ArcInput): PlayerArc[] {
  const { roster, archive, awards, team } = input;
  const all = [
    ...twoWay(roster),
    ...repeatWinner(awards ?? [], archive ?? [], team),
    ...freshmanPhenom(roster),
    ...resurrection(roster, archive ?? []),
    ...unrecruited(roster),
    ...ironMan(roster),
  ];
  // One arc per player. A man who is both a freshman phenom and an iron man is one story
  // told twice, and the heavier framing is always the better one.
  const bestPerPlayer = new Map<string, PlayerArc>();
  for (const a of all.sort((x, y) => y.weight - x.weight)) {
    const key = a.player.toLowerCase();
    if (!bestPerPlayer.has(key)) bestPerPlayer.set(key, a);
  }
  return [...bestPerPlayer.values()].slice(0, 4);
}

// ── The branch ─────────────────────────────────────────────────────────────────

/**
 * Which chapter an arc is in, from what has actually happened to it.
 *
 * This is the "+" in Storylines+. The same detected fact is a different story in week 2 than
 * in week 10, and a story that STOPPED is the most interesting version of all — so a broken
 * arc is still returned, still written about, rather than vanishing and leaving the beat
 * looking like it forgot a man it spent a month on.
 */
export function chapterOf(
  arc: PlayerArc,
  memory: ArcMemory | null | undefined,
  context: { ranked: boolean; seasonOver: boolean }
): ArcChapter {
  if (memory?.broken) return "broken";
  const held = memory?.weeksHeld ?? 1;
  if (context.seasonOver && held >= 4) return "legend";
  if (arc.kind === "repeat-winner") return held >= 2 ? "legend" : "spotlight";
  if (held >= 7) return "target";
  if (held >= 4) return context.ranked ? "spotlight" : "proof";
  if (held >= 2) return "proof";
  return "claim";
}

/**
 * Fold this week's detections into what we already knew.
 *
 * An arc that was established and has now stopped appearing is marked broken rather than
 * deleted. An arc that never established (one week, then gone) is simply dropped — every hot
 * Saturday is not a storyline, and treating one as a collapse would make the beat hysterical.
 */
export function advanceArcs(
  prior: ArcMemory[],
  found: PlayerArc[],
  at: { year: number; week: number }
): ArcMemory[] {
  const byKey = new Map(prior.map((m) => [m.key, { ...m }]));
  const seen = new Set<string>();

  for (const arc of found) {
    const key = arcKey(arc);
    seen.add(key);
    const held = byKey.get(key);
    if (!held) {
      byKey.set(key, {
        key,
        firstSeenYear: at.year,
        firstSeenWeek: at.week,
        weeksHeld: 1,
        peakWeight: arc.weight,
        broken: false,
        lastSeenWeek: at.week,
        lastSeenYear: at.year,
      });
      continue;
    }
    // Same week twice (a re-parse, a revisit) must not inflate the count — that is how a
    // week-two story claims to have held for a month.
    const sameWeek = held.lastSeenWeek === at.week && held.lastSeenYear === at.year;
    byKey.set(key, {
      ...held,
      weeksHeld: sameWeek ? held.weeksHeld : held.weeksHeld + 1,
      peakWeight: Math.max(held.peakWeight, arc.weight),
      broken: false,
      lastSeenWeek: at.week,
      lastSeenYear: at.year,
    });
  }

  for (const [key, held] of byKey) {
    if (seen.has(key) || held.broken) continue;
    // Established and now absent. Three weeks is the bar for "established" — below that it
    // was a good afternoon, not a story, and it just goes away.
    if (held.weeksHeld >= 3 && (held.lastSeenYear !== at.year || held.lastSeenWeek < at.week)) {
      byKey.set(key, { ...held, broken: true });
    }
  }

  return [...byKey.values()];
}

/** The arcs as the newsroom should see them: the fact, the chapter, and how to play it. */
export function liveArcs(
  found: PlayerArc[],
  memory: ArcMemory[],
  context: { ranked: boolean; seasonOver: boolean }
): LiveArc[] {
  const byKey = new Map(memory.map((m) => [m.key, m]));
  const out: LiveArc[] = found.map((arc) => {
    const mem = byKey.get(arcKey(arc));
    const chapter = chapterOf(arc, mem, context);
    return { ...arc, chapter, angle: CHAPTER_ANGLE[chapter], weeksHeld: mem?.weeksHeld ?? 1 };
  });
  return out.sort((a, b) => b.weight - a.weight);
}

/** The block the shared context carries, so every desk tells the same story. */
export function arcsBlock(arcs: LiveArc[]): string | null {
  if (!arcs.length) return null;
  const parts = [
    "=== THE STORIES OF THIS SEASON (computed from the save — every number below is real) ===",
    "  These are the one or two players this season is actually ABOUT. Reference them the way",
    "  a real beat does: not once in every piece, but present — in the lede when they earned it,",
    "  in the fan reaction, in what the opposing coach had to worry about.",
  ];
  for (const a of arcs) {
    parts.push("");
    parts.push(`  [${CHAPTER_LABEL[a.chapter]}] ${a.claim}`);
    for (const e of a.evidence) parts.push(`     · ${e}`);
    parts.push(`     Where the story is: ${a.angle}`);
    parts.push(`     It grows if ${a.advancesIf}. It ends if ${a.collapsesIf}.`);
    if (a.weeksHeld > 1) parts.push(`     This has now held for ${a.weeksHeld} weeks.`);
  }
  parts.push("");
  parts.push(
    "  HARD RULE: do not invent a number for these players, and do not invent a DIFFERENT " +
      "storyline player. If a man is not on this list, he is not one of the season's stories."
  );
  return parts.join("\n");
}
