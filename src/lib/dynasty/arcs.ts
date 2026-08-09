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

import type { LeagueAward, RosterPlayer, RosterStats, RosterStatsSide, SnapshotGame, TeamInfo } from "./client";
import type { SeasonRecord } from "./archive";

export type ArcKind =
  // ── The player ──
  | "two-way"
  | "freshman-phenom"
  | "prodigy-qb"
  | "repeat-winner"
  | "unrecruited"
  | "iron-man"
  | "resurrection"
  | "workhorse"
  | "sack-artist"
  | "ball-hawk"
  | "last-dance"
  // ── The program ──
  | "unbeaten"
  | "cinderella"
  | "giant-killer"
  | "drought"
  // ── The week ──
  | "collision";

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
  /** Whose player this is. The league has stories too, and the good weeks are the collisions. */
  team: string;
  /** True when this is somebody else's man — changes who is allowed to be excited about him. */
  opposing?: boolean;
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
  /**
   * The angle this particular telling takes.
   *
   * Every archetype is a shape that recurs — there is a freshman phenom somewhere most years.
   * What stops the fifth one reading like the first is that each is assigned a framing, fixed
   * to the player so it never drifts between weeks, and varying between players so a dynasty
   * that runs a decade never tells the same story twice.
   */
  spin: string;
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

/**
 * What a detector produces: the fact, with no opinion about whose it is or how to frame it.
 * `detectArcs` stamps the team and picks the spin, so a new detector cannot forget to.
 */
type RawArc = Omit<PlayerArc, "team" | "spin" | "opposing">;

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

// ── The spin ───────────────────────────────────────────────────────────────────
//
// An archetype recurs; a STORY should not. There is a freshman phenom somewhere most years,
// and by the fifth one a dynasty has read the same paragraph five times. So each arc is
// assigned one of several framings — fixed to the player, so it never drifts week to week,
// and spread across players, so a ten-year dynasty keeps finding new angles on old shapes.
//
// These are angles for a writer, not plot. Nothing here asserts a fact; each one tells the
// beat which true thing to lead with.

const SPINS: Record<ArcKind, string[]> = {
  "two-way": [
    "the workload question — nobody has done this at this volume and stayed healthy, and every snap count is now a story",
    "the purist argument — half the sport says he would be better if he picked one, and he keeps answering it on the field",
    "the recruiting aftershock — every two-way high schooler in the country now points at him",
  ],
  "freshman-phenom": [
    "the one who was not supposed to play — the plan was a redshirt, and the plan lasted about a month",
    "the reclassification — he should still be in high school, and everyone he lines up against knows it",
    "the room he walked into — there were established players ahead of him and there are not any more",
  ],
  "prodigy-qb": [
    "the arm nobody can teach — the throws are not schemed, they are improvised, and that cuts both ways",
    "the weight of the position — this program has not had one of these in a long time and it is behaving accordingly",
    "the escape act — the plays that should be sacks keep turning into the highlight of the week",
  ],
  "repeat-winner": [
    "the ranking argument — the conversation has moved from whether he is the best to where he sits historically",
    "the encore problem — the second one is harder than the first because everyone expected it",
  ],
  unrecruited: [
    "the list nobody read — the schools that passed all have to play against him now",
    "the depth-chart accident — an injury opened a door and it never closed",
    "the walk-on math — he was a body in camp and he is the best player on the field",
  ],
  "iron-man": [
    "the snap count as a health story — the staff keeps being asked when they will rest him and keeps not resting him",
    "the availability argument — the best ability line, said seriously for once",
  ],
  resurrection: [
    "the year that vanished — he was a name on a roster and now he is the roster",
    "the coaching-change beneficiary — the same player, a completely different use of him",
    "the offseason nobody saw — whatever happened between seasons, it took",
  ],
  workhorse: [
    "the carry count — the number is climbing toward the range where people start arguing it is irresponsible",
    "the throwback — a bell-cow back in a sport that stopped building them",
  ],
  "sack-artist": [
    "the game-plan tax — offenses are spending two men on him and he is still getting there",
    "the pressure that does not show up as a sack — the number understates him and the film says so",
  ],
  "ball-hawk": [
    "the quarterbacks who stopped looking — the interceptions dry up because nobody throws at him",
    "the range — he is finishing plays that start on the other hash",
  ],
  "last-dance": [
    "the man who came back — he could have left and did not, and every week is the bill for that",
    "the exit — a career ending in front of people who watched all of it",
  ],
  unbeaten: [
    "the zero — the only number anyone cares about, and it gets heavier every Saturday",
    "the schedule argument — the record is real and the doubt is about who it came against",
  ],
  cinderella: [
    "the budget gap — the programs above them spend multiples of what they do",
    "the nobody-picked-them file — every preseason list had them nowhere near this",
  ],
  "giant-killer": [
    "the afternoon that changed the season — it is now the thing every future opponent prepares for",
    "the aftermath — beating them was the easy part; being the team that beat them is the hard part",
  ],
  drought: [
    "the years — the number is now long enough that a whole class arrived and left inside it",
    "the last time — everyone can tell you the year, which is the problem",
  ],
  collision: [
    "the matchup everyone circled",
    "the two of them on the same field",
  ],
};

/**
 * Pick a spin, deterministically.
 *
 * Stable per player and kind — the same man reads the same way in week 3 and week 11, which
 * is what makes it a storyline rather than a mood. Different men land differently because the
 * name is in the hash. `Math.random()` here would be a story that changes its own premise
 * every time the page reloads.
 */
function spinFor(kind: ArcKind, seed: string): string {
  const options = SPINS[kind] ?? [];
  if (!options.length) return "";
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return options[h % options.length];
}

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
function twoWay(roster: RosterPlayer[]): RawArc[] {
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
function freshmanPhenom(roster: RosterPlayer[]): RawArc[] {
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
function repeatWinner(awards: LeagueAward[], archive: SeasonRecord[], team: string): RawArc[] {
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

  const out: RawArc[] = [];
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
function unrecruited(roster: RosterPlayer[]): RawArc[] {
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
function ironMan(roster: RosterPlayer[]): RawArc[] {
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
function resurrection(roster: RosterPlayer[], archive: SeasonRecord[]): RawArc[] {
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


/**
 * The quarterback the sport builds a season around. Kept separate from the freshman arc on
 * purpose: the position has its own beat, its own expectations and its own kind of scrutiny,
 * and a 3,000-yard sophomore is a different story from a 1,000-yard freshman receiver even
 * when the numbers are equally rare.
 */
function prodigyQb(roster: RosterPlayer[]): RawArc[] {
  return roster
    .filter((p) => /^QB/i.test(p.position ?? ""))
    .map((p) => {
      const o = p.stats?.offense ?? p.stats;
      const yds = n(o?.passYds);
      const tds = n(o?.passTDs);
      const ints = n(o?.passInts);
      const young = /^(fr|so|rs fr|rs so|freshman|sophomore)/i.test(p.year ?? "");
      return { p, yds, tds, ints, young, rating: tds * 20 + Math.floor(yds / 12) - ints * 12 };
    })
    .filter((x) => x.rating >= 120 && x.tds >= 12)
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 1)
    .map(({ p, yds, tds, ints, young }) => ({
      kind: "prodigy-qb" as const,
      player: p.name,
      position: p.position,
      classYear: p.year,
      claim: young
        ? `${p.name} is doing this at quarterback before he is old enough to be doing it.`
        : `${p.name} is playing quarterback at a level the rest of the sport has to answer.`,
      evidence: [
        `${yds} passing yards, ${tds} TD, ${ints} INT in ${n(p.stats?.gamesPlayed)} games`,
        n(p.stats?.offense?.rushYds) >= 200
          ? `And ${n(p.stats?.offense?.rushYds)} rushing yards — he is a problem outside the pocket too.`
          : "",
        p.year ? `Class: ${p.year}.` : "",
      ].filter(Boolean),
      weight: 95 + Math.floor(yds / 40) + tds * 3 + (young ? 30 : 0),
      advancesIf: "the production holds against the best defense left on the schedule",
      collapsesIf: "the interceptions start, or the pocket stops holding up",
    }));
}

/** The bell-cow. A carry count a modern sport mostly stopped producing. */
function workhorse(roster: RosterPlayer[]): RawArc[] {
  return roster
    .map((p) => ({
      p,
      att: n((p.stats?.offense ?? p.stats)?.rushAtt),
      yds: n((p.stats?.offense ?? p.stats)?.rushYds),
    }))
    .filter((x) => x.att >= 160 && x.yds >= 800)
    .sort((a, b) => b.att - a.att)
    .slice(0, 1)
    .map(({ p, att, yds }) => ({
      kind: "workhorse" as const,
      player: p.name,
      position: p.position,
      classYear: p.year,
      claim: `${p.name} is carrying this offense, literally.`,
      evidence: [
        `${att} carries for ${yds} yards, ${n((p.stats?.offense ?? p.stats)?.rushTDs)} TD`,
        `${Math.round(att / games(p.stats))} carries a game.`,
      ],
      weight: 70 + Math.floor(att / 4),
      advancesIf: "he holds up under the load into November",
      collapsesIf: "the volume catches up with him",
    }));
}

/** The man offenses have to build a plan around. */
function sackArtist(roster: RosterPlayer[]): RawArc[] {
  return roster
    .map((p) => ({
      p,
      sacks: n((p.stats?.defense ?? p.stats)?.sacks),
      tfl: n((p.stats?.defense ?? p.stats)?.tfl),
    }))
    .filter((x) => x.sacks >= 7)
    .sort((a, b) => b.sacks - a.sacks)
    .slice(0, 1)
    .map(({ p, sacks, tfl }) => ({
      kind: "sack-artist" as const,
      player: p.name,
      position: p.position,
      classYear: p.year,
      claim: `${p.name} is living in the backfield.`,
      evidence: [
        `${sacks} sacks${tfl ? `, ${tfl} tackles for loss` : ""} in ${n(p.stats?.gamesPlayed)} games`,
        `${(sacks / games(p.stats)).toFixed(1)} a game.`,
      ],
      weight: 75 + sacks * 5,
      advancesIf: "he keeps producing once teams start chipping and sliding protection to him",
      collapsesIf: "the double teams work",
    }));
}

/** The defensive back nobody wants to throw at. */
function ballHawk(roster: RosterPlayer[]): RawArc[] {
  return roster
    .map((p) => ({
      p,
      ints: n((p.stats?.defense ?? p.stats)?.ints),
      pbu: n((p.stats?.defense ?? p.stats)?.deflections),
      tkl: n((p.stats?.defense ?? p.stats)?.tackles),
    }))
    .filter((x) => x.ints >= 4 || (x.ints >= 3 && x.pbu >= 8))
    .sort((a, b) => b.ints * 3 + b.pbu - (a.ints * 3 + a.pbu))
    .slice(0, 1)
    .map(({ p, ints, pbu, tkl }) => ({
      kind: "ball-hawk" as const,
      player: p.name,
      position: p.position,
      classYear: p.year,
      claim: `${p.name} is taking the ball away.`,
      evidence: [
        `${ints} interceptions${pbu ? `, ${pbu} pass breakups` : ""}${tkl ? `, ${tkl} tackles` : ""}`,
        `In ${n(p.stats?.gamesPlayed)} games.`,
      ],
      weight: 72 + ints * 8 + pbu,
      advancesIf: "quarterbacks keep testing him",
      collapsesIf: "they stop throwing his way entirely, which is its own kind of compliment",
    }));
}

/** A senior star in his last season. The clock is the story. */
function lastDance(roster: RosterPlayer[]): RawArc[] {
  return roster
    .filter((p) => /^(sr|senior|rs sr)/i.test(p.year ?? ""))
    .map((p) => ({
      p,
      load: Math.max(
        scrimmageYards(p.stats),
        defProduction(p.stats) * 6,
        n((p.stats?.offense ?? p.stats)?.passYds) / 2
      ),
    }))
    .filter((x) => x.load >= 600)
    .sort((a, b) => b.load - a.load)
    .slice(0, 1)
    .map(({ p }) => ({
      kind: "last-dance" as const,
      player: p.name,
      position: p.position,
      classYear: p.year,
      claim: `${p.name} is a senior, and this is the last of it.`,
      evidence: [
        scrimmageYards(p.stats) > 0
          ? `${scrimmageYards(p.stats)} yards from scrimmage, ${totalTDs(p.stats)} TD this season.`
          : `${n((p.stats?.defense ?? p.stats)?.tackles)} tackles, ${n((p.stats?.defense ?? p.stats)?.sacks)} sacks this season.`,
        `${n(p.stats?.gamesStarted)} starts.`,
      ],
      weight: 60 + Math.floor(scrimmageYards(p.stats) / 30),
      advancesIf: "the season goes deep enough to give it the ending it deserves",
      collapsesIf: "it ends early, which is how most of them end",
    }));
}

// -- The program ---------------------------------------------------------------
//
// Not every story has a face. A zero in the loss column, a program nobody picked, the
// afternoon somebody took down a giant, the wait that has gone on long enough to define the
// place — these are the season-long arcs the sport actually runs on, and every one of them is
// computable from standings the app already holds.

export interface TeamArcInput {
  team: TeamInfo | null;
  games: SnapshotGame[];
  teams: Record<string, TeamInfo>;
  teamRow: number | null | undefined;
  archive: SeasonRecord[];
}

function teamArcs(input: TeamArcInput): RawArc[] {
  const { team, games, teams, teamRow, archive } = input;
  if (!team || teamRow == null) return [];
  const out: RawArc[] = [];
  const wins = n(team.wins);
  const losses = n(team.losses);
  const played = wins + losses;
  const label = team.name;

  // The zero. Only a story once it has survived a few weeks — 2-0 is not a season.
  if (played >= 5 && losses === 0) {
    out.push({
      kind: "unbeaten",
      player: label,
      position: null,
      classYear: null,
      claim: `${label} has not lost.`,
      evidence: [`${wins}-0${team.rankMedia ? `, ranked #${team.rankMedia}` : ""}.`, `${played} games in.`],
      weight: 110 + wins * 6,
      advancesIf: "the zero survives the next one",
      collapsesIf: "anybody beats them — and then the story becomes what the streak cost",
    });
  }

  // Ranked far above what the program is. Prestige is the save's own opinion of the place,
  // which makes "nobody saw this coming" a fact rather than a flourish.
  if (team.rankMedia != null && team.rankMedia <= 15 && n(team.prestige) > 0 && n(team.prestige) <= 5) {
    out.push({
      kind: "cinderella",
      player: label,
      position: null,
      classYear: null,
      claim: `${label} is ranked #${team.rankMedia}, and ${label} is not supposed to be.`,
      evidence: [`Program prestige: ${n(team.prestige)}/10.`, `Record: ${wins}-${losses}.`],
      weight: 100 + (16 - team.rankMedia) * 4,
      advancesIf: "they keep winning the games the programs above them are supposed to win",
      collapsesIf: "the schedule finds them out",
    });
  }

  // Beat somebody they had no business beating. The save does not keep what a team was
  // ranked on the day, so this says "is ranked", not "was ranked" — a smaller claim, and a
  // true one.
  const mine = games.filter((g) => g.played && (g.homeRow === teamRow || g.awayRow === teamRow));
  for (const g of mine.slice(-6).reverse()) {
    const home = g.homeRow === teamRow;
    const us = n(home ? g.homeScore : g.awayScore);
    const them = n(home ? g.awayScore : g.homeScore);
    const oppRow = home ? g.awayRow : g.homeRow;
    const opp = oppRow != null ? teams[String(oppRow)] : null;
    if (!opp || us <= them) continue;
    const oppRank = opp.rankMedia;
    if (oppRank == null || oppRank > 8) continue;
    if (team.rankMedia != null && team.rankMedia <= 15) continue; // not an upset if you are also good
    out.push({
      kind: "giant-killer",
      player: label,
      position: null,
      classYear: null,
      claim: `${label} beat ${opp.name}, who is ranked #${oppRank}.`,
      evidence: [`${us}-${them}${g.week != null ? `, Week ${g.week}` : ""}.`],
      weight: 95 + (9 - oppRank) * 5,
      advancesIf: "they back it up instead of spending the rest of the season on it",
      collapsesIf: "they lose to somebody they should not, and it becomes a fluke in hindsight",
    });
    break;
  }

  // The wait. Visible only because the archive remembers seasons the save has thrown away.
  const seasons = [...(archive ?? [])].sort((a, b) => b.year - a.year);
  const lastTitle = seasons.find((sn) => sn.result === "national-champ");
  const thisYear = seasons[0]?.year ?? null;
  if (seasons.length >= 4 && thisYear != null) {
    const since = lastTitle ? thisYear - lastTitle.year : seasons.length;
    if (since >= 4) {
      out.push({
        kind: "drought",
        player: label,
        position: null,
        classYear: null,
        claim: lastTitle
          ? `${label} has not won it since ${lastTitle.year}.`
          : `${label} has never won it in the years this archive covers.`,
        evidence: [
          lastTitle
            ? `Last title: ${lastTitle.year} — ${since} seasons ago.`
            : `${seasons.length} archived seasons, no title.`,
          `This season: ${wins}-${losses}.`,
        ],
        weight: 55 + Math.min(40, since * 3),
        advancesIf: "this is the team that ends it",
        collapsesIf: "it does not, and the number goes up by one",
      });
    }
  }

  return out;
}

export interface ArcInput {
  roster: RosterPlayer[];
  archive: SeasonRecord[];
  awards: LeagueAward[];
  team: string;
  /** The program's own arcs — the zero, the wait, the afternoon it beat somebody. */
  program?: TeamArcInput;
  /** True when this is a rival's board rather than the user's. */
  opposing?: boolean;
  /** How many to keep. The opponent gets fewer: they are context, not the whole paper. */
  limit?: number;
}

/**
 * Every arc a roster genuinely supports, best first.
 *
 * Capped hard. A board of nine "storylines" is a board of none — the point is that a user
 * reads this and recognises the one or two men their season is actually about.
 */
export function detectArcs(input: ArcInput): PlayerArc[] {
  const { roster, archive, awards, team, program, opposing, limit } = input;
  const all = [
    ...twoWay(roster),
    ...repeatWinner(awards ?? [], archive ?? [], team),
    ...prodigyQb(roster),
    ...freshmanPhenom(roster),
    ...resurrection(roster, archive ?? []),
    ...ballHawk(roster),
    ...sackArtist(roster),
    ...workhorse(roster),
    ...unrecruited(roster),
    ...lastDance(roster),
    ...ironMan(roster),
    ...(program ? teamArcs(program) : []),
  ];
  // One arc per subject. A man who is both a freshman phenom and an iron man is one story
  // told twice, and the heavier framing is always the better one.
  const best = new Map<string, PlayerArc>();
  for (const a of all.sort((x, y) => y.weight - x.weight)) {
    const key = a.player.toLowerCase();
    if (!best.has(key)) {
      best.set(key, { ...a, team, opposing: opposing === true, spin: spinFor(a.kind, a.player) });
    }
  }
  return [...best.values()].slice(0, limit ?? 4);
}

/**
 * The collision.
 *
 * This is what makes a league feel alive rather than a backdrop: your true freshman safety
 * has a story, their prodigy quarterback has a story, and on Saturday the two of them are on
 * the same field. That is the week the beat writes itself — and it only exists because both
 * sides are being tracked, not just yours.
 *
 * Emitted as an arc of its own so it flows through the same block, the same chapters and the
 * same rules as everything else. It is deliberately not persisted: a meeting happens once.
 */
export function collisions(ours: PlayerArc[], theirs: PlayerArc[]): PlayerArc[] {
  if (!ours.length || !theirs.length) return [];
  const facing = (a: PlayerArc, b: PlayerArc): boolean => {
    // Only when the two stories actually intersect on the field. A quarterback and a
    // secondary is a matchup; a quarterback and a nose tackle is a coincidence.
    const pass = new Set(["prodigy-qb", "ball-hawk", "two-way"]);
    const run = new Set(["workhorse", "sack-artist", "iron-man"]);
    return (pass.has(a.kind) && pass.has(b.kind)) || (run.has(a.kind) && run.has(b.kind));
  };
  const mine = ours.filter((a) => a.position);
  const yours = theirs.filter((b) => b.position);
  for (const a of mine) {
    for (const b of yours) {
      if (!facing(a, b)) continue;
      return [
        {
          kind: "collision",
          team: a.team,
          player: `${a.player} vs ${b.player}`,
          position: null,
          classYear: null,
          claim: `${a.player} and ${b.player} are on the same field this week.`,
          evidence: [
            `${a.team}: ${a.claim} ${a.evidence[0] ?? ""}`.trim(),
            `${b.team}: ${b.claim} ${b.evidence[0] ?? ""}`.trim(),
          ],
          weight: Math.max(a.weight, b.weight) + 40,
          advancesIf: "one of them wins the afternoon outright",
          collapsesIf: "the game is decided somewhere else entirely, which happens more often than the buildup admits",
          spin: spinFor("collision", `${a.player}${b.player}`),
        },
      ];
    }
  }
  return [];
}

/**
 * The whole board: the user's stories, the opponent's, and the meeting between them.
 *
 * The opponent's roster is already parsed every week for the matchup, so their arcs cost
 * nothing extra — and without them the league is scenery. With them, the team on the other
 * sideline arrives with a season of its own.
 */
export function detectLeagueArcs(input: {
  user: ArcInput;
  opponent?: ArcInput | null;
}): PlayerArc[] {
  const ours = detectArcs(input.user);
  const theirs = input.opponent
    ? detectArcs({ ...input.opponent, opposing: true, limit: input.opponent.limit ?? 2 })
    : [];
  return [...collisions(ours, theirs), ...ours, ...theirs];
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
  const ours = arcs.filter((a) => !a.opposing && a.kind !== "collision");
  const theirs = arcs.filter((a) => a.opposing);
  const meeting = arcs.filter((a) => a.kind === "collision");

  const render = (a: LiveArc, prefix = ""): string[] => {
    const lines = [`  ${prefix}[${CHAPTER_LABEL[a.chapter]}] ${a.claim}`];
    for (const e of a.evidence) lines.push(`     · ${e}`);
    if (a.spin) lines.push(`     The angle: ${a.spin}`);
    lines.push(`     Where the story is: ${a.angle}`);
    lines.push(`     It grows if ${a.advancesIf}. It ends if ${a.collapsesIf}.`);
    if (a.weeksHeld > 1) lines.push(`     This has now held for ${a.weeksHeld} weeks.`);
    return lines;
  };

  const parts = [
    "=== THE STORIES OF THIS SEASON (computed from the save — every number below is real) ===",
    "  These are the players this season is actually ABOUT. Reference them the way a real beat",
    "  does: not once in every piece, but present — in the lede when they earned it, in the fan",
    "  reaction, in what the opposing coach had to worry about.",
  ];

  if (meeting.length) {
    parts.push("");
    parts.push("  THIS WEEK'S MEETING — the two of them are on the same field:");
    for (const a of meeting) parts.push(...render(a));
    parts.push(
      "     Play it as the matchup it is. Neither man is a prop for the other, and the game can",
      "     still be decided by somebody nobody is talking about."
    );
  }

  for (const a of ours) {
    parts.push("");
    parts.push(...render(a));
  }

  if (theirs.length) {
    parts.push("");
    parts.push("  THE OTHER SIDELINE — these are the OPPONENT'S stories, not yours:");
    for (const a of theirs) {
      parts.push("");
      parts.push(...render(a, `${a.team}: `));
    }
    parts.push(
      "     Cover them the way a rival's beat would be covered: acknowledged, respected, and",
      "     written about as a problem your team has to solve — never celebrated as your own."
    );
  }

  parts.push("");
  parts.push(
    "  HARD RULE: do not invent a number for any player above, and do not invent a DIFFERENT " +
      "storyline player. If a man is not on this list, he is not one of the season's stories."
  );
  return parts.join("\n");
}
