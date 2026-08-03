// In-app content generation. This is the port of the old Node ingest generators
// (ingest/gen/*.js + ingest/generate.js) into the webview so NO sidecar process is
// spawned on a screen/situation load. The context is built from the already-parsed
// snapshot + delta the app holds in memory; the only native hop is a single HTTPS call
// to Claude (client.ts `claudeComplete` → Rust reqwest). One source of truth for every
// prompt lives here now.
//
// Each `kind` maps to a prompt spec; generateInApp() runs it, parses the JSON, and applies
// the same light normalization the sidecar modules did so screens degrade instead of break.

import {
  claudeComplete,
  openaiComplete,
  type DynastySnapshot,
  type LlmConfig,
  type Recruit,
  type RosterPlayer,
  type RtgPlayer,
  type WeekDelta,
} from "./client";
import { recordBaseline, rowFromReport } from "./baseline";
import { buildGroundTruth, validateGeneration } from "./validator";
import { lockedBlock, recapBrief, recapFacts } from "./recap";
import { nationalBrief, nationalFacts } from "./national";
import { coachResumeBlock, jobSecurityLine, priorSeasons, priorSeasonsBlock } from "./history";
import { postseasonBlock, postseasonOutlook, weekShape, type PostseasonOutlook } from "./postseason";
import { gameplan, gameplanBlock, positionRoom, roomBlock, rtgBrief, rtgFacts, type PlayerWeekState } from "./rtg";
import { characterBlock, type RtgCharacter } from "./rtg-character";
import { worldBlock } from "./world";
import { brandBlock, brandTier, TIER_NOTE, type BrandState, type FollowerResult } from "./brand";
import type { SeasonRecord } from "./archive";
import type { CoachBackstory } from "./saga";
import {
  EDGE_LABEL,
  SEVERITY_LABEL,
  TIER_LABEL,
  formLine,
  playerLine,
  scoutingMath,
  starterLine,
  tierFor,
} from "./scouting";
import { STANDING_LABEL, playerStandings, pressureBoard, pressureLine } from "./pressure";
import { weekStateOf } from "./week-state";
import { attackLine, profileLine } from "./traits";

export type { LlmConfig, RosterPlayer };

// Fixed, current Anthropic model. Do NOT auto-pick from the /models list — that approach
// preferred retired 2024 checkpoints (claude-3-5-sonnet-*) and added a network round-trip
// before the first generation. claude-sonnet-5 is the current generally-available Sonnet.
const MODEL = "claude-sonnet-5";
// Budget mode swaps to Haiku — a large per-token cost cut for users burning credits on the
// weekly auto-write. Sonnet stays the default for best quality.
const BUDGET_MODEL = "claude-haiku-4-5-20251001";

/** One transport call, routed by provider. Everything above this line is provider-agnostic.
 * `cachePrefix` is the shared week context: on Anthropic it rides as a prompt-cached block
 * (all sections of a week's issue share it, so tabs 2..N read it at ~10% input price); on
 * OpenAI-compatible providers it's simply prepended (those cache prefixes automatically). */
async function llmComplete(
  llm: LlmConfig,
  system: string,
  prompt: string,
  maxTokens: number,
  images?: string[],
  cachePrefix?: string
): Promise<string> {
  if (llm.provider === "openai") {
    if (!llm.baseUrl) throw new Error("OpenAI-compatible provider needs a base URL (set it in Settings → API keys).");
    return openaiComplete(
      llm.baseUrl,
      llm.apiKey,
      llm.model || "gpt-4o-mini",
      system,
      cachePrefix ? `${cachePrefix}\n\n${prompt}` : prompt,
      llm.noMaxTokens ? null : maxTokens,
      images
    );
  }
  return claudeComplete(
    llm.apiKey,
    system,
    prompt,
    maxTokens,
    llm.budgetMode !== false ? BUDGET_MODEL : MODEL,
    images,
    cachePrefix
  );
}

export const SYSTEM_PROMPT = [
  "You are the DynastyWire content engine, an AI college-football media simulator.",
  "Voice: bold, authentic, electric — late-night ESPN meets College GameDay. Sharp,",
  "unapologetic, real. Never sterile or generic.",
  "",
  "THIS IS A SIMULATED DYNASTY UNIVERSE — THE PROVIDED SAVE DATA IS THE ONLY REALITY:",
  "- The context (roster, recruits, teams, results, recurring cast) is the sole source of",
  "  truth. People and teams named there exist in this universe — use them exactly as given,",
  "  even if you recognize the name from the real world.",
  "- NEVER supplement from your own real-world college football knowledge: no career",
  "  histories, stats, awards, hometowns, storylines, past seasons, or 'famous moments' for",
  "  ANY name — even recognizable ones. What the context says about them is ALL that is true.",
  "- Never assume real-world conference alignments, rivalries, or league history from memory",
  "  (e.g. never reference the Pac-12 or a team's real-world conference). This universe's",
  "  timeline diverged from reality the moment the dynasty started.",
  "- OTHER PROGRAMS: their real coaches and players ARE in this save, and the context provides",
  "  them where known — a KNOWN HEAD COACHES list and an OPPONENT roster block. Use EXACTLY",
  "  those names for those teams. For any other-team individual NOT provided in the context,",
  "  never name them (not from real-world memory, not made up) — refer by role only: \"their",
  "  quarterback\", \"the head coach at Tulane\". An other-team name that isn't in the context",
  "  is a hard error.",
  "- Off-team CHARACTERS (reporters, fans, boosters, hosts) not named in the context are",
  "  fictional inventions with realistic names — never real-world figures from your memory.",
  "- THE HEAD COACH AND THE USER'S SCHOOL ARE THE MOST COMMON LEAKS. The coach is whoever the",
  "  context names — if it names no one, write \"the head coach\" and never supply a name. The",
  "  user's program is EXACTLY the school in the context; never drift to a different, more",
  "  famous program, and never attribute that school's real-world coach, roster, or history.",
  "",
  "RULES:",
  "1. Respond with valid JSON matching the exact schema requested. No markdown fences.",
  "2. Never invent scores, stats, ranks, or records. The context is the sole source of truth.",
  "3. If a team is stated UNRANKED, never assign it a poll number.",
  "4. Write in authentic CFB media voice with real terminology and culture.",
  "5. Match tone to the result — a blowout reads differently than a nail-biter.",
  // Ratings are the single loudest tell that this was written inside a video game. No beat
  // writer, coach, fan or analyst has ever said "our 87 overall left tackle" — the number
  // exists in the save, and the media's job is to translate it into how a player is talked
  // about. Every rating is therefore stripped from the context and replaced with the words
  // a staff would actually use.
  // Reported repeatedly: an average gets re-labelled with a denominator it never had. A back
  // averaging 97.5 rushing yards A GAME became "97.5 yards per carry" — a number that cannot
  // exist. Every rate in the context now states its own unit; this forbids changing it.
  "6. EVERY AVERAGE KEEPS THE UNIT IT IS GIVEN. If the context says PER GAME, it is per game;",
  "   if it says PER CARRY, it is per carry. NEVER re-label a rate, never divide one number by",
  "   another to invent a rate, and never compute an average the context did not give you. If",
  "   the rate you want is not listed, it is UNKNOWN — write the sentence without a number.",
  "7. NEVER write a player rating, an overall, an OVR, a 0-99 number, a letter grade for a",
  "   player, or any phrase like \"an 88 overall corner\" / \"rated 92\" / \"a 74 OVR backup\".",
  "   Those numbers do not exist in this universe. Real football language ONLY: all-conference,",
  "   a load in the middle, a burner, the weak link, a program-changer, a guy who's still a",
  "   year away, the reason they're ranked. When the context grades a player in words, use",
  "   THOSE words or your own football language — never convert them back into a number.",
].join("\n");

// House style for long-form articles (front page recap, national lead, featured wire
// stories). This is the anti-"AI article" contract: the goal is prose a reader would
// believe was filed by a human on deadline.
export const HOUSE_STYLE = [
  "=== HOUSE STYLE (non-negotiable — this is what separates real copy from AI filler) ===",
  "LEDE: Never open with the score, the date, or 'Team X defeated Team Y.' Open inside a",
  "moment — a play, a sound, a sideline detail, a person — and let the score arrive when",
  "the story needs it. Pick a DIFFERENT angle than the obvious one: the third-string guy,",
  "the coordinator's gamble, the drive that told the truth about this team.",
  "",
  "TEXTURE: Real game stories have concrete, specific detail. You may INVENT in-game texture",
  "(a 3rd-and-8 call, a 12-play drive, a dropped snap, the student section, the weather, a",
  "sideline exchange) as long as it never contradicts the actual score, quarters, records,",
  "or rankings provided. Vague hype ('dominant performance', 'weapons all over the field')",
  "is banned — replace every abstraction with a specific.",
  "",
  "QUOTES: Sound transcribed, not composed. Contractions, half-sentences, coach-speak evasions,",
  "a player saying something slightly off-message. Vary attribution ('said afterward', 'told",
  "reporters in the hallway', 'shrugged'). Never more than one quote per paragraph.",
  "",
  "RHYTHM: Vary sentence and paragraph length hard. Use an occasional one-sentence paragraph",
  "for weight. No lists dressed as prose, no 'three things' structures.",
  "",
  "BANNED PHRASES & MOVES (instant AI tells — never use): 'statement win', 'sent a message',",
  "'made a statement', 'wasn't just a win', 'more than just a game', \"isn't just X, it's Y\",",
  "'as the dust settles', 'as the final whistle blew', 'at the end of the day', 'one thing is",
  "clear', 'only time will tell', 'remains to be seen', 'a tale of two halves', 'had everything',",
  "'the story of the game', 'in a game that', 'proved the doubters wrong', 'found ways to win',",
  "'answered the call', 'took care of business', rhetorical questions as transitions, and",
  "wrapping up with a tidy moral. End on an image, a quote, or a hard fact — not a summary.",
  "",
  "VOICE: You are a specific writer with opinions, history with this beat, and a way of seeing",
  "the game. Commit to judgments ('the play-calling got scared') instead of balanced hedging.",
].join("\n");

// Fixed national radio pair so the show has continuity week to week (same reason the
// broadcast shows have recurring personas).
const NATIONAL_HOSTS = {
  analyst: "Marcus Bell",
  hotTake: '"Big Cat" Donnie Ray',
};

export interface MediaContext {
  systemPrompt: string;
  userContext: string;
  school: string;
  coachName: string;
  week: number | null;
  snapshot: DynastySnapshot;
  delta: WeekDelta | null;
  /** Real roster of the user's team (names/positions), when the parser has provided it. */
  roster: RosterPlayer[];
  /** The opponent in focus: this week's result, or the next game up. */
  opponent: string | null;
  /** That opponent's real roster, when the parser has provided it. */
  oppRoster: RosterPlayer[];
  /** Players who cannot play right now. */
  suspensions: ActiveSuspension[];
  /** Persistent coach identity + recurring cast, when the user has written one. */
  backstory: CoachBackstory | null;
  /** Year-over-year memory: the rendered PRIOR SEASONS table, or null in year one. Held
   * separately as well as folded into userContext, because the ported surfaces no longer
   * receive the shared blob and would silently lose the program's history with it. */
  history: string | null;
  /** True only when REAL prior seasons exist. `history` is now always non-null — it states
   * ignorance when the archive is empty — so anything that should only fire when there IS a
   * past must key on this instead. */
  hasHistory: boolean;
  /** The coach's career résumé from the save — titles, career record, record at THIS
   * school, tenure. Carried separately for the same reason as `history`. */
  resume: string | null;
  /** The league's own life: the game's own headlines, the record book, the carousel, the
   * anniversaries. Parsed, never generated — see world.ts. */
  world: string | null;
  /** What this team is playing for: bowl math, playoff standing, and whether a postseason
   * game is a bracket game or an ordinary bowl. Null when the save has no user team. */
  outlook: PostseasonOutlook | null;
  /** What this week actually is — "game" only when a real result exists; "pregame" when
   * this week's matchup is on the schedule but kickoff hasn't happened. */
  weekState: "game" | "pregame" | "preseason" | "bye" | "season-over";
  /** Season phase from the real calendar (regular / late / conf-champ / postseason round). */
  phase: PhaseInfo;
}

export interface GenerateOpts {
  team?: string;
  coach?: string;
  extra?: Record<string, unknown>;
  roster?: RosterPlayer[];
  /** The current opponent's real roster (this week's result, or the next scheduled game). */
  oppRoster?: RosterPlayer[];
  /** The coach's persistent backstory (saga) — folded into every generator's context so the
   * media universe stays consistent with who this coach is and their recurring cast. */
  backstory?: CoachBackstory | null;
  /** Players currently serving a suspension. Their save OVR is temporarily dropped to bench
   * them, so the context restores the REAL rating and states the suspension as hard fact —
   * otherwise every generator would hallucinate a star suddenly rated 40. */
  suspensions?: ActiveSuspension[];
  /** Every season this dynasty has archived (the Season Archive). Prior years become the
   * PRIOR SEASONS block; the season being played is filtered out inside history.ts, since
   * the archive checkpoints it continuously and feeding it back would let this week's own
   * result be written as history. */
  priorSeasons?: SeasonRecord[];
}

export interface ActiveSuspension {
  playerName: string;
  position?: string | null;
  reason: string;
  source: "situation" | "academics";
  weeksLeft: number;
  /** The player's true rating (captured before the temporary drop). */
  originalOverall: number | null;
}

function fmtRank(r: number | null | undefined): string {
  return r && r <= 25 ? `#${r} ` : "";
}

/**
 * A player's ability, in the only vocabulary this universe has.
 *
 * The save stores a 0-99 rating. Nobody in football talks that way — no beat writer has
 * written "our 87 overall left tackle", no fan has ever shouted it, and a rating number in
 * an article is the loudest possible signal that a video game wrote it. The number stays in
 * the app for sorting and math; it never reaches a prompt. The scouting report has graded in
 * words since v0.1.9 — this is that rule applied to every other surface, which is where it
 * was still leaking.
 */
function gradeWord(overall: unknown): string {
  // Takes `unknown` on purpose: several of these boards arrive as Record<string, unknown>
  // from the sidecar, and a rating slipping through as a raw value is exactly what this
  // function exists to prevent.
  const n = typeof overall === "number" && Number.isFinite(overall) ? overall : null;
  return TIER_LABEL[tierFor(n)];
}

// One compact stat line per player, from the save's real season stat tables. This is what
// lets the media REASON about the depth chart ("the freshman has 30 TDs; the senior has 6")
// instead of guessing from overalls.
type StatsSide = NonNullable<NonNullable<RosterPlayer["stats"]>["offense"]>;
function fmtOffense(o: StatsSide | null | undefined): string[] {
  if (!o) return [];
  const bits: string[] = [];
  if (o.passAtt) bits.push(`${o.passComp}/${o.passAtt}, ${o.passYds} pass yds, ${o.passTDs} TD, ${o.passInts} INT`);
  // Any real carry count counts — the old ">25 yards" gate hid short-yardage backs entirely.
  if (o.rushAtt || (o.rushYds != null && o.rushYds !== 0)) {
    bits.push(`${o.rushAtt ? `${o.rushAtt} car, ` : ""}${o.rushYds} rush yds, ${o.rushTDs} rush TD`);
  }
  if (o.recCatches) bits.push(`${o.recCatches} rec, ${o.recYds} yds, ${o.recTDs} TD`);
  const ret: string[] = [];
  if (o.kickRetYds) ret.push(`${o.kickRetYds} KR yds${o.kickRetTDs ? `, ${o.kickRetTDs} TD` : ""}`);
  if (o.puntRetYds) ret.push(`${o.puntRetYds} PR yds${o.puntRetTDs ? `, ${o.puntRetTDs} TD` : ""}`);
  if (ret.length) bits.push(ret.join("; "));
  return bits;
}
function fmtDefense(d: StatsSide | null | undefined): string[] {
  if (!d) return [];
  const bits: string[] = [];
  if (d.tackles) bits.push(`${d.tackles} tkl`);
  if (d.tfl) bits.push(`${d.tfl} TFL`);
  if (d.sacks) bits.push(`${d.sacks} sacks`);
  if (d.ints) bits.push(`${d.ints} INT`);
  if (d.deflections) bits.push(`${d.deflections} PD`);
  if (d.forcedFumbles) bits.push(`${d.forcedFumbles} FF`);
  return bits;
}

function fmtKicking(k: StatsSide | null | undefined): string[] {
  if (!k) return [];
  const bits: string[] = [];
  if (k.fgAtt) {
    const long = k.fgLong ? `, long ${k.fgLong}` : "";
    const deep = k.fgAtt50Plus ? `, ${k.fgMade50Plus}/${k.fgAtt50Plus} from 50+` : "";
    bits.push(`${k.fgMade}/${k.fgAtt} FG${long}${deep}`);
  }
  if (k.xpAtt) bits.push(`${k.xpMade}/${k.xpAtt} XP`);
  if (k.gameWinners) bits.push(`${k.gameWinners} game-winner${k.gameWinners === 1 ? "" : "s"}`);
  if (k.punts) {
    const avg = k.puntYds && k.punts ? ` (${(k.puntYds / k.punts).toFixed(1)} avg)` : "";
    const in20 = k.puntIn20 ? `, ${k.puntIn20} inside the 20` : "";
    const long = k.puntLong ? `, long ${k.puntLong}` : "";
    bits.push(`${k.punts} punts, ${k.puntYds} yds${avg}${in20}${long}`);
  }
  return bits;
}

/**
 * The number the writer has never been given, and the reason he takes the wrong one.
 *
 * Reported from a real save: "my running back had 900+ yards in a single game with 100+
 * carries." That is the season total, printed as a game line. The prompt has told the model
 * not to do this for six lines and it still does — because a recap NEEDS a per-game number
 * and, with only a cumulative total in front of it, the total is the only number there is.
 *
 * A per-game average is computable, true, and usable in a sentence. It is labelled as an
 * average so it cannot be passed off as tonight's line either.
 */
function fmtPerGame(s: NonNullable<RosterPlayer["stats"]>): string {
  const gp = s.gamesPlayed;
  if (gp == null || gp < 2) return "";
  const o = s.offense ?? (s.side === "offense" ? s : null);
  const d = s.defense ?? (s.side === "defense" ? s : null);
  const rate = (v: number | null | undefined, by: number | null | undefined) =>
    typeof v === "number" && typeof by === "number" && by > 0 ? Math.round((v / by) * 10) / 10 : null;
  const avg = (v: number | null | undefined) => rate(v, gp);

  // EVERY NUMBER CARRIES ITS OWN DENOMINATOR. Reported from a real save: a back averaging
  // 97.5 rushing yards A GAME was written up as "97.5 yards per carry", which is not a
  // possible number. The unit was in the header and the figure itself was bare, so the model
  // was free to attach any denominator it liked to it.
  const bits: string[] = [];
  const pass = avg(o?.passYds);
  const rush = avg(o?.rushYds);
  const rec = avg(o?.recYds);
  const tkl = avg(d?.tackles);
  if (pass) bits.push(`${pass} pass yds PER GAME`);
  if (rush) bits.push(`${rush} rush yds PER GAME`);
  if (rec) bits.push(`${rec} rec yds PER GAME`);
  if (tkl) bits.push(`${tkl} tackles PER GAME`);

  // And give the real per-attempt rates, so the writer never has to derive one. A number he
  // has is a number he cannot get wrong.
  const ypc = rate(o?.rushYds, o?.rushAtt);
  const ypr = rate(o?.recYds, o?.recCatches);
  const ypa = rate(o?.passYds, o?.passAtt);
  if (ypc) bits.push(`${ypc} yds PER CARRY`);
  if (ypr) bits.push(`${ypr} yds PER CATCH`);
  if (ypa) bits.push(`${ypa} yds PER PASS ATTEMPT`);

  if (!bits.length) return "";
  return (
    ` — RATES (each already divided; use the one whose label matches what you are saying, and` +
    ` NEVER re-divide or re-label one): ${bits.join(", ")}`
  );
}

function fmtStats(p: RosterPlayer): string | null {
  const s = p.stats;
  if (!s) return null;
  // Every line is prefixed with what it IS. A label at the top of the block is easy to lose
  // forty players later; a label welded to the number is not.
  const label = (line: string) =>
    `SEASON TOTALS${s.gamesPlayed != null ? ` across ${s.gamesPlayed} games` : ""} (NOT one game): ${line}`;
  if (s.side === "kicking") {
    const bits = fmtKicking(s.kicking ?? s);
    return bits.length ? label(bits.join("; ") + fmtAppearances(s)) : null;
  }
  // Two-way players (both sides this season) show BOTH lines — a community ask.
  if (s.twoWay && s.offense && s.defense) {
    const off = fmtOffense(s.offense).join("; ");
    const def = fmtDefense(s.defense).join("; ");
    if (off || def) {
      return label(`TWO-WAY — OFF: ${off || "—"} | DEF: ${def || "—"}`) + fmtPerGame(s);
    }
  }
  const bits = s.side === "offense" ? fmtOffense(s.offense ?? s) : fmtDefense(s.defense ?? s);
  if (!bits.length) return null;
  return label(bits.join("; ") + fmtAppearances(s)) + fmtPerGame(s);
}

// Games played/started, stated only when the save actually gives us both and they're
// coherent. Starts are omitted when unavailable rather than guessed — reporting phantom
// starts for a backup is worse than saying nothing.
function fmtAppearances(s: NonNullable<RosterPlayer["stats"]>): string {
  const gp = s.gamesPlayed;
  const gs = s.gamesStarted;
  if (gp == null) return "";
  if (gs == null) return ` (${gp} games played)`;
  return ` (${gs} starts / ${gp} games played)`;
}

// The save's five player personalities → how that player behaves under pressure. Injected
// wherever players talk, react, or get pulled into drama, so an Intense player stands his
// ground where a TeamPlayer would smooth it over.
const PERSONALITY_RULES = [
  "PLAYER PERSONALITIES (from the save — every rostered player carries one; it GOVERNS his behavior):",
  "- Intense: confrontational and unbending. If he calls someone out, he does NOT walk it back —",
  "  he doubles down. Short fuse with reporters, holds grudges, respects only directness.",
  "- Leader: takes accountability publicly, protects teammates, steadies the room. Confronts",
  "  privately, defends publicly. The one who calls the players-only meeting.",
  "- TeamPlayer: deflects credit, avoids drama, toes the company line. If dragged into conflict",
  "  he de-escalates and may backtrack — that's in character for HIM, not for others.",
  "- Entertainer: loves the cameras and the mic. Stirs things up half-joking, lives on social",
  "  media, turns beef into content. Never boring quotes.",
  "- Unpredictable: nobody knows which version shows up. Might apologize, might torch the whole",
  "  room, might go silent for a week. Write him with genuine volatility.",
  "A player's words, texts, apologies (or refusals to apologize), and locker-room moves must",
  "match HIS listed personality — never give every player the same conflict-averse voice.",
].join("\n");

export interface PhaseInfo {
  key: "regular" | "late-season" | "conf-champ" | "postseason" | "offseason";
  label: string;
  /** Postseason round name when key === "postseason" — "National Championship", or
   * "Bowl Game" for the ~120 teams playing a postseason game outside the bracket. */
  roundName: string | null;
  /** True once the CFP bracket is set — kills all résumé/committee/bubble talk. */
  bracketSet: boolean;
  /** True ONLY when this team is playing inside the playoff bracket. A postseason week is a
   * BOWL week for almost everybody, and assuming otherwise is what turned a Sun Belt team's
   * bowl game into "a first round playoff matchup". */
  playoffGame: boolean;
  pressNote: string;
}

// The season phase, computed from the save's REAL calendar (SeasonInfo) rather than a
// hardcoded week number. This is what makes "we are IN the playoff / this is the natty"
// true instead of guessed — and what stops a team playing in the bracket being written
// about as if it's still building a résumé for the committee.
export function computePhase(
  calendar: DynastySnapshot["calendar"] | null | undefined,
  weekPlayed: number | null | undefined,
  /** What this team is actually playing for. Without it a postseason week has to ASSUME the
   * playoff, which is wrong for the ~120 teams in ordinary bowls. */
  outlook: PostseasonOutlook | null = null
): PhaseInfo {
  const w = weekPlayed ?? 0;
  const shape = weekShape(calendar, weekPlayed);
  const confChamp = shape.confChampWeek;
  const psWeeks = shape.roundsTotal;
  const weekType = calendar?.weekType ?? null; // "RegularSeason" | "BowlSeason1..4" | ...

  // OFFSEASON — the save's stage says we're between seasons (portal window, signing day,
  // coaching carousel, spring). Detect from CurrentStage / week-type so no game is invented.
  if (shape.inOffseason) {
    const os = calendar?.offseasonStage ?? null;
    const total = calendar?.offseasonNumStages ?? null;
    return {
      key: "offseason",
      label: total != null && os != null ? `OFFSEASON — stage ${os + 1} of ${total}` : "OFFSEASON",
      roundName: null,
      bracketSet: false,
      playoffGame: false,
      pressNote:
        "It is the OFFSEASON — there are NO games this week and NO results to report. Do NOT invent, " +
        "recap, or reference any game. Coverage is offseason business: the transfer portal, recruiting " +
        "and signing day, the coaching carousel, roster churn, spring outlook, and expectations for next " +
        "season. Frame everything as between-seasons, forward-looking — never as a game week.",
    };
  }

  if (shape.inPostseason) {
    // THE BUG THIS BRANCH EXISTS TO FIX: "BowlSeason1" is the first week of the POSTSEASON,
    // not the first round of the PLAYOFF. Roughly 120 of 134 teams spend it in an ordinary
    // bowl, so mapping the week straight onto a bracket round wrote a Sun Belt team's bowl
    // game up as "a first round playoff matchup" — reported from a real save.
    const inBracket = outlook ? outlook.inPlayoffGame : true;
    if (!inBracket) {
      return {
        key: "postseason",
        label: "POSTSEASON — Bowl Game (NOT a playoff game)",
        roundName: "Bowl Game",
        bracketSet: true,
        playoffGame: false,
        pressNote:
          "This is a BOWL GAME, not a playoff game — this team is NOT in the playoff field. It " +
          "is ONE game and the season ends with it either way: nothing to advance to, nothing " +
          "to be eliminated from, no bracket, no seeding, no title implications. NEVER call it " +
          "a playoff game, a playoff round, a first-round/opening-round matchup, a " +
          "quarterfinal, a semifinal, or a New Year's Six bowl, and never say a win advances " +
          "them. Do NOT mention the selection committee, résumés or the bubble — that window " +
          "is closed and it was never about this team. Cover what a bowl week actually is: the " +
          "reward for the season, the extra practices, opt-outs and the portal, the seniors' " +
          "last game, and what a win would mean for next year's momentum.",
      };
    }
    const round = shape.round;
    const fromEnd = psWeeks - round; // 0 = the final
    let roundName: string;
    if (fromEnd <= 0) roundName = "National Championship";
    else if (fromEnd === 1) roundName = "Playoff Semifinal";
    else if (fromEnd === 2) roundName = "Playoff Quarterfinal";
    else if (round === 1) roundName = "Playoff First Round";
    else roundName = `Playoff Round ${round}`;
    const isFinal = fromEnd <= 0;
    return {
      key: "postseason",
      label: `POSTSEASON — ${roundName}`,
      roundName,
      bracketSet: true,
      playoffGame: true,
      pressNote:
        `THE PLAYOFF FIELD IS SET — this is the ${roundName}, and the selection committee has ` +
        "ALREADY made every pick. Do NOT mention résumés, the committee, 'the bubble', 'making " +
        "the field', at-large bids, or seeding debates — that window is CLOSED. This is win-or-" +
        (isFinal
          ? "lose for the NATIONAL TITLE: one game, everything on the line, no tomorrow. Cover the moment, the run to get here, the matchup, opt-out/NFL-draft shadows, and legacy."
          : "go-home: advance or the season is over. Cover the matchup, the run this team is on, what it takes to survive, and opt-out/NFL-draft shadows."),
    };
  }
  // Before the postseason, the stakes note has to follow what this team is actually chasing.
  // A flat "the résumé matters / connect this to the CFP picture" is how an unranked 7-3 Sun
  // Belt team ended up being written as fighting for a playoff spot every single week.
  const chase =
    outlook == null
      ? ""
      : outlook.standing === "out"
        ? outlook.bowlEligible
          ? " THIS TEAM IS UNRANKED AND NOT IN THE PLAYOFF RACE, and it is ALREADY bowl eligible: the live questions are which bowl, the conference race, and finishing strong — NOT the CFP, the committee, the bubble, a New Year's Six bid, or bowl eligibility, which is settled."
          : " THIS TEAM IS UNRANKED AND NOT IN THE PLAYOFF RACE: the live question is bowl eligibility and the conference race — NOT the CFP, the committee, the bubble, or a New Year's Six bid."
        : outlook.standing === "longshot"
          ? " They are ranked but well outside the field — the playoff is a long shot needing help, never the working assumption."
          : "";
  if (w === confChamp || weekType === "ConferenceChampionship") {
    return {
      key: "conf-champ",
      label: "CONFERENCE CHAMPIONSHIP WEEK",
      roundName: null,
      bracketSet: false,
      playoffGame: false,
      pressNote:
        "Championship-week press: the conference title on the line, what a win or loss creates, and revenge/rematch angles. The bracket is NOT set yet — this game helps decide it." +
        chase,
    };
  }
  if (w >= 11) {
    return {
      key: "late-season",
      label: "LATE SEASON — stakes week",
      roundName: null,
      bracketSet: false,
      playoffGame: false,
      pressNote:
        "November press: the season's math is live. Questions connect this result to what this team is actually playing for, rivalry stakes, and seniors' last rides." +
        chase,
    };
  }
  return {
    key: "regular",
    label: "REGULAR SEASON",
    roundName: null,
    bracketSet: false,
    playoffGame: false,
    pressNote:
      "Regular-season press: this game, the next opponent, position battles, and week-to-week development." +
      chase,
  };
}

/** @deprecated week-only shim — prefer ctx.phase (computed from the real calendar). */
export function seasonPhase(week: number | null | undefined): PhaseInfo {
  return computePhase(null, week);
}

const COACH_ROLE_LABEL: Record<string, string> = {
  HeadCoach: "Head Coach",
  OffensiveCoordinator: "Offensive Coordinator",
  DefensiveCoordinator: "Defensive Coordinator",
};

// Social feed anti-sameness engine. The complaint was "it loads the same reactions every
// week." Two levers: (1) a deep, rotating cast of account archetypes so it isn't always the
// same five voices, and (2) a week-seeded rotation so consecutive weeks emphasize different
// corners of the fanbase. The model still returns the fixed 5 `type` values, but the PERSONA
// behind each post rotates, which is what makes the feed feel alive.
const SOCIAL_ARCHETYPES = [
  "a face-painted superfan who has been to every game since the 90s",
  "the student-section barstool account",
  "a stats nerd who quote-tweets with advanced numbers",
  "a former player of this program now doing media",
  "the local sports-radio host fishing for callers",
  "a burner account that only shows up after wins",
  "a doom-posting fan convinced it'll all fall apart",
  "a bandwagon fan who just discovered the team",
  "an opposing team's fan lurking to talk trash",
  "a recruiting insider dropping cryptic hints",
  "a parent of a player posting proud (slightly cringe) support",
  "a meme account that turns everything into a copypasta",
  "a beat writer subtweeting something they can't print",
  "a degenerate bettor reacting to the line and their parlay",
  "a national pundit weighing in from 30,000 feet",
  "the official-sounding but clearly fan-run hype account",
  "a nostalgic alum comparing this team to a past era",
  "a first-year student experiencing the fandom for the first time",
];

function socialVarietyBlock(ctx: MediaContext): string {
  // Deterministic per (dynasty, year, week) so a given week has a stable-but-distinct
  // flavor, and week N+1 rotates to a different slice of the cast.
  const seed = Math.abs((ctx.week ?? 0) * 31 + (ctx.snapshot.year ?? 0) * 7);
  const pick: string[] = [];
  for (let i = 0; i < 6; i++) {
    pick.push(SOCIAL_ARCHETYPES[(seed + i * 5) % SOCIAL_ARCHETYPES.length]);
  }
  return [
    "VARIETY ENGINE — the feed must feel ALIVE and NEW, never a rerun of last week:",
    "- Behind the 5 required `type` values, give each post a DISTINCT persona and voice. This",
    "  week, make sure these archetypes are represented among the posts:",
    ...pick.map((a) => `    • ${a}`),
    "- No two posts may share the same joke structure, opener, or cadence. Vary length wildly:",
    "  some are three words, some are a mini-thread. Vary emoji/hashtag use.",
    "- Invent FRESH handles and display names — do not reuse generic ones like @CFBFan or",
    "  @Gameday. Handles should feel like real people (@brant_ksu, @PurplePrideMom, @thirdstring_qb).",
    "- Anchor at least half the posts to SPECIFIC real details from the context (a player by",
    "  name and his real numbers, the exact score, the coach's decision, the opponent).",
    ctx.phase.playoffGame
      ? "- It's the playoff — the feed is at maximum intensity: nerves, superstition, ticket-price jokes, legacy talk."
      : ctx.phase.key === "postseason"
        ? "- It's BOWL WEEK, not the playoff — the feed is bowl-week energy: the trip, the matchup nobody asked for, opt-out discourse, seniors' last ride, and gallows humour about the bowl's sponsor. Nobody is talking about a bracket."
        : "",
  ]
    .filter(Boolean)
    .join("\n");
}

// Repair a model's almost-JSON. Long creative payloads (4k+ tokens) routinely slip on:
// literal newlines inside strings, a missing comma between array/object elements, a
// trailing comma, or truncation mid-structure. One string-aware scan fixes all of these.
function repairModelJson(jsonStr: string): string {
  let inString = false;
  let escaped = false;
  let out = "";
  // Last emitted non-whitespace char OUTSIDE strings (structural context).
  let lastStructural = "";

  for (let i = 0; i < jsonStr.length; i++) {
    const char = jsonStr[i];
    if (inString) {
      if (escaped) {
        out += char;
        escaped = false;
      } else if (char === "\\") {
        out += char;
        escaped = true;
      } else if (char === '"') {
        inString = false;
        out += char;
        lastStructural = '"';
      } else if (char === "\n") {
        out += "\\n"; // literal newline inside a string
      } else if (char === "\r") {
        // drop
      } else if (char === "\t") {
        out += "\\t";
      } else {
        out += char;
      }
      continue;
    }
    if (char === '"') {
      // Missing comma between elements: a value just ended (") } ]) and a new one starts.
      if (lastStructural === '"' || lastStructural === "}" || lastStructural === "]") {
        out += ",";
      }
      inString = true;
      out += char;
      continue;
    }
    if (char === "{" || char === "[") {
      if (lastStructural === '"' || lastStructural === "}" || lastStructural === "]") {
        out += ",";
      }
      out += char;
      lastStructural = char;
      continue;
    }
    if (char === "}" || char === "]") {
      // Trailing comma: strip a comma emitted just before this closer.
      const trimmed = out.replace(/,\s*$/, "");
      out = trimmed + char;
      lastStructural = char;
      continue;
    }
    out += char;
    if (!/\s/.test(char)) lastStructural = char;
  }

  // Truncation: close any structures the model never finished.
  if (inString) out += '"';
  // Re-scan the repaired text for unbalanced closers (string-aware).
  const stack: string[] = [];
  let inS = false;
  let esc = false;
  for (const ch of out) {
    if (inS) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inS = false;
      continue;
    }
    if (ch === '"') inS = true;
    else if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") {
      if (stack[stack.length - 1] === ch) stack.pop();
    }
  }
  out = out.replace(/,\s*$/, "");
  while (stack.length) out += stack.pop();
  return out;
}

export function parseJSON<T = Record<string, unknown>>(raw: string): T | null {
  // Strip markdown fences / prose around the object, then parse; on failure run the
  // string-aware repair pass. Never leak the raw blob into UI state — callers get null
  // and the details go to the console for bug reports.
  const s = raw.indexOf("{");
  const e = raw.lastIndexOf("}");
  const candidate = s >= 0 && e > s ? raw.slice(s, e + 1) : raw;
  try {
    return JSON.parse(candidate) as T;
  } catch {
    try {
      return JSON.parse(repairModelJson(candidate)) as T;
    } catch (err2) {
      console.warn(
        "[dynastywire] model JSON unrecoverable:",
        err2 instanceof Error ? err2.message : err2,
        "\nraw:",
        raw.slice(0, 2000)
      );
      return null;
    }
  }
}

// Render the real delta + season state into the shared userContext text block. Ported
// faithfully from ingest/generate.js buildMediaContext, tolerant of a null delta (the very
// first ingest has no baseline to diff against yet).
/**
 * Persistent coach + program identity. Written once on the Coach tab, then fed to every
 * generator so recaps, social, pressers and situations all know who this coach is and
 * reuse the same recurring cast instead of inventing new ones.
 *
 * Extracted so the surfaces that build their own context (the deterministic recap) and the
 * shared blob stay the same text — a coach who is a disciplinarian on one tab and a
 * players-coach on the next is its own kind of hallucination.
 */
export function identityBlock(backstory: CoachBackstory | null): string[] {
  if (!backstory) return [];
  const parts: string[] = [];
  parts.push("=== COACH IDENTITY (persistent — keep every story consistent with this) ===");
  parts.push(`Archetype: ${backstory.archetype}`);
  if (backstory.bio) parts.push(`Bio: ${backstory.bio}`);
  parts.push("Recurring cast (reuse these exact names; do NOT invent replacements):");
  if (backstory.adName) parts.push(`  Athletic Director: ${backstory.adName}`);
  if (backstory.boosterName) parts.push(`  Lead booster: ${backstory.boosterName}`);
  if (backstory.reporterName) parts.push(`  Lead beat writer: ${backstory.reporterName} (byline/reporter of record for this program)`);
  if (backstory.rivalCoachName) parts.push(`  Rival head coach: ${backstory.rivalCoachName}`);
  parts.push("");

  // The PROGRAM's own identity — an FCS team that just moved up, or a brand-new
  // TeamBuilder school, must not be covered like a generic established FBS program.
  const sit = backstory.programSituation;
  if (sit && sit !== "established") {
    parts.push("=== PROGRAM IDENTITY (this is what this school IS — never contradict it) ===");
    parts.push(SITUATION_BRIEF[sit] ?? "");
    if (backstory.programNote) parts.push(`The coach's own account of the program: ${backstory.programNote}`);
    if (backstory.programBio) parts.push(backstory.programBio);
    parts.push(
      "Frame coverage around this reality: the stakes, the doubters, the resources, and what",
      "counts as success here are all set by it. NEVER invent a decorated history, a national",
      "title, or traditions this program does not have."
    );
    parts.push("");
  } else if (backstory.programBio) {
    parts.push("=== PROGRAM IDENTITY ===");
    parts.push(backstory.programBio);
    parts.push("");
  }
  return parts;
}

export function buildMediaContext(
  delta: WeekDelta | null,
  after: DynastySnapshot,
  opts: GenerateOpts = {}
): MediaContext {
  const d: WeekDelta =
    delta ?? {
      weekPlayed: after.week,
      userTeam: after.userTeam?.name ?? null,
      gamesPlayed: 0,
      userResult: null,
      results: [],
      rankingMoves: [],
    };

  const u = after.userTeam;
  const knownSchool = u?.name?.trim() || opts.team?.trim() || null;
  const school = knownSchool ?? "the team";
  // When neither the save nor settings supply a coach name we must say so LOUDLY. Left as a
  // bare "the head coach", models filled the blank with the program's real-world coach
  // (e.g. South Carolina → Shane Beamer). Unknown must stay unknown.
  const knownCoach = opts.coach?.trim() || after.coachName?.trim() || null;
  const coachName = knownCoach ?? "the head coach";
  const g = d.userResult;

  const parts: string[] = [];
  parts.push("=== DYNASTY CONTEXT ===");
  // The season was never stated anywhere in the context, so every generator fell back to
  // whatever year its training suggested — social posts were dating losses to "2024" in a
  // save eight seasons past it.
  if (after.year != null) {
    parts.push(
      `Season: ${after.year}. THIS is the current year in this universe — every reference to ` +
        `"this season", "last year", or any date is relative to ${after.year}. NEVER date anything ` +
        "to a real-world season, and never assume the present is any year but this one." +
        (after.dynastyYear != null ? ` (Year ${after.dynastyYear} of the dynasty.)` : "")
    );
  }
  parts.push(
    knownSchool
      ? `Program: ${knownSchool} — this IS the user's program. Every story is about ${knownSchool} ` +
        "and no other school. Do not drift to a bigger-name program, and ignore anything you " +
        `think you know about the real-world ${knownSchool}.`
      : "Program: NOT IDENTIFIED. Write only about \"the program\" / \"the team\" — do NOT pick a " +
        "school name, and never default to a famous one."
  );
  if (u) {
    // The record is authoritative AND already final for this week. Stated bare, models added
    // the week's result to it a second time ("4-3" + a loss reported as "now 4-4"), and
    // inferred games played from the week number — which is wrong the moment a bye exists.
    const gp = (u.wins ?? 0) + (u.losses ?? 0) + (u.ties ?? 0);
    const wkNum = d.weekPlayed;
    const byes = wkNum != null && wkNum > gp ? wkNum - gp : 0;
    parts.push(
      `Record: ${u.wins}-${u.losses}` +
        (u.confWins != null ? ` (${u.confWins}-${u.confLosses} conf)` : "") +
        ` — ${gp} games played. THIS RECORD IS FINAL AND ALREADY INCLUDES this week's result.` +
        " Do NOT add this week's win or loss to it, and do NOT state any other record."
    );
    if (byes > 0 && wkNum != null) {
      parts.push(
        `NOTE: it is Week ${wkNum} but only ${gp} games have been played — this team has had ` +
          `${byes} bye week${byes === 1 ? "" : "s"}. NEVER infer games played, or a record, from ` +
          "the week number."
      );
    }
    parts.push(
      u.rankMedia
        ? `AP ranking: #${u.rankMedia}`
        : "AP ranking: UNRANKED (not in the AP Top 25 — do NOT assign this team any poll number)"
    );
    if (u.prestige != null) parts.push(`Program prestige: ${u.prestige}/10`);
  }
  parts.push(
    knownCoach
      ? `Head coach: ${knownCoach} (this is the ONLY name for this program's head coach — never substitute another)`
      : "Head coach: NAME NOT PROVIDED. Refer to them ONLY as \"the head coach\" or \"the staff\". " +
        "Do NOT name them, and NEVER use the real-world coach of this program — inventing or " +
        "recalling a name here is a hard error."
  );

  // The user's actual job from the save. A coordinator's media universe is different: the
  // press asks them about their unit and play-calling, and program-level heat lands on the
  // (separate) head coach.
  const coachPosition = after.coach?.position ?? null;
  const isCoordinator = coachPosition != null && coachPosition !== "HeadCoach";
  if (isCoordinator) {
    const roleLabel = COACH_ROLE_LABEL[coachPosition] ?? coachPosition;
    parts.push(
      `USER'S ROLE: ${knownCoach ?? "the user"} is the ${roleLabel} — NOT the head coach. ` +
        `All coverage of ${knownCoach ?? "them"} is coordinator coverage: their unit's performance, ` +
        "play-calling, development, and their rising (or falling) stock for future head-coaching jobs. " +
        "Program-level decisions belong to the head coach (unnamed unless provided) — never conflate the two."
    );
  }

  // Phase from the REAL calendar (SeasonInfo), not a hardcoded week. This is the single
  // source of playoff-round truth every tab reads.
  //
  // The calendar says WHEN we are; the outlook says what this team is PLAYING FOR, and the
  // phase needs the second to describe the first honestly — a postseason week is a bowl week
  // for almost every program. Both read `weekShape`, so they can never disagree about
  // whether this is the postseason at all.
  const outlook = postseasonOutlook({
    team: u ?? null,
    games: after.games ?? [],
    userRow: after.userTeamRow,
    calendar: after.calendar,
    week: d.weekPlayed,
    inPostseason: weekShape(after.calendar, d.weekPlayed).inPostseason,
  });
  const phase = computePhase(after.calendar, d.weekPlayed, outlook);
  const weekDesc =
    phase.key === "postseason" && phase.roundName
      ? `${d.weekPlayed} — ${phase.roundName} (postseason; regular season is OVER)`
      : phase.key === "conf-champ"
        ? `${d.weekPlayed} (Conference Championship Week)`
        : `${d.weekPlayed}`;
  parts.push(`Week: ${weekDesc}`);
  parts.push(`SEASON PHASE: ${phase.label}`);
  // The phase note goes into the SHARED context, so recaps, social, shows, national, and
  // rankings all obey it — not just the press-conference tab.
  parts.push(phase.pressNote);
  if (phase.playoffGame) {
    parts.push(
      "REMINDER FOR EVERY STORY THIS WEEK: this team is playing INSIDE the playoff bracket. " +
        "Any line about 'needing to impress the committee', 'building a résumé', 'staying in " +
        "the hunt', or 'the bubble' is factually WRONG and must not appear."
    );
  }
  parts.push("");

  // The stakes, computed. This is the block that answers "fighting for bowl eligibility" at
  // 7-3 and "pushing for a New Year's Six" while unranked: both were the model supplying
  // stakes because the context stated only the week. It goes in the SHARED context, so the
  // press conference, the situation room and the wire all obey the same arithmetic.
  const stakesBlock = postseasonBlock(outlook);
  if (stakesBlock) {
    parts.push(stakesBlock);
    parts.push("");
  }

  // The opponent in focus: this week's result, or (bye/preseason) the next scheduled game.
  let opponentName: string | null = null;

  if (g) {
    const userIsHome = g.home === school;
    const isNeutralSite = d.weekPlayed != null && d.weekPlayed >= 16;
    const location = isNeutralSite ? "neutral site (NOT a home game)" : (userIsHome ? "home" : "away");
    const usScore = userIsHome ? g.homeScore : g.awayScore;
    const oppScore = userIsHome ? g.awayScore : g.homeScore;
    const oppName = userIsHome ? g.away : g.home;
    opponentName = oppName;
    const oppRank = userIsHome ? g.rankAway : g.rankHome;
    const won = (usScore ?? 0) > (oppScore ?? 0);
    parts.push("=== THIS WEEK'S GAME (source of truth) ===");
    parts.push(
      `${school} ${won ? "defeated" : "lost to"} ${fmtRank(oppRank)}${oppName}, ` +
        `${usScore}-${oppScore} (${location}).`
    );
    parts.push(`Result: ${won ? "WIN" : "LOSS"} · Margin: ${Math.abs((usScore ?? 0) - (oppScore ?? 0))}`);
    parts.push("");
  }

  // Single source of truth, shared with the UI (see week-state.ts) so a screen can never
  // announce "post-game" while the model was told kickoff hasn't happened.
  const weekState: MediaContext["weekState"] = weekStateOf(after, d);
  if (!g) {
    // No result this week. This is NOT a vacuum for the model to fill with an invented
    // game — it's one of four real states (weekState, above), each with its own frame.
    const row = after.userTeamRow;
    const nextGame =
      row != null
        ? (after.games ?? [])
            .filter((gm) => (gm.homeRow === row || gm.awayRow === row) && !gm.played)
            .sort((a, b) => (a.year ?? 0) - (b.year ?? 0) || (a.week ?? 0) - (b.week ?? 0))[0] ?? null
        : null;
    const nextOppRow = nextGame ? (nextGame.homeRow === row ? nextGame.awayRow : nextGame.homeRow) : null;
    const nextOpp = nextOppRow != null ? after.teams?.[String(nextOppRow)] ?? null : null;
    const nextOppLine = nextOpp
      ? `Next opponent: ${nextOpp.rankMedia ? `#${nextOpp.rankMedia} ` : ""}${nextOpp.name} (${nextOpp.wins ?? 0}-${nextOpp.losses ?? 0})${nextGame?.week != null ? `, Week ${nextGame.week}` : ""}.`
      : "Next opponent: not on the schedule yet.";
    opponentName = nextOpp?.name ?? null;

    if (weekState === "preseason") {
      parts.push("=== SEASON NOT STARTED (Week 0 / preseason — source of truth) ===");
      parts.push(
        `${school} has NOT played a game yet this season. There is NO result to cover.`,
        "HARD RULE: do not invent, imply, or recap ANY game, score, scrimmage result, or stat",
        "from this season — none exist. This is BEGINNING-OF-SEASON coverage: expectations,",
        "camp battles, the roster (real names/stats from last season where provided), what this",
        "season means for the program and the coach, and the opener ahead.",
        nextOppLine
      );
    } else if (weekState === "pregame") {
      // This week's matchup is on the schedule but kickoff hasn't happened — not a bye and
      // not a result. (The "phantom score for a game we haven't played" bug.)
      parts.push("=== THIS WEEK'S GAME: NOT PLAYED YET (source of truth) ===");
      parts.push(
        `${school} (${u?.wins ?? 0}-${u?.losses ?? 0}) plays ${nextOpp?.rankMedia ? `#${nextOpp.rankMedia} ` : ""}${nextOpp?.name ?? "their next opponent"}${nextOpp ? ` (${nextOpp.wins ?? 0}-${nextOpp.losses ?? 0})` : ""} THIS WEEK (Week ${d.weekPlayed}). Kickoff has NOT happened.`,
        "HARD RULE: there is NO score, NO outcome, and NO post-game anything for this matchup —",
        "do not invent one, do not recap it, do not state a prediction as a result. Any earlier",
        "meeting between these teams (a past season) is history, NOT this game.",
        "This is PREGAME coverage: the matchup preview, keys to the game, how the two rosters",
        "stack up (use the real rosters and stat lines provided), injuries, stakes, and the",
        "buildup. Predictions are allowed only as clearly-framed opinion."
      );
    } else if (weekState === "season-over") {
      parts.push("=== NO GAME THIS WEEK — LATE/POST SEASON (source of truth) ===");
      parts.push(
        `${school} (${u?.wins ?? 0}-${u?.losses ?? 0}) did not play this week. Do NOT invent a game or result.`,
        "This is END-OF-SEASON coverage: the season's arc in the rearview, what the record and",
        "résumé mean, bowl/playoff waiting rooms, portal and recruiting stakes, awards cases,",
        "and what comes next for the program.",
        nextOppLine
      );
    } else {
      parts.push("=== BYE WEEK (source of truth) ===");
      parts.push(
        `${school} (${u?.wins ?? 0}-${u?.losses ?? 0}) is on a BYE. There is NO game and NO result this week.`,
        "HARD RULE: do not invent, imply, or recap any game played by this team this week.",
        "This is BYE-WEEK coverage: getting healthy, self-scouting, the season so far, players",
        "stepping up in practice, coaches on the recruiting road, and the next opponent looming.",
        nextOppLine
      );
    }
    parts.push("");
  }

  const ranked = d.results
    .filter((r) => (r.rankHome && r.rankHome <= 25) || (r.rankAway && r.rankAway <= 25))
    .filter((r) => !r.userInvolved)
    .slice(0, 6);
  if (ranked.length) {
    parts.push("=== AROUND THE NATION (this week, ranked teams) ===");
    for (const r of ranked) {
      parts.push(`  ${fmtRank(r.rankAway)}${r.away} ${r.awayScore} @ ${fmtRank(r.rankHome)}${r.home} ${r.homeScore}`);
    }
    parts.push("");
  }
  if (d.rankingMoves && d.rankingMoves.length) {
    parts.push("=== POLL MOVEMENT ===");
    for (const m of d.rankingMoves.slice(0, 6)) {
      parts.push(`  ${m.team}: ${m.from && m.from <= 25 ? "#" + m.from : "NR"} -> ${m.to && m.to <= 25 ? "#" + m.to : "NR"}`);
    }
    parts.push("");
  }

  // REAL head coaches from the save for every program this context mentions — so other
  // teams' coaches are the save's actual names, never invented or recalled from reality.
  const hcs = after.headCoaches ?? {};
  const nameToIndex = new Map<string, number | null>(
    Object.values(after.teams ?? {}).map((t) => [t.name, t.teamIndex])
  );
  const mentioned = new Set<string>();
  if (opponentName) mentioned.add(opponentName);
  for (const r of ranked) {
    mentioned.add(r.home);
    mentioned.add(r.away);
  }
  for (const m of (d.rankingMoves ?? []).slice(0, 6)) mentioned.add(m.team);
  const coachLines: string[] = [];
  for (const n of mentioned) {
    if (n === school) continue; // the user's coach has its own line above
    const ti = nameToIndex.get(n);
    const c = ti != null ? hcs[String(ti)] : null;
    if (c) coachLines.push(`  ${n} — HC ${c}`);
  }
  if (coachLines.length) {
    parts.push("=== KNOWN HEAD COACHES (REAL, from the save — the ONLY valid names for these programs' coaches) ===");
    parts.push(...coachLines);
    parts.push("");
  }

  // The opponent's REAL roster from the save (this week's result, or the next game up).
  const oppRoster = opts.oppRoster ?? [];
  if (opponentName && oppRoster.length) {
    parts.push(`=== OPPONENT ROSTER: ${opponentName} (REAL players from the save) ===`);
    for (const p of oppRoster.slice(0, 18)) {
      // Graded in WORDS, never a number — see rule 6. The staff-board tier is the same one
      // the scouting report has always used, so the whole app speaks one language.
      const bits = [p.position, p.year, p.overall != null ? TIER_LABEL[tierFor(p.overall)] : null]
        .filter(Boolean)
        .join(", ");
      const stat = fmtStats(p);
      // EVERY line carries its team. Untagged names were the #1 hallucination: with two
      // bare name lists in context, the model routinely credited one team's players to the
      // other ("Rice's defense, anchored by <an FAU linebacker>").
      parts.push(`  [${opponentName}] ${p.name}${bits ? ` (${bits})` : ""}${stat ? ` — ${stat}` : ""}`);
    }
    parts.push(
      `These are the ONLY valid ${opponentName} player names. Anyone on ${opponentName} not`,
      "listed here stays role-only (\"their left tackle\") — never invent or recall a name."
    );
    parts.push("");
  }

  const roster = opts.roster ?? [];
  // Active suspensions, keyed by lowercase name. The save carries a temporary 40 OVR for
  // these players (that's what benches them in-game) — the context must show their REAL
  // rating and state the suspension, or every generator invents a "collapse to 40 overall".
  const suspensions = opts.suspensions ?? [];
  const suspByName = new Map(suspensions.map((s) => [s.playerName.toLowerCase(), s]));
  if (roster.length) {
    parts.push("=== YOUR ROSTER (use ONLY these real players for player-specific content) ===");
    parts.push(
      "Format: Name (Pos, Year, how the staff grades him IN WORDS, Personality) — SEASON-TO-DATE TOTALS.",
      "There are NO rating numbers here on purpose. Never invent one and never convert a grade",
      "back into a number — see rule 6 in the system prompt.",
      "CRITICAL: these are CUMULATIVE SEASON totals, NOT this week's box score. Never present",
      "a season total as a single-game performance (a QB with 3,100 season yards did NOT throw",
      "for 3,100 this week). If you don't have this game's individual numbers, write about the",
      "game without inventing per-game stat lines."
    );
    for (const p of roster.slice(0, 40)) {
      const susp = suspByName.get(p.name.toLowerCase());
      // While suspended the save holds the temporary benching rating — show the real one.
      const shownOverall = susp?.originalOverall ?? p.overall;
      const bits = [
        p.position,
        p.year,
        shownOverall != null ? TIER_LABEL[tierFor(shownOverall)] : null,
        p.personality ?? null,
      ]
        .filter(Boolean)
        .join(", ");
      const stat = fmtStats(p);
      const flags = [
        susp ? `SUSPENDED — ${susp.weeksLeft} more week${susp.weeksLeft === 1 ? "" : "s"}` : null,
        p.injury && p.injury !== "Healthy" && p.injury !== "Uninjured" ? `INJURY: ${p.injury}` : null,
        p.redshirt && /taken|used|active/i.test(p.redshirt) ? "redshirting" : null,
      ]
        .filter(Boolean)
        .join(", ");
      // Team-tagged, same as the opponent block — this is what stops your own players from
      // being written up as the other team's.
      parts.push(
        `  [${school}] ${p.name}${bits ? ` (${bits})` : ""}${stat ? ` — ${stat}` : ""}${flags ? ` [${flags}]` : ""}`
      );
    }
    parts.push(
      "DEPTH-CHART TRUTH: the stat lines above are the season's actual production. Reason from",
      "them — who is actually starting (starts/games played), who is producing, and where a",
      "younger player is outplaying a veteran at the same position. The media KNOWS this and",
      "asks about it; never invent a depth chart that contradicts these numbers.",
      "ONE LINE = ONE PLAYER: each stat line belongs to that single named player and NO ONE else.",
      "NEVER combine or add up two players' numbers, and never attribute one player's stats to",
      "another. If two players share a position (e.g. two QBs), keep them separate — the STARTER",
      "is the one with more starts/games played; the other is the backup with his own smaller line.",
      `ROSTER SEPARATION — THE MOST COMMON ERROR. Every player line is tagged with the team`,
      `that owns him, like "[${school}] Name". A player tagged [${school}] plays for ${school}`,
      "and NOWHERE else; a player tagged with another school plays for THAT school. NEVER move a",
      "player between teams, never credit one team's player to the other team, and never write a",
      "sentence like \"<their school>'s defense, anchored by <a player tagged with YOUR school>\".",
      "Before you name anyone, check his tag. If a name is not tagged in this context at all, do",
      "not use it — describe the role instead (\"their left tackle\").",
      "THESE ARE YOUR TEAM'S OWN PRODUCTION — what YOUR players did, on offense or on defense.",
      "A passing/rushing/receiving total here is YARDAGE YOUR OFFENSE GAINED, never yardage your",
      "defense GAVE UP. NEVER flip your own player's stat into something the OPPONENT did to you",
      "(e.g. a QB's 500 pass yards is HIS production, NOT '500 yards you allowed'). You are NOT",
      "given any opponent box score or per-team yards-allowed splits — so NEVER state, ask about,",
      "or reference how many yards/points your defense 'gave up' or the opponent 'racked up' by",
      "category. Only the final score and margin are known; everything else about the opponent's",
      "statline is UNKNOWN and must not be invented."
    );
    parts.push("");
    parts.push(PERSONALITY_RULES);
    parts.push("");
  }

  if (suspensions.length) {
    parts.push("=== SUSPENDED PLAYERS (hard fact — they CANNOT play right now) ===");
    for (const s of suspensions) {
      parts.push(
        `  ${s.playerName}${s.position ? ` (${s.position})` : ""} — suspended ${s.weeksLeft} more ` +
          `week${s.weeksLeft === 1 ? "" : "s"} (${s.source === "academics" ? "ruled academically ineligible" : "team discipline"}: ${s.reason})`
      );
    }
    parts.push(
      "RULES FOR SUSPENDED PLAYERS:",
      "- They DO NOT play, start, or record stats while suspended. Never write them into game",
      "  action, drives, highlights, or the box score for any suspended week.",
      "- The grade listed for them above is their TRUE ability. The suspension — not talent,",
      "  injury, or any drop in ability — is the ONLY reason they're out. NEVER claim a player",
      "  collapsed, regressed, lost his ability, or was benched for performance (and never put a",
      "  rating number on it either way).",
      "- This IS a storyline: cover the absence like real media would — who steps up in his spot,",
      "  what the locker room thinks, when he's back, pressers fielding questions about it.",
      "- When he returns, he returns at his true ability. Frame any return week as reinstatement."
    );
    parts.push("");
  }

  // Year-over-year memory. Same pattern as suspensions: prior seasons are stated as fixed
  // fact from the Season Archive, which is what makes memory safe to ship at all — asked to
  // remember without a locked table, a model invents last year's record and a revenge game
  // that never happened.
  const hasHistory = priorSeasons(opts.priorSeasons ?? [], after.year ?? null).length > 0;
  const history = priorSeasonsBlock({
    archive: opts.priorSeasons ?? [],
    currentYear: after.year ?? null,
    opponent: opponentName,
    roster,
    current: u ? { wins: u.wins ?? 0, losses: u.losses ?? 0 } : null,
  });
  if (history) {
    parts.push(history);
    parts.push("");
  }

  // Who the man at the podium actually is. Unlike the archive this needs no prior seasons
  // played through the app — it comes off the save, so it works on a mid-dynasty install and
  // in year one, which is exactly when "does the beat know him" mattered and nothing did.
  const resume = coachResumeBlock(after.coach, school);
  if (resume) {
    parts.push(resume);
    parts.push("");
  }

  // The league moving without you. All four of these are parsed from the save, so they cost
  // nothing and cannot be wrong — the game itself decided what was newsworthy.
  const world = worldBlock({
    world: after.world,
    school: knownSchool,
    opponent: opponentName,
    week: d.weekPlayed,
    archive: opts.priorSeasons ?? [],
    currentYear: after.year ?? null,
  });
  if (world) {
    parts.push(world);
    parts.push("");
  }

  // Persistent coach identity: written once on the Coach tab, then fed to EVERY generator
  // so recaps, social, pressers, and situations all know who this coach is and reuse the
  // same recurring cast (AD, booster, beat writer, rival) instead of inventing new ones.
  const backstory = opts.backstory ?? null;
  parts.push(...identityBlock(backstory));

  return {
    systemPrompt: SYSTEM_PROMPT,
    userContext: parts.join("\n"),
    school,
    coachName,
    week: d.weekPlayed,
    snapshot: after,
    delta,
    roster,
    opponent: opponentName,
    oppRoster,
    suspensions,
    backstory,
    history,
    hasHistory,
    resume,
    world,
    outlook,
    weekState,
    phase,
  };
}

/** The head coach the SAVE says runs a program, or null. Never guess one — an invented
 * coach for a real school is the leak the system prompt spends five lines on. */
export function headCoachOf(snapshot: DynastySnapshot, teamName: string | null): string | null {
  if (!teamName) return null;
  const t = Object.values(snapshot.teams ?? {}).find((x) => x?.name === teamName);
  if (!t || t.teamIndex == null) return null;
  return snapshot.headCoaches?.[String(t.teamIndex)] ?? null;
}

// ── Prompt specs (one per kind) ────────────────────────────────────────────────

interface PromptSpec {
  system?: string;
  prompt: string;
  maxTokens: number;
}

type Extra = Record<string, unknown>;

function rosterLine(ctx: MediaContext): string {
  return ctx.roster.length
    ? "Use ONLY the real players listed in YOUR ROSTER above for any player-specific content. Never invent player names."
    : "The roster is not available; do not invent specific rostered player names.";
}

/** The deterministic recap core, assembled from the structured context. v2: code works out
 * how the game turned and who could have decided it; the model writes the story around it. */
function recapFactsFor(ctx: MediaContext, extra: Extra) {
  const highlights = Array.isArray(extra.highlights)
    ? (extra.highlights as { text: string; player?: string | null }[])
    : [];
  return recapFacts({
    result: ctx.delta?.userResult ?? null,
    userTeam: ctx.school,
    userTeamInfo: ctx.snapshot.userTeam ?? null,
    userRow: ctx.snapshot.userTeamRow,
    games: ctx.snapshot.games ?? [],
    roster: ctx.roster,
    oppRoster: ctx.oppRoster,
    oppCoach: headCoachOf(ctx.snapshot, ctx.opponent),
    week: ctx.week,
    year: ctx.snapshot.year ?? null,
    stakesLines: ctx.outlook?.lines ?? [],
    highlights,
    unavailable: ctx.suspensions.map((s) => ({
      playerName: s.playerName,
      reason:
        s.source === "academics"
          ? `ruled academically ineligible (${s.reason})`
          : `suspended, team discipline (${s.reason})`,
    })),
  });
}

/**
 * ROAD TO GLORY — "The Week". The only generated surface in RTG v1, and therefore the whole
 * cost model of the mode.
 *
 * Built entirely on the deterministic core in rtg.ts: code settles whether he played, what he
 * did in the actual game, and where he stands, then the writer builds prose around a table it
 * may not contradict. The load-bearing case is the week he DIDN'T play — that has to be a real
 * piece about not playing, not padding, or the mode does not work. See DESIGN-rtg-mode.md
 * decision 12.
 */
const RTG_FRAMING: Record<PlayerWeekState, string> = {
  "did-not-play":
    "HE DID NOT PLAY THIS WEEK. Write the piece about exactly that — the scout-team reps nobody " +
    "saw, watching from the sideline in a clean uniform, the guy ahead of him having a night, " +
    "what a week looks like when you are not part of the plan. This is the honest experience of " +
    "most of a young player's season and it is the part the game never shows. Do NOT invent a " +
    "snap, a rep in the game, a stat, or a moment on the field for him.",
  "played-off-bench":
    "HE GOT ON THE FIELD but did not start. Write what that is: the wait, the number being " +
    "called, what he did with it. His real line for this game is below — use it, and do not " +
    "inflate it into a starring role.",
  "first-start":
    "THIS WAS HIS FIRST CAREER START. It only happens once — write it that way: the week " +
    "leading in, the walk out, what the job actually asked of him, and how he answered. His " +
    "real line is below.",
  starter:
    "HE STARTED. Write the game he had, using the real line below, and what it does to his hold " +
    "on the job.",
  "multi-week-gap":
    "MORE THAN ONE GAME HAS PASSED since the last reading, so nothing can be pinned to a single " +
    "week. Write about the stretch as a stretch — never claim what happened in one specific game.",
  unknown:
    "THERE IS NO PREVIOUS READING to compare against, so whether he played this week is UNKNOWN. " +
    "Write about where he stands overall — his season, his standing, the room he is in — and " +
    "never claim he did or did not play.",
};

/** The team's actual game this week, or null. Null must stay null: an invented scoreline is
 * exactly what the gate caught. */
function rtgTeamResult(ctx: MediaContext): string | null {
  const g = ctx.delta?.userResult ?? null;
  const u = ctx.snapshot.userTeam ?? null;
  if (!g || g.homeScore == null || g.awayScore == null) {
    return u ? `${u.name} are ${u.wins}-${u.losses}. NO game result is available for this week — do not invent one.` : null;
  }
  const won = g.winner === u?.name;
  return `${g.home} ${g.homeScore}, ${g.away} ${g.awayScore} — ${u?.name ?? "his team"} ${won ? "won" : "lost"}. Record: ${u?.wins ?? "?"}-${u?.losses ?? "?"}.`;
}

function buildRtgWeekSpec(ctx: MediaContext, extra: Extra): PromptSpec {
  const snap = ctx.snapshot;
  const baseline = (extra.baselinePlayer ?? null) as RtgPlayer | null;
  const facts = rtgFacts({
    player: snap.player ?? null,
    baseline,
    school: ctx.school,
    interest: snap.schoolInterest,
    teamResult: rtgTeamResult(ctx),
  });
  const player = snap.player ?? null;
  return {
    maxTokens: 2200,
    prompt: [
      "Write this week's story about ONE PLAYER for his own personal wire. 400-550 words.",
      "Return JSON with this exact schema:",
      '{"headline": "string", "byline": "string", "body": "string", "pullQuote": "string"}',
      "",
      // The gate caught a piece filing under "Beat Writer, Oregon State Athletics" while the
      // character named one. If a name is given, the byline IS that name.
      (extra.character as { reporter?: string } | null)?.reporter
        ? `You ARE ${(extra.character as { reporter: string }).reporter}, who covers ${ctx.school}. The byline is YOUR NAME — never a generic title.`
        : ctx.backstory?.reporterName
          ? `You ARE ${ctx.backstory.reporterName}, who covers ${ctx.school}. The byline is YOUR NAME.`
          : `You are a veteran beat writer covering ${ctx.school}. The byline is your own (fictional, realistic) name — never a generic title like "Staff Writer".`,
      "",
      HOUSE_STYLE,
      "",
      "FOR THIS PIECE SPECIFICALLY:",
      `- The subject is ${player?.name ?? "the player"}, and the story is HIS week — not the team's.`,
      "- 4-6 paragraphs separated by \\n\\n.",
      RTG_FRAMING[facts.time.state],
      // The whole emotional premise of the mode: he is one of 85, and the world is indifferent
      // until it isn't. A piece that treats a freshman as the centre of the program is the
      // failure mode here.
      "- HE IS NOT THE CENTRE OF THIS PROGRAM YET. The team has its own season and it does not " +
        "revolve around him. Write him as one of eighty-five — the interest of the piece is what " +
        "it looks like from where he actually stands, not a manufactured spotlight.",
      "- The pullQuote is a single line, text only, no quote marks — him, a coach, or a teammate.",
      "- Invent the texture freely (the walk to the facility, the group chat, the weather, what " +
        "his hands were doing) as long as it never contradicts the locked facts.",
      "",
      rtgBrief(facts),
      "",
      // Who he is. Without this the piece is a stat line with adjectives.
      characterBlock((extra.character ?? null) as RtgCharacter | null) ?? "",
      "",
      ctx.history ?? "",
      ...identityBlock(ctx.backstory),
      `The week: Week ${ctx.week ?? "—"} · ${ctx.phase.label}.`,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

/**
 * ROAD TO GLORY — social. Not the dynasty feed with a different subject in it.
 *
 * Dynasty social works because 40,000 people care about your program and argue about it. A
 * freshman backup has none of that, and pointing the dynasty generator at him produces the
 * single worst failure this mode can have: a fanbase treating a kid who took zero snaps as
 * the centre of the sport. That is the "manufactured spotlight" problem, and at week three of
 * a two-star's freshman year it is not just wrong, it's embarrassing.
 *
 * So the RTG feed is built on a different premise: THE INTERNET DOES NOT KNOW HIM YET. The
 * accounts that talk about him are the ones that talk about players nobody has heard of —
 * recruiting services who ranked him, position-battle obsessives, his own high school's
 * account, his teammates, his hometown. National attention is something the feed EARNS as his
 * week-state climbs, and withholding it early is what makes it land later.
 */
function buildRtgSocialSpec(ctx: MediaContext, extra: Extra): PromptSpec {
  const snap = ctx.snapshot;
  const player = snap.player ?? null;
  const baseline = (extra.baselinePlayer ?? null) as RtgPlayer | null;
  const facts = rtgFacts({
    player,
    baseline,
    school: ctx.school,
    interest: snap.schoolInterest,
    teamResult: rtgTeamResult(ctx),
  });
  const state = facts.time.state;
  const brand = (extra.brand ?? null) as BrandState | null;
  const brandWeek = (extra.brandWeek ?? null) as FollowerResult | null;

  // How much of the internet has any reason to be looking at him this week.
  const attention: Record<PlayerWeekState, string> = {
    "did-not-play":
      "ATTENTION LEVEL: ALMOST NONE. He did not play. The feed is mostly NOT about him — it is " +
      "the fanbase arguing about the team, and he surfaces only at the edges: a recruiting " +
      "account still tracking him, a depth-chart obsessive asking why he isn't seeing the " +
      "field, his high school posting about a former player, a teammate's group post he happens " +
      "to be in. NOBODY national is discussing him. Do not manufacture buzz that does not exist.",
    "played-off-bench":
      "ATTENTION LEVEL: LOCAL AND CURIOUS. He got in. A few people noticed — the film-watchers, " +
      "the recruiting account that ranked him, the fans who wanted to see him. It is interest, " +
      "not hype. The rest of the feed is still about the team.",
    "first-start":
      "ATTENTION LEVEL: THIS IS THE SPIKE. His first career start is the first time the wider " +
      "fanbase has an opinion about him, and opinions arrive fully formed and mostly unfair. " +
      "Include the people who are suddenly experts on him, the ones defending him before he has " +
      "done anything, and the recruiting account posting 'told you' with his old ranking.",
    starter:
      "ATTENTION LEVEL: HE IS THE STORY NOW. He is the starter and gets starter treatment: " +
      "credit, blame, and takes from people who did not watch. Rivals have opinions about him.",
    "multi-week-gap":
      "ATTENTION LEVEL: unclear — more than one game has passed. Keep the feed about the team " +
      "and the stretch, never about one specific game of his.",
    unknown:
      "ATTENTION LEVEL: unknown — there is no reading of whether he played. Keep the feed about " +
      "the program and his standing in general, and never react to a game of his.",
  };

  const board = facts.board;
  return {
    maxTokens: 2600,
    prompt: [
      "Generate 14 social media posts as JSON with this exact schema:",
      '{"posts": [{"handle": "string", "displayName": "string", "type": "fan"|"rival"|"analyst"|"insider"|"reddit", "body": "string", "likes": number, "reposts": number}]}',
      "",
      `The subject is ${player?.name ?? "a player"}, a ${player?.classYear ?? ""} ${player?.position ?? "player"} at ${ctx.school}.`,
      attention[state],
      "",
      "WHO IS ACTUALLY POSTING — this is a PLAYER's feed, not a program's:",
      "- Recruiting-service accounts who ranked him coming out of high school, and treat every " +
        "snap as evidence about their own ranking. Use type \"analyst\".",
      "- Depth-chart obsessives who track snap counts and argue about who should be playing. " +
        "Type \"fan\" or \"reddit\".",
      "- Teammates and other players — short, in-group, emoji-heavy, often just a reaction. " +
        "Type \"fan\". They talk TO him, not about him.",
      "- His hometown and high school: the local paper account, a former coach, people who knew " +
        "him at 16. This is the register nothing else in the app has — use it.",
      "- The beat writer noting where he sits, factually. Type \"insider\".",
      "- Rival fans, ONLY once he is worth their attention. Type \"rival\".",
      "",
      "HARD RULES:",
      "- The type field MUST be one of exactly: fan, rival, analyst, insider, reddit.",
      "- MOST OF THIS FEED IS NOT ABOUT HIM unless he is the starter. A feed where fourteen " +
        "posts all discuss a backup freshman is the failure mode of this surface.",
      "- Engagement must match reality: posts about an unknown freshman get 3-80 likes, not " +
        "thousands. A recruiting account has more reach than a fan. Only once he starts do " +
        "numbers climb. Fake virality for a nobody reads as fake.",
      "- Never state a rating, an overall or any 0-99 number (see rule 6).",
      "- Never invent a stat for him. His real line, if he has one, is below.",
      player?.prospectStars
        ? `- His high-school ranking (${player.prospectStars.replace(/_/g, " ").toLowerCase()}) is a REAL fact and recruiting accounts will cite it. It is what he WAS rated, not what he is.`
        : "",
      board.offers.length
        ? `- Schools that offered him are real and fans reference them: ${board.offers.map((o) => o.school).join(", ")}.`
        : "",
      board.decommittedFrom.length
        ? `- He DECOMMITTED from ${board.decommittedFrom.map((o) => o.school).join(", ")} — that fanbase has not forgotten.`
        : "",
      "- NO HTML entities. Plain text only.",
      // His reach is a computed number, and every engagement figure in the feed has to be
      // consistent with it. This is what stops a 380-follower freshman getting 2,000 likes.
      brand
        ? "- SCALE EVERY LIKE AND REPOST TO HIS ACTUAL REACH, stated below. His own posts sit in " +
          "that range; other accounts' reach is their own."
        : "",
      "",
      socialVarietyBlock(ctx),
      "",
      brand ? brandBlock({ state: brand, week: brandWeek }) : "",
      "",
      characterBlock((extra.character ?? null) as RtgCharacter | null) ?? "",
      "",
      rtgBrief(facts),
      "",
      // The league's own headlines give the feed real events to react to, which is what stops
      // it inventing league news to fill fourteen posts.
      ctx.world ?? "",
      "",
      "Context:",
      ctx.userContext,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

/** Exported so a ported surface can be tested without a network call — the v2 port is a
 * claim about what the model is HANDED, and that claim should be under test. */
export function buildSpec(kind: string, ctx: MediaContext, extra: Extra = {}): PromptSpec {
  switch (kind) {
    case "rtg-week":
      return buildRtgWeekSpec(ctx, extra);

    case "rtg-social":
      return buildRtgSocialSpec(ctx, extra);

    /**
     * HIS GAMEPLAN — the scouting report as a PLAYER receives it.
     *
     * The dynasty version is the whole board: every unit, both sides, the staff view. He gets
     * his own matchup and nothing else, and the withholding is the feature. A freshman
     * quarterback is handed the coverage install, not the run-fit chart, and a report that
     * gave him everything would quietly turn him back into the head coach.
     */
    case "rtg-gameplan": {
      const p = ctx.snapshot.player ?? null;
      const plan = gameplan(p, ctx.oppRoster, ctx.opponent, gradeWord);
      const ch = (extra.character ?? null) as RtgCharacter | null;
      return {
        maxTokens: 2000,
        prompt: [
          "Write this week's GAMEPLAN for ONE PLAYER — what his position coach put in front of",
          "him. Return JSON with this exact schema:",
          '{"headline": "string", "assignment": "1-2 sentences: what his job IS this week",',
          '  "keys": [{"title": "<=6 words", "detail": "2-3 sentences of actual football"}],',
          '  "theyDoThis": "what the man across from him does well, in film language",',
          '  "goAtThis": "the one thing he can win with", "coachSays": "one line from his position coach"}',
          "",
          `He is a ${p?.classYear ?? ""} ${p?.position ?? "player"}. 3-4 keys.`,
          "",
          "WRITE IT LIKE A POSITION MEETING, not a broadcast:",
          "- Real football language — leverage, alignment, hips, hands, the snap count, what he",
          "  sees pre-snap, what tells him it's coming. Concrete, physical, specific.",
          "- The men he faces are named below and they are REAL. Use those names. If none are",
          "  listed, refer to them by role and NEVER invent one.",
          "- NO RATINGS, no 0-99 numbers, no overalls (rule 6). Film language only.",
          "- He is not the coordinator. Nothing about the team's overall plan, the other side of",
          "  the ball, or units he does not play against — he has not been shown any of it.",
          ch?.positionCoach
            ? `- "coachSays" is ${ch.positionCoach} in his own voice — short, blunt, the way a position coach actually talks.`
            : '- "coachSays" is his position coach, short and blunt.',
          "",
          gameplanBlock(plan) ?? "",
          "",
          rtgBrief(
            rtgFacts({
              player: p,
              baseline: (extra.baselinePlayer ?? null) as RtgPlayer | null,
              school: ctx.school,
              interest: ctx.snapshot.schoolInterest,
              teamResult: rtgTeamResult(ctx),
            })
          ),
          "",
          characterBlock(ch) ?? "",
        ]
          .filter(Boolean)
          .join("\n"),
      };
    }

    /**
     * HIS PHONE. The group chat, the position coach, home.
     *
     * This is the register dynasty has no equivalent for, and the reason it works is that the
     * people in it were named by the user at setup. A text from "Coach Reyes" lands; a text
     * from "your position coach" does not. The cast is fixed, so these threads accumulate into
     * relationships across a season instead of resetting every week.
     */
    case "rtg-texts": {
      const facts = rtgFacts({
        player: ctx.snapshot.player ?? null,
        baseline: (extra.baselinePlayer ?? null) as RtgPlayer | null,
        school: ctx.school,
        interest: ctx.snapshot.schoolInterest,
        teamResult: rtgTeamResult(ctx),
      });
      const ch = (extra.character ?? null) as RtgCharacter | null;
      const didNotPlay = facts.time.state === "did-not-play";
      return {
        maxTokens: 1800,
        prompt: [
          "Write this week's TEXT MESSAGES to a college football player. Return JSON:",
          '{"threads": [{"with": "who", "relationship": "coach"|"teammate"|"home"|"other",',
          '  "messages": [{"from": "them"|"him", "text": "string"}]}]}',
          "",
          "3-4 threads, 2-5 messages each. These are TEXTS: short, lowercase, unfinished",
          "sentences, no greeting, no signature. Nobody writes a paragraph. Some threads are two",
          "messages and a read receipt's worth of silence.",
          "",
          "WHO TEXTS HIM — use these people and no invented replacements:",
          ch?.positionCoach ? `- ${ch.positionCoach}, his position coach. Brief, functional, occasionally warmer than expected. He does not explain himself.` : "",
          ch?.teammate ? `- ${ch.teammate}, his closest teammate. Jokes, memes described in words, the group-chat register.` : "",
          ch?.aheadOfHim ? `- ${ch.aheadOfHim}, the man ahead of him — which makes every message between them slightly loaded even when it isn't.` : "",
          ch?.home ? `- ${ch.home}. This one is not about football. That is the point of it.` : "",
          "",
          didNotPlay
            ? "HE DID NOT PLAY. The coach thread is the hard one — it can be encouragement, a correction, or nothing much at all, and 'nothing much at all' is often the most honest. Home does not mention the game."
            : "He played. The threads react to what he actually did, using the real line below.",
          "",
          "Never promise him playing time or a start — nobody has decided that. Never state a",
          "score, a record or a rating (rule 6).",
          "",
          rtgBrief(facts),
          "",
          characterBlock(ch) ?? "",
        ]
          .filter(Boolean)
          .join("\n"),
      };
    }

    /**
     * HIS SITUATION ROOM. The decisions a player actually gets.
     *
     * A coach's situation room is about power he holds. A player's is about the almost total
     * lack of it: what he does with a week, who he talks to, whether he says the thing he is
     * thinking. The choices are small on purpose — small choices are all he has, and that is
     * the honest version of the fantasy.
     */
    case "rtg-situation": {
      const facts = rtgFacts({
        player: ctx.snapshot.player ?? null,
        baseline: (extra.baselinePlayer ?? null) as RtgPlayer | null,
        school: ctx.school,
        interest: ctx.snapshot.schoolInterest,
        teamResult: rtgTeamResult(ctx),
      });
      const ch = (extra.character ?? null) as RtgCharacter | null;
      return {
        maxTokens: 2000,
        prompt: [
          "Write ONE situation this college football player faces this week. Return JSON:",
          '{"headline": "string", "category": "locker-room"|"academics"|"family"|"brand"|"football"|"money"|"body"|"future",',
          '  "setup": "3-4 sentences putting him in it, specific and physical",',
          '  "options": [{"label": "<=5 words", "text": "what he does", "cost": "one line on what it costs him"}]}',
          "",
          "3 options. NONE is free and none is obviously right — if one is plainly correct it is",
          "not a decision, it is a formality.",
          "",
          "WHAT A PLAYER ACTUALLY CONTROLS — the whole design of this surface:",
          "- He does NOT control the depth chart, the play calls, his snaps, or whether he starts.",
          "- He DOES control what he says, who he tells the truth to, where he puts his time, what",
          "  he signs, what he posts, and whether he asks a question he may not want answered.",
          "- A situation about whether he gets promoted is not a situation, it is a wish.",
          "",
          "THIS MUST BE SOMETHING A REAL DIVISION I PLAYER ACTUALLY FACES. Not TV drama, not a",
          "movie plot — the small, specific, unglamorous things that happen to nineteen-year-olds",
          "on scholarship. Draw from the real texture of the job:",
          "",
          "  BODY & HEALTH — a hamstring that is 'fine', hiding a stinger from the trainer because",
          "    the guy behind him is playing well, a concussion protocol he could talk his way out",
          "    of, losing or gaining weight the staff has asked for, sleeping four hours.",
          "  ACADEMICS — a professor who does not move exams for road games, a tutor doing more of",
          "    the work than he should, a major he was steered into, missing the study-hall hours.",
          "  MONEY — a family that needs help now, an NIL deal that pays real money for something",
          "    slightly embarrassing, a 'handler' or 'advisor' in his DMs, a collective payment",
          "    that is late, teammates comparing deals.",
          "  LOCKER ROOM — the man ahead of him getting hurt and how he is supposed to feel about",
          "    it, being asked to cover for a teammate, a veteran calling him out in a film session,",
          "    a group chat he probably should not be in, being asked to switch positions or numbers.",
          "  FAMILY & HOME — a parent who wants to talk to the coaches, a hometown that thinks he",
          "    has changed, a younger sibling being recruited, homesickness he will not name, a",
          "    grandparent in hospital during a road week.",
          "  FUTURE — the portal window and a coach at another school who has been texting, a",
          "    redshirt conversation, an agent-adjacent guy at a family dinner, being told he",
          "    projects at a different position at the next level.",
          "  BRAND — a post that would get attention for the wrong reason, a media request his",
          "    coaches would rather he declined, a fan account that has taken against him.",
          "",
          "Pick ONE lane and make it small and specific. The best of these are mundane: a text",
          "he has not answered for two days, a form he has not filled in, a conversation he keeps",
          "not having. Ground it in the people he actually knows, by name.",
          "",
          "Never resolve it — the options end at the decision, not the outcome. Never promise",
          "playing time, and never make an option morally free.",
          "",
          rtgBrief(facts),
          "",
          characterBlock(ch) ?? "",
        ]
          .filter(Boolean)
          .join("\n"),
      };
    }

    /**
     * HIS PODIUM. A player's media availability, which is a different animal from a coach's.
     *
     * A coach at a microphone is performing a job he has done a thousand times. A nineteen-
     * year-old is being asked, in public, to explain something he does not control — why he
     * isn't playing, whether he's transferring, what he thinks of the guy ahead of him. The
     * questions have to be smaller and more awkward than a coach's, and the answers have to be
     * allowed to be immature, because that is what makes them his.
     */
    case "rtg-podium": {
      const facts = rtgFacts({
        player: ctx.snapshot.player ?? null,
        baseline: (extra.baselinePlayer ?? null) as RtgPlayer | null,
        school: ctx.school,
        interest: ctx.snapshot.schoolInterest,
      });
      const room = positionRoom((extra.roster as RosterPlayer[]) ?? ctx.roster, ctx.snapshot.player ?? null);
      const p = ctx.snapshot.player ?? null;
      const didNotPlay = facts.time.state === "did-not-play";
      return {
        maxTokens: 2600,
        prompt: [
          "Generate a short media availability with a COLLEGE PLAYER as JSON with this exact schema:",
          '{"questions": [{',
          '  "reporterName": "string", "outlet": "string",',
          '  "question": "string", "tone": "friendly"|"neutral"|"hostile"|"gotcha",',
          '  "answers": [{"label": "<=4 word posture", "text": "what he actually says", "poise": int, "roomDelta": int, "brandDelta": int}]',
          "}]}",
          "",
          `He is ${p?.name ?? "the player"}, a ${p?.classYear ?? ""} ${p?.position ?? "player"} at ${ctx.school}.`,
          "",
          "WRITE 4 QUESTIONS. This is NOT a head coach's press conference:",
          "- Reporters are gentler with a young player, and more invasive. They ask about his",
          "  family, his hometown, the adjustment, what his phone looks like after a game.",
          didNotPlay
            ? "- HE DID NOT PLAY. At least two questions are about that — what the staff has told him, whether he is frustrated, whether he has thought about leaving. He should not have a good answer to all of them."
            : "- At least one question is about what he just did on the field, using his real line below.",
          room.length > 1
            ? "- One question asks him about the player ahead of or behind him in the room, BY NAME, from the list below. Being asked to comment on a teammate competing for his job is the most uncomfortable question a young player gets."
            : "",
          "- One question comes from someone who covered him in high school, or from his hometown.",
          "",
          "ANSWERS — 3 per question, and they must sound NINETEEN:",
          "- He is allowed to be bad at this. Clichés he has obviously been coached to say, a real",
          "  answer that says too much, and something faintly petulant. A player who sounds like a",
          "  polished head coach is the failure mode of this surface.",
          "- poise (-8..+8) is how well he handled the room; roomDelta is what teammates and the",
          "  staff make of it; brandDelta is whether it plays online. THESE DO NOT MOVE TOGETHER,",
          "  and the interesting answers are the ones where they conflict — honest and popular but",
          "  bad for the locker room, or coach-speak that keeps him safe and dull.",
          "- Never let an answer promise playing time, a start, or a transfer as a decision made.",
          "",
          rtgBrief(facts),
          "",
          characterBlock((extra.character ?? null) as RtgCharacter | null) ?? "",
          "",
          roomBlock(room, p?.position ?? null) ?? "",
          "",
          ...identityBlock(ctx.backstory),
        ]
          .filter(Boolean)
          .join("\n"),
      };
    }

    /**
     * THE PLAYER POSTS. He writes it; the internet answers.
     *
     * The split is the one the whole app runs on: the model judges how the post LANDED —
     * reach and whether it drew backlash — and writes the replies in real voices. It does NOT
     * decide the follower number. `postDelta()` does that from the judgement plus his actual
     * reach, so the count stays auditable and can never drift from the model's mood.
     */
    case "rtg-post": {
      const text = typeof extra.text === "string" ? extra.text : "";
      const brand = (extra.brand ?? null) as BrandState | null;
      const followers = brand?.followers ?? 0;
      const tier = brandTier(followers);
      return {
        maxTokens: 1400,
        prompt: [
          "A college football player just posted this on social media. Judge how it landed and",
          "write the replies. Return JSON with this exact schema:",
          '{"reach": "ignored"|"local"|"viral", "backlash": boolean, "verdict": "one line on how it read",',
          ' "replies": [{"handle": "string", "displayName": "string", "type": "fan"|"rival"|"analyst"|"insider"|"reddit", "body": "string", "likes": number}]}',
          "",
          `HE POSTED: "${text}"`,
          "",
          `WHO HE IS: ${ctx.snapshot.player?.name ?? "the player"}, ${ctx.snapshot.player?.classYear ?? ""} ${ctx.snapshot.player?.position ?? "player"} at ${ctx.school}.`,
          `HIS REACH: ${TIER_NOTE[tier]}`,
          "",
          "JUDGING IT — be honest, and mostly unimpressed:",
          "- \"ignored\" is the DEFAULT and the most common outcome. Most posts by most players do",
          "  nothing at all. A bland post from someone with a small following is ignored, full stop.",
          "- \"local\" means his own fanbase saw it and reacted.",
          "- \"viral\" is RARE and requires an actual reason — genuinely funny, genuinely reckless,",
          "  or he is already a name. Do not hand it out for a normal post.",
          "- backlash is true when it reads as arrogant, whiny, ungrateful, aimed at a teammate or",
          "  coach, or when it will not survive a bad game next week. A player calling out his own",
          "  coaching staff draws backlash however true it is.",
          "- Reach is capped by who he actually is. Someone nobody follows cannot go viral inside",
          "  his own fanbase for an ordinary opinion.",
          "",
          "THE REPLIES: 5-8, in real voices — teammates, his own fanbase, rival fans if it travelled,",
          "a recruiting account, someone from his hometown. Short. Some are just an emoji or a",
          "single word. Reply likes must be small relative to his reach; a reply is never bigger",
          "than the post unless it is a dunk from a much larger account.",
          "",
          "Never invent a follower count, a stat, or a rating (see rule 6). Never claim the post",
          "changed his playing time — that is the coaching staff's call and it has not been made.",
          "",
          characterBlock((extra.character ?? null) as RtgCharacter | null) ?? "",
          ctx.snapshot.player ? rtgBrief(rtgFacts({
            player: ctx.snapshot.player,
            baseline: (extra.baselinePlayer ?? null) as RtgPlayer | null,
            school: ctx.school,
            interest: ctx.snapshot.schoolInterest,
          })) : "",
        ]
          .filter(Boolean)
          .join("\n"),
      };
    }

    case "recap-lead": {
      const hl = Array.isArray(extra.highlights) ? (extra.highlights as { text: string; player?: string | null }[]) : [];
      const hlBlock = hl.length
        ? [
            "",
            "=== VERIFIED GAME HIGHLIGHTS (extracted from the user's in-game footage — these plays",
            "REALLY happened; weave them into the story and never contradict them) ===",
            ...hl.map((h) => `- ${h.text}${h.player ? ` (${h.player})` : ""}`),
            "",
          ].join("\n")
        : "";
      const noGameFraming: Record<string, string> = {
        pregame:
          "THIS WEEK'S GAME HAS NOT BEEN PLAYED YET. Write the GAME-PREVIEW cover story for the upcoming matchup instead: how the two rosters actually stack up (use the real names and stat lines on both sides), keys to the game, the injury/lineup angles, what's at stake, and the buildup in town. Predictions only as clearly-framed opinion — NEVER invent a score, a result, or anything post-game.",
        preseason:
          "THERE IS NO GAME THIS WEEK — the season hasn't started. Write the SEASON-PREVIEW cover story instead: expectations, the roster taking shape (real names), camp battles, what this year means for the coach, and the opener ahead. Never invent a played game, score, or this-season stat.",
        bye: "THERE IS NO GAME THIS WEEK — it's a BYE. Write the bye-week column instead: the season so far at this record, who's getting healthy, self-scouting, the locker room's temperature, and the next opponent looming. Never invent a game or result for this week.",
        "season-over":
          "THERE IS NO GAME THIS WEEK — the season is at its end. Write the season-wrap piece: the arc of the year, what the record means, the players who defined it, and what's next (portal, recruiting, the offseason). Never invent a game or result.",
      };
      // v2 DETERMINISTIC CORE. On a game week the model no longer receives the shared blob
      // — code has already worked out how the game turned, who could have decided it, and
      // what the result is worth, so the piece is written around a short locked table
      // instead of a 40-player dump the writer had to reason over. On the weeks with no
      // game the shared context still carries the material (camp battles, the next
      // opponent), so those keep it and gain only the locked stakes.
      const facts = recapFactsFor(ctx, extra);
      const isGame = ctx.weekState === "game";
      return {
        maxTokens: 2800,
        prompt: [
          isGame
            ? "Write the week's game story for a program's front page — the piece a subscriber"
            : noGameFraming[ctx.weekState],
          isGame ? "actually reads to the end. 450-600 words. Return JSON with this exact schema:" : "450-600 words. Return JSON with this exact schema:",
          '{"headline": "string", "byline": "string", "body": "string", "pullQuote": "string"}',
          "",
          ctx.backstory?.reporterName
            ? `You ARE ${ctx.backstory.reporterName}, the beat writer of record for ${ctx.school} — years on this beat, sources in the building, opinions you've earned. The byline is your name.`
            : `You ARE a veteran beat writer covering ${ctx.school} — years on this beat, sources in the building, opinions you've earned. The byline is your (fictional, realistic) name.`,
          "",
          HOUSE_STYLE,
          "",
          "FOR THIS PIECE SPECIFICALLY:",
          "- The headline reads like a newspaper A1 head, not SEO: specific, punchy, no colon-itis.",
          isGame
            ? "- 5-7 paragraphs separated by \\n\\n. HOW IT TURNED is computed for you below — build the\n  story on it rather than working it out again, and never argue with it. Then: who decided\n  it, and what the result does to the season's stakes."
            : "- 5-7 paragraphs separated by \\n\\n. Let the STORY dictate the order, not a checklist.",
          `- The pressure or belief building around Coach ${ctx.coachName} is the throughline.`,
          "- 1-2 attributed quotes inside the body, per house style.",
          ctx.backstory
            ? "- Your history with this coach colors the framing: a disciplinarian's ugly win reads different than a players-coach's. Reuse the recurring cast; never invent a rival beat writer."
            : "",
          "- The pullQuote is the single most alive quote (coach or player), text only, no quote marks.",
          isGame
            ? "- THE DIVISION OF LABOUR: the numbers, the names and who they play for are settled below\n  and are not yours to adjust. Everything between the numbers — the drives, the play calls,\n  the sideline, the crowd, the weather, what a moment FELT like — is yours to see and report."
            : "- Never invent scores, stats, rankings, or records — the context is the source of truth.",
          "- If it is a neutral site or playoff/bowl game, DO NOT claim it was played at either team's home stadium.",
          "- If the week is Postseason, do not refer to the regular season or imply there are more regular season games left.",
          ctx.phase.playoffGame
            ? `- THIS IS THE ${ctx.phase.roundName?.toUpperCase()}. Frame the game as exactly that — ${ctx.phase.roundName === "National Championship" ? "one game for the national title, win-or-go-home, legacy on the line" : "a win-or-go-home playoff game; a win ADVANCES them, a loss ENDS the season"}. NEVER write about résumés, the selection committee, the bubble, or 'making the playoff' — they are already IN it and playing.`
            : ctx.phase.key === "postseason"
              ? "- THIS IS A BOWL GAME, NOT A PLAYOFF GAME — this team is not in the field. It is one game and the season ends with it either way; nothing advances, nothing is eliminated. NEVER call it a playoff game, a playoff round, a first-round matchup, or a New Year's Six bowl, and never name a specific bowl — the save does not carry its name. Write the bowl-week story: what the season added up to, the seniors' last game, opt-outs and the portal, and what a win sets up for next year."
              : "",
          "- Do not invent transfer portal news or roster departures unless explicitly mentioned.",
          // Year-over-year memory earns its keep here more than anywhere: a beat writer with
          // history is the difference between a game story and a chapter of one.
          ctx.hasHistory
            ? "- You have covered this program for years and the archive below proves it. Where it fits, reach back: a rematch, a 'second straight year', a player measured against what he was, a callback to a decision that aged well or badly. Never contradict the archive, and never reach for a past fact that isn't in it."
            : "",
          ctx.resume
            ? "- You know exactly who the coach is — his titles, his career record, his record at this school, how long he's been here. Measure this result against THAT standard. Never award him a championship or a tenure the résumé doesn't list."
            : "",
          isGame ? "" : hlBlock,
          "",
          // On a game week the brief IS the context. Everywhere else it rides in front of
          // the shared blob so the record and the streak are locked even in a bye column.
          isGame ? recapBrief(facts) : lockedBlock(facts),
          "",
          // The ported game-week path does NOT receive the shared blob, so anything the
          // shared context carries has to be handed over explicitly here or it is silently
          // lost — the same hole that dated a recap to a real-world season.
          ...(isGame
            ? [
                ctx.history ?? "",
                ctx.resume ?? "",
                ...identityBlock(ctx.backstory),
                `The week: Week ${ctx.week ?? "—"} · ${ctx.phase.label}.`,
              ]
            : ["Context:", ctx.userContext]),
        ].join("\n"),
      };
    }

    case "social": {
      const sits = Array.isArray(extra.situations) ? (extra.situations as Record<string, unknown>[]) : [];
      const sitBlock = sits.length
        ? [
            "",
            "=== OFF-FIELD THIS WEEK (the coach's Situation Room — react to these too) ===",
            ...sits.map(
              (s) =>
                `- [${s.category}] ${s.headline}${s.player ? ` (player: ${s.player})` : ""} → coach's move: ${s.decision}. Fallout: ${s.outcome}`
            ),
            "At least 3 posts should react to these off-field storylines — fans defending or turning, rivals piling on, insiders reporting the locker-room mood, reddit making it a meme. Reference the specific player and the coach's decision.",
            "",
          ].join("\n")
        : "";
      return {
        maxTokens: 2900,
        prompt: [
          "Generate 15 social media posts reacting to this week as JSON with this exact schema:",
          '{"posts": [{"handle": "string", "displayName": "string", "type": "fan"|"rival"|"analyst"|"insider"|"reddit", "body": "string", "likes": number, "reposts": number}]}',
          "",
          ctx.weekState === "game"
            ? `Posts should react to ${ctx.school}'s Week ${ctx.week} result${sits.length ? " AND the off-field storylines below" : ""}.`
            : ctx.weekState === "pregame"
              ? `THIS WEEK'S GAME HAS NOT KICKED OFF YET. Posts are PREGAME energy for the upcoming matchup — hype, nerves, matchup takes citing real players on both rosters, trash talk with the opponent's fans${sits.length ? " — AND the off-field storylines below" : ""}. NEVER post a score or result for this game.`
              : `THERE IS NO GAME THIS WEEK (${ctx.weekState}). Posts react to the state of the program — ${ctx.weekState === "preseason" ? "preseason hype, expectations, camp chatter" : ctx.weekState === "bye" ? "the bye-week mood, the season so far, the next opponent" : "the season wrapping up, what's next"}${sits.length ? " — AND the off-field storylines below" : ""}. NEVER invent a game or score for this week.`,
          "IMPORTANT: The type field MUST be one of exactly these 5 values: fan, rival, analyst, insider, reddit.",
          "Include a diverse mix across all 15: at least 4 fan, 3 rival, 2 analyst, 2 insider, 3 reddit — plus 1 more of your choice.",
          "",
          socialVarietyBlock(ctx),
          "",
          "Key style notes for each type:",
          "- fan: Emotional, ALL CAPS energy, overreactions. Self-deprecating after losses, euphoric after wins.",
          "- rival: Snarky, schadenfreude, 'scoreboard' energy, mocking. Reference the actual opponent.",
          "- analyst: Film references, stats, scheme observations. Measured but with a clear take.",
          "- insider: 'Sources tell me...' energy. Locker room mood, staff reactions, recruiting implications.",
          "- reddit: Self-deprecating humor, absurd comparisons, copypasta energy, funny/viral takes.",
          "",
          "IMPORTANT:",
          "- Use the ACTUAL score, opponent name, and game events from the context below.",
          "- Vary engagement realistically: high-energy fan posts get 500-2000 likes, analyst posts 100-500.",
          "- The 'reposts' field is required (not retweets).",
          // Fans have the longest memories in sports, and now the app can back them up.
          ctx.resume
            ? "- Fans argue about the COACH with his actual résumé in hand (below): his titles or lack of them, his record here, how long he's had. \"X rings and this is what we get\" / \"give him time, it's year one\" are both fair — inventing a championship is not."
            : "",
          ctx.hasHistory
            ? "- 2-3 posts should have a LONG MEMORY: last year's collapse or breakout, the rematch, " +
              '"same as last season", a player who was nothing a year ago. Use ONLY the archived ' +
              "prior-season facts in the context — a fan may be an idiot about what it means, never wrong about what happened."
            : "",
          "- NO HTML entities. Use plain text quotes and punctuation.",
          sitBlock,
          "Context:",
          ctx.userContext,
        ].join("\n"),
      };
    }

    case "rankings":
      return {
        maxTokens: 1000,
        prompt: [
          "Write a 100-word CFP analyst take about this team's ranking picture as JSON with this exact schema:",
          '{"headline": "string", "body": "string", "movement": "string"}',
          "",
          ctx.phase.playoffGame
            ? `${ctx.school} is IN the College Football Playoff, playing the ${ctx.phase.roundName}. The bracket is SET — do NOT talk about rankings movement, the bubble, or making the field. 'movement' is a short phrase about their run, e.g. '${ctx.phase.roundName === "National Championship" ? "Playing for it all" : "Two wins from a title"}', 'Final Four', 'Cinderella run', 'Title favorite'. The body is a studio analyst breaking down how far this team can go and what it'd take to win it all.`
            : ctx.phase.key === "postseason"
              ? `${ctx.school} is NOT in the playoff — they are playing an ordinary BOWL GAME while the bracket runs without them. Do NOT write a playoff take. 'movement' is a short phrase about where the season landed, e.g. 'Bowl bound', 'Season's last act', 'Building something'. The body is a studio analyst on what the year added up to and what the program's next step is — never on a bracket they are not in.`
              : [
                  // An unranked team asked "analyze your playoff picture" produces a playoff
                  // picture, because that is what it was asked for. Reported from a real save:
                  // a 7-3 unranked Sun Belt team written as fighting for a playoff spot, and
                  // pushing for a New Year's Six bid, every single week.
                  ctx.outlook && ctx.outlook.standing === "out"
                    ? `${ctx.school} is UNRANKED and NOT in the playoff race. Do NOT write a playoff/committee/bubble/New Year's Six take — none of it applies. Analyze what is actually live for them: the bowl math (see the stakes block in the context — do not restate it wrongly), the conference race, and whether this team is trending up or down. 'movement' is a short phrase like 'Bowl eligible', 'Two from a bowl', 'Playing spoiler', 'Trending up'.`
                    : `Analyze ${ctx.school}'s ranking picture after Week ${ctx.week}, in line with the stakes stated in the context. Never invent a poll number.`,
                  "movement is a short phrase like 'On the bubble', 'Knocking on the door', 'Holds at #8', 'Up 3 spots', 'Drops out'.",
                  "Write in the voice of a TV studio analyst.",
                ].join("\n"),
          "",
          "Context:",
          ctx.userContext,
        ].join("\n"),
      };

    case "press-conference": {
      const phase = ctx.phase;
      const role = ctx.snapshot.coach?.position ?? null;
      const isCoordinator = role != null && role !== "HeadCoach";
      return {
        maxTokens: 3200,
        prompt: [
          "Generate an INTERACTIVE post-game press conference as JSON with this exact schema:",
          '{"questions": [{',
          '  "reporterName": "string", "outlet": "string",',
          '  "question": "string", "tone": "friendly"|"neutral"|"hostile"|"gotcha",',
          '  "answers": [{"label": "<=4 word posture", "text": "the exact quote the coach gives at the podium",',
          '    "mediaDelta": int, "fanDelta": int, "lockerDelta": int}]',
          "}]}",
          "",
          ctx.weekState === "pregame"
            ? "THIS WEEK'S GAME HAS NOT BEEN PLAYED. This is the PRE-GAME press conference. Write 6 questions previewing the upcoming matchup: the game plan, the opponent's real players by name (from the OPPONENT ROSTER), injuries and availability, the stakes, and the coach's mindset. NEVER reference a score or outcome for this game — it hasn't happened."
            : ctx.weekState !== "game"
            ? `THERE IS NO GAME THIS WEEK (${ctx.weekState === "preseason" ? "the season hasn't started" : ctx.weekState === "bye" ? "bye week" : "season's end"}). This is a mid-week media availability, NOT a post-game presser. Write 6 questions about what's actually live: ${ctx.weekState === "preseason" ? "camp battles, expectations, the depth chart, the opener" : ctx.weekState === "bye" ? "health, self-scouting, the season so far, the next opponent" : "the season in review, the portal, recruiting, what's next"}. NEVER reference a game or result from this week — none exists.`
            : isCoordinator
              ? `Write 6 questions reporters would ask ${ctx.coachName}, the ${COACH_ROLE_LABEL[role] ?? role} at ${ctx.school}, after THIS WEEK'S game — coordinator questions (their unit, their calls), not head-coach program questions.`
              : `Write 6 questions reporters would ask Coach ${ctx.coachName} of ${ctx.school} after THIS WEEK'S game.`,
          "Mix tones: a couple friendly/neutral, at least one hostile or gotcha if the result warrants it.",
          ctx.backstory?.reporterName
            ? `At least one question comes from beat writer ${ctx.backstory.reporterName}.`
            : "",
          "Ground every question in the actual result, score, and season context. Reporters reference real details.",
          "",
          `SEASON PHASE: ${phase.label}. ${phase.pressNote}`,
          "",
          "ROSTER-REASONED QUESTIONS — reporters have watched the film and read the stat sheet:",
          "- At least 2 questions must cite REAL numbers from YOUR ROSTER's stat lines (a player's",
          "  yards, TDs, starts) and press on what they imply: why the veteran lost the job to the",
          "  younger player who's producing, an injured starter's timeline, a redshirt burning, a",
          "  breakout underclassman's future. If a lower-classman is out-producing an upperclassman",
          "  at the same position, SOMEBODY in this room asks about it by name.",
          "- Personality is fair game: reporters phrase questions differently for an Intense star",
          "  than a quiet TeamPlayer, and ask the coach to respond to what players are like.",
          // The presser is where memory pays off most: a reporter who was in the room last
          // year asks a different, harder question than one meeting the coach for the first
          // time. Every comparison must come off the archived table, never from a guess.
          // The room knows his résumé cold. Whether he has one ring or five changes what
          // they feel entitled to ask, and it is the difference between a reporter and a
          // stranger with a microphone.
          ctx.resume
            ? "- THE ROOM KNOWS HIS RÉSUMÉ (below) AND WRITES LIKE IT. His titles, his career record,\n" +
              "  his record at THIS school and how long he has been here all shape the questions: a\n" +
              "  decorated champion gets asked why THIS team is short of his standard; a first-year\n" +
              "  coach gets asked to prove he belongs. Cite those facts exactly as given — never\n" +
              "  invent a title, a former job, or a tenure he doesn't have."
            : "",
          ctx.hasHistory
            ? "- THESE REPORTERS HAVE COVERED YOU FOR YEARS. At least ONE question compares this season\n" +
              "  to a PRIOR one from the archive below — the record then versus now, a rematch with a\n" +
              "  team that beat you, a returning player measured against his old numbers, or a past\n" +
              "  decision they are still asking about. Quote the archived facts exactly; never invent\n" +
              "  a past record, result or number to build a question on."
            : "",
          "",
          "Answer rules — the coach's response ACTUALLY MATTERS:",
          "- Each question gets EXACTLY 3 answer options with genuinely different postures",
          "  (e.g. accountable, defiant/fiery, deflect/coach-speak, protect a player, take a shot at critics).",
          "- Each answer's deltas are integers roughly -8..+8. mediaHeat: NEGATIVE calms the press, positive inflames it.",
          "  fanDelta/lockerDelta reflect how fans and the locker room hear that quote. Trade-offs must be real:",
          "  a fiery answer can rally fans while raising media heat; coach-speak calms media but reads hollow to fans.",
          "- Answers are real sentences a coach would say into a microphone, matched to the actual result.",
          "",
          "Context:",
          ctx.userContext,
        ].join("\n"),
      };
    }

    case "podium-answer":
      return buildPodiumAnswerSpec(ctx, extra);

    case "national-wire":
      return buildNationalWireSpec(ctx, extra);

    case "national-desk":
      return buildNationalDeskSpec(ctx);

    case "recruiting":
      return {
        maxTokens: 1200,
        prompt: [
          "You are a college football recruiting insider writing a program recruiting-trail column as JSON with this exact schema:",
          JSON.stringify({
            headline: "string (punchy insider headline)",
            subhead: "string (one line)",
            trend: "hot|warm|stable|cooling|cold",
            trendReason: "string (1 sentence — why the trail is trending this way)",
            beats: [{ title: "string", text: "string (2-3 sentences)" }],
          }),
          "",
          `Write the recruiting-trail outlook for ${ctx.school} under Coach ${ctx.coachName} at Week ${ctx.week}.`,
          "Produce 3-4 beats: how on-field results are playing on the trail, position groups the program needs to sell, regional pipeline energy, and the momentum recruits feel about this staff.",
          "",
          "HARD CONSTRAINTS:",
          "- Do NOT invent specific named recruits, star ratings, commitment counts, or a class ranking.",
          "- Talk about the program and the trail in general insider terms, grounded ENTIRELY in the real season context below.",
          "- Set trend from the actual results: winning and climbing = hot/warm, losing or sliding = cooling/cold.",
          "",
          "Context:",
          ctx.userContext,
        ].join("\n"),
      };

    case "nil":
      return {
        maxTokens: 1300,
        prompt: [
          "You are a college football NIL and transfer-portal insider writing a market column as JSON with this exact schema:",
          JSON.stringify({
            headline: "string (insider headline)",
            body: "string (2-3 sentences setting the NIL/portal scene for the program)",
            marketTemp: "cold|warm|hot|red-hot",
            tempReason: "string (1 sentence — why the market is this hot/cold)",
            notes: [{ label: "string (short tag, e.g. Collective, Portal, Boosters)", text: "string (1-2 sentences)" }],
          }),
          "",
          `Write the NIL & transfer-portal market outlook for ${ctx.school} at Week ${ctx.week}.`,
          "Produce 3-4 notes covering the collective/donor mood, the transfer-portal climate, and how winning or losing is moving NIL leverage.",
          "",
          "HARD CONSTRAINTS:",
          `- ${rosterLine(ctx)}`,
          "- Write about the program NIL market and portal climate grounded ENTIRELY in the real season context below.",
          "- Set marketTemp from the actual results.",
          "",
          "Context:",
          ctx.userContext,
        ].join("\n"),
      };

    case "trophy":
      return {
        system: [
          "You are a prestigious sports journalist writing a long-form retrospective on a",
          "college football program mid-season. Your style is literary, sweeping, and",
          "authoritative — think Wright Thompson or Dan Jenkins. This is a FICTIONAL simulated",
          "universe: never reference real-world players, coaches, games, or conference history",
          "from your own knowledge — only the data provided, inventing fictional names where",
          "needed. Ground every claim in the real data provided; never invent scores, rankings,",
          "or awards. Return valid JSON matching the exact schema provided. No markdown, no",
          "code fences.",
        ].join(" "),
        maxTokens: 3000,
        prompt: [
          `Write a retrospective on the ${ctx.school} season so far under Coach ${ctx.coachName}.`,
          "Treat the campaign to date as a story with a narrative arc — the identity of the team, its signature moments, and what is at stake down the stretch.",
          "",
          "Return JSON with this EXACT schema:",
          '{ "headline": "string", "body": "90-140 word intro", "chapters": [ { "title": "string", "body": "120-180 words", "year": 0 } ] }',
          "",
          "Include 2 or 3 chapters covering the arc so far. Leave \"year\" as 0 in every chapter. Reference the actual record, ranking, and results below. Do not fabricate a national title or awards not in the data.",
          "",
          "Context (source of truth — never contradict it):",
          ctx.userContext,
        ].join("\n"),
      };

    case "shows":
      return buildShowSpec(ctx, extra);

    case "offseason":
      return buildOffseasonSpec(ctx, extra);

    case "offseason-brief":
      return buildOffseasonBriefSpec(ctx, extra);

    case "coach-backstory":
      return buildBackstorySpec(ctx, extra);

    case "press-conference-grade":
      return buildGradeSpec(ctx, extra);

    case "storylines":
      return buildStorylinesSpec(ctx, extra);

    case "storyline-fallout":
      return buildFalloutSpec(ctx, extra);

    case "player-text":
      return buildPlayerTextSpec(ctx, extra);

    case "recruit-dossier":
      return buildRecruitDossierSpec(ctx, extra);

    case "recruit-text":
      return buildRecruitTextSpec(ctx, extra);

    case "scouting":
      return buildScoutingSpec(ctx, extra);

    case "figure-text":
      return buildFigureTextSpec(ctx, extra);

    case "brand-deals":
      return buildBrandDealsSpec(ctx);

    case "nil-reaction":
      return buildNilReactionSpec(ctx, extra);

    case "highlights-extract":
      return {
        maxTokens: 1500,
        system:
          "You are a precise sports-data extractor. You read screenshots of a college football " +
          "video game's post-game highlight/stat screens and transcribe ONLY what is visibly " +
          "shown. Never guess, never embellish, never add plays that aren't on screen. Return " +
          "valid JSON only, no markdown fences.",
        prompt: [
          "The attached screenshot(s) show the in-game highlight list / player stat screens from",
          `${ctx.school}'s most recent game. Extract every distinct highlight or stat line you can`,
          "actually read. Return JSON with this exact schema:",
          '{"highlights": [{"text": "one line describing the play or stat exactly as shown", "player": "player name if visible, else null"}]}',
          "",
          "Rules:",
          "- Transcribe only what is legible. If a name or number is unreadable, skip it.",
          "- Keep each highlight to one factual line (e.g. '68-yard TD pass, Q3' or '12 catches, 173 yds').",
          "- Return {\"highlights\": []} if nothing legible is shown.",
        ].join("\n"),
      };

    default:
      throw new Error(`unknown generator kind: ${kind}`);
  }
}

// ── Multi-part / parameterized specs kept out of the switch for readability ─────

const SHOW_PERSONAS: Record<string, { name: string; role: string; affiliation: string; personality: string }[]> = {
  gameday: [
    { name: "Marcus Cole", role: "Host", affiliation: "DynastyWire", personality: "Enthusiastic and energetic, loves big moments" },
    { name: "Diana Reeves", role: "Analyst", affiliation: "CFP Network", personality: "Analytical and data-driven, always has the numbers" },
    { name: "Troy Washington", role: "Analyst", affiliation: "DynastyWire", personality: "Contrarian hot-take artist, provocative but entertaining" },
  ],
  rankings: [
    { name: "Marcus Cole", role: "Host", affiliation: "DynastyWire", personality: "Enthusiastic and energetic, drives the studio discussion" },
    { name: "Diana Reeves", role: "Analyst", affiliation: "CFP Network", personality: "Analytical and data-driven, defends or critiques rankings with evidence" },
    { name: "Troy Washington", role: "Analyst", affiliation: "DynastyWire", personality: "Contrarian hot-take artist, loves to argue a team is over/underrated" },
  ],
  portal: [
    { name: "Jake Morrison", role: "Reporter", affiliation: "Portal Insider Network", personality: "Connected insider with sources everywhere, speaks in scoops" },
    { name: "Lisa Chen", role: "Analyst", affiliation: "CFP Network", personality: "Measured and thoughtful, evaluates roster impact carefully" },
    { name: "Marcus Cole", role: "Host", affiliation: "DynastyWire", personality: "Enthusiastic and energetic, ties portal moves to the bigger picture" },
  ],
  draft: [
    { name: "Pete Nakamura", role: "Scout", affiliation: "Draft Scout Network", personality: "Former NFL scout, evaluates players with technical precision" },
    { name: "Diana Reeves", role: "Analyst", affiliation: "CFP Network", personality: "Analytical and data-driven, compares prospects to NFL archetypes" },
  ],
  hotseat: [
    { name: "Troy Washington", role: "Host", affiliation: "DynastyWire", personality: "Provocative and direct, not afraid to say a coach should be fired" },
    { name: "Lisa Chen", role: "Analyst", affiliation: "CFP Network", personality: "Measured and fair, considers context and program trajectory" },
  ],
  podcast: [
    { name: "Dominic Farr", role: "National Voice", affiliation: "The Wire Room", personality: "Sees the program from 30,000 feet — respects it when earned, dismisses homer cope, ranks it against the whole country" },
    { name: "Bucky Lane", role: "The Local", affiliation: "The Wire Room", personality: "Grew up twenty minutes from the stadium, unapologetic diehard — knows every player's story, takes every slight personally, all-in every week" },
  ],
};

const SHOW_TITLES: Record<string, { title: string; subtitle: string }> = {
  gameday: { title: "DynastyWire GameDay", subtitle: "Pre-game preview panel" },
  rankings: { title: "The Rankings Report", subtitle: "Weekly top-25 show" },
  portal: { title: "Portal Insider", subtitle: "Transfer portal segment" },
  draft: { title: "Draft Scout", subtitle: "NFL draft prospect breakdown" },
  hotseat: { title: "Hot Seat Weekly", subtitle: "Coaching performance segment" },
  podcast: { title: "The Wire Room", subtitle: "Weekly podcast — national voice meets the local homer" },
};

const SHOW_DIRECTION: Record<string, string[]> = {
  gameday: [
    "Generate a lively pre-game/post-game panel discussion. The analysts debate the team's performance,",
    "make observations about the season trajectory, and reference specific stats and results from the context.",
    "Include natural banter, disagreements, and stage directions like [turns to camera] or [laughs].",
  ],
  rankings: [
    "Generate a rankings discussion segment. The analysts debate whether the team's ranking is justified,",
    "discuss playoff implications, compare to other teams, and argue about who should move up or down.",
    "Reference the team's record, strength of schedule, and key wins/losses. Include stage directions.",
  ],
  portal: [
    "Generate a LEAGUE-WIDE transfer portal segment — this is a national portal show, not a",
    "single-team update. Jake Morrison works the board team by team; Lisa Chen breaks down what",
    "each move (or looming move) means for the depth chart; Marcus ties it to the national picture.",
    "Work directly off the PORTAL BOARD provided in the context: name real at-risk players by name,",
    "their program, how good they are IN FOOTBALL TERMS (never a rating number), and WHY they're a",
    "flight risk (buried behind a starter, playing-time",
    "dealbreaker). Cover several different programs. If the portal isn't open yet, frame it as the",
    "flight-risk watch list and the storylines building toward the window — never claim someone has",
    "transferred when the board says the portal is closed. Include stage directions and real banter.",
  ],
  draft: [
    "Generate an NFL draft prospect evaluation segment. Pete Nakamura provides scout-level analysis of top prospects.",
    "Discuss draft stock and how the season is affecting draft position. Use fictional player names that fit the program.",
    "Include stage directions and technical football evaluation language.",
  ],
  hotseat: [
    "Generate a coaching hot seat discussion. Troy Washington is provocative about the coach's job security",
    "while Lisa Chen provides measured counterpoints. Discuss trajectory, fan sentiment, and administration patience.",
    "Reference the record, losses, and program direction. Include stage directions.",
  ],
  podcast: [
    "Generate a weekly PODCAST episode — looser and longer-form than a TV segment. Dominic (national) and",
    "Bucky (local homer) argue about this week's result from their two lenses: Dominic frames it against the",
    "national picture (rankings, playoff math, how outsiders see this program); Bucky counters with the local",
    "truth (what the locker room actually looks like, players by name from the roster, what the fanbase is",
    "feeling). They talk over each other, take listener-question detours, run an ad-read for a fictional local",
    "business mid-episode, and end with a 'lock of the week'. The two-perspective tension IS the show:",
    "national skepticism vs local faith — whichever the week's result supports harder gets the last word.",
    "Use [stage directions] sparingly for pauses, laughter, sound-drops.",
  ],
};

// Render the real league-wide portal board (from buildPortal) into prompt context so the
// Portal Insider show names ACTUAL at-risk players across the league, not invented ones.
function portalBoardBlock(extra: Extra): string {
  const p = extra.portalData as
    | { active?: boolean; transferred?: Record<string, unknown>[]; atRisk?: Record<string, unknown>[] }
    | undefined;
  if (!p) return "";
  const lines: string[] = ["=== LEAGUE-WIDE TRANSFER PORTAL BOARD (REAL players from the save — use ONLY these names) ==="];
  if (p.active && Array.isArray(p.transferred) && p.transferred.length) {
    lines.push("IN THE PORTAL NOW (real transfer chances):");
    for (const t of p.transferred.slice(0, 20)) {
      lines.push(`  - ${t.name} (${t.position}, ${gradeWord(t.overall)}, ${t.year}) — ${t.team}${t.teamRank ? ` (#${t.teamRank})` : ""} · ${t.chance}% chance · wants: ${t.dealbreaker}`);
    }
  } else {
    lines.push("PORTAL STATUS: the transfer portal is NOT open yet this week (it opens after the season) — do NOT claim any player has entered the portal or transferred. Cover it as WHO IS AT RISK and the storylines building toward the window.");
  }
  const risk = Array.isArray(p.atRisk) ? p.atRisk : [];
  if (risk.length) {
    lines.push("", "FLIGHT RISK — good players buried on the depth chart league-wide (this is the story):");
    for (const r of risk.slice(0, 24)) {
      lines.push(`  - [${r.tier}] ${r.name} (${r.position}, ${gradeWord(r.overall)}, ${r.year}) — ${r.team}${r.teamRank ? ` (#${r.teamRank})` : ""} · buried behind a ${gradeWord(r.starterOvr)} starter · dealbreaker: ${r.dealbreaker}`);
    }
  }
  lines.push(
    "",
    "Every player you name MUST come from the board above. Reason from the data: a highly-graded",
    "underclassman stuck behind a returning starter whose dealbreaker is Playing Time is the",
    "textbook flight risk. Cover multiple programs, not just one — this is a league-wide show."
  );
  return lines.join("\n");
}

function buildShowSpec(ctx: MediaContext, extra: Extra): PromptSpec {
  const requested = String(extra.showType ?? "gameday");
  const showType = SHOW_PERSONAS[requested] ? requested : "gameday";
  const personas = SHOW_PERSONAS[showType];
  const personaBlock = personas.map((p) => `- ${p.name} (${p.role}, ${p.affiliation}): ${p.personality}`).join("\n");
  const portalBlock = showType === "portal" ? portalBoardBlock(extra) : "";
  const prompt = [
    `You are generating a transcript for a college football broadcast show called "${SHOW_TITLES[showType].title}".`,
    "The show features these recurring personalities:",
    personaBlock,
    "",
    `School: ${ctx.school}`,
    `Head Coach: ${ctx.coachName}`,
    `Current Week: ${ctx.week}`,
    "",
    "Season & game context (source of truth — never invent scores, stats, or ranks beyond this):",
    ctx.userContext,
    portalBlock ? "\n" + portalBlock : "",
    "",
    ...SHOW_DIRECTION[showType],
    "",
    "Respond with valid JSON only. No markdown fences. Use this exact schema:",
    '{"dialogue": [{"speaker": "Name", "role": "Role", "text": "what they say or the stage direction", "isStageDirection": false}]}',
    "",
    showType === "podcast"
      ? "Generate 22-32 dialogue lines (it's a podcast — let exchanges breathe). Mix in 2-4 stage directions."
      : "Generate 12-20 dialogue lines. Mix regular dialogue with 2-4 stage directions.",
    "Reference real details from the context. Do not invent scores or stats not provided.",
  ].join("\n");
  // House-style dialogue runs long; 2048 was truncating transcripts mid-array, which is
  // why shows intermittently "didn't come together". The podcast runs longer still.
  return { prompt, maxTokens: showType === "podcast" ? 3800 : 2800 };
}

const OFFSEASON_PHASES = ["bowl_recap", "awards", "portal_window", "coaching_carousel", "signing_day", "spring_preview"];

// The offseason command-center briefing — a stage-aware "state of the program" grounded in
// the REAL offseason data the hub gathers (record, recruiting class, portal). Regenerates as
// the user advances through the 9 offseason stages.
function buildOffseasonBriefSpec(ctx: MediaContext, extra: Extra): PromptSpec {
  const stageLabel = String(extra.stageLabel ?? "The Offseason");
  const stageNum = typeof extra.stageNum === "number" ? extra.stageNum : null;
  const totalStages = typeof extra.totalStages === "number" ? extra.totalStages : null;
  const record = extra.record ? String(extra.record) : null;
  const isChamp = extra.isChamp === true;
  const commits = Array.isArray(extra.commits) ? (extra.commits as { name: string; position: string; nationalRank: number | null }[]) : [];
  const atRisk = typeof extra.atRisk === "number" ? extra.atRisk : 0;

  // League-wide portal intelligence (see offseason/page.tsx). The save exposes who is IN the
  // portal and from WHICH program — never a landing/destination — so "losers" and "movers"
  // are hard fact, but "who wins the portal" is analysis, never an invented commitment.
  type Mover = { name: string; position: string | null; overall: number | null; team: string; teamRank: number | null; chance: number };
  type TeamLoss = { team: string; teamRank: number | null; count: number; topOverall: number; names: string[] };
  const leagueMovers = Array.isArray(extra.leagueMovers) ? (extra.leagueMovers as Mover[]) : [];
  const teamLosses = Array.isArray(extra.teamLosses) ? (extra.teamLosses as TeamLoss[]) : [];
  const userDepartures = Array.isArray(extra.userDepartures) ? (extra.userDepartures as Mover[]) : [];
  // REAL commitment data — destinations resolved from the save, so "who went where" is fact.
  type TopClass = { school: string; teamRank: number | null; count: number; blueChips: number; avgRank: number | null; top: string[] };
  type Commit = { name: string; position: string | null; nationalRank: number | null; stage: string; school: string };
  const topClasses = Array.isArray(extra.topClasses) ? (extra.topClasses as TopClass[]) : [];
  const notableCommits = Array.isArray(extra.notableCommits) ? (extra.notableCommits as Commit[]) : [];

  const commitLines = commits
    .slice(0, 24)
    .map((c) => `  ${c.name} (${c.position}${c.nationalRank ? `, #${c.nationalRank} nat'l` : ""})`);
  const moverLines = leagueMovers
    .slice(0, 16)
    .map((m) => `  ${m.name} (${m.position ?? "?"}${m.overall != null ? `, ${gradeWord(m.overall)}` : ""}) — LEFT ${m.teamRank ? `#${m.teamRank} ` : ""}${m.team}${m.chance ? `, ${m.chance}% gone` : ""}`);
  const lossLines = teamLosses
    .slice(0, 10)
    .map((t) => `  ${t.teamRank ? `#${t.teamRank} ` : ""}${t.team}: ${t.count} in the portal (best of them ${gradeWord(t.topOverall)})${t.names.length ? ` — ${t.names.join(", ")}` : ""}`);
  const userLossLines = userDepartures.slice(0, 12).map((m) => `  ${m.name} (${m.position ?? "?"}${m.overall != null ? `, ${gradeWord(m.overall)}` : ""})`);
  const classLines = topClasses
    .slice(0, 12)
    .map((c) => `  ${c.teamRank ? `#${c.teamRank} ` : ""}${c.school}: ${c.count} commits, ${c.blueChips} blue-chip${c.avgRank ? `, avg nat'l rank ${c.avgRank}` : ""}${c.top.length ? ` — ${c.top.join(", ")}` : ""}`);
  const commitLinesLeague = notableCommits
    .slice(0, 24)
    .map((c) => `  ${c.nationalRank ? `#${c.nationalRank} ` : ""}${c.name} (${c.position ?? "?"}) → ${c.school} [${c.stage}]`);

  return {
    maxTokens: 2600,
    prompt: [
      `You are a national college-football insider filing the OFFSEASON portal briefing, anchored to ${ctx.school} but covering the whole league.`,
      `Current offseason stage: ${stageLabel}${stageNum != null && totalStages != null ? ` (stage ${stageNum} of ${totalStages})` : ""}.`,
      "Return JSON with this exact schema:",
      JSON.stringify({
        headline: "string (offseason A1 headline about the portal landscape)",
        stageLabel: "string (short label for this stage)",
        body: "string (2-3 paragraphs, \\n\\n separated: FIRST the national portal picture — how the transfer landscape is shaping up around the league, who's gaining and who's bleeding — THEN bring it home to what it means for " + ctx.school + ")",
        portalReport: {
          winners: [{ team: "string", note: "1 sentence: what they landed (grounded in the REAL classes below)" }],
          losers: [{ team: "string", note: "1 sentence: what they're losing (grounded in the departures below)" }],
          movers: [{ player: "string", note: "1 sentence: the commit and WHERE HE WENT, or a portal name and who he left" }],
        },
        storylines: [{ title: "string", text: "string (2-3 sentences)" }],
        lookAhead: "string (1-2 sentences: what next week of the window could bring)",
      }),
      "",
      "HARD RULES:",
      "- It is the OFFSEASON. There are NO games. Do NOT invent, recap, or reference any game or score.",
      "- RECRUIT COMMITMENTS BELOW ARE REAL AND INCLUDE THE DESTINATION SCHOOL. Use them exactly —",
      "  name the player and the school he actually picked. Never reassign a commit to another school.",
      "- PORTAL TRANSFERS ARE DIFFERENT: the board shows who ENTERED the portal and the team he LEFT,",
      "  never where he lands. NEVER say a portal player 'committed to', 'signed with', or 'is headed",
      "  to' a school — only who he left. That destination genuinely isn't decided yet.",
      "- Every team and player you name must come from the real lists below (or the context).",
      "- 3-4 storylines. Confident, specific national-insider voice — no filler.",
      "- 3-5 winners, 3-6 losers, 4-8 movers where the data supports it (fewer if it doesn't).",
      "",
      "=== YOUR PROGRAM (anchor the story here) ===",
      record ? `${ctx.school} just finished ${record}${isChamp ? " — NATIONAL CHAMPIONS" : ""}.` : "",
      `${ctx.school} flight risks flagged: ${atRisk}.`,
      userLossLines.length ? `${ctx.school} players in the portal:` : `${ctx.school} portal departures: none surfaced yet this stage.`,
      ...userLossLines,
      commitLines.length ? `${ctx.school} signed class (${commitLines.length}):` : `${ctx.school} signed class: none yet this stage.`,
      ...commitLines,
      "",
      "=== LEAGUE RECRUITING BOARD (REAL commitments — destination is FACT, use it) ===",
      classLines.length ? "Programs winning the trail (incoming classes):" : "No classes resolved yet this stage.",
      ...classLines,
      commitLinesLeague.length ? "Notable commitments — player → the school he picked:" : "",
      ...commitLinesLeague,
      "",
      "=== LEAGUE PORTAL BOARD (real — who ENTERED the portal, and from where; NO destinations) ===",
      moverLines.length ? "Notable names on the move:" : "No league-wide portal entries surfaced yet this stage.",
      ...moverLines,
      lossLines.length ? "Programs bleeding the most talent (the losers):" : "",
      ...lossLines,
      "",
      "Program context:",
      ctx.userContext,
    ].filter(Boolean).join("\n"),
  };
}

function buildOffseasonSpec(ctx: MediaContext, extra: Extra): PromptSpec {
  const phase = OFFSEASON_PHASES.includes(String(extra.phase)) ? String(extra.phase) : "bowl_recap";
  const prestige = ctx.snapshot.userTeam?.prestige != null ? `${ctx.snapshot.userTeam.prestige}/10` : "unknown";
  const head = [
    `You are a college football beat writer and insider covering ${ctx.school}.`,
    `The head coach is ${ctx.coachName}. Program prestige: ${prestige}.`,
    "Write in a vivid, editorial style befitting a premium sports publication.",
    "Ground everything in the season context below — never invent scores, ranks, or records beyond it.",
    "",
    "Season context (source of truth):",
    ctx.userContext,
    "",
  ];
  const bodies: Record<string, string[]> = {
    bowl_recap: [
      "Write a season-ending bowl recap article as JSON with this exact schema:",
      '{"headline": "string", "body": "300-400 words", "socialReactions": [{"handle": "string", "body": "string", "type": "fan"|"analyst"|"rival"}]}',
      "",
      "Include 5-6 social reactions with a mix of fan, analyst, and rival perspectives. Reflect on the entire season arc.",
    ],
    awards: [
      "Generate end-of-season awards as JSON with this exact schema:",
      '{"awards": [{"name": "string", "winner": "string", "description": "string"}], "allConference": [{"name": "string", "position": "string"}], "narrative": "100-150 words"}',
      "",
      "Include 4-6 awards and 6-8 all-conference selections.",
      ctx.roster.length ? "Use real players from YOUR ROSTER above for winners/selections." : `Use fictional player names that fit the ${ctx.school} program.`,
    ],
    portal_window: [
      "Generate transfer portal activity as JSON with this exact schema:",
      '{"entries": [{"name": "string", "position": "string", "direction": "in"|"out", "reason": "string", "impact": "string"}], "narrative": "100-150 words"}',
      "",
      "Include 6-10 portal entries with a realistic mix of incoming and outgoing players. Base the volume on the season results.",
    ],
    coaching_carousel: [
      "Generate coaching carousel rumors as JSON with this exact schema:",
      '{"rumors": [{"staffName": "string", "role": "string", "school": "string", "likelihood": "confirmed"|"likely"|"rumored"|"unlikely", "narrative": "string"}], "headline": "string"}',
      "",
      "Include 3-5 coordinator/position-coach rumors. At least one poaching attempt and one potential hire.",
    ],
    signing_day: [
      "Generate signing day results as JSON with this exact schema:",
      '{"decisions": [{"name": "string", "position": "string", "stars": number, "decision": "committed"|"flipped"|"decommitted"|"surprise", "narrative": "string"}], "classGrade": "string", "summary": "100-150 words"}',
      "",
      "Generate 4-6 fictional recruits making signing day decisions. Mix decisions; include at least one surprise.",
    ],
    spring_preview: [
      "Generate a spring preview article as JSON with this exact schema:",
      '{"headline": "string", "body": "250-350 words", "keyStorylines": ["string","string","string","string","string"], "preseasonRanking": number|null}',
      "",
      "Forward-looking preview. Exactly 5 key storylines (15-25 words each). preseasonRanking is a realistic 1-25 number or null.",
    ],
  };
  return { prompt: head.concat(bodies[phase]).join("\n"), maxTokens: 1800 };
}

// How each program situation should be written. This is what lets a TeamBuilder school or an
// FCS team that just moved up have its OWN story instead of being written like a generic
// FBS program — a heavily requested gap.
const SITUATION_BRIEF: Record<string, string> = {
  established:
    "An established FBS program with its own history, traditions, and settled expectations.",
  "fcs-jump":
    "This program RECENTLY MOVED UP FROM FCS to FBS. That jump is the defining fact of its identity: a smaller stadium and budget, a schedule full of programs with more money, recruits who used to be out of reach, national media that doesn't take it seriously yet, and a fan base that remembers winning at the old level. Every 'can they hang at this level?' question is live.",
  "new-program":
    "This is a BRAND-NEW program playing its first seasons — no history, no alumni base, no traditions yet. Everything is being established for the first time: the first signature win, the first rivalry, the first star. The media frames it as a program being built from nothing.",
  rebuild:
    "A long-struggling program being dragged back toward relevance. Losing is the baseline expectation, so progress reads as remarkable and every setback feels familiar to the fan base.",
  "fallen-giant":
    "A program with REAL history that fell off badly. The pressure is restoration: fans and boosters remember what it was, and anything short of returning to that standard reads as failure.",
};

function buildBackstorySpec(ctx: MediaContext, extra: Extra): PromptSpec {
  const archetype = String(extra.archetype ?? "players-coach");
  const customPath = String(extra.customPath ?? "");
  const situation = typeof extra.programSituation === "string" ? extra.programSituation : "established";
  const programNote = String(extra.programNote ?? "");
  const brief = SITUATION_BRIEF[situation] ?? SITUATION_BRIEF.established;
  const prompt = [
    "You are a premier sports biographer and narrative designer for a college-football simulator.",
    "Write a rich, detailed, immersive backstory for BOTH a head coach AND the program he runs.",
    "Respond with a JSON object matching this exact schema:",
    '{ "archetype": "disciplinarian"|"players-coach"|"nil-merchant"|"hometown-savior", "customPath": "the custom path input saved back", "bio": "2-3 paragraphs (150-220 words), prestige sports-journalism tone", "programBio": "1-2 paragraphs (90-150 words) on the PROGRAM itself — where it came from, where it stands, what it is trying to become", "adName": "fictional realistic Athletic Director name", "boosterName": "fictional realistic chief billionaire booster name", "reporterName": "fictional realistic lead beat writer name", "rivalCoachName": "fictional realistic rival head coach name" }',
    "",
    "Rules:",
    "- The bio must feel lived-in, textured, and dramatic. Address the pressure of this job.",
    "- Archetype selected: " + archetype + ". Reflect its profile (disciplinarian=old-school/integrity; players-coach=empathy/culture; nil-merchant=transactional/portal; hometown-savior=local hero/expectation).",
    '- Incorporate the custom career path if provided: "' + customPath + '".',
    "",
    "THE PROGRAM'S SITUATION (shapes programBio, and the coach's bio should acknowledge it):",
    `- ${brief}`,
    programNote ? `- The user's own description of this program, treat as FACT: "${programNote}"` : "",
    "- programBio must be specific to THIS situation — never generic 'storied program' filler for",
    "  a school that just moved up or doesn't exist yet.",
    "",
    `- Coach Name: ${ctx.coachName}`,
    `- School: ${ctx.school}`,
    ctx.snapshot.userTeam?.prestige != null ? `- Program prestige: ${ctx.snapshot.userTeam.prestige}/10` : "",
    "- Do not mention any real living people or actual active college coaches.",
    "- Fictional names must sound authentic to college sports.",
  ].filter(Boolean).join("\n");
  return { prompt, maxTokens: 1900 };
}

function buildGradeSpec(ctx: MediaContext, extra: Extra): PromptSpec {
  const exchanges = Array.isArray(extra.exchanges) ? (extra.exchanges as Record<string, unknown>[]) : [];
  const transcript = exchanges
    .map((ex, i) => {
      const q = (ex.question as Record<string, unknown>) ?? {};
      let text = `Q${i + 1} (${q.reporterName ?? "Reporter"}, ${q.outlet ?? ""} — ${q.tone ?? "neutral"} tone): "${q.question ?? ""}"`;
      text += `\nCoach's answer (${ex.selectedTone ?? "honest"} tone): "${ex.userAnswer ?? ""}"`;
      if (ex.followUp) {
        text += `\nFollow-up: "${ex.followUp}"`;
        text += `\nCoach's follow-up answer: "${ex.followUpAnswer ?? "(no answer)"}"`;
      }
      return text;
    })
    .join("\n\n");
  const prompt = [
    `You are a college football media analyst grading Coach ${ctx.coachName} of ${ctx.school} after their Week ${ctx.week} press conference. Fair but critical.`,
    "",
    "Grade this press conference transcript:",
    "",
    transcript,
    "",
    "Evaluate 0-100 each: composure, authenticity, deflectionSkill, headlineManagement.",
    "Also provide overall (letter grade), summary (2-3 sentences), bestMoment, worstMoment.",
    "",
    "Respond with valid JSON only, no markdown fences, matching:",
    '{"overall": "B+", "composure": 78, "authenticity": 82, "deflectionSkill": 65, "headlineManagement": 71, "summary": "...", "bestMoment": "...", "worstMoment": "..."}',
  ].join("\n");
  return { prompt, maxTokens: 1024 };
}

function buildStorylinesSpec(ctx: MediaContext, extra: Extra): PromptSpec {
  const security = jobSecurityLine(ctx.snapshot.coach);

  // What's really brewing, computed from the roster (buried stars, NIL grievances, seniors
  // on the bench, confidence collapses, academic risk). Situations built on these are about
  // the user's ACTUAL team instead of plausible fiction.
  const board = pressureBoard(ctx.roster ?? []);
  const boardLines = board.map(pressureLine);

  // Continuity: what the coach has already decided this season, and where each player
  // stands with him because of it. Without this the desk has amnesia — every week reads
  // like the first week of the job, which is the single least immersive thing it could do.
  const priors = Array.isArray(extra.recentDecisions)
    ? (extra.recentDecisions as Array<Record<string, unknown>>)
    : [];
  const priorLines = priors.slice(0, 8).map((d) => {
    const wk = d.week != null ? `Wk ${d.week}` : "earlier";
    const who = d.playerName ? ` (${d.playerName})` : "";
    return `  ${wk}: "${d.headline ?? ""}"${who} → you went ${d.decision ?? "?"} [${d.tone ?? "measured"}]${d.suspended ? ", and you suspended him" : ""}. Fallout: ${d.outcome ?? "—"}`;
  });

  const standings = playerStandings(
    priors.map((d) => ({
      playerName: typeof d.playerName === "string" ? d.playerName : null,
      week: typeof d.week === "number" ? d.week : 0,
      year: typeof d.year === "number" ? d.year : 0,
      headline: String(d.headline ?? ""),
      decision: String(d.decision ?? ""),
      tone: String(d.tone ?? "measured"),
      suspended: d.suspended === true,
    }))
  );
  const standingLines = standings
    .filter((s) => s.standing !== "neutral")
    .slice(0, 6)
    .map((s) => `  ${s.name}: ${STANDING_LABEL[s.standing]} (${s.history.length} decision${s.history.length === 1 ? "" : "s"})`);

  // A situation the coach chose to sit on last week. It does not go away — it comes back
  // worse, which is what makes "let it ride" an actual decision instead of a free skip.
  const deferred = Array.isArray(extra.deferred)
    ? (extra.deferred as Array<Record<string, unknown>>)
    : [];
  const deferredLines = deferred.map(
    (d) => `  "${d.headline ?? ""}"${d.playerName ? ` (${d.playerName})` : ""} — ignored in Wk ${d.week ?? "?"}, severity was ${d.severity ?? "brewing"}`
  );

  const prompt = [
    "You are the situation desk for a college-football head coach simulator. Generate the",
    "off-field situations landing on the coach's desk THIS WEEK as JSON with this exact schema:",
    '{"situations": [{',
    "  \"category\": one of [legal, academics, portal, nil, locker-room, off-field, booster, social-media, recruiting],",
    '  "severity": "brewing" | "developing" | "crisis",',
    '  "headline": "tabloid-sharp but realistic, <= 9 words",',
    '  "dek": "1-2 sentences: what happened, who it involves, why it lands on the coach now",',
    '  "player": {"name": "realistic full name", "position": "QB/RB/WR/LB/etc", "year": "Fr/So/Jr/Sr"} | null,',
    "  \"source\": \"how the coach found out\",",
    '  "stakes": "one line on what is on the line if this is mishandled",',
    '  "callback": "one line naming the EARLIER decision this grows out of, or empty string" ,',
    '  "options": [{"id": "a|b|c", "label": "<=5 word stance", "approach": "one line on the move", "tone": "hardline|measured|protective|pragmatic", "cost": "one line on what this move costs you — who it upsets, what it spends"}]',
    "}]}",
    "",
    "Rules:",
    "- Generate 2 to 3 situations. At least one MUST involve a specific named player (player != null).",
    "- Give EACH situation exactly 3 options with genuinely different philosophies — there is no clean answer.",
    "- EVERY option needs an honest `cost`. If an option looks free, you have written it wrong.",
    "- Ground the situations in the actual result and the pressure the coach is under.",
    boardLines.length
      ? [
          "- BUILD FROM THE PRESSURE BOARD BELOW. It is computed from the real roster — those grievances",
          "  already exist. At least one situation MUST come from a BOILING or real pressure point, using",
          "  that exact player. Do not invent a grievance when a real one is listed.",
        ].join("\n")
      : "",
    priorLines.length
      ? [
          "- CONTINUITY IS THE POINT. You are handed what this coach already decided. Situations should",
          "  grow out of that history: a player he protected pushes his luck; a player he suspended comes",
          "  back with something to prove or a chip on his shoulder; the beat writer returns to a story he",
          "  was fed a line about. When a situation is a direct consequence of an earlier decision, fill",
          "  `callback` with one line naming it. At least one situation should be a callback when the",
          "  history below supports one. Never contradict what already happened.",
        ].join("\n")
      : "",
    deferredLines.length
      ? [
          "- THE COACH IGNORED SOMETHING. Every item under IGNORED LAST WEEK must return this week, one",
          "  severity level HOTTER (brewing→developing→crisis), with worse options than it had before.",
          "  Nothing the coach sat on quietly resolves itself.",
        ].join("\n")
      : "",
    `- ${rosterLine(ctx)} When a situation involves one of YOUR players, use a real name from the roster.`,
    "- PERSONALITY DRIVES THE DRAMA: each roster player carries a personality. Pick situations that",
    "  fit who they are — an Intense player benched behind a hot freshman confronts the staff; an",
    "  Entertainer's social post blows up; an Unpredictable star goes dark; a Leader calls a",
    "  players-only meeting. The situation must be believable FOR THAT PLAYER.",
    "- Use the stat lines: a producing player's drama has leverage (portal threats hit harder); a",
    "  buried veteran's frustration is about playing time the numbers justify.",
    "- Keep it grounded and human. No cartoon villainy — these are 18-22 year olds and real people.",
    ctx.backstory
      ? [
          "- Shape the slate around the coach's archetype: a disciplinarian breeds player chafing/authority standoffs;",
          "  a players-coach gets AD/media pressure to discipline someone the room loves; a nil-merchant gets money/portal",
          "  leverage fights; a hometown-savior gets outsized fan/local-media blowups.",
          `- Use the recurring cast by name in "source"/"dek" where natural (AD ${ctx.backstory.adName}, booster ${ctx.backstory.boosterName}, beat writer ${ctx.backstory.reporterName}).`,
        ].join("\n")
      : "",
    "",
    `Coach's current job security: ${security}.`,
    "",
    boardLines.length ? "=== THE PRESSURE BOARD (computed from the real roster — these grievances EXIST) ===" : null,
    ...boardLines,
    boardLines.length ? "" : null,
    priorLines.length ? "=== WHAT THIS COACH HAS ALREADY DECIDED THIS SEASON ===" : null,
    ...priorLines,
    priorLines.length ? "" : null,
    standingLines.length ? "=== WHERE PLAYERS STAND WITH HIM BECAUSE OF IT ===" : null,
    ...standingLines,
    standingLines.length ? "" : null,
    deferredLines.length ? "=== IGNORED LAST WEEK (must come back hotter) ===" : null,
    ...deferredLines,
    deferredLines.length ? "" : null,
    "Context (source of truth — never contradict the record or result):",
    ctx.userContext,
  ]
    .filter((l) => l != null)
    .join("\n");
  return { prompt, maxTokens: 2600 };
}

// Look up a player's save-assigned personality by name (case-insensitive).
function personalityOf(ctx: MediaContext, name: unknown): string | null {
  if (typeof name !== "string" || !name.trim()) return null;
  const n = name.trim().toLowerCase();
  const hit = ctx.roster.find((p) => p.name.toLowerCase() === n);
  return hit?.personality ?? null;
}

function buildFalloutSpec(ctx: MediaContext, extra: Extra): PromptSpec {
  const situation = (extra.situation as Record<string, unknown>) ?? {};
  const option = (extra.option as Record<string, unknown>) ?? {};
  const meters = (extra.meters as Record<string, unknown>) ?? {};
  const player = (situation.player as Record<string, unknown>) ?? null;
  const playerPersonality = player ? personalityOf(ctx, player.name) : null;
  const prompt = [
    "You are the consequence engine for a college-football head coach simulator.",
    "The coach faced a situation and made a decision. Return the fallout as JSON with this exact schema:",
    '{ "outcome": "2-3 sentences: what happens next as a direct result", "meterDeltas": {"boosterConfidence": int, "fanTrust": int, "mediaHeat": int, "lockerRoom": int}, "lockerRoom": {"reaction": "one line", "byPlayer": "a teammate/captain name or role"}, "playerThread": [{"from": "coach"|"player", "text": "a realistic text message"}], "mediaQuestions": [{"reporter": "name", "outlet": "outlet", "tone": "hostile|gotcha|neutral|friendly", "question": "the pointed question about THIS decision", "answers": [{"label": "<=4 word posture", "text": "the exact quote you give", "mediaDelta": int, "fanDelta": int, "lockerDelta": int}]}], "suspension": {"weeks": 1|2|3} | null }',
    "",
    "Meter rules (0-100 each): boosterConfidence, fanTrust, lockerRoom (higher=better); mediaHeat (HIGHER IS WORSE — a calming, accountable answer has a NEGATIVE mediaDelta).",
    "- meterDeltas from the decision: integers roughly -20..+20, reflecting the trade-off honestly. Not all four move.",
    "- Media gauntlet: exactly 2 questions, at least one hostile/gotcha if serious. Each question gets 3 answer options with different postures; deltas roughly -10..+10.",
    "- SUSPENSION (almost always null): only when a named player is involved AND the offense is",
    "  genuinely serious (legal trouble, a flagrant team-rules violation, academics) AND the",
    "  coach's chosen approach imposes discipline (a hardline tone, or a measured one where the",
    "  program's hand is forced). Then — and only then — set suspension.weeks (1 = internal",
    "  discipline, 2 = serious, 3 = the book thrown). A protective/shielding decision, a minor",
    "  distraction, or any situation without a named player is ALWAYS suspension: null. Across",
    "  a whole season this should fire only a handful of times — when it does, say so in the",
    "  outcome text (it will really cost him those games).",
    player
      ? `- Player thread: a private text thread between the coach and ${player.name} (${player.position ?? "player"}). 3-5 messages, starting with the coach, true to the decision. Real texting voice.`
      : "- No specific player is involved; return playerThread as an empty array [].",
    playerPersonality
      ? [
          `- ${player!.name}'s personality is ${playerPersonality}. His texts, public moves, and whether he`,
          "  backs down or doubles down MUST match it (Intense stands his ground and does not backtrack;",
          "  TeamPlayer smooths it over; Unpredictable is genuinely volatile; Entertainer takes it public;",
          "  Leader handles it face-to-face and owns his part).",
        ].join("\n")
      : "",
    "- The lockerRoom reaction should come from a real roster player whose PERSONALITY fits the reaction (a Leader steadies, an Intense player pours gas).",
    ctx.backstory
      ? [
          `- At least one media question comes from beat writer ${ctx.backstory.reporterName}.`,
          `- Where it fits, reflect AD ${ctx.backstory.adName} or booster ${ctx.backstory.boosterName} in the outcome/questions based on how the decision lands with them.`,
          "- The player's texting tone reacts to the coach's archetype (weight of the rules with a disciplinarian; protected-but-accountable with a players-coach).",
        ].join("\n")
      : "",
    "",
    "=== THE SITUATION ===",
    `Category: ${situation.category ?? "unknown"} · Severity: ${situation.severity ?? "developing"}`,
    `Headline: ${situation.headline ?? ""}`,
    `Details: ${situation.dek ?? ""}`,
    player ? `Player: ${player.name} (${player.position ?? "?"})` : "Player: none",
    `Stakes: ${situation.stakes ?? ""}`,
    "",
    "=== THE DECISION THE COACH MADE ===",
    `${option.label ?? ""} — ${option.approach ?? ""} (tone: ${option.tone ?? "measured"})`,
    "",
    "=== COACH STANDING RIGHT NOW (0-100) ===",
    `Boosters/AD: ${meters.boosterConfidence ?? "n/a"} · Fans: ${meters.fanTrust ?? "n/a"} · Media heat: ${meters.mediaHeat ?? "n/a"} · Locker room: ${meters.lockerRoom ?? "n/a"}`,
    "",
    "Season context (source of truth):",
    ctx.userContext,
  ].join("\n");
  return { prompt, maxTokens: 2200 };
}

function buildPlayerTextSpec(ctx: MediaContext, extra: Extra): PromptSpec {
  const situation = (extra.situation as Record<string, unknown>) ?? {};
  const player = (situation.player as Record<string, unknown>) ?? { name: "the player", position: "" };
  const thread = Array.isArray(extra.thread) ? (extra.thread as Record<string, unknown>[]) : [];
  const coachMessage = String(extra.coachMessage ?? "");
  const personality = personalityOf(ctx, player.name);
  const transcript = thread
    .map((m) => `${m.from === "coach" ? "COACH" : String(player.name ?? "PLAYER").toUpperCase()}: ${m.text}`)
    .join("\n");
  const prompt = [
    `You are ${player.name}${player.position ? `, a ${player.position}` : ""} on the team, texting your head coach back.`,
    "Reply as JSON with this exact schema:",
    '{"reply": "your text back (1-3 short messages worth, natural texting voice)", "mood": "warm|defensive|angry|grateful|shut-down"}',
    "",
    "Stay fully in character as a real 18-22 year old college athlete. React honestly. Do not narrate — just text back. Keep it short.",
    personality
      ? [
          `YOUR PERSONALITY (from the game, non-negotiable): ${personality}.`,
          "- Intense: you don't back down. If you said it, you meant it — pressure makes you dig in, not fold.",
          "- Leader: you own your part, protect teammates, and want to fix it man-to-man.",
          "- TeamPlayer: you hate the drama, you defer to the team, you'll take the olive branch.",
          "- Entertainer: you keep it light, joke through tension, and you're already thinking about the cameras.",
          "- Unpredictable: your mood can swing mid-thread — conciliatory one text, heated the next.",
          "Never break from this personality just to make the coach comfortable.",
        ].join("\n")
      : "",
    ctx.backstory
      ? `Your coach is a ${ctx.backstory.archetype} — let that shape your tone (guarded compliance with a disciplinarian, more open/emotional with a players-coach).`
      : "",
    "",
    "=== THE SITUATION ===",
    `${situation.headline ?? ""} — ${situation.dek ?? ""}`,
    "",
    "=== THE THREAD SO FAR ===",
    transcript || "(no prior messages)",
    "",
    "=== COACH JUST TEXTED YOU ===",
    coachMessage,
  ].join("\n");
  return { prompt, maxTokens: 500 };
}

function recruitLine(r: Record<string, unknown>): string {
  // Spell the position out — bare codes like "RE" were being misread (a defensive end
  // turned into a tight end in the generated article).
  const code = typeof r.position === "string" ? r.position.toUpperCase() : null;
  const posText = code ? `${code} (${POSITION_NAME[code] ?? code})` : null;
  const bits = [
    r.stars != null ? `${r.stars}★` : null,
    posText,
    r.overall != null ? gradeWord(r.overall) : null,
    r.nationalRank != null ? `#${r.nationalRank} nat'l` : null,
    r.positionRank != null ? `#${r.positionRank} at position` : null,
    r.stateRank != null ? `#${r.stateRank} in state` : null,
    r.class ? `class of ${r.class}` : null,
    r.stage ? `stage: ${r.stage}` : null,
    r.commitScore != null ? `commit score ${r.commitScore}` : null,
  ].filter(Boolean);
  return `${r.name} — ${bits.join(", ")}`;
}

const POSITION_NAME: Record<string, string> = {
  QB: "quarterback", HB: "running back", RB: "running back", FB: "fullback",
  WR: "wide receiver", TE: "tight end", LT: "left tackle", LG: "left guard",
  C: "center", RG: "right guard", RT: "right tackle", OL: "offensive lineman",
  LE: "defensive end", RE: "defensive end", DE: "defensive end", DT: "defensive tackle",
  LOLB: "outside linebacker", ROLB: "outside linebacker", MLB: "middle linebacker",
  LB: "linebacker", CB: "cornerback", FS: "free safety", SS: "strong safety",
  S: "safety", K: "kicker", P: "punter", ATH: "athlete",
};

function buildRecruitDossierSpec(ctx: MediaContext, extra: Extra): PromptSpec {
  const r = (extra.recruit as Record<string, unknown>) ?? {};
  const posCode = typeof r.position === "string" ? r.position.toUpperCase() : null;
  const posLong = posCode ? POSITION_NAME[posCode] ?? posCode : null;
  const prompt = [
    "You are a college-football recruiting department building a full dossier on a prospect for the head coach.",
    "Return JSON with this exact schema:",
    '{',
    '  "backstory": "2-3 paragraphs (paragraphs separated by \\n\\n): where he is from, his path, his family/character, what drives him",',
    '  "film": {"grade": "A+/A/B+/…", "summary": "1-2 sentence scout read", "strengths": ["3-4 bullets"], "weaknesses": ["1-3 bullets"], "comp": "a stylistic player comparison", "projection": "how he projects at the next level"},',
    '  "article": {"outlet": "a recruiting outlet name", "headline": "string", "body": "~140 words in recruiting-media voice, paragraphs separated by \\n\\n"},',
    '  "social": [{"handle": "@handle", "platform": "X"|"IG", "body": "what the recruit himself posts", "likes": number}],',
    `  "interest": "how interested he is in ${ctx.school} specifically, and why (tie to the program's season). paragraphs separated by \\n\\n"`,
    '}',
    "",
    "Rules:",
    "- 3-4 social posts in the voice of a real 17-18 year old recruit (commit hype, visit photos, faith/family, grind posts).",
    "- Ground his interest in the real season context — a winning, ranked program sells differently than a struggling one.",
    "- This is a prospect, not a rostered player. Invent a believable BACKGROUND (hometown, high",
    "  school, family, path) consistent with his rating and rankings below. Everything the data",
    "  below states is FIXED FACT and must not be re-imagined.",
    "- No real living recruits.",
    posLong
      ? `- POSITION IS LOCKED: he is a ${posLong.toUpperCase()} (${posCode}). Every mention — the film ` +
        `report, the article, his own posts — must treat him as a ${posLong}. Do NOT describe him ` +
        `playing any other position, and do not say he "played ${posLong === "tight end" ? "defensive end" : "tight end"}" ` +
        "or any other spot in high school. His film, strengths, weaknesses, and comparison must all " +
        `be those of a ${posLong}.`
      : "",
    "- Do NOT state which school he committed to or signed with unless the data below names one.",
    "  If it doesn't, write about his recruitment WITHOUT naming a destination school.",
    "",
    `=== THE PROSPECT ===`,
    recruitLine(r),
    "",
    `=== YOUR PROGRAM ===`,
    ctx.userContext,
  ].join("\n");
  // Largest schema in the app — undersized budgets truncated the JSON mid-object and the
  // whole dossier was lost.
  return { prompt, maxTokens: 4600 };
}

// Next-opponent scouting report for the coach's desk. Built from the opponent's REAL roster
// + record: computes their stat leaders and run/pass identity from actual numbers, then has
// the model write the report so every named player and tendency is grounded in the save.
// Coach ↔ (AD / booster / beat reporter) text thread. Each figure replies in their own
// persona, grounded in the program's real state + the coach's standing (meters), reusing the
// recurring cast the backstory established.
// Brand-deal offers brought to the coach by the AD / lead booster. Each deal supplies a
// weeks-long stipend (program points → NIL headroom) but carries reputational risk: a clean
// national brand is easy money, a controversial one pays more but poisons fan trust and
// invites media heat. "Not all money is good money." The mechanical meter effects are
// computed deterministically from the reputation in the frontend, so the tradeoff is
// consistent — the model just supplies the brands, the pitch, and the risk framing.
function buildBrandDealsSpec(ctx: MediaContext): PromptSpec {
  const bs = ctx.backstory;
  return {
    maxTokens: 1800,
    prompt: [
      `You are generating brand-deal / NIL-collective offers pitched to Coach ${ctx.coachName} of ${ctx.school},`,
      `brokered by the athletic director${bs?.adName ? ` (${bs.adName})` : ""} and the lead booster${bs?.boosterName ? ` (${bs.boosterName})` : ""}.`,
      "Return JSON with this exact schema:",
      JSON.stringify({
        deals: [{
          brand: "fictional company/brand name",
          category: "e.g. Truck Dealership, Energy Drink, Crypto Exchange, Local BBQ, Sportsbook, Fashion Label",
          broker: "AD|Booster",
          pitch: "1-2 sentences: what they're offering and why they want THIS program",
          stipendPoints: "integer 0-100 — RELATIVE richness of this offer for its tier, NOT a currency amount (60 = modest for its tier, 100 = the richest offer of that tier). The app converts this into real program points scaled to the program's stature.",
          weeks: "integer 2-6 (how many weeks the stipend runs)",
          reputation: "clean|edgy|controversial",
          upside: "one line on the good side of the money",
          risk: "one line on the catch (fans, optics, distraction) — be honest that not all money is good money",
        }],
      }),
      "",
      "Rules:",
      "- Produce 4 deals with a spread of reputations: at least 1 clean, 1 edgy, 1 controversial.",
      "- Controversial deals (sportsbook, crypto, vice) pay the most but read as bad PR — make the risk real.",
      "- Ground the pitches in the program's real state (a champion draws bigger, cleaner money than a rebuild).",
      "- Invent all brand names; never use a real company.",
      "",
      "Program context:",
      ctx.userContext,
    ].join("\n"),
  };
}

// The wire reacting to an NIL deal the coach just handed out — scaled to the money. A monster
// deal gets national analysts and rival snark; a small bump gets a couple of fan posts.
function buildNilReactionSpec(ctx: MediaContext, extra: Extra): PromptSpec {
  const deals = Array.isArray(extra.deals) ? (extra.deals as { name: string; position?: string; from: number; to: number }[]) : [];
  const biggest = deals.reduce((m, d) => Math.max(m, d.to - d.from), 0);
  const size = biggest >= 400 ? "MASSIVE" : biggest >= 150 ? "BIG" : biggest >= 40 ? "notable" : "minor";
  const count = size === "MASSIVE" ? 8 : size === "BIG" ? 6 : size === "notable" ? 4 : 2;
  return {
    maxTokens: 1600,
    prompt: [
      `${ctx.school} just moved NIL money. React on social as JSON with this exact schema:`,
      '{"posts": [{"handle": "string", "displayName": "string", "type": "fan"|"rival"|"analyst"|"insider"|"reddit", "body": "string", "likes": number, "reposts": number}]}',
      "",
      `The size of the move is ${size}. Generate EXACTLY ${count} posts — the reaction MUST scale to the money:`,
      "- MASSIVE: national analysts, insiders reporting the number, rival fans seething about collectives, reddit meltdown.",
      "- minor: just a couple of fan posts, low-key.",
      "React to the SPECIFIC players and their new deals below. Use real player names; never invent a player.",
      "NO HTML entities. 'reposts' required.",
      "",
      "=== THE NIL MOVES ===",
      ...deals.map((d) => `  ${d.name}${d.position ? ` (${d.position})` : ""}: $${d.from}K → $${d.to}K NIL`),
      "",
      "Program context:",
      ctx.userContext,
    ].join("\n"),
  };
}

function buildFigureTextSpec(ctx: MediaContext, extra: Extra): PromptSpec {
  const figure = String(extra.figure ?? "ad"); // "ad" | "booster" | "reporter"
  const bs = ctx.backstory;
  const nameMap: Record<string, string | null | undefined> = {
    ad: bs?.adName,
    booster: bs?.boosterName,
    reporter: bs?.reporterName,
  };
  const roleMap: Record<string, string> = {
    ad: "the Athletic Director",
    booster: "the program's lead booster",
    reporter: "the beat writer who covers this program",
  };
  const voiceMap: Record<string, string> = {
    ad: "measured, institutional, protective of the department and the brand; talks about expectations, budgets, and optics. Warm when you're winning, pointed when the seat heats up.",
    booster: "big personality, money talks, wants wins and access; generous when happy, blunt and demanding when not. Name-drops donations and the facility.",
    reporter: "sharp, a little skeptical, always fishing for a quote or a scoop; friendly but never fully on your side — they have a story to file.",
  };
  const name = nameMap[figure] || roleMap[figure];
  const thread = Array.isArray(extra.thread) ? (extra.thread as Record<string, unknown>[]) : [];
  const coachMessage = String(extra.coachMessage ?? "");
  const transcript = thread
    .map((m) => `${m.from === "coach" ? "COACH" : String(name).toUpperCase()}: ${m.text}`)
    .join("\n");
  const meters = ctx.snapshot ? "" : "";
  return {
    maxTokens: 500,
    prompt: [
      `You are ${name}, ${roleMap[figure]} at ${ctx.school}, texting Coach ${ctx.coachName} back.`,
      `Your voice: ${voiceMap[figure]}`,
      "Reply as JSON with this exact schema:",
      '{"reply": "your text back (1-3 short messages, natural texting voice)", "mood": "warm|neutral|pleased|frustrated|threatening|fishing"}',
      "",
      "Stay fully in character. React to the real state of the program (record, ranking, momentum).",
      "Keep it short and real — this is a text, not a speech. Don't narrate.",
      bs ? `Reuse the established relationship; you are ${name}, a recurring figure in this coach's world.` : "",
      meters,
      "",
      "=== PROGRAM STATE ===",
      ctx.userContext,
      "",
      "=== THE THREAD SO FAR ===",
      transcript || "(no prior messages)",
      "",
      "=== COACH JUST TEXTED YOU ===",
      coachMessage,
    ].filter(Boolean).join("\n"),
  };
}

function buildScoutingSpec(ctx: MediaContext, extra: Extra): PromptSpec {
  const oppName = String(extra.oppName ?? "the next opponent");
  const oppRecord = extra.oppRecord ? String(extra.oppRecord) : null;
  const oppRank = typeof extra.oppRank === "number" ? extra.oppRank : null;
  // Team OVR is deliberately NOT read any more — the report grades in words, not numbers.
  const oppRoster = Array.isArray(extra.oppRoster) ? (extra.oppRoster as RosterPlayer[]) : [];

  // Stat leaders from real numbers.
  const withOff = (sel: (s: NonNullable<RosterPlayer["stats"]>["offense"]) => number) =>
    oppRoster
      .map((p) => ({ p, v: p.stats?.offense ? sel(p.stats.offense) || 0 : 0 }))
      .filter((x) => x.v > 0)
      .sort((a, b) => b.v - a.v)[0]?.p ?? null;
  const withDef = (sel: (s: NonNullable<RosterPlayer["stats"]>["defense"]) => number) =>
    oppRoster
      .map((p) => ({ p, v: p.stats?.defense ? sel(p.stats.defense) || 0 : 0 }))
      .filter((x) => x.v > 0)
      .sort((a, b) => b.v - a.v)[0]?.p ?? null;

  const passer = withOff((o) => o?.passYds ?? 0);
  const rusher = withOff((o) => o?.rushYds ?? 0);
  const receiver = withOff((o) => o?.recYds ?? 0);
  const tackler = withDef((d) => d?.tackles ?? 0);
  const sacker = withDef((d) => d?.sacks ?? 0);
  const picker = withDef((d) => d?.ints ?? 0);

  // Ratings never enter the prompt — the model can only repeat what it is given, so the
  // no-OVR rule has to hold on the way IN as well as the way out.
  const leaderLine = (label: string, p: RosterPlayer | null) =>
    p ? `  ${label}: ${playerLine(p)} ${p.position ?? "?"} — ${fmtStats(p) ?? "—"}` : null;

  const leaders = [
    leaderLine("Passer", passer),
    leaderLine("Lead rusher", rusher),
    leaderLine("Top receiver", receiver),
    leaderLine("Tackles leader", tackler),
    leaderLine("Pass rush", sacker),
    leaderLine("Ball hawk", picker),
  ].filter(Boolean) as string[];

  // Depth: the top handful in depth-chart order, real names + board grade in words, so
  // "key players" are grounded without ever handing over a rating.
  const keyGuys = oppRoster
    .filter((p) => p.overall != null)
    .slice(0, 14)
    .map((p) => {
      const prof = profileLine(p);
      return `  ${playerLine(p)} ${p.position ?? "?"} — ${TIER_LABEL[tierFor(p.overall)]}${prof ? ` — ${prof}` : ""}${fmtStats(p) ? ` — ${fmtStats(p)}` : ""}`;
    });

  // The deterministic half of the report: graded unit edges, individual mismatches, their
  // soft spots, injuries, play-calling tendency, special teams, plus the schedule-derived
  // half a real report opens with (form, common opponents, series, quarter splits). Computed
  // from the save so the model never guesses — and so the prose can't contradict the panel
  // the UI shows next to it.
  //
  // NOTE: nothing below hands the model a rating number. Staffs don't have an OVR column, so
  // the report doesn't either — grades and tiers go in, grades and tiers come out.
  const oppRow = typeof extra.oppRow === "number" ? extra.oppRow : null;
  const m = scoutingMath(ctx.roster ?? [], oppRoster, {
    games: ctx.snapshot?.games ?? [],
    teams: ctx.snapshot?.teams ?? {},
    myRow: ctx.snapshot?.userTeamRow,
    theirRow: oppRow,
  });
  const t = m.tendencies;

  const edgeLines = m.edges
    .filter((e) => e.verdict != null)
    .map((e) => `  ${e.label}: us ${e.myGrade ?? "?"} / them ${e.theirGrade ?? "?"} — ${EDGE_LABEL[e.verdict!]}`);
  // Each line carries the computed instruction as well as the verdict — that instruction is
  // what the UI shows the coach, so handing it to the model keeps the prose from arguing
  // with the panel directly above it.
  const matchupLines = m.matchups
    .filter((x) => x.verdict != null)
    .map(
      (x) =>
        `  ${x.label}: ${EDGE_LABEL[x.verdict!]} (us ${x.myGrade ?? "?"} / them ${x.theirGrade ?? "?"}) — read: ${x.call}`
    );
  const mismatchLines = m.mismatches.map((x) => {
    const how = attackLine(x.theirs.player);
    return `  ${starterLine(x.mine, true)} vs their ${starterLine(x.theirs, true)} — ${SEVERITY_LABEL[x.severity]} edge to us${how ? `. He is a ${how}` : ""}`;
  });
  // Archetype + trait read: WHY he's a threat, WHERE he can be attacked. Straight out of
  // the save's PlayerType and trait ratings, translated to coach-speak (see traits.ts) so
  // the report says "speed rusher · bull rush" instead of a number nobody can act on.
  const weakLines = m.weakLinks.map((s) => {
    const how = attackLine(s.player);
    return `  ${starterLine(s, true)}${how ? ` — ${how}` : ""}`;
  });
  const threatLines = m.threats.map((s) => {
    const prof = profileLine(s.player);
    const stat = fmtStats(s.player);
    return `  ${starterLine(s, true)}${prof ? ` — ${prof}` : ""}${stat ? ` — ${stat}` : ""}`;
  });
  const injuryLines = m.injuries
    .slice(0, 6)
    .map((i) => `  ${playerLine(i.player)} ${i.player.position ?? "?"}: ${i.status}`);
  const dropOffLines = m.dropOffs.map(
    (d) =>
      `  ${d.slot} ${playerLine(d.starter)} — big fall-off behind him${d.backup ? ` (next man: ${playerLine(d.backup)})` : " (no real backup on the roster)"}`
  );

  const sc = m.schedule;
  const formLines = sc ? sc.form.games.map((g) => `  ${formLine(g)}`) : [];
  const commonLines = sc
    ? sc.common.map(
        (c) =>
          `  vs ${c.opponent}: we went ${formLine(c.yours)}, they went ${formLine(c.theirs)} (${c.swing >= 0 ? "+" : ""}${c.swing} point swing our way)`
      )
    : [];
  const seriesLines = sc ? sc.series.map((g) => `  ${formLine(g)}`) : [];

  const st = m.specialTeams;
  const stLines = [
    st.kicker
      ? `  K ${st.kicker.name}${st.kicker.fgAtt > 0 ? ` — ${st.kicker.fgMade}/${st.kicker.fgAtt} FG` : ""}${st.kicker.fgLong ? `, long ${st.kicker.fgLong}` : ""}${st.kicker.att50 ? `, ${st.kicker.made50 ?? 0}/${st.kicker.att50} from 50+` : ""}`
      : null,
    st.punter
      ? `  P ${st.punter.name}${st.punter.avg ? ` — ${st.punter.avg} yd avg` : ""}${st.punter.in20 ? `, ${st.punter.in20} inside the 20` : ""}`
      : null,
    ...st.returnThreats.map(
      (r) => `  Return threat: ${r.name}${r.position ? ` (${r.position})` : ""} — ${r.retYds} return yds, ${r.kickRetTDs + r.puntRetTDs} return TD`
    ),
  ].filter(Boolean) as string[];

  const tendencyLine = [
    t.passRate != null ? `they pass on ${t.passRate}% of snaps (${t.passAtt} att vs ${t.rushAtt} carries)` : null,
    t.yardsPerAtt != null ? `${t.yardsPerAtt} yds/attempt` : null,
    t.completionPct != null ? `${t.completionPct}% completions` : null,
    t.yardsPerCarry != null ? `${t.yardsPerCarry} yds/carry` : null,
    `${t.passTDs} pass TD / ${t.passInts} INT`,
    t.sacksPerGame != null ? `their defense: ${t.sacksPerGame} sacks per game` : null,
    t.takeawaysPerGame != null ? `${t.takeawaysPerGame} takeaways per game` : null,
    t.tflPerGame != null ? `${t.tflPerGame} TFL per game` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const prompt = [
    `You are ${ctx.school}'s analytics staff building the scouting report on ${oppName} for the head coach's desk, ahead of the next game.`,
    "The coach reads this and then PLAYS THE GAME himself. Write it to be used with a controller in hand:",
    "name the man to target, the call to make, and what to stay away from.",
    "Return JSON with this exact schema:",
    JSON.stringify({
      opponent: "string (the opponent name)",
      bottomLine: "string (ONE sentence: can we win this, and the single lever that decides it)",
      summary: "string (2-3 sentence read: who they are and how dangerous)",
      offense: {
        identity: "run-heavy|pass-heavy|balanced",
        scheme: "string (short, inferred from their production — e.g. 'spread RPO', 'pro-style under center', 'gap-scheme power')",
        tendency: "string (1-2 sentences on HOW they call a game, quoting the real split/efficiency numbers given below)",
        keyPlayers: [{ name: "string (with his jersey number)", note: "string (WHAT HE IS and why that hurts — his archetype and trait read, plus a real stat)", assignment: "string (who on our side handles him and how — 'bracket him with the nickel and the free safety')" }],
        howToStop: "string (2-3 sentences of plan)",
        calls: ["3-4 CONCRETE defensive calls to make against them — coverage shells, fronts, blitz/contain decisions, who to double. Each 8-16 words, usable as-is."],
      },
      defense: {
        identity: "string (short, inferred)",
        scheme: "string (short, inferred — front and coverage tendency)",
        keyPlayers: [{ name: "string (with his jersey number)", note: "string (real stat)", assignment: "string (how we block/avoid him)" }],
        howToAttack: "string (2-3 sentences of plan)",
        calls: ["3-4 CONCRETE offensive concepts to call against them — formations, run/pass concepts, tempo, who to isolate. Each 8-16 words, usable as-is."],
      },
      attack: [{ target: "string (a REAL opponent player by jersey + name, or a named spot)", why: "string (the trait/archetype hole that makes him the target)", how: "string (the concept that gets him)" }],
      beware: [{ threat: "string (a REAL opponent player, jersey + name)", why: "string (his real production)", how: "string (how to neutralize him)" }],
      openingScript: ["EXACTLY 3 plays to open the game with, in order. Real concepts, chosen to test what this specific defense showed on film. Each 6-14 words."],
      situational: {
        firstDown: "string (one line — what they do on first down and your answer)",
        thirdDown: "string (one line)",
        redZone: "string (one line)",
        fourthDown: "string (one line — when to go for it against this defense, and their kicker's real range)",
      },
      adjustments: {
        ifTrailing: "string (one line — what changes if we're down two scores in the second half)",
        ifLeading: "string (one line — how we close it out, tied to when in a game they do their damage)",
      },
      gameFlow: "string (1-2 sentences on how the game likely unfolds, built on their quarter-by-quarter scoring profile and recent form)",
      injuryImpact: "string (what their injury list actually changes for us — or empty string if nobody is out)",
      seriesRead: "string (what the common opponents and prior meetings tell us — or empty string if there are none)",
      specialTeams: "string (1-2 lines: kicker range, punt game, return threat, and what it means for your 4th-down math)",
      xFactor: "string (the one player or matchup that decides the game)",
      keys: ["4-5 short bullet keys to the game"],
      prediction: { call: "string (who wins and roughly how)", confidence: "lock|lean|toss-up|underdog" },
    }),
    "",
    "HARD RULES:",
    "- NEVER cite a rating, an OVR, or any 0-99 player number. This report is written the way a real",
    "  staff writes one: jersey number, name, class, real production, and a grade in WORDS",
    "  ('elite', 'all-conference', 'first-year starter', 'weak spot', 'B+ unit'). A sentence like",
    "  '#12 Reed, an 88 overall corner' is WRONG. '#12 Reed, an all-conference corner' is right.",
    "- Refer to opponent players by jersey number and name on first mention (e.g. '#7 Danny Cole').",
    "- Use ONLY the real opponent players listed below, by their real names. Never invent a player.",
    "- Every claim about a player must match his real stat line. Do not inflate or invent numbers.",
    "- The GRADED EDGES and MISMATCHES below are computed from the actual save. Treat them as fact and",
    "  build the plan on them. NEVER contradict them — do not tell the coach to run into a front he loses to,",
    "  and do not call a unit a weakness when the grades say it's a strength.",
    `- Their play-calling identity from the numbers is: ${t.identity}. Reflect that honestly.`,
    "- EVERY player you name must come with WHY, in football terms, from his archetype and trait",
    "  read below — 'a speed rusher who wins with his first step', 'a man-coverage corner who",
    "  can't play zone', 'a run-stopping MIKE who's a liability up the seam'. Never write that",
    "  someone is simply 'good' or 'dangerous': say what he DOES.",
    "- Weaknesses come with the answer attached. 'Their CB2 is beat in man' is half a thought;",
    "  'isolate him with your WR1 and run vertical' is the note the coach uses.",
    "- attack: 2-3 entries. beware: 2-3 entries. Ground each one in a real player and real production.",
    "- calls must be real football, specific enough to act on: 'Cover 2 shell, keep the safety over #7'",
    "  beats 'play good defense'. No filler, no hedging, no repeating the same idea twice.",
    "- Do NOT invent situational data you were not given. There are no third-down or red-zone splits in",
    "  this data: write those lines as reasoned coaching judgement from what IS here (personnel, tendency,",
    "  quarter splits), never as a fabricated statistic.",
    "- If a number below is missing, say nothing about it rather than guessing.",
    "- Confident coaching-staff voice. This is a game plan, not hype.",
    "",
    `=== ${oppName.toUpperCase()} — TEAM ===`,
    `Record: ${oppRecord ?? "n/a"}${oppRank ? ` · AP #${oppRank}` : ""}`,
    `Play-calling / efficiency (real): ${t.identity}${tendencyLine ? ` — ${tendencyLine}` : ""}`,
    t.games != null ? `Games played so far: ${t.games}` : null,
    `Experience: ${m.experience.read}`,
    "",
    sc && sc.form.games.length ? "=== THEIR RECENT FORM (real results, most recent first) ===" : null,
    ...formLines,
    sc && sc.form.streak
      ? `  Streak: ${sc.form.streak} · scoring ${sc.form.pointsForPerGame ?? "?"} per game, allowing ${sc.form.pointsAgainstPerGame ?? "?"} (avg margin ${sc.form.averageMargin! >= 0 ? "+" : ""}${sc.form.averageMargin})`
      : null,
    formLines.length ? "" : null,
    commonLines.length ? "=== COMMON OPPONENTS (the most honest comparison we have) ===" : null,
    ...commonLines,
    commonLines.length ? "" : null,
    seriesLines.length ? "=== THE SERIES (prior meetings, our result first) ===" : null,
    ...seriesLines,
    seriesLines.length ? "" : null,
    sc?.quarters.read ? "=== WHEN THEY DO THEIR DAMAGE (quarter-by-quarter, real) ===" : null,
    sc?.quarters.read
      ? `  Scoring by quarter (per game): ${sc.quarters.scoredPerQuarter.join(" / ")} · allowing: ${sc.quarters.allowedPerQuarter.join(" / ")} (over ${sc.quarters.games} games)`
      : null,
    sc?.quarters.read ? `  Read: ${sc.quarters.read}` : null,
    sc?.quarters.read ? "" : null,
    "=== GRADED EDGES, UNIT BY UNIT (computed from both real rosters — FACT, report-card grades) ===",
    ...(edgeLines.length ? edgeLines : ["  (rosters unavailable — do not claim any edge)"]),
    m.overallVerdict ? `  Overall on-field talent: ${EDGE_LABEL[m.overallVerdict]} for us` : null,
    "",
    "=== THE FOUR PHASE MATCHUPS (computed — always stated FROM OUR SIDE) ===",
    ...(matchupLines.length ? matchupLines : ["  (unavailable)"]),
    "",
    "=== YOUR BEST INDIVIDUAL MISMATCHES (computed) ===",
    ...(mismatchLines.length ? mismatchLines : ["  (no clear individual mismatch — say so rather than inventing one)"]),
    "",
    "=== THEIR SOFTEST ON-FIELD SPOTS (computed, lowest-rated starters) ===",
    ...(weakLines.length ? weakLines : ["  (unavailable)"]),
    "",
    "=== THEIR MOST DANGEROUS STARTERS (computed) ===",
    ...(threatLines.length ? threatLines : ["  (unavailable)"]),
    "",
    dropOffLines.length ? "=== SPOTS THEY CANNOT AFFORD TO LOSE (starter-to-backup fall-off) ===" : null,
    ...dropOffLines,
    dropOffLines.length ? "" : null,
    injuryLines.length ? "=== THEIR INJURIES (from the save — real) ===" : null,
    ...injuryLines,
    injuryLines.length ? "" : null,
    stLines.length ? "=== THEIR SPECIAL TEAMS (real) ===" : null,
    ...stLines,
    stLines.length ? "" : null,
    "=== STAT LEADERS (real) ===",
    ...leaders,
    "",
    "=== KEY PERSONNEL (real, depth-chart order) ===",
    ...keyGuys,
    "",
    "Season context for your own team:",
    ctx.userContext,
  ]
    .filter((l) => l != null)
    .join("\n");
  // Biggest prompt + biggest schema in the app: an undersized budget truncates the JSON
  // mid-object and the whole call sheet is lost.
  return { prompt, maxTokens: 5200 };
}

function buildRecruitTextSpec(ctx: MediaContext, extra: Extra): PromptSpec {
  const r = (extra.recruit as Record<string, unknown>) ?? {};
  const thread = Array.isArray(extra.thread) ? (extra.thread as Record<string, unknown>[]) : [];
  const coachMessage = String(extra.coachMessage ?? "");
  const transcript = thread
    .map((m) => `${m.from === "coach" ? "COACH" : String(r.name ?? "RECRUIT").toUpperCase()}: ${m.text}`)
    .join("\n");
  const prompt = [
    `You are ${r.name}, a ${r.stars ?? ""}-star ${r.position ?? "recruit"} prospect being recruited by ${ctx.school}.`,
    `Coach ${ctx.coachName} is texting you. Reply as JSON:`,
    '{"reply": "your text back (1-3 short messages, real recruit texting voice)", "mood": "hyped|interested|noncommittal|cooling|committed"}',
    "",
    "Stay in character as a HS senior weighing offers. Be respectful but real — you have other schools in your ear.",
    `Your interest tracks the program's success: ${ctx.school} is ${ctx.snapshot.userTeam ? `${ctx.snapshot.userTeam.wins}-${ctx.snapshot.userTeam.losses}` : "in season"}.`,
    "Do not narrate — just text back.",
    "",
    "=== YOU (the prospect) ===",
    recruitLine(r),
    "",
    "=== THREAD SO FAR ===",
    transcript || "(no prior messages)",
    "",
    "=== COACH JUST TEXTED YOU ===",
    coachMessage,
  ].join("\n");
  return { prompt, maxTokens: 500 };
}

function buildPodiumAnswerSpec(ctx: MediaContext, extra: Extra): PromptSpec {
  const q = (extra.question as Record<string, unknown>) ?? {};
  const answer = String(extra.answer ?? "");
  const prompt = [
    "You are the press-room reaction engine for a college-football coach simulator.",
    `Coach ${ctx.coachName} of ${ctx.school} just answered a question at the post-game podium IN HIS OWN WORDS.`,
    "Judge how that exact answer lands. Return JSON:",
    '{"reaction": "1-2 sentences: how the room takes it — murmurs, follow-up shouts, nods, a beat writer smirking",',
    ' "mediaDelta": int, "fanDelta": int, "lockerDelta": int,',
    ' "headline": "the headline a beat writer files off this quote, <=12 words"}',
    "",
    "Delta rules: integers roughly -10..+10. mediaHeat: NEGATIVE calms the press. Judge the ANSWER AS GIVEN —",
    "an evasive answer draws blood from a hostile room; an honest accountable one cools it; a shot at the media",
    "rallies some fans but raises heat; throwing a player under the bus wrecks the locker room.",
    "",
    "=== THE QUESTION ===",
    `${q.reporterName ?? "Reporter"}${q.outlet ? ` (${q.outlet})` : ""} — tone: ${q.tone ?? "neutral"}`,
    `"${q.question ?? ""}"`,
    "",
    "=== THE COACH'S ACTUAL ANSWER (verbatim) ===",
    `"${answer}"`,
    "",
    "Season context:",
    ctx.userContext,
  ].join("\n");
  return { prompt, maxTokens: 600 };
}

function buildNationalWireSpec(ctx: MediaContext, extra: Extra = {}): PromptSpec {
  // v2 DETERMINISTIC CORE. This surface measured worst on the first real fact-check run —
  // 10 invented people in one piece — because its own rules told it to invent any name it
  // wasn't given, while the system prompt calls that a hard error. Code now supplies the
  // real people for the programs in the news, so there is nothing left to invent.
  const rosters = (extra.rosters ?? {}) as Record<string, RosterPlayer[]>;
  const facts = nationalFacts({
    snapshot: ctx.snapshot,
    delta: ctx.delta,
    userTeam: ctx.school,
    rosters,
  });
  // Real school names from the save so around-the-league items never invent programs.
  const teams = Object.values(ctx.snapshot.teams ?? {});
  const ranked = teams
    .filter((t) => t.rankMedia != null && t.rankMedia >= 1 && t.rankMedia <= 25)
    .sort((a, b) => (a.rankMedia as number) - (b.rankMedia as number))
    .map((t) => `#${t.rankMedia} ${t.name} (${t.wins}-${t.losses})`);
  const others = teams
    .filter((t) => (t.rankMedia == null || t.rankMedia > 25) && t.name && t.name !== ctx.school)
    .slice(0, 25)
    .map((t) => `${t.name} (${t.wins}-${t.losses})`);
  const slate = nationalSlate(ctx);
  const prompt = [
    "You are the national desk for a college-football media wire. Write this week's AROUND-THE-LEAGUE",
    "items — the national noise beyond the user's program — as JSON with this exact schema:",
    '{"items": [{',
    '  "category": "recruiting"|"portal"|"legal"|"locker-room"|"carousel"|"upset"|"rankings"|"nil",',
    '  "school": "the program involved (a real school from the lists below)",',
    '  "headline": "ticker-ready, <=16 words, no trailing period",',
    '  "blurb": "1-2 sentences of insider detail",',
    '  "featured": true|false,',
    '  "story": "FEATURED items only: a full 2-3 paragraph wire story (SEPARATED BY \\n\\n, DO NOT USE ACTUAL NEWLINES) with quotes, stakes, and what happens next. Omit for non-featured items."',
    "}]}",
    "",
    "Rules:",
    "- Write 6-8 items with a wide mix: recruiting wins/battles (who landed who, who is fighting for who),",
    "  portal entries and destinations, a player in trouble with the law, locker-room turmoil, a coach on the",
    "  carousel / fired / interviewing, NIL money moves, and takes on real results from the context below.",
    "- Mark the 2 biggest items featured:true and write EACH a full story — these are the national",
    "  storylines readers click into. Everything else stays headline+blurb only.",
    "- FEATURED STORIES read like real wire journalism: open inside a moment (never 'School X did Y'),",
    "  concrete invented texture (a source, a timeline, a visit detail) that never contradicts the save",
    "  data, one transcribed-sounding quote, hard specific judgments, and no tidy moral ending. Banned",
    "  AI tells: 'statement win', 'sent a message', \"isn't just X, it's Y\", 'only time will tell',",
    "  'remains to be seen', 'at the end of the day', 'one thing is clear'.",
    `- Use ONLY schools from the lists below. NEVER write items about ${ctx.school} — the rest of the app covers them.`,
    "- DO NOT INVENT GAME RESULTS. If an item references a game score/upset, it MUST be a [FINAL] game",
    "  from the slate below. Games marked [NOT PLAYED YET] have no result — never state a score for them.",
    "- Where the context shows real ranked results or poll movement, tie items to those actual outcomes.",
    "- PLAYERS AND COACHES ARE REAL PEOPLE IN THIS SAVE. Name only the ones listed below, and",
    "  only for the program they're listed under. For any other program, write the role —",
    "  \"their quarterback\", \"the head coach at Tulane\" — and never a name. Do NOT invent a",
    "  player or coach; that is the one invention this desk is not allowed.",
    "- Never pull a real-world CFB figure, storyline, or conference alignment from your own",
    "  knowledge — this universe's history is only what the save shows.",
    "- Recruits are the exception: high-school prospects are not in the save, so invented",
    "  recruit names are fine. Never attach an invented recruit to a fake national ranking.",
    "- Voice: wire-service tight. These feed a breaking-news ticker.",
    "",
    nationalBrief(facts),
    "",
    // The rules above tell the desk that any score it cites must come from "the slate below".
    // It has to actually be below, or that rule points at nothing and the desk fills the gap.
    "=== THIS WEEK'S NATIONAL SLATE (the ONLY games you may reference) ===",
    slate.played.length ? "FINAL (real scores you may cite):" : "FINAL: (none played yet this week)",
    ...slate.played.map((s) => `  ${s}`),
    slate.upcoming.length ? "UPCOMING (NOT played — preview only, NO scores):" : "UPCOMING: (none)",
    ...slate.upcoming.map((s) => `  ${s}`),
    "",
    "=== AP TOP 25 (real, from the save) ===",
    ...ranked,
    "",
    "=== OTHER PROGRAMS (real, from the save — schools you may write ABOUT, by role only) ===",
    others.join(", "),
    "",
    "Context (real results this week):",
    ctx.userContext,
  ].join("\n");
  return { prompt, maxTokens: 2800 };
}

// Build the REAL national slate for this week from the save's game rows — split into games
// that were actually PLAYED (have a score) and games that are still UPCOMING (no score yet).
// This is what stops the National Desk inventing results for games that haven't been simmed.
function nationalSlate(ctx: MediaContext): { played: string[]; upcoming: string[] } {
  const snap = ctx.snapshot;
  const wk = ctx.week;
  const teams = snap.teams ?? {};
  const games = (snap.games ?? []) as {
    week: number | null; year: number | null; homeRow: number | null; awayRow: number | null;
    homeScore: number | null; awayScore: number | null; played: boolean;
  }[];
  const maxYear = games.reduce((m, g) => (g.year != null && g.year > m ? g.year : m), -1);
  const rk = (t: { rankMedia: number | null }) => (t.rankMedia && t.rankMedia <= 25 ? `#${t.rankMedia} ` : "");
  const played: string[] = [];
  const upcoming: string[] = [];
  for (const g of games) {
    if (wk != null && g.week !== wk) continue;
    if (maxYear >= 0 && g.year != null && g.year !== maxYear) continue;
    const home = g.homeRow != null ? teams[String(g.homeRow)] : null;
    const away = g.awayRow != null ? teams[String(g.awayRow)] : null;
    if (!home || !away) continue;
    const notable = (home.rankMedia && home.rankMedia <= 25) || (away.rankMedia && away.rankMedia <= 25);
    if (!notable) continue; // keep the slate to games with a ranked team
    if (g.played && (g.homeScore || 0) + (g.awayScore || 0) > 0) {
      played.push(`${rk(away)}${away.name} ${g.awayScore} @ ${rk(home)}${home.name} ${g.homeScore} [FINAL]`);
    } else {
      upcoming.push(`${rk(away)}${away.name} (${away.wins}-${away.losses}) at ${rk(home)}${home.name} (${home.wins}-${home.losses}) [NOT PLAYED YET]`);
    }
  }
  return { played: played.slice(0, 10), upcoming: upcoming.slice(0, 10) };
}

function buildNationalDeskSpec(ctx: MediaContext): PromptSpec {
  const teams = Object.values(ctx.snapshot.teams ?? {});
  const ranked = teams
    .filter((t) => t.rankMedia != null && t.rankMedia >= 1 && t.rankMedia <= 25)
    .sort((a, b) => (a.rankMedia as number) - (b.rankMedia as number))
    .map((t) => `#${t.rankMedia} ${t.name} (${t.wins}-${t.losses})`);
  const slate = nationalSlate(ctx);
  const anyPlayed = slate.played.length > 0;
  // Committee / playoff-mock talk is nonsense in September. Only allow it once the résumé
  // actually matters (late season onward).
  // The national desk covers the whole country, so committee talk is legitimate late in the
  // year whatever the user's own team is doing — it just must not be pointed at a program
  // that has no business in it.
  const committeeOk = ctx.phase.key === "late-season" || ctx.phase.key === "conf-champ" || ctx.phase.key === "postseason";
  const prompt = [
    "You are the NATIONAL DESK of a college-football media network — the whole country's week,",
    "not one program's. Write this week's national edition as JSON with this exact schema:",
    "{",
    '  "lead": {"headline": "national A1 headline", "byline": "fictional national columnist",',
    '    "body": "4-6 paragraph national story (SEPARATED BY \\n\\n, DO NOT USE ACTUAL NEWLINES)"},',
    '  "gamesOfTheWeek": [{"matchup": "string", "status": "final"|"preview", "take": "2-3 sentence take"}],',
    '  "pollPulse": {"headline": "string", "body": "1-2 paragraphs (SEPARATED BY \\n\\n, DO NOT USE ACTUAL NEWLINES)"},',
    '  "podcast": {"title": "show name", "hosts": ["' + NATIONAL_HOSTS.analyst + '", "' + NATIONAL_HOSTS.hotTake + '"],',
    '    "lines": [{"speaker": "host name", "text": "what they say"}]}',
    "}",
    "",
    HOUSE_STYLE,
    "",
    "🚨 THE SINGLE MOST IMPORTANT RULE — DO NOT INVENT GAME RESULTS 🚨",
    "You may ONLY reference games from the SLATE below. Games marked [FINAL] have a real score you",
    "may cite. Games marked [NOT PLAYED YET] have NO result — you must NOT state or imply a score,",
    "a winner, or anything that happened in them. Treat them as UPCOMING. Making up a score for a",
    "game that hasn't been played is the worst possible failure. If a matchup isn't in the slate,",
    "do not mention it at all.",
    "",
    "SECTION RULES:",
    anyPlayed
      ? "- lead: build it off the biggest [FINAL] result in the slate — a columnist's argument about what that result MEANS nationally, not a plain recap. Invented, transcribed-sounding quotes from the (fictional) people involved."
      : "- lead: NOTHING has been played yet this week — so the lead is a PREVIEW of the marquee upcoming matchup in the slate: the stakes, the styles, what's on the line. It is a look-ahead, NOT a recap, and contains NO score or outcome.",
    "- gamesOfTheWeek: 4-6 entries, EACH taken directly from the slate below. For a [FINAL] game set",
    '  status:"final" and put the real score in the matchup ("#4 Arizona 31, #9 Navy 20"); your take is',
    "  a sharp judgment on what it meant. For a [NOT PLAYED YET] game set status:\"preview\" and the",
    '  matchup is just the pairing ("#4 Arizona at #9 Navy") with NO score; your take is a prediction /',
    "  what to watch. NEVER put a score on a preview. Prefer finals when the slate has them.",
    committeeOk
      ? "- pollPulse: grounded in the real POLL MOVEMENT lines — voters' logic, snubs, and (since it's late enough to matter) the playoff/committee picture."
      : "- pollPulse: grounded in the real POLL MOVEMENT lines — early-season poll jockeying only. It is WAY too early for playoff brackets, committee talk, résumés, or 'the bubble' — do NOT mention the committee or a playoff field this week.",
    `- podcast: 12-16 lines of "${NATIONAL_HOSTS.analyst}" (measured, film-first, dry wit) and`,
    `  "${NATIONAL_HOSTS.hotTake}" (loud, absolutist, occasionally right) — ALWAYS these two. Real radio:`,
    "  they interrupt, react in fragments ('No. No no no.'), talk over each other, actually disagree and",
    `  NOT resolve it. They can PREVIEW upcoming games and react to finals, but same rule — no invented`,
    `  scores. Spend a beat on ${ctx.school} from a NATIONAL lens (respect or skepticism, not fandom).`,
    committeeOk ? "" : "  It is early September — no playoff-bracket or committee talk on the pod either.",
    "- Use only schools from the slate / top-25 below; invent PEOPLE (coaches, players) not named in the context.",
    // The archive only covers the user's program, so a rise/fall comparison is available for
    // exactly one team on the board. Saying so is what keeps it from being extended to the
    // other 130 by invention.
    ctx.hasHistory
      ? `- ${ctx.school} is the ONE program whose past you actually hold (see PRIOR SEASONS in the context): a national desk noticing it is up or down on a year ago is fair game and should appear once. For every other program, you have NO history — never compare them to a prior season.`
      : "",
    // The national lens is exactly where an unranked team gets written into a playoff race,
    // because a national column is ABOUT the playoff race.
    ctx.outlook && ctx.outlook.standing === "out"
      ? `- ${ctx.school} is UNRANKED and NOT in the playoff or New Year's Six conversation. Whatever else the column argues nationally, never place ${ctx.school} in a bracket, a bubble, a committee discussion or a NY6 bid — the national lens on them is a good-season-in-their-own-lane story, or skepticism, not contention.`
      : "",
    "",
    "=== THIS WEEK'S NATIONAL SLATE (the ONLY games you may reference) ===",
    slate.played.length ? "FINAL (real scores you may cite):" : "FINAL: (none played yet this week)",
    ...slate.played.map((s) => `  ${s}`),
    slate.upcoming.length ? "UPCOMING (NOT played — preview only, NO scores):" : "UPCOMING: (none)",
    ...slate.upcoming.map((s) => `  ${s}`),
    "",
    "=== AP TOP 25 (real, from the save) ===",
    ...ranked,
    "",
    "Context:",
    ctx.userContext,
  ].join("\n");
  return { prompt, maxTokens: 3400 };
}

// ── Normalization (mirror the sidecar modules' degrade-don't-break behavior) ─────
// Every kind whose UI maps over a nested array MUST guarantee that array here — a raw
// model response missing a field otherwise crashes the page ("reading 'map'").

const VALID_SOCIAL = new Set(["fan", "rival", "analyst", "insider", "reddit"]);
const VALID_TRENDS = new Set(["hot", "warm", "stable", "cooling", "cold"]);
const VALID_TEMPS = new Set(["cold", "warm", "hot", "red-hot"]);

function normalize(
  kind: string,
  parsed: Record<string, unknown> | null,
  ctx: MediaContext,
  extra: Extra
): unknown {
  if (kind === "highlights-extract") {
    const hl = Array.isArray(parsed?.highlights)
      ? (parsed!.highlights as Record<string, unknown>[])
          .filter((h) => h && typeof h.text === "string" && (h.text as string).trim())
          .map((h) => ({ text: String(h.text), player: typeof h.player === "string" ? h.player : null }))
      : [];
    return { highlights: hl, error: parsed == null };
  }
  if (kind === "social") {
    const posts = Array.isArray(parsed?.posts) ? (parsed!.posts as Record<string, unknown>[]) : [];
    const normalized = posts
      .filter((p) => p && typeof p.handle === "string" && typeof p.body === "string")
      .map((p) => ({
        handle: String(p.handle),
        displayName: typeof p.displayName === "string" ? p.displayName : String(p.handle),
        type: VALID_SOCIAL.has(p.type as string) ? p.type : "fan",
        body: String(p.body),
        likes: typeof p.likes === "number" ? p.likes : 0,
        reposts: typeof p.reposts === "number" ? p.reposts : typeof p.retweets === "number" ? p.retweets : 0,
      }));
    return normalized.length ? { posts: normalized } : { posts: [], error: true };
  }

  // Shows: the model returns only {dialogue}; the viewer renders personas/title/subtitle
  // too, so wrap it exactly like the old sidecar module did.
  if (kind === "shows") {
    const requested = String(extra.showType ?? "gameday");
    const showType = SHOW_PERSONAS[requested] ? requested : "gameday";
    const dialogue = Array.isArray(parsed?.dialogue)
      ? (parsed!.dialogue as Record<string, unknown>[]).map((l) => ({
          speaker: String(l?.speaker ?? ""),
          role: String(l?.role ?? ""),
          text: String(l?.text ?? ""),
          isStageDirection: Boolean(l?.isStageDirection),
        }))
      : [];
    return {
      showType,
      title: SHOW_TITLES[showType].title,
      subtitle: SHOW_TITLES[showType].subtitle,
      personas: SHOW_PERSONAS[showType],
      dialogue,
      week: ctx.week,
      error: dialogue.length === 0,
    };
  }

  if (kind === "brand-deals") {
    const deals = Array.isArray(parsed?.deals)
      ? (parsed!.deals as Record<string, unknown>[])
          .filter((d) => d && typeof d.brand === "string")
          .map((d) => {
            const rep = d.reputation === "controversial" ? "controversial" : d.reputation === "edgy" ? "edgy" : "clean";
            // 0-100 richness-within-tier, not a currency amount. deals.ts turns this into the
            // real per-week points using the program's prestige (see scaleStipend).
            const stipend = Math.max(0, Math.min(100, Math.round(Number(d.stipendPoints) || 0)));
            const weeks = Math.max(1, Math.min(8, Math.round(Number(d.weeks) || 3)));
            // Deterministic meter tradeoff from reputation + money — "not all money is good money."
            const base = { clean: { fanTrust: 3, mediaHeat: 0, boosterConfidence: 2 }, edgy: { fanTrust: -3, mediaHeat: 4, boosterConfidence: 4 }, controversial: { fanTrust: -9, mediaHeat: 11, boosterConfidence: 6 } }[rep];
            const moneyBump = Math.round(stipend / 50); // richer offer, happier booster (0-2)
            return {
              brand: String(d.brand),
              category: typeof d.category === "string" ? d.category : "",
              broker: d.broker === "Booster" ? "Booster" : "AD",
              pitch: typeof d.pitch === "string" ? d.pitch : "",
              stipendPoints: stipend,
              weeks,
              reputation: rep,
              upside: typeof d.upside === "string" ? d.upside : "",
              risk: typeof d.risk === "string" ? d.risk : "",
              effects: { ...base, boosterConfidence: base.boosterConfidence + moneyBump },
            };
          })
      : [];
    return deals.length ? { deals } : { deals: [], error: true };
  }

  if (kind === "nil-reaction") {
    const posts = Array.isArray(parsed?.posts) ? (parsed!.posts as Record<string, unknown>[]) : [];
    const norm = posts
      .filter((p) => p && typeof p.body === "string")
      .map((p) => ({
        handle: typeof p.handle === "string" ? p.handle : "@fan",
        displayName: typeof p.displayName === "string" ? p.displayName : "Fan",
        type: VALID_SOCIAL.has(p.type as string) ? p.type : "fan",
        body: String(p.body),
        likes: typeof p.likes === "number" ? p.likes : 0,
        reposts: typeof p.reposts === "number" ? p.reposts : 0,
      }));
    return norm.length ? { posts: norm } : { posts: [], error: true };
  }

  if (kind === "offseason-brief") {
    if (!parsed || typeof parsed !== "object" || typeof parsed.body !== "string") return { error: true };
    const pairList = (v: unknown, aKey: string, bKey: string) =>
      Array.isArray(v)
        ? (v as Record<string, unknown>[])
            .filter((x) => x && typeof x[aKey] === "string")
            .map((x) => ({ [aKey]: String(x[aKey]), [bKey]: typeof x[bKey] === "string" ? String(x[bKey]) : "" }))
        : [];
    const pr = parsed.portalReport as Record<string, unknown> | undefined;
    const portalReport = pr && typeof pr === "object"
      ? {
          winners: pairList(pr.winners, "team", "note") as { team: string; note: string }[],
          losers: pairList(pr.losers, "team", "note") as { team: string; note: string }[],
          movers: pairList(pr.movers, "player", "note") as { player: string; note: string }[],
        }
      : null;
    return {
      headline: typeof parsed.headline === "string" ? parsed.headline : "The Offseason",
      stageLabel: typeof parsed.stageLabel === "string" ? parsed.stageLabel : "",
      body: parsed.body,
      storylines: Array.isArray(parsed.storylines)
        ? (parsed.storylines as Record<string, unknown>[])
            .filter((s) => s && typeof s.text === "string")
            .map((s) => ({ title: typeof s.title === "string" ? s.title : "", text: String(s.text) }))
        : [],
      lookAhead: typeof parsed.lookAhead === "string" ? parsed.lookAhead : "",
      portalReport,
    };
  }

  if (kind === "scouting") {
    if (!parsed || typeof parsed !== "object") return { error: true };
    const side = (s: unknown): Record<string, unknown> => (s && typeof s === "object" ? (s as Record<string, unknown>) : {});
    const kp = (v: unknown) =>
      Array.isArray(v)
        ? (v as Record<string, unknown>[])
            .filter((x) => x && typeof x.name === "string")
            .map((x) => ({
              name: String(x.name),
              note: typeof x.note === "string" ? x.note : "",
              assignment: typeof x.assignment === "string" ? x.assignment : "",
            }))
        : [];
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    const strList = (v: unknown) =>
      Array.isArray(v) ? (v as unknown[]).filter((k) => typeof k === "string" && k.trim()).map(String) : [];
    // attack/beware entries: keep only the ones that actually name a target — a bullet with
    // no subject is worse than one fewer bullet.
    const triples = (v: unknown, headKey: string) =>
      Array.isArray(v)
        ? (v as Record<string, unknown>[])
            .filter((x) => x && typeof x[headKey] === "string" && String(x[headKey]).trim())
            .map((x) => ({ target: String(x[headKey]), why: str(x.why), how: str(x.how) }))
        : [];
    const off = side(parsed.offense);
    const def = side(parsed.defense);
    const sit = side(parsed.situational);
    const adj = side(parsed.adjustments);
    const pred = side(parsed.prediction);
    const ok = typeof parsed.summary === "string" || kp(off.keyPlayers).length || kp(def.keyPlayers).length;
    if (!ok) return { error: true };
    return {
      opponent: str(parsed.opponent),
      bottomLine: str(parsed.bottomLine),
      summary: str(parsed.summary),
      offense: {
        identity: typeof off.identity === "string" ? off.identity : "balanced",
        scheme: str(off.scheme),
        tendency: str(off.tendency),
        keyPlayers: kp(off.keyPlayers),
        howToStop: str(off.howToStop),
        calls: strList(off.calls),
      },
      defense: {
        identity: str(def.identity),
        scheme: str(def.scheme),
        keyPlayers: kp(def.keyPlayers),
        howToAttack: str(def.howToAttack),
        calls: strList(def.calls),
      },
      attack: triples(parsed.attack, "target"),
      beware: triples(parsed.beware, "threat"),
      openingScript: strList(parsed.openingScript).slice(0, 3),
      situational: {
        firstDown: str(sit.firstDown),
        thirdDown: str(sit.thirdDown),
        redZone: str(sit.redZone),
        fourthDown: str(sit.fourthDown),
      },
      adjustments: {
        ifTrailing: str(adj.ifTrailing),
        ifLeading: str(adj.ifLeading),
      },
      gameFlow: str(parsed.gameFlow),
      injuryImpact: str(parsed.injuryImpact),
      seriesRead: str(parsed.seriesRead),
      specialTeams: str(parsed.specialTeams),
      xFactor: str(parsed.xFactor),
      keys: strList(parsed.keys),
      prediction: { call: str(pred.call), confidence: str(pred.confidence) },
    };
  }

  if (kind === "national-wire") {
    const items = Array.isArray(parsed?.items)
      ? (parsed!.items as Record<string, unknown>[]).filter(
          (i) => i && typeof i.headline === "string" && typeof i.school === "string"
        )
      : [];
    return items.length ? { items } : { items: [], error: true };
  }

  if (kind === "national-desk") {
    if (parsed && (parsed as Record<string, unknown>).error) return parsed;
    const lead = (parsed?.lead ?? null) as Record<string, unknown> | null;
    if (!lead || typeof lead.headline !== "string" || typeof lead.body !== "string") {
      return { error: true, _err: "Missing headline or body in parsed object", raw: JSON.stringify(parsed) };
    }
    const podcast = (parsed?.podcast ?? {}) as Record<string, unknown>;
    return {
      lead,
      gamesOfTheWeek: Array.isArray(parsed?.gamesOfTheWeek)
        ? (parsed!.gamesOfTheWeek as Record<string, unknown>[])
            .filter((g) => g && typeof g.matchup === "string")
            .map((g) => ({ ...g, status: g.status === "preview" ? "preview" : "final" }))
        : [],
      pollPulse:
        parsed?.pollPulse && typeof (parsed.pollPulse as Record<string, unknown>).body === "string"
          ? parsed.pollPulse
          : null,
      podcast: {
        title: typeof podcast.title === "string" ? podcast.title : "The National Desk",
        hosts: Array.isArray(podcast.hosts) ? podcast.hosts : [],
        lines: Array.isArray(podcast.lines)
          ? (podcast.lines as Record<string, unknown>[]).filter(
              (l) => l && typeof l.text === "string"
            )
          : [],
      },
    };
  }

  if (kind === "podium-answer") {
    if (!parsed || typeof parsed.reaction !== "string") return { error: true };
    return {
      reaction: parsed.reaction,
      headline: typeof parsed.headline === "string" ? parsed.headline : "",
      mediaDelta: typeof parsed.mediaDelta === "number" ? parsed.mediaDelta : 0,
      fanDelta: typeof parsed.fanDelta === "number" ? parsed.fanDelta : 0,
      lockerDelta: typeof parsed.lockerDelta === "number" ? parsed.lockerDelta : 0,
    };
  }

  if (kind === "recruiting") {
    const beats = Array.isArray(parsed?.beats) ? parsed!.beats : null;
    if (!parsed || typeof parsed.headline !== "string" || !beats) {
      return {
        headline: `${ctx.school} works the trail`,
        subhead: "The desk is still compiling this week's trail intel.",
        trend: "stable",
        trendReason: "The report didn't come through cleanly — regenerate to retry.",
        beats: [],
        error: true,
      };
    }
    if (!VALID_TRENDS.has(parsed.trend as string)) parsed.trend = "stable";
    return parsed;
  }

  if (kind === "nil") {
    const notes = Array.isArray(parsed?.notes) ? parsed!.notes : null;
    if (!parsed || typeof parsed.headline !== "string" || !notes) {
      return {
        headline: `${ctx.school} NIL market holds steady`,
        body: "The market read didn't come through cleanly — regenerate to retry.",
        marketTemp: "warm",
        tempReason: "Report unavailable this pass.",
        notes: [],
        error: true,
      };
    }
    if (!VALID_TEMPS.has(parsed.marketTemp as string)) parsed.marketTemp = "warm";
    return parsed;
  }

  if (kind === "trophy") {
    if (
      !parsed ||
      typeof parsed.headline !== "string" ||
      typeof parsed.body !== "string" ||
      !Array.isArray(parsed.chapters)
    ) {
      return {
        headline: `The ${ctx.coachName} Chapter at ${ctx.school}`,
        body: "The retrospective didn't come through cleanly — regenerate to retry.",
        chapters: [],
        error: true,
      };
    }
    return {
      headline: parsed.headline,
      body: parsed.body,
      chapters: (parsed.chapters as Record<string, unknown>[]).map((ch) => ({
        title: typeof ch?.title === "string" ? ch.title : "Untitled Chapter",
        body: typeof ch?.body === "string" ? ch.body : "",
        year: typeof ch?.year === "number" ? ch.year : 0,
      })),
    };
  }

  // Recruit dossier: the largest schema in the app (backstory + film + article + social +
  // interest), so a single malformed or truncated section used to throw the WHOLE report
  // away ("the scouting report came back empty"). Salvage whatever sections did parse and
  // only fail when there is genuinely nothing usable.
  if (kind === "recruit-dossier") {
    if (!parsed || typeof parsed !== "object") return { error: true };
    const film = (parsed.film ?? null) as Record<string, unknown> | null;
    const article = (parsed.article ?? null) as Record<string, unknown> | null;
    const strArr = (v: unknown) =>
      Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).map(String) : [];
    const out = {
      backstory: typeof parsed.backstory === "string" ? parsed.backstory : null,
      film: film
        ? {
            grade: typeof film.grade === "string" ? film.grade : "—",
            summary: typeof film.summary === "string" ? film.summary : "",
            strengths: strArr(film.strengths),
            weaknesses: strArr(film.weaknesses),
            comp: typeof film.comp === "string" ? film.comp : "",
            projection: typeof film.projection === "string" ? film.projection : "",
          }
        : null,
      article:
        article && typeof article.body === "string"
          ? {
              outlet: typeof article.outlet === "string" ? article.outlet : "Recruiting Wire",
              headline: typeof article.headline === "string" ? article.headline : "",
              body: article.body,
            }
          : null,
      social: Array.isArray(parsed.social)
        ? (parsed.social as Record<string, unknown>[])
            .filter((p) => p && typeof p.body === "string")
            .map((p) => ({
              handle: typeof p.handle === "string" ? p.handle : "@prospect",
              platform: p.platform === "IG" ? "IG" : "X",
              body: String(p.body),
              likes: typeof p.likes === "number" ? p.likes : 0,
            }))
        : [],
      interest: typeof parsed.interest === "string" ? parsed.interest : null,
    };
    const anything =
      out.backstory || out.film || out.article || out.social.length > 0 || out.interest;
    return anything ? out : { error: true };
  }

  if (!parsed || typeof parsed !== "object") {
    return { error: true };
  }
  return parsed;
}

// ── Carousel (two dependent calls) ──────────────────────────────────────────────

async function generateCarousel(ctx: MediaContext, llm: LlmConfig): Promise<unknown> {
  const prestige = ctx.snapshot.userTeam?.prestige != null ? `${ctx.snapshot.userTeam.prestige}/10` : "unknown";
  const record = ctx.snapshot.userTeam ? `${ctx.snapshot.userTeam.wins}-${ctx.snapshot.userTeam.losses}` : "unknown";
  const staffPrompt = [
    "Generate 2-3 coaching staff members for a college football program.",
    'Respond with valid JSON only, no markdown fences, wrapped as {"staff": [ ... ]}.',
    '{"id": "unique_string", "name": "Full Name", "role": "OC"|"DC"|"ST"|"Position Coach", "hotSeatLevel": "secure"|"lukewarm"|"hot", "yearsOnStaff": number, "reputation": "one sentence"}',
    "- At least one OC and one DC. Names realistic but fictional. yearsOnStaff 1-6.",
    `School: ${ctx.school} · Head Coach: ${ctx.coachName} · Prestige: ${prestige} · Record: ${record}`,
  ].join("\n");
  const staffRaw = await llmComplete(llm, ctx.systemPrompt, staffPrompt, 1200);
  const staffParsed = parseJSON<{ staff?: Record<string, unknown>[] }>(staffRaw);
  const staff =
    staffParsed?.staff && staffParsed.staff.length >= 2
      ? staffParsed.staff
      : [
          { id: "oc-fallback", name: "Mike Callahan", role: "OC", hotSeatLevel: "lukewarm", yearsOnStaff: 2, reputation: "Veteran coordinator known for conservative play-calling." },
          { id: "dc-fallback", name: "Ray Dawkins", role: "DC", hotSeatLevel: "secure", yearsOnStaff: 1, reputation: "Former NFL LB coach with an aggressive, blitz-heavy scheme." },
        ];

  const staffDesc = staff.map((s) => `${s.name} (${s.role}, hot seat: ${s.hotSeatLevel}, ${s.yearsOnStaff}yr)`).join("\n  ");
  const rumorsPrompt = [
    "Generate 1-3 coaching carousel rumors.",
    'Respond with valid JSON only, no markdown fences, wrapped as {"rumors": [ ... ]}.',
    '{"id": "unique_string", "staffMember": {"id","name","role","hotSeatLevel","yearsOnStaff","reputation"}, "type": "interview_request"|"poaching_attempt"|"forced_departure"|"loyalty_test", "suitor": "School Name", "narrative": "2-3 sentence insider report", "urgency": "low"|"medium"|"high"}',
    "- Reference ONLY the provided staff members. Suitor school must differ from " + ctx.school + ".",
    `School: ${ctx.school} · Record: ${record} · Prestige: ${prestige}`,
    `Staff:\n  ${staffDesc}`,
  ].join("\n");
  const rumorsRaw = await llmComplete(llm, ctx.systemPrompt, rumorsPrompt, 1500);
  const rumorsParsed = parseJSON<{ rumors?: Record<string, unknown>[] }>(rumorsRaw);
  const rumors = rumorsParsed?.rumors?.length ? rumorsParsed.rumors : [];
  return { staff, rumors };
}

// ── Entry point ─────────────────────────────────────────────────────────────────

/**
 * Generate content for a kind entirely in-app: build the media context from the parsed
 * snapshot/delta, run the prompt through the configured provider (Anthropic or any
 * OpenAI-compatible endpoint), and normalize. No process is spawned.
 */
export async function generateInApp<T = unknown>(
  kind: string,
  llm: LlmConfig,
  snapshot: DynastySnapshot,
  delta: WeekDelta | null,
  opts: GenerateOpts = {}
): Promise<T> {
  const ctx = buildMediaContext(delta, snapshot, opts);
  if (kind === "carousel") {
    const carousel = (await generateCarousel(ctx, llm)) as T;
    observeFacts(kind, carousel, ctx, opts, opts.extra ?? {}, modelLabel(llm));
    return carousel;
  }
  const extra = opts.extra ?? {};
  const spec = buildSpec(kind, ctx, extra);
  const system = spec.system ?? ctx.systemPrompt;
  // Lift the shared week context out of the prompt into a separate leading block. It is
  // byte-identical for every section of a week's issue, so on Anthropic it prompt-caches:
  // the first section pays for it once, every following section reads it at ~10% of the
  // input price. (Context-first ordering is also the recommended prompt shape.)
  let prompt = spec.prompt;
  let cachePrefix: string | undefined;
  const labeled = `Context:\n${ctx.userContext}`;
  const li = prompt.indexOf(labeled);
  const ci = li >= 0 ? -1 : prompt.indexOf(ctx.userContext);
  if (li >= 0) {
    prompt = (prompt.slice(0, li) + prompt.slice(li + labeled.length)).trimEnd();
    cachePrefix = ctx.userContext;
  } else if (ci >= 0) {
    prompt = (prompt.slice(0, ci) + prompt.slice(ci + ctx.userContext.length)).trimEnd();
    cachePrefix = ctx.userContext;
  }
  // Vision kinds pass base64 screenshots through extra.images (e.g. highlights-extract).
  const images = Array.isArray(extra.images) ? (extra.images as string[]) : undefined;
  const raw = await llmComplete(llm, system, prompt, spec.maxTokens, images, cachePrefix);
  let parsed = parseJSON(raw);
  if (parsed == null) {
    // The model broke the JSON envelope even after repair (long creative payloads slip on
    // commas/truncation). One corrective retry fixes the vast majority of these.
    console.warn(`[dynastywire] ${kind}: invalid JSON, retrying once with corrective prompt`);
    const retryPrompt =
      prompt +
      "\n\nIMPORTANT: Your previous attempt returned INVALID JSON (a syntax error such as a " +
      "missing comma between elements, an unescaped quote, or a cut-off structure). Respond " +
      "with ONLY the complete, valid JSON object — double-check every comma and bracket, and " +
      "keep it within the length budget so nothing is truncated.";
    const retryRaw = await llmComplete(llm, system, retryPrompt, spec.maxTokens, images, cachePrefix);
    parsed = parseJSON(retryRaw);
  }
  const result = normalize(kind, parsed, ctx, extra) as T;
  observeFacts(kind, result, ctx, opts, extra, modelLabel(llm));
  return result;
}

/** The exact model that wrote this piece — the baseline is meaningless without it, since
 * the ship gate is stated on the CHEAP model. Exported so Settings can show the user which
 * transport their next generation will be recorded under, before they play a week on it. */
export function modelLabel(llm: LlmConfig): string {
  if (llm.provider === "openai") return llm.model || "gpt-4o-mini";
  return llm.budgetMode !== false ? BUDGET_MODEL : MODEL;
}

/**
 * Fact-check what we just generated and record it. OBSERVE-ONLY (v2 step 1): it never
 * rewrites the payload, never blocks the return, and never throws — the whole call is
 * fire-and-forget behind a catch. Repair lands once the baseline says what the real
 * violation rate is.
 */
function observeFacts(
  kind: string,
  payload: unknown,
  ctx: MediaContext,
  opts: GenerateOpts,
  extra: Extra,
  model: string
): void {
  try {
    const truth = buildGroundTruth({
      snapshot: ctx.snapshot,
      delta: ctx.delta,
      roster: ctx.roster,
      oppRoster: opts.oppRoster,
      recruits: Array.isArray(extra.recruits) ? (extra.recruits as Recruit[]) : undefined,
      cast: ctx.backstory
        ? [ctx.backstory.adName, ctx.backstory.boosterName, ctx.backstory.reporterName, ctx.backstory.rivalCoachName]
        : [],
    });
    const report = validateGeneration(kind, payload, truth);
    if (report.violations.length) {
      console.warn(
        `[dynastywire] ${kind}: ${report.violations.length} fact violation(s) — ` +
          report.violations.map((v) => `${v.kind}:${v.claim}`).join(" · ")
      );
    }
    void recordBaseline(
      rowFromReport(report, {
        model,
        week: ctx.week,
        year: ctx.snapshot.year ?? null,
        at: Date.now(),
      })
    );
  } catch (err) {
    console.warn("[dynastywire] fact-check skipped:", err);
  }
}
