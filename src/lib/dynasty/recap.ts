// Deterministic recap math — the v2 port of the flagship offender.
//
// `recap-lead` was the surface that got players onto the wrong teams and mixed the stats:
// it received a 40-player dump plus thirty lines of increasingly desperate prompt rules and
// was asked to work out, in prose, who mattered and how the game turned. That reasoning is
// the part a model is worst at and code is best at, so code does it here.
//
// Same contract as scouting.ts: everything below is computed from the save, and the model
// writes the story AROUND these tables. What the model still owns is untouched — the lede,
// the angle, the structure, the quotes, and every invented in-game detail. This file only
// decides what CANNOT be contradicted.
//
// THE STATS ARE SEASON-TO-DATE, NEVER A BOX SCORE. The save gives cumulative season totals
// and the final score; it does not give this game's individual lines. Every helper here
// carries that distinction into its output, because collapsing it is precisely how "a QB
// with 3,100 season yards threw for 3,100 today" gets written.

import type { GameResult, RosterPlayer, SnapshotGame, TeamInfo } from "./client";
import { classAbbrev } from "./scouting";

// ── The shape of the game ───────────────────────────────────────────────────────

export type MarginBand = "one-score" | "two-score" | "comfortable" | "runaway";

export const BAND_LABEL: Record<MarginBand, string> = {
  "one-score": "a one-score game",
  "two-score": "a two-score game",
  comfortable: "a comfortable win",
  runaway: "a runaway",
};

export function marginBand(margin: number): MarginBand {
  const m = Math.abs(margin);
  if (m <= 8) return "one-score";
  if (m <= 16) return "two-score";
  if (m <= 24) return "comfortable";
  return "runaway";
}

export type GameShape =
  | "wire-to-wire"
  | "pulled-away-late"
  | "held-on"
  | "comeback"
  | "collapse"
  | "back-and-forth"
  | "even";

export interface QuarterSwing {
  /** Points by quarter, user's perspective. */
  ours: number[];
  theirs: number[];
  /** Score margin after each quarter, user's perspective. Negative = trailing. */
  running: number[];
  /** The quarter that moved the margin most, 1-indexed, and by how much. */
  biggestQuarter: { quarter: number; swing: number } | null;
  /** Times the lead actually changed hands (margin crossed zero). */
  leadChanges: number;
  /** Largest deficit the user faced at the end of any quarter, as a positive number. */
  largestDeficit: number;
  /** Largest lead the user held at the end of any quarter. The mirror of largestDeficit —
   * a blown lead is not visible in the halftime margin when it was blown BY halftime. */
  largestLead: number;
  shape: GameShape;
  /** The one sentence about how the game turned that the model may not contradict. */
  read: string;
}

/**
 * How the game actually turned, from the quarter scores the save has always carried and
 * nobody reads. This is the single biggest thing the recap used to guess at: "the drive
 * that told the truth about this team" is a real, computable fact, not a vibe.
 */
export function quarterSwing(quarters: { ours: number[]; theirs: number[] }): QuarterSwing | null {
  const { ours, theirs } = quarters;
  if (ours.length < 4 || theirs.length < 4) return null;

  const running: number[] = [];
  let us = 0;
  let them = 0;
  for (let q = 0; q < 4; q++) {
    us += ours[q] ?? 0;
    them += theirs[q] ?? 0;
    running.push(us - them);
  }

  let biggestQuarter: QuarterSwing["biggestQuarter"] = null;
  for (let q = 0; q < 4; q++) {
    const swing = (ours[q] ?? 0) - (theirs[q] ?? 0);
    if (!biggestQuarter || Math.abs(swing) > Math.abs(biggestQuarter.swing)) {
      biggestQuarter = { quarter: q + 1, swing };
    }
  }

  let leadChanges = 0;
  for (let i = 1; i < running.length; i++) {
    const before = running[i - 1];
    const now = running[i];
    if (before === 0 || now === 0) continue;
    if (Math.sign(before) !== Math.sign(now)) leadChanges++;
  }

  const largestDeficit = Math.max(0, ...running.map((m) => -m));
  const largestLead = Math.max(0, ...running);
  const final = running[3];
  const half = running[1];
  const won = final > 0;

  let shape: GameShape;
  if (won && largestDeficit >= 10) shape = "comeback";
  else if (!won && largestLead >= 10) shape = "collapse";
  else if (leadChanges >= 2) shape = "back-and-forth";
  else if (won && half > 0 && final - half >= 10) shape = "pulled-away-late";
  else if (won && half >= 10 && final < half) shape = "held-on";
  else if (Math.abs(final) <= 3) shape = "even";
  else if (won && running.every((m) => m >= 0)) shape = "wire-to-wire";
  else if (!won && running.every((m) => m <= 0)) shape = "wire-to-wire";
  else shape = "even";

  const q = biggestQuarter;
  const qLabel = q ? ordinalQuarter(q.quarter) : "";
  const reads: Record<GameShape, string> = {
    comeback: `They trailed by ${largestDeficit} and won it — the ${qLabel} is where it turned.`,
    collapse: `They led by ${largestLead} and lost it; the ${qLabel} is where it went.`,
    "back-and-forth": `The lead changed hands ${leadChanges} times — nobody held it for long.`,
    "pulled-away-late": `It was ${fmtHalf(half)} at the half and they pulled away after it, mostly in the ${qLabel}.`,
    "held-on": `They built a ${half}-point half-time lead and had to hold on for it late.`,
    "wire-to-wire": won
      ? "They led at the end of every quarter — it was never really in doubt."
      : "They trailed at the end of every quarter — they were never really in it.",
    even: `It stayed tight all the way; the ${qLabel} was the only quarter that moved it much.`,
  };

  return {
    ours,
    theirs,
    running,
    biggestQuarter,
    leadChanges,
    largestDeficit,
    largestLead,
    shape,
    read: reads[shape],
  };
}

function ordinalQuarter(q: number): string {
  return ["first quarter", "second quarter", "third quarter", "fourth quarter"][q - 1] ?? `quarter ${q}`;
}

function fmtHalf(margin: number): string {
  if (margin === 0) return "level";
  return margin > 0 ? `a ${margin}-point lead` : `a ${-margin}-point deficit`;
}

export interface GameFacts {
  us: string;
  them: string;
  usScore: number;
  themScore: number;
  won: boolean;
  margin: number;
  band: MarginBand;
  location: "home" | "away" | "neutral";
  overtime: boolean;
  usRank: number | null;
  themRank: number | null;
  /** True when the user beat a team ranked well above them (or unranked beating ranked). */
  upset: boolean;
  /** True when the user LOST to a team ranked well below them. */
  upsetAgainst: boolean;
  swing: QuarterSwing | null;
}

export interface GameInput {
  result: GameResult;
  userTeam: string;
  /** The schedule row for this game, for quarter scores and overtime. */
  game?: SnapshotGame | null;
  /** Weeks 16+ are neutral-site by the app's own rule (see buildMediaContext). */
  neutralSite?: boolean;
}

export function gameFacts(input: GameInput): GameFacts {
  const { result: r, userTeam } = input;
  const home = r.home === userTeam;
  const usScore = (home ? r.homeScore : r.awayScore) ?? 0;
  const themScore = (home ? r.awayScore : r.homeScore) ?? 0;
  const usRank = home ? r.rankHome : r.rankAway;
  const themRank = home ? r.rankAway : r.rankHome;
  const won = usScore > themScore;
  const g = input.game ?? null;
  const ours = (home ? g?.homeQuarters : g?.awayQuarters) ?? null;
  const theirs = (home ? g?.awayQuarters : g?.homeQuarters) ?? null;

  // An unranked team beating a ranked one is an upset; so is a big gap in the poll. Both
  // are stated as fact so the model never has to guess whether this was a big deal.
  const ranked = (n: number | null | undefined) => n != null && n > 0 && n <= 25;
  const upset =
    won && ranked(themRank) && (!ranked(usRank) || (usRank ?? 99) - (themRank ?? 0) >= 10);
  const upsetAgainst =
    !won && ranked(usRank) && (!ranked(themRank) || (themRank ?? 99) - (usRank ?? 0) >= 10);

  return {
    us: userTeam,
    them: home ? r.away : r.home,
    usScore,
    themScore,
    won,
    margin: usScore - themScore,
    band: marginBand(usScore - themScore),
    location: input.neutralSite ? "neutral" : home ? "home" : "away",
    overtime: (g?.homeOT ?? 0) > 0 || (g?.awayOT ?? 0) > 0,
    usRank: ranked(usRank) ? usRank ?? null : null,
    themRank: ranked(themRank) ? themRank ?? null : null,
    upset,
    upsetAgainst,
    swing: ours && theirs ? quarterSwing({ ours: nums(ours), theirs: nums(theirs) }) : null,
  };
}

function nums(a: (number | null)[]): number[] {
  return a.map((n) => n ?? 0);
}

// ── What the result is worth ────────────────────────────────────────────────────

export interface StakesFacts {
  record: string;
  confRecord: string | null;
  gamesPlayed: number;
  /** "three straight wins" / "back-to-back losses" / null when there is no run. */
  streak: string | null;
  bowlEligible: boolean;
  /** Wins still needed for the six-win bowl line, null once eligible. */
  winsToBowl: number | null;
  /** Games left on the regular-season schedule. */
  gamesLeft: number;
}

export interface StakesInput {
  team: TeamInfo;
  games: SnapshotGame[];
  userRow: number | null | undefined;
}

export function stakesFacts(input: StakesInput): StakesFacts {
  const t = input.team;
  const wins = t.wins ?? 0;
  const losses = t.losses ?? 0;
  const ties = t.ties ?? 0;
  const gamesPlayed = wins + losses + ties;
  const row = input.userRow;
  const mine = row == null ? [] : input.games.filter((g) => g.homeRow === row || g.awayRow === row);
  const gamesLeft = mine.filter((g) => !g.played).length;

  return {
    record: `${wins}-${losses}${ties ? `-${ties}` : ""}`,
    confRecord: t.confWins != null ? `${t.confWins}-${t.confLosses ?? 0}` : null,
    gamesPlayed,
    streak: streakOf(mine, row),
    bowlEligible: wins >= 6,
    winsToBowl: wins >= 6 ? null : 6 - wins,
    gamesLeft,
  };
}

/** The current run, in the words a beat writer uses. Computed from the schedule, so it can
 * never drift from the record the way a model-inferred streak does. */
function streakOf(mine: SnapshotGame[], row: number | null | undefined): string | null {
  if (row == null) return null;
  const played = mine
    .filter((g) => g.played && g.homeScore != null && g.awayScore != null)
    .sort((a, b) => (a.year ?? 0) - (b.year ?? 0) || (a.week ?? 0) - (b.week ?? 0));
  if (!played.length) return null;
  let run = 0;
  let won: boolean | null = null;
  for (let i = played.length - 1; i >= 0; i--) {
    const g = played[i];
    const home = g.homeRow === row;
    const w = ((home ? g.homeScore : g.awayScore) ?? 0) > ((home ? g.awayScore : g.homeScore) ?? 0);
    if (won == null) won = w;
    else if (w !== won) break;
    run++;
  }
  if (won == null || run < 2) return null;
  const plural = won ? "wins" : "losses";
  return run === 2 ? `back-to-back ${plural}` : `${numberWord(run)} straight ${plural}`;
}

function numberWord(n: number): string {
  return ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][n] ?? String(n);
}

// ── The cast ────────────────────────────────────────────────────────────────────
// This replaces the 40-player dump. Code works out who could plausibly have decided this
// game and hands the model a short, tagged list with an honest label on every number. Six
// people the writer can name beats forty he has to sort through — and it is the reason the
// team-attribution rules can shrink from a wall of warnings to one line.

export interface CastMember {
  name: string;
  team: string;
  /** How a writer would introduce him: "junior quarterback", "the kicker". */
  role: string;
  /** Season-to-date production, explicitly framed as such. Null when he has no stat line. */
  seasonLine: string | null;
  /** His per-game average, so a story about ONE game has a true number to reach for. */
  perGame: string | null;
  /** Why code put him on the list — the angle that is legitimately available. */
  why: string;
  /** Plays verified from the user's own footage. These DID happen in this game. */
  verified: string[];
  /** Out for this game, and why. */
  unavailable: string | null;
}

const num = (v: number | null | undefined) => (typeof v === "number" ? v : 0);

function side(p: RosterPlayer, key: "offense" | "defense" | "kicking") {
  const s = p.stats;
  if (!s) return null;
  // The parser flattens the active side onto the wrapper as well as the nested block.
  const nested = s[key];
  if (nested) return nested;
  return s.side === key ? (s as unknown as NonNullable<typeof nested>) : null;
}

/**
 * The per-game average. A recap is ABOUT one game, and the save has no box score — so with
 * only a cumulative total on the page the writer uses it as tonight's line ("900 yards and
 * 100 carries in a single game", from a real save). This is the honest number he can build
 * that sentence on, and it says what it is.
 */
function perGameOf(p: RosterPlayer): string | null {
  const gp = p.stats?.gamesPlayed ?? null;
  if (gp == null || gp < 2) return null;
  const o = side(p, "offense");
  const d = side(p, "defense");
  const rate = (v: number | null | undefined, by: number | null | undefined) =>
    typeof v === "number" && v && typeof by === "number" && by > 0 ? Math.round((v / by) * 10) / 10 : null;
  const avg = (v: number | null | undefined) => rate(v, gp);
  // Every figure states its own denominator. A back averaging 97.5 rushing yards A GAME was
  // written up as "97.5 yards per carry" because the unit lived in the label and the number
  // did not carry it.
  const bits: string[] = [];
  const pass = avg(o?.passYds);
  const rush = avg(o?.rushYds);
  const rec = avg(o?.recYds);
  const tkl = avg(d?.tackles);
  if (pass) bits.push(`${pass} pass yds PER GAME`);
  if (rush) bits.push(`${rush} rush yds PER GAME`);
  if (rec) bits.push(`${rec} rec yds PER GAME`);
  if (tkl) bits.push(`${tkl} tackles PER GAME`);
  // The per-attempt rates, computed, so no one has to derive one.
  const ypc = rate(o?.rushYds, o?.rushAtt);
  const ypr = rate(o?.recYds, o?.recCatches);
  const ypa = rate(o?.passYds, o?.passAtt);
  if (ypc) bits.push(`${ypc} yds PER CARRY`);
  if (ypr) bits.push(`${ypr} yds PER CATCH`);
  if (ypa) bits.push(`${ypa} yds PER PASS ATTEMPT`);
  return bits.length ? `RATES (already divided — never re-divide or re-label): ${bits.join(", ")}` : null;
}

function seasonLineOf(p: RosterPlayer): string | null {
  const o = side(p, "offense");
  const d = side(p, "defense");
  const k = side(p, "kicking");
  const bits: string[] = [];
  if (o) {
    if (num(o.passAtt)) bits.push(`${num(o.passYds)} pass yds, ${num(o.passTDs)} TD, ${num(o.passInts)} INT`);
    if (num(o.rushAtt) || num(o.rushYds)) bits.push(`${num(o.rushYds)} rush yds, ${num(o.rushTDs)} TD`);
    if (num(o.recCatches)) bits.push(`${num(o.recCatches)} rec, ${num(o.recYds)} yds, ${num(o.recTDs)} TD`);
  }
  if (d) {
    const dd: string[] = [];
    if (num(d.tackles)) dd.push(`${num(d.tackles)} tkl`);
    if (num(d.sacks)) dd.push(`${num(d.sacks)} sacks`);
    if (num(d.ints)) dd.push(`${num(d.ints)} INT`);
    if (dd.length) bits.push(dd.join(", "));
  }
  if (k) {
    if (num(k.fgAtt)) bits.push(`${num(k.fgMade)}/${num(k.fgAtt)} FG${num(k.fgLong) ? `, long ${num(k.fgLong)}` : ""}`);
    if (num(k.punts)) bits.push(`${num(k.punts)} punts`);
  }
  return bits.length ? `SEASON TOTALS (not one game): ${bits.join("; ")}` : null;
}

function roleOf(p: RosterPlayer): string {
  const cls = classAbbrev(p.year);
  const year = cls ? `${cls.replace(".", "")} ` : "";
  const pos = (p.position ?? "").toUpperCase();
  const label: Record<string, string> = {
    QB: "quarterback",
    HB: "running back",
    RB: "running back",
    FB: "fullback",
    WR: "receiver",
    TE: "tight end",
    LT: "left tackle",
    RT: "right tackle",
    LG: "guard",
    RG: "guard",
    C: "center",
    LE: "defensive end",
    RE: "defensive end",
    DE: "defensive end",
    DT: "defensive tackle",
    MLB: "linebacker",
    LOLB: "linebacker",
    ROLB: "linebacker",
    LB: "linebacker",
    CB: "cornerback",
    FS: "safety",
    SS: "safety",
    S: "safety",
    K: "kicker",
    P: "punter",
  };
  return `${year}${label[pos] ?? (pos ? pos.toLowerCase() : "player")}`.trim();
}

export interface CastInput {
  roster: RosterPlayer[];
  team: string;
  game: GameFacts | null;
  /** Plays pulled from the user's footage — real, per-play truth for THIS game. */
  highlights?: { text: string; player?: string | null }[];
  /** Players who could not play. */
  unavailable?: { playerName: string; reason: string }[];
  limit?: number;
}

/**
 * The players a recap of THIS game could legitimately be built around. Selection is by
 * season production plus what the game itself demands: a one-score game puts the kicker in
 * the story whether or not he leads the team in anything.
 */
export function recapCast(input: CastInput): CastMember[] {
  const { roster, team, game } = input;
  const limit = input.limit ?? 6;
  const picked = new Map<string, { p: RosterPlayer; why: string }>();
  const take = (p: RosterPlayer | undefined, why: string) => {
    if (!p || picked.has(p.name)) return;
    picked.set(p.name, { p, why });
  };

  const best = (key: (p: RosterPlayer) => number) => {
    const ranked = roster.filter((p) => key(p) > 0).sort((a, b) => key(b) - key(a));
    return ranked[0];
  };

  // Anyone in the verified highlights leads the list — those plays actually happened.
  const highlights = input.highlights ?? [];
  for (const h of highlights) {
    if (!h.player) continue;
    const p = roster.find((r) => r.name.toLowerCase() === h.player!.toLowerCase());
    take(p, "on the verified highlight reel from this game");
  }

  take(
    best((p) => num(side(p, "offense")?.passYds)),
    "the season's passing production"
  );
  take(
    best((p) => num(side(p, "offense")?.rushYds)),
    "the season's leading rusher"
  );
  take(
    best((p) => num(side(p, "offense")?.recYds)),
    "the season's leading receiver"
  );
  take(
    best((p) => num(side(p, "defense")?.sacks) * 10 + num(side(p, "defense")?.tackles)),
    "the defense's most productive player this season"
  );
  // A kicker only belongs in the story when the margin says he could have decided it.
  if (game && Math.abs(game.margin) <= 8) {
    take(
      best((p) => num(side(p, "kicking")?.fgAtt)),
      "the margin was inside one score — the kicking game was live all night"
    );
  }

  // Early in a season — and for most opponents, whose stat tables the save does not carry —
  // nobody clears a production filter. These are still REAL names from the save, and a
  // writer with no names at all will reach for invented ones, so fall back to the depth
  // chart rather than handing over an empty cast.
  if (picked.size < 2) {
    for (const p of [...roster].sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0)).slice(0, limit)) {
      take(p, "on the roster — the save carries no season production for him");
    }
  }

  const unavailable = new Map(
    (input.unavailable ?? []).map((u) => [u.playerName.toLowerCase(), u.reason] as const)
  );
  // Someone who could not play is a story in his own right, so he stays on the list — with
  // the reason attached, which is what stops "he was quiet tonight" being written about a
  // player who was not on the field.
  for (const [name, reason] of unavailable) {
    const p = roster.find((r) => r.name.toLowerCase() === name);
    take(p, `did not play — ${reason}`);
  }

  return [...picked.values()]
    .slice(0, limit + unavailable.size)
    .map(({ p, why }) => ({
      name: p.name,
      team,
      role: roleOf(p),
      seasonLine: seasonLineOf(p),
      perGame: perGameOf(p),
      why,
      verified: highlights
        .filter((h) => h.player && h.player.toLowerCase() === p.name.toLowerCase())
        .map((h) => h.text),
      unavailable: unavailable.get(p.name.toLowerCase()) ?? null,
    }));
}

// ── The whole locked table ──────────────────────────────────────────────────────

export interface RecapFacts {
  game: GameFacts | null;
  stakes: StakesFacts | null;
  cast: CastMember[];
  oppCast: CastMember[];
  oppCoach: string | null;
  /** Plays pulled from the user's own footage. Unlike everything else here these are
   * PER-GAME truth, so they carry separately from the season-total cast lines — including
   * the ones no player could be matched to, which would otherwise be dropped. */
  verifiedPlays: string[];
  /** Statements the story may not contradict, already in plain English. */
  locked: string[];
  /** What the save does NOT contain. Stated so the model stops filling these in — this list
   * is the honest boundary of what anyone can know about this game. */
  unknown: string[];
}

export interface RecapInput extends Partial<CastInput> {
  result: GameResult | null;
  userTeam: string;
  userTeamInfo: TeamInfo | null;
  userRow: number | null | undefined;
  games: SnapshotGame[];
  roster: RosterPlayer[];
  oppRoster?: RosterPlayer[];
  oppCoach?: string | null;
  week?: number | null;
  /** The save's season. Stated as a locked fact — see recapFacts. */
  year?: number | null;
  /** The computed stakes (bowl math, playoff standing, bowl-vs-bracket). The ported recap
   * does not receive the shared context, so without this it has to infer what the game is
   * worth — which is how a bowl game got written as a playoff round. */
  stakesLines?: string[];
  highlights?: { text: string; player?: string | null }[];
  unavailable?: { playerName: string; reason: string }[];
}

export function recapFacts(input: RecapInput): RecapFacts {
  const scheduleRow =
    input.result && input.userRow != null
      ? input.games.find(
          (g) =>
            g.played &&
            g.week === (input.week ?? input.result?.week) &&
            (g.homeRow === input.userRow || g.awayRow === input.userRow)
        ) ?? null
      : null;

  const game = input.result
    ? gameFacts({
        result: input.result,
        userTeam: input.userTeam,
        game: scheduleRow,
        neutralSite: (input.week ?? input.result.week ?? 0) >= 16,
      })
    : null;

  const stakes = input.userTeamInfo
    ? stakesFacts({ team: input.userTeamInfo, games: input.games, userRow: input.userRow })
    : null;

  const cast = recapCast({
    roster: input.roster,
    team: input.userTeam,
    game,
    highlights: input.highlights,
    unavailable: input.unavailable,
  });

  const oppCast = game
    ? recapCast({ roster: input.oppRoster ?? [], team: game.them, game, limit: 3 })
    : [];

  const locked: string[] = [];
  // The recap no longer receives the shared context blob, so the season has to be stated
  // here or the piece has no idea what year it is and dates itself to a real-world season.
  if (input.year != null) {
    locked.push(
      `Season: ${input.year}. Every "this season", "last year" and date is relative to ${input.year} — never a real-world year.`
    );
  }
  if (game) {
    const where =
      game.location === "neutral" ? "at a neutral site" : game.location === "home" ? "at home" : "on the road";
    locked.push(
      `${game.us} ${game.won ? "beat" : "lost to"} ${game.themRank ? `#${game.themRank} ` : ""}${game.them}, ` +
        `${game.usScore}-${game.themScore}, ${where}${game.overtime ? ", in overtime" : ""}.`
    );
    locked.push(`Margin: ${Math.abs(game.margin)} — ${BAND_LABEL[game.band]}.`);
    if (game.swing) {
      locked.push(
        `By quarter — ${game.us}: ${game.swing.ours.join(", ")} · ${game.them}: ${game.swing.theirs.join(", ")}.`
      );
      locked.push(`How it turned: ${game.swing.read}`);
    }
    if (game.upset) locked.push(`This was an upset: ${game.us} was the lesser-ranked team and won.`);
    if (game.upsetAgainst) locked.push(`This was an upset loss: ${game.us} was the better-ranked team and lost.`);
  }
  if (stakes) {
    // The wording MUST follow whether a game was played. Stating "the record already
    // includes this week's result" on a pregame week contradicts the same prompt's "this
    // game has not been played yet" — the model caught that and refused to write at all.
    const rec = `${stakes.record}${stakes.confRecord ? ` (${stakes.confRecord} conference)` : ""}`;
    locked.push(
      game
        ? `Record after this game: ${rec} — ${stakes.gamesPlayed} played, ${stakes.gamesLeft} left. ` +
            "This ALREADY includes this week's result."
        : `Record entering this week: ${rec} — ${stakes.gamesPlayed} played, ${stakes.gamesLeft} left. ` +
            "NO game has been played this week, so nothing is added to it."
    );
    if (stakes.streak) locked.push(`They are on ${stakes.streak}.`);
  }
  // What the result is WORTH. Computed upstream (postseason.ts) so the bowl/playoff answer
  // is identical here and in the shared context; a recap that reached its own conclusion is
  // how the same week read as a bowl on one tab and a playoff round on another.
  for (const l of input.stakesLines ?? []) locked.push(l);

  const unknown = [
    "This game's individual box score. Every stat line above is a SEASON TOTAL — never present one as tonight's line. " +
      "If you want to say what a player did in THIS game, use his average-game line as a reference point and write it " +
      "as the kind of night he has (\"another hundred-yard afternoon\"), NOT as a counted stat you do not have.",
    "Any team or per-category yardage, and anything the defense 'gave up'. Only the final score and the quarter scores are known.",
    "Drive charts, play-by-play, penalties, time of possession, attendance and weather. Invent these freely as texture — they are colour, not record.",
  ];
  // Keyed on whether anyone from the other side actually made the cast, not on whether a
  // roster was passed: a roster that yields no nameable player leaves the writer with
  // nothing, which is exactly when an invented name gets reached for.
  if (!oppCast.length && game) {
    unknown.push(`${game.them}'s players. Refer to them by role only ("their quarterback") — never by name.`);
  }

  return {
    game,
    stakes,
    cast,
    oppCast,
    oppCoach: input.oppCoach ?? null,
    verifiedPlays: (input.highlights ?? []).map((h) => (h.player ? `${h.text} (${h.player})` : h.text)),
    locked,
    unknown,
  };
}

// ── Prompt rendering ────────────────────────────────────────────────────────────

/** How a cast member reads on the page the writer is handed. */
export function castLine(m: CastMember): string {
  const bits = [`[${m.team}] ${m.name} — ${m.role}`];
  if (m.unavailable) bits.push(`OUT: ${m.unavailable}`);
  if (m.seasonLine) bits.push(m.seasonLine);
  if (m.perGame) bits.push(m.perGame);
  if (m.verified.length) bits.push(`verified in THIS game: ${m.verified.join("; ")}`);
  bits.push(`why he's here: ${m.why}`);
  return `  ${bits.join(" · ")}`;
}

/** The computed facts, in prose the writer cannot argue with. Usable on its own for the
 * weeks with no game, where the record and the streak still get miscounted. */
export function lockedBlock(facts: RecapFacts): string {
  const parts = [
    "=== LOCKED FACTS (computed from the save — every one of these is true, and none may be contradicted) ===",
    ...facts.locked.map((l) => `  ${l}`),
  ];
  if (facts.verifiedPlays.length) {
    parts.push(
      "  Verified from the user's own footage — these plays REALLY happened in THIS game, and are",
      "  the only per-play facts anyone has. Weave them in; never contradict them:"
    );
    for (const p of facts.verifiedPlays) parts.push(`    - ${p}`);
  }
  return parts.join("\n");
}

/** The short, tagged cast that replaces the 40-player dump. */
export function castBlock(facts: RecapFacts): string | null {
  if (!facts.cast.length && !facts.oppCast.length && !facts.oppCoach) return null;
  const parts = [
    "=== THE ONLY PEOPLE YOU MAY NAME ===",
    "  Each line is tagged with the team that owns him. A name not on this list does not exist:",
    "  write the role instead (\"their left tackle\"). Invented non-players — fans, a beat",
    "  writer, a booster, the PA announcer — are still yours to create.",
  ];
  for (const m of facts.cast) parts.push(castLine(m));
  for (const m of facts.oppCast) parts.push(castLine(m));
  if (facts.oppCoach) parts.push(`  [${facts.game?.them ?? "opponent"}] ${facts.oppCoach} — head coach`);
  return parts.join("\n");
}

/** The honest boundary of what anyone can know about this game. */
export function unknownBlock(facts: RecapFacts): string {
  return [
    "=== NOT IN THE SAVE (do not state these as fact) ===",
    ...facts.unknown.map((u) => `  ${u}`),
  ].join("\n");
}

/**
 * The locked-fact brief the recap prompt is built around. This is the whole point of the
 * port: what used to be a 40-player dump the model had to reason over is now a short table
 * the model writes prose around.
 */
export function recapBrief(facts: RecapFacts): string {
  return [lockedBlock(facts), castBlock(facts), unknownBlock(facts)].filter(Boolean).join("\n\n");
}
