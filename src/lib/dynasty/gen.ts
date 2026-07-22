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
  type RosterPlayer,
  type WeekDelta,
} from "./client";
import type { CoachBackstory } from "./saga";

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
].join("\n");

// House style for long-form articles (front page recap, national lead, featured wire
// stories). This is the anti-"AI article" contract: the goal is prose a reader would
// believe was filed by a human on deadline.
const HOUSE_STYLE = [
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
  /** Persistent coach identity + recurring cast, when the user has written one. */
  backstory: CoachBackstory | null;
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

function fmtStats(p: RosterPlayer): string | null {
  const s = p.stats;
  if (!s) return null;
  if (s.side === "kicking") {
    const bits = fmtKicking(s.kicking ?? s);
    return bits.length ? bits.join("; ") + fmtAppearances(s) : null;
  }
  // Two-way players (both sides this season) show BOTH lines — a community ask.
  if (s.twoWay && s.offense && s.defense) {
    const off = fmtOffense(s.offense).join("; ");
    const def = fmtDefense(s.defense).join("; ");
    if (off || def) {
      return `TWO-WAY — OFF: ${off || "—"} | DEF: ${def || "—"}`;
    }
  }
  const bits = s.side === "offense" ? fmtOffense(s.offense ?? s) : fmtDefense(s.defense ?? s);
  if (!bits.length) return null;
  return bits.join("; ") + fmtAppearances(s);
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
  /** Postseason round name when key === "postseason" (e.g. "National Championship"). */
  roundName: string | null;
  /** True once the CFP bracket is set — kills all résumé/committee/bubble talk. */
  bracketSet: boolean;
  pressNote: string;
}

// The season phase, computed from the save's REAL calendar (SeasonInfo) rather than a
// hardcoded week number. This is what makes "we are IN the playoff / this is the natty"
// true instead of guessed — and what stops a team playing in the bracket being written
// about as if it's still building a résumé for the committee.
export function computePhase(
  calendar: DynastySnapshot["calendar"] | null | undefined,
  weekPlayed: number | null | undefined
): PhaseInfo {
  const w = weekPlayed ?? 0;
  const confChamp = calendar?.confChampWeek ?? 16;
  const psWeeks = calendar?.postSeasonWeeks ?? 4;
  const weekType = calendar?.weekType ?? null; // "RegularSeason" | "BowlSeason1..4" | ...

  // OFFSEASON — the save's stage says we're between seasons (portal window, signing day,
  // coaching carousel, spring). Detect from CurrentStage / week-type so no game is invented.
  const stage = calendar?.stage ?? null;
  const inOffseason = (!!stage && /off\s*season|offseason/i.test(stage)) || (!!weekType && /off\s*season|offseason/i.test(weekType));
  if (inOffseason) {
    const os = calendar?.offseasonStage ?? null;
    const total = calendar?.offseasonNumStages ?? null;
    return {
      key: "offseason",
      label: total != null && os != null ? `OFFSEASON — stage ${os + 1} of ${total}` : "OFFSEASON",
      roundName: null,
      bracketSet: false,
      pressNote:
        "It is the OFFSEASON — there are NO games this week and NO results to report. Do NOT invent, " +
        "recap, or reference any game. Coverage is offseason business: the transfer portal, recruiting " +
        "and signing day, the coaching carousel, roster churn, spring outlook, and expectations for next " +
        "season. Frame everything as between-seasons, forward-looking — never as a game week.",
    };
  }

  // Postseason if the save's week-type says a bowl round, OR we're past conf-champ week.
  const bowlMatch = weekType ? /^BowlSeason(\d+)$/i.exec(weekType) : null;
  const isPost = !!bowlMatch || w > confChamp;
  if (isPost) {
    const round = bowlMatch ? Number(bowlMatch[1]) : Math.max(1, w - confChamp);
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
      pressNote:
        `THE PLAYOFF FIELD IS SET — this is the ${roundName}, and the selection committee has ` +
        "ALREADY made every pick. Do NOT mention résumés, the committee, 'the bubble', 'making " +
        "the field', at-large bids, or seeding debates — that window is CLOSED. This is win-or-" +
        (isFinal
          ? "lose for the NATIONAL TITLE: one game, everything on the line, no tomorrow. Cover the moment, the run to get here, the matchup, opt-out/NFL-draft shadows, and legacy."
          : "go-home: advance or the season is over. Cover the matchup, the run this team is on, what it takes to survive, and opt-out/NFL-draft shadows."),
    };
  }
  if (w === confChamp || weekType === "ConferenceChampionship") {
    return {
      key: "conf-champ",
      label: "CONFERENCE CHAMPIONSHIP WEEK",
      roundName: null,
      bracketSet: false,
      pressNote:
        "Championship-week press: the conference title on the line, the playoff résumé and seeding scenarios a win or loss creates, and revenge/rematch angles. The bracket is NOT set yet — this game helps decide it.",
    };
  }
  if (w >= 11) {
    return {
      key: "late-season",
      label: "LATE SEASON — stakes week",
      roundName: null,
      bracketSet: false,
      pressNote:
        "November press: playoff/bowl math is live and the résumé matters. Questions connect this result to the CFP picture, rivalry stakes, and seniors' last rides.",
    };
  }
  return {
    key: "regular",
    label: "REGULAR SEASON",
    roundName: null,
    bracketSet: false,
    pressNote:
      "Regular-season press: this game, the next opponent, position battles, and week-to-week development.",
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
    ctx.phase.key === "postseason"
      ? "- It's the playoff — the feed is at maximum intensity: nerves, superstition, ticket-price jokes, legacy talk."
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
  parts.push(
    knownSchool
      ? `Program: ${knownSchool} — this IS the user's program. Every story is about ${knownSchool} ` +
        "and no other school. Do not drift to a bigger-name program, and ignore anything you " +
        `think you know about the real-world ${knownSchool}.`
      : "Program: NOT IDENTIFIED. Write only about \"the program\" / \"the team\" — do NOT pick a " +
        "school name, and never default to a famous one."
  );
  if (u) {
    parts.push(`Record: ${u.wins}-${u.losses}` + (u.confWins != null ? ` (${u.confWins}-${u.confLosses} conf)` : ""));
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
  const phase = computePhase(after.calendar, d.weekPlayed);
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
  if (phase.bracketSet) {
    parts.push(
      "REMINDER FOR EVERY STORY THIS WEEK: this team is playing INSIDE the playoff bracket. " +
        "Any line about 'needing to impress the committee', 'building a résumé', 'staying in " +
        "the hunt', or 'the bubble' is factually WRONG and must not appear."
    );
  }
  parts.push("");

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

  let weekState: MediaContext["weekState"] = "game";
  if (!g) {
    // No result this week. This is NOT a vacuum for the model to fill with an invented
    // game — it's one of three real states, each with its own storytelling frame.
    const gamesPlayed = (u?.wins ?? 0) + (u?.losses ?? 0);
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

    // This week's matchup is on the schedule but kickoff hasn't happened — that's PREGAME,
    // not a bye and not a result. (The "phantom score for a game we haven't played" bug.)
    const upcomingThisWeek =
      nextGame != null && nextGame.week != null && d.weekPlayed != null && nextGame.week === d.weekPlayed;

    if (gamesPlayed === 0) {
      weekState = "preseason";
      parts.push("=== SEASON NOT STARTED (Week 0 / preseason — source of truth) ===");
      parts.push(
        `${school} has NOT played a game yet this season. There is NO result to cover.`,
        "HARD RULE: do not invent, imply, or recap ANY game, score, scrimmage result, or stat",
        "from this season — none exist. This is BEGINNING-OF-SEASON coverage: expectations,",
        "camp battles, the roster (real names/stats from last season where provided), what this",
        "season means for the program and the coach, and the opener ahead.",
        nextOppLine
      );
    } else if (upcomingThisWeek) {
      weekState = "pregame";
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
    } else if (d.weekPlayed != null && d.weekPlayed >= 17) {
      weekState = "season-over";
      parts.push("=== NO GAME THIS WEEK — LATE/POST SEASON (source of truth) ===");
      parts.push(
        `${school} (${u?.wins ?? 0}-${u?.losses ?? 0}) did not play this week. Do NOT invent a game or result.`,
        "This is END-OF-SEASON coverage: the season's arc in the rearview, what the record and",
        "résumé mean, bowl/playoff waiting rooms, portal and recruiting stakes, awards cases,",
        "and what comes next for the program.",
        nextOppLine
      );
    } else {
      weekState = "bye";
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
      const bits = [p.position, p.year, p.overall != null ? `${p.overall} OVR` : null]
        .filter(Boolean)
        .join(", ");
      const stat = fmtStats(p);
      parts.push(`  ${p.name}${bits ? ` (${bits})` : ""}${stat ? ` — ${stat}` : ""}`);
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
      "Format: Name (Pos, Year, OVR, Personality) — SEASON-TO-DATE TOTALS.",
      "CRITICAL: these are CUMULATIVE SEASON totals, NOT this week's box score. Never present",
      "a season total as a single-game performance (a QB with 3,100 season yards did NOT throw",
      "for 3,100 this week). If you don't have this game's individual numbers, write about the",
      "game without inventing per-game stat lines."
    );
    for (const p of roster.slice(0, 40)) {
      const susp = suspByName.get(p.name.toLowerCase());
      // While suspended the save holds the temporary benching rating — show the real one.
      const shownOverall = susp?.originalOverall ?? p.overall;
      const bits = [p.position, p.year, shownOverall != null ? `${shownOverall} OVR` : null, p.personality ?? null]
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
      parts.push(
        `  ${p.name}${bits ? ` (${bits})` : ""}${stat ? ` — ${stat}` : ""}${flags ? ` [${flags}]` : ""}`
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
      "is the one with more starts/games played; the other is the backup with his own smaller line."
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
      "- Their listed OVR above is their TRUE ability. The suspension — not talent, injury, or a",
      "  ratings drop — is the ONLY reason they're out. NEVER claim a player's rating collapsed,",
      "  that he 'fell to 40 overall', regressed, or was benched for performance.",
      "- This IS a storyline: cover the absence like real media would — who steps up in his spot,",
      "  what the locker room thinks, when he's back, pressers fielding questions about it.",
      "- When he returns, he returns at his true ability. Frame any return week as reinstatement."
    );
    parts.push("");
  }

  // Persistent coach identity: written once on the Coach tab, then fed to EVERY generator
  // so recaps, social, pressers, and situations all know who this coach is and reuse the
  // same recurring cast (AD, booster, beat writer, rival) instead of inventing new ones.
  const backstory = opts.backstory ?? null;
  if (backstory) {
    parts.push("=== COACH IDENTITY (persistent — keep every story consistent with this) ===");
    parts.push(`Archetype: ${backstory.archetype}`);
    if (backstory.bio) parts.push(`Bio: ${backstory.bio}`);
    parts.push("Recurring cast (reuse these exact names; do NOT invent replacements):");
    if (backstory.adName) parts.push(`  Athletic Director: ${backstory.adName}`);
    if (backstory.boosterName) parts.push(`  Lead booster: ${backstory.boosterName}`);
    if (backstory.reporterName) parts.push(`  Lead beat writer: ${backstory.reporterName} (byline/reporter of record for this program)`);
    if (backstory.rivalCoachName) parts.push(`  Rival head coach: ${backstory.rivalCoachName}`);
    parts.push("");
  }

  return {
    systemPrompt: SYSTEM_PROMPT,
    userContext: parts.join("\n"),
    school,
    coachName,
    week: d.weekPlayed,
    snapshot: after,
    delta,
    roster,
    backstory,
    weekState,
    phase,
  };
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

function buildSpec(kind: string, ctx: MediaContext, extra: Extra): PromptSpec {
  switch (kind) {
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
      return {
        maxTokens: 2800,
        prompt: [
          ctx.weekState === "game"
            ? "Write the week's game story for a program's front page — the piece a subscriber"
            : noGameFraming[ctx.weekState],
          ctx.weekState === "game" ? "actually reads to the end. 450-600 words. Return JSON with this exact schema:" : "450-600 words. Return JSON with this exact schema:",
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
          "- 5-7 paragraphs separated by \\n\\n. Cover: how the game actually turned (use the quarter",
          "  scores if provided — where did it swing?), the units/decisions that decided it (real",
          "  roster names when the roster is provided), and what this does to the season's stakes —",
          `  the pressure or belief building around Coach ${ctx.coachName}. But let the STORY dictate`,
          "  the order, not this list.",
          "- 1-2 attributed quotes inside the body, per house style.",
          ctx.backstory
            ? "- Your history with this coach colors the framing: a disciplinarian's ugly win reads different than a players-coach's. Reuse the recurring cast; never invent a rival beat writer."
            : "",
          "- The pullQuote is the single most alive quote (coach or player), text only, no quote marks.",
          "- Never invent scores, stats, rankings, or records — the context is the box score truth.",
          "  Everything between the numbers (drives, plays, moments) is yours to see and report.",
          "- If the context says it is a neutral site or playoff/bowl game, DO NOT claim the game was played at either team's home stadium.",
          "- If the week is Postseason, do not refer to the regular season or imply there are more regular season games left.",
          ctx.phase.key === "postseason"
            ? `- THIS IS THE ${ctx.phase.roundName?.toUpperCase()}. Frame the game as exactly that — ${ctx.phase.roundName === "National Championship" ? "one game for the national title, win-or-go-home, legacy on the line" : "a win-or-go-home playoff game; a win ADVANCES them, a loss ENDS the season"}. NEVER write about résumés, the selection committee, the bubble, or 'making the playoff' — they are already IN it and playing.`
            : "",
          "- Do not invent transfer portal news or roster departures unless explicitly mentioned in the context.",
          hlBlock,
          "",
          "Context:",
          ctx.userContext,
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
          ctx.phase.key === "postseason"
            ? `${ctx.school} is IN the College Football Playoff, playing the ${ctx.phase.roundName}. The bracket is SET — do NOT talk about rankings movement, the bubble, or making the field. 'movement' is a short phrase about their run, e.g. '${ctx.phase.roundName === "National Championship" ? "Playing for it all" : "Two wins from a title"}', 'Final Four', 'Cinderella run', 'Title favorite'. The body is a studio analyst breaking down how far this team can go and what it'd take to win it all.`
            : [
                `Analyze ${ctx.school}'s playoff/ranking picture after Week ${ctx.week}. If UNRANKED, frame it as trying to break in — never invent a number.`,
                "movement is a short phrase like 'On the bubble', 'Knocking on the door', 'Holds at #8', 'Up 3 spots', 'Drops out'.",
                "Write in the voice of a TV studio analyst breaking down the CFP picture.",
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
      return buildNationalWireSpec(ctx);

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
      return buildStorylinesSpec(ctx);

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
    "their program, their OVR, and WHY they're a flight risk (buried behind a starter, playing-time",
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
      lines.push(`  - ${t.name} (${t.position}, ${t.overall} OVR, ${t.year}) — ${t.team}${t.teamRank ? ` (#${t.teamRank})` : ""} · ${t.chance}% chance · wants: ${t.dealbreaker}`);
    }
  } else {
    lines.push("PORTAL STATUS: the transfer portal is NOT open yet this week (it opens after the season) — do NOT claim any player has entered the portal or transferred. Cover it as WHO IS AT RISK and the storylines building toward the window.");
  }
  const risk = Array.isArray(p.atRisk) ? p.atRisk : [];
  if (risk.length) {
    lines.push("", "FLIGHT RISK — good players buried on the depth chart league-wide (this is the story):");
    for (const r of risk.slice(0, 24)) {
      lines.push(`  - [${r.tier}] ${r.name} (${r.position}, ${r.overall} OVR, ${r.year}) — ${r.team}${r.teamRank ? ` (#${r.teamRank})` : ""} · buried behind a ${r.starterOvr} OVR starter · dealbreaker: ${r.dealbreaker}`);
    }
  }
  lines.push(
    "",
    "Every player you name MUST come from the board above. Reason from the data: a high-OVR",
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
  const portalIn = typeof extra.portalIn === "number" ? extra.portalIn : 0;
  const portalOut = typeof extra.portalOut === "number" ? extra.portalOut : 0;
  const atRisk = typeof extra.atRisk === "number" ? extra.atRisk : 0;

  const commitLines = commits
    .slice(0, 24)
    .map((c) => `  ${c.name} (${c.position}${c.nationalRank ? `, #${c.nationalRank} nat'l` : ""})`);

  return {
    maxTokens: 2200,
    prompt: [
      `You are ${ctx.school}'s beat writer filing the OFFSEASON briefing for the coach's program.`,
      `Current offseason stage: ${stageLabel}${stageNum != null && totalStages != null ? ` (stage ${stageNum} of ${totalStages})` : ""}.`,
      "Return JSON with this exact schema:",
      JSON.stringify({
        headline: "string (offseason A1 headline)",
        stageLabel: "string (short label for this stage)",
        body: "string (2-3 paragraphs, \\n\\n separated: the state of the program right now this offseason)",
        storylines: [{ title: "string", text: "string (2-3 sentences)" }],
        lookAhead: "string (1-2 sentences on what's next / next season's outlook)",
      }),
      "",
      "HARD RULES:",
      "- It is the OFFSEASON. There are NO games. Do NOT invent, recap, or reference any game or score.",
      "- Ground everything in the REAL data below — the record just finished, the signed class, the portal.",
      "- Name real signees from the list. Do NOT invent recruits or players not provided.",
      "- 3-4 storylines fit for THIS stage of the offseason (recruiting class, portal moves, roster",
      "  turnover, expectations). Confident, specific beat-writer voice — no filler.",
      "",
      "=== REAL PROGRAM STATE ===",
      record ? `Just-finished season record: ${record}${isChamp ? " — NATIONAL CHAMPIONS" : ""}` : "",
      `Transfer portal: ${portalIn} incoming, ${portalOut} outgoing, ${atRisk} current players flagged as flight risks.`,
      commitLines.length ? `Signed recruiting class (${commitLines.length}):` : "Signed recruiting class: none yet this stage.",
      ...commitLines,
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

function buildBackstorySpec(ctx: MediaContext, extra: Extra): PromptSpec {
  const archetype = String(extra.archetype ?? "players-coach");
  const customPath = String(extra.customPath ?? "");
  const prompt = [
    "You are a premier sports biographer and narrative designer for a college-football simulator.",
    "Write a rich, detailed, immersive backstory and ecosystem for a head coach.",
    "Respond with a JSON object matching this exact schema:",
    '{ "archetype": "disciplinarian"|"players-coach"|"nil-merchant"|"hometown-savior", "customPath": "the custom path input saved back", "bio": "2-3 paragraphs (150-220 words), prestige sports-journalism tone", "adName": "fictional realistic Athletic Director name", "boosterName": "fictional realistic chief billionaire booster name", "reporterName": "fictional realistic lead beat writer name", "rivalCoachName": "fictional realistic rival head coach name" }',
    "",
    "Rules:",
    "- The bio must feel lived-in, textured, and dramatic. Address the pressure of this job.",
    "- Archetype selected: " + archetype + ". Reflect its profile (disciplinarian=old-school/integrity; players-coach=empathy/culture; nil-merchant=transactional/portal; hometown-savior=local hero/expectation).",
    '- Incorporate the custom career path if provided: "' + customPath + '".',
    `- Coach Name: ${ctx.coachName}`,
    `- School: ${ctx.school}`,
    "- Do not mention any real living people or actual active college coaches.",
    "- Fictional names must sound authentic to college sports.",
  ].join("\n");
  return { prompt, maxTokens: 1500 };
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

function buildStorylinesSpec(ctx: MediaContext): PromptSpec {
  const security = ctx.snapshot.coach?.jobSecurity ?? "unknown";
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
    '  "options": [{"id": "a|b|c", "label": "<=5 word stance", "approach": "one line on the move", "tone": "hardline|measured|protective|pragmatic"}]',
    "}]}",
    "",
    "Rules:",
    "- Generate 2 to 3 situations. At least one MUST involve a specific named player (player != null).",
    "- Give EACH situation exactly 3 options with genuinely different philosophies — there is no clean answer.",
    "- Ground the situations in the actual result and the pressure the coach is under.",
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
    "Context (source of truth — never contradict the record or result):",
    ctx.userContext,
  ].join("\n");
  return { prompt, maxTokens: 2000 };
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
    r.overall != null ? `${r.overall} OVR` : null,
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
          stipendPoints: "integer program points per week (clean deals 50-150, edgy 150-300, controversial 300-600)",
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
  const oppOvr = typeof extra.oppRatingOVR === "number" ? extra.oppRatingOVR : null;
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

  // Run/pass identity straight from their production.
  const passYds = passer?.stats?.offense?.passYds ?? 0;
  const rushYds = oppRoster.reduce((s, p) => s + (p.stats?.offense?.rushYds ?? 0), 0);
  const identity =
    passYds > rushYds * 1.4 ? "pass-heavy" : rushYds > passYds * 1.1 ? "run-heavy" : "balanced";

  const leaderLine = (label: string, p: RosterPlayer | null) =>
    p ? `  ${label}: ${p.name} (${p.position}, ${p.overall} OVR) — ${fmtStats(p) ?? "—"}` : null;

  const leaders = [
    leaderLine("Passer", passer),
    leaderLine("Lead rusher", rusher),
    leaderLine("Top receiver", receiver),
    leaderLine("Tackles leader", tackler),
    leaderLine("Pass rush", sacker),
    leaderLine("Ball hawk", picker),
  ].filter(Boolean) as string[];

  // Depth: the top handful by OVR, real names, so "key players" are grounded.
  const keyGuys = oppRoster
    .filter((p) => p.overall != null)
    .slice(0, 14)
    .map((p) => `  ${p.name} (${p.position}, ${p.overall} OVR${p.year ? `, ${p.year}` : ""})${fmtStats(p) ? ` — ${fmtStats(p)}` : ""}`);

  const prompt = [
    `You are ${ctx.school}'s analytics staff building the scouting report on ${oppName} for the head coach's desk, ahead of the next game.`,
    "Return JSON with this exact schema:",
    JSON.stringify({
      opponent: "string (the opponent name)",
      summary: "string (2-3 sentence bottom-line: who they are and how dangerous)",
      offense: { identity: "run-heavy|pass-heavy|balanced", scheme: "string (short, inferred from their numbers)", keyPlayers: [{ name: "string", note: "string (why he matters, with a real stat)" }], howToStop: "string (2-3 sentences)" },
      defense: { identity: "string (short, inferred)", keyPlayers: [{ name: "string", note: "string (real stat)" }], howToAttack: "string (2-3 sentences)" },
      xFactor: "string (the one player or matchup that decides the game)",
      keys: ["3-4 short bullet keys to the game"],
    }),
    "",
    "HARD RULES:",
    "- Use ONLY the real opponent players listed below, by their real names. Never invent a player.",
    "- Every claim about a player must match his real stat line. Do not inflate or invent numbers.",
    `- Their offensive identity from the numbers is: ${identity}. Reflect that honestly.`,
    "- keyPlayers: 2-3 per side, the genuinely dangerous ones (stat leaders / highest OVR).",
    "- Be specific and useful — this is a real game plan, not hype filler. Confident coaching-staff voice.",
    "",
    `=== ${oppName.toUpperCase()} — TEAM ===`,
    `Record: ${oppRecord ?? "n/a"}${oppRank ? ` · AP #${oppRank}` : ""}${oppOvr ? ` · Team OVR ${oppOvr}` : ""}`,
    `Offensive tendency (from their production): ${identity} (≈${passYds} pass yds vs ≈${rushYds} rush yds on the season)`,
    "",
    "=== STAT LEADERS (real) ===",
    ...leaders,
    "",
    "=== KEY PERSONNEL (real, by OVR) ===",
    ...keyGuys,
    "",
    "Season context for your own team:",
    ctx.userContext,
  ].join("\n");
  return { prompt, maxTokens: 2200 };
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

function buildNationalWireSpec(ctx: MediaContext): PromptSpec {
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
    "- Player/recruit/coach names: use names from the provided context where given; otherwise INVENT",
    "  realistic fictional ones. Never pull a real-world CFB figure, storyline, or conference alignment",
    "  from your own knowledge — this universe's history is only what the save shows.",
    "- Voice: wire-service tight. These feed a breaking-news ticker.",
    "",
    "=== AP TOP 25 (real, from the save) ===",
    ...ranked,
    "",
    "=== OTHER PROGRAMS (real, from the save) ===",
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
            const stipend = Math.max(0, Math.min(800, Math.round(Number(d.stipendPoints) || 0)));
            const weeks = Math.max(1, Math.min(8, Math.round(Number(d.weeks) || 3)));
            // Deterministic meter tradeoff from reputation + money — "not all money is good money."
            const base = { clean: { fanTrust: 3, mediaHeat: 0, boosterConfidence: 2 }, edgy: { fanTrust: -3, mediaHeat: 4, boosterConfidence: 4 }, controversial: { fanTrust: -9, mediaHeat: 11, boosterConfidence: 6 } }[rep];
            const moneyBump = Math.round(stipend / 120); // bigger money, happier booster
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
    };
  }

  if (kind === "scouting") {
    if (!parsed || typeof parsed !== "object") return { error: true };
    const side = (s: unknown): Record<string, unknown> => (s && typeof s === "object" ? (s as Record<string, unknown>) : {});
    const kp = (v: unknown) =>
      Array.isArray(v)
        ? (v as Record<string, unknown>[])
            .filter((x) => x && typeof x.name === "string")
            .map((x) => ({ name: String(x.name), note: typeof x.note === "string" ? x.note : "" }))
        : [];
    const off = side(parsed.offense);
    const def = side(parsed.defense);
    const ok = typeof parsed.summary === "string" || kp(off.keyPlayers).length || kp(def.keyPlayers).length;
    if (!ok) return { error: true };
    return {
      opponent: typeof parsed.opponent === "string" ? parsed.opponent : "",
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      offense: {
        identity: typeof off.identity === "string" ? off.identity : "balanced",
        scheme: typeof off.scheme === "string" ? off.scheme : "",
        keyPlayers: kp(off.keyPlayers),
        howToStop: typeof off.howToStop === "string" ? off.howToStop : "",
      },
      defense: {
        identity: typeof def.identity === "string" ? def.identity : "",
        keyPlayers: kp(def.keyPlayers),
        howToAttack: typeof def.howToAttack === "string" ? def.howToAttack : "",
      },
      xFactor: typeof parsed.xFactor === "string" ? parsed.xFactor : "",
      keys: Array.isArray(parsed.keys) ? (parsed.keys as unknown[]).filter((k) => typeof k === "string").map(String) : [],
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
  if (kind === "carousel") return (await generateCarousel(ctx, llm)) as T;
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
  return normalize(kind, parsed, ctx, extra) as T;
}
