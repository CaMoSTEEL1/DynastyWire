// The deterministic core's fact-checker (v2, step 1 — observe-only).
//
// Facts-in has failed repeatedly: the model can always ignore its context. This module is
// the other half of the contract, validate-out. We own ground truth — every valid name, the
// team it belongs to, every score, record and rank — so a contradiction is detectable in
// code at ZERO API cost.
//
// The rule this file enforces, and the only one: THE VALIDATOR PUNISHES CONTRADICTION,
// NEVER INVENTION. Code owns names, team attribution, scores, records, ranks. The model
// still owns the lede, the angle, the quotes, the fictional beat writer and every invented
// in-game detail. A fan may be an idiot about whether you deserved to win; he may not be
// wrong about who plays for you.
//
// Nothing here talks to the network, the store, or the Tauri bridge — it is pure logic over
// known inputs, which is exactly why it ships with fixture tests (validator.test.ts).

import type { DynastySnapshot, Recruit, RosterPlayer, WeekDelta } from "./client";

// ── Ground truth ────────────────────────────────────────────────────────────────

export interface KnownTeam {
  name: string;
  /** Name, nickname, city, and "City Nickname" — every string a writer may call this team. */
  aliases: string[];
  wins: number;
  losses: number;
  /** Every poll number this team legitimately holds (media / coaches / CFP). A claim that
   * matches ANY of them is true; three polls disagreeing is not a hallucination. */
  ranks: number[];
  headCoach: string | null;
}

export type PersonRole = "player" | "coach" | "recruit";

/** The stat categories a writer states in prose and the save can settle. */
export type StatCategory =
  | "passYds"
  | "passTDs"
  | "rushYds"
  | "rushAtt"
  | "rushTDs"
  | "recYds"
  | "recTDs"
  | "recCatches"
  | "tackles"
  | "sacks"
  | "ints"
  | "fgMade";

/** A player's SEASON-TO-DATE totals. Never a box score — the save has no per-game lines,
 * which is the distinction the whole stat check is built around. */
export type StatLine = Partial<Record<StatCategory, number>>;

export interface KnownPerson {
  name: string;
  /** Resolved program. null for recruits, who haven't signed anywhere yet. */
  team: string | null;
  role: PersonRole;
  position: string | null;
  /** Season-to-date production, when the save carries a stat line for him. */
  stats: StatLine | null;
  /** Games those totals accumulated over. One game in, a season total and a game line are
   * the same number, and the season-total-as-game-line check has to stay quiet. */
  gamesPlayed: number | null;
}

export interface GroundTruth {
  userTeam: string | null;
  opponent: string | null;
  coachName: string | null;
  week: number | null;
  teams: KnownTeam[];
  /** Every alias, lowercased, to the team it names. */
  teamByAlias: Map<string, KnownTeam>;
  people: KnownPerson[];
  /** Full name (normalized) -> people. */
  peopleByName: Map<string, KnownPerson[]>;
  /** Surname (normalized) -> people. Attribution is usually written surname-only. */
  peopleBySurname: Map<string, KnownPerson[]>;
  /** Every legal final score this week, as "a-b" in both orders. */
  legalScores: Set<string>;
  /** The user's own result, for the truth string on a bad score claim. */
  userScoreLine: string | null;
  /** True when we hold no roster at all — name checks must stay silent rather than flag
   * every name in the piece. */
  rosterKnown: boolean;
  /** True when at least one person carries a season stat line. Without one the stat check
   * has nothing to compare against and must report itself skipped, not clean. */
  statsKnown: boolean;
  /** The coach's recurring cast (AD, booster, beat writer, rival coach). Invented by the
   * user on purpose, so these names are never a violation anywhere. */
  castNames: string[];
}

export interface GroundTruthInput {
  snapshot: DynastySnapshot;
  delta: WeekDelta | null;
  /** The user team's real roster, when the parser provided one. */
  roster?: RosterPlayer[];
  /** This week's opponent's real roster. */
  oppRoster?: RosterPlayer[];
  /** Recruits in play, for the recruiting surfaces. */
  recruits?: Recruit[];
  /** The coach's recurring cast (AD, booster, beat writer, rival coach) — invented on
   * purpose and therefore never a violation. */
  cast?: (string | null | undefined)[];
}

function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’.]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function surnameOf(name: string): string {
  const parts = norm(name).split(" ").filter(Boolean);
  // "Jr"/"III" trail the surname; the name before them is the one writers use.
  const tail = parts[parts.length - 1];
  if (parts.length > 2 && /^(jr|sr|ii|iii|iv|v)$/.test(tail)) return parts[parts.length - 2];
  return tail ?? "";
}

/**
 * A player's season totals, flattened out of whichever shape the parser produced. The
 * sidecar writes the active side BOTH nested (`stats.offense`) and flattened onto the
 * wrapper, and a two-way player carries both blocks — reading only one of them is how a
 * real stat line reads as "unknown" and silently disables the check for that player.
 */
function statLineOf(p: RosterPlayer): StatLine | null {
  const s = p.stats;
  if (!s) return null;
  const pick = (key: "offense" | "defense" | "kicking") => {
    const nested = s[key];
    if (nested) return nested;
    return s.side === key ? (s as unknown as NonNullable<typeof nested>) : null;
  };
  const o = pick("offense");
  const d = pick("defense");
  const k = pick("kicking");
  const line: StatLine = {};
  const set = (cat: StatCategory, v: number | null | undefined) => {
    if (typeof v === "number" && Number.isFinite(v)) line[cat] = v;
  };
  set("passYds", o?.passYds);
  set("passTDs", o?.passTDs);
  set("rushYds", o?.rushYds);
  set("rushAtt", o?.rushAtt);
  set("rushTDs", o?.rushTDs);
  set("recYds", o?.recYds);
  set("recTDs", o?.recTDs);
  set("recCatches", o?.recCatches);
  set("tackles", d?.tackles);
  set("sacks", d?.sacks);
  set("ints", d?.ints);
  set("fgMade", k?.fgMade);
  return Object.keys(line).length ? line : null;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export function buildGroundTruth(input: GroundTruthInput): GroundTruth {
  const { snapshot, delta } = input;
  const userTeam = snapshot.userTeam?.name?.trim() || null;

  // teams is keyed by save row, not by name (see gen.ts) — walk the values.
  const teams: KnownTeam[] = [];
  const teamByAlias = new Map<string, KnownTeam>();
  const ambiguous = new Set<string>();
  const rowToName = new Map<string, string>();
  const headCoaches = snapshot.headCoaches ?? {};
  for (const [row, t] of Object.entries(snapshot.teams ?? {})) {
    if (!t?.name) continue;
    rowToName.set(row, t.name);
    const aliases = [t.name, t.nickname, t.city, t.city && t.nickname ? `${t.city} ${t.nickname}` : null]
      .filter((a): a is string => !!a && a.trim().length > 1);
    const known: KnownTeam = {
      name: t.name,
      aliases,
      wins: t.wins ?? 0,
      losses: t.losses ?? 0,
      ranks: [t.rankMedia, t.rankCoaches, t.rankCFP].filter(
        (r): r is number => typeof r === "number" && r > 0 && r <= 25
      ),
      headCoach: t.teamIndex != null ? headCoaches[String(t.teamIndex)] ?? null : null,
    };
    teams.push(known);
    for (const a of aliases) {
      const k = norm(a);
      // Nicknames collide across the league — Kansas State and Northwestern are both the
      // Wildcats. An alias that names two programs names neither: resolving it last-write-
      // wins produced a confident, wrong "unranked" verdict on the user's own team.
      if (teamByAlias.has(k) && teamByAlias.get(k)!.name !== t.name) ambiguous.add(k);
      else teamByAlias.set(k, known);
    }
  }
  for (const k of ambiguous) teamByAlias.delete(k);

  // The opponent in focus, resolved the same way gen.ts resolves it: this week's result
  // first, otherwise the next unplayed game on the schedule.
  let opponent: string | null = null;
  const g = delta?.userResult ?? null;
  if (g && userTeam) {
    opponent = g.home === userTeam ? g.away : g.home;
  } else if (snapshot.userTeamRow != null) {
    const row = snapshot.userTeamRow;
    const next =
      (snapshot.games ?? [])
        .filter((gm) => (gm.homeRow === row || gm.awayRow === row) && !gm.played)
        .sort((a, b) => (a.year ?? 0) - (b.year ?? 0) || (a.week ?? 0) - (b.week ?? 0))[0] ?? null;
    const oppRow = next ? (next.homeRow === row ? next.awayRow : next.homeRow) : null;
    opponent = oppRow != null ? rowToName.get(String(oppRow)) ?? null : null;
  }

  const people: KnownPerson[] = [];
  const addPerson = (p: KnownPerson) => {
    if (!p.name || p.name.trim().length < 3) return;
    people.push(p);
  };
  const asPlayer = (p: RosterPlayer, team: string | null): KnownPerson => ({
    name: p.name,
    team,
    role: "player",
    position: p.position ?? null,
    stats: statLineOf(p),
    gamesPlayed: p.stats?.gamesPlayed ?? null,
  });
  for (const p of input.roster ?? []) addPerson(asPlayer(p, userTeam));
  for (const p of input.oppRoster ?? []) addPerson(asPlayer(p, opponent));
  for (const r of input.recruits ?? []) {
    addPerson({ name: r.name, team: null, role: "recruit", position: r.position ?? null, stats: null, gamesPlayed: null });
  }
  for (const t of teams) {
    if (t.headCoach) {
      addPerson({ name: t.headCoach, team: t.name, role: "coach", position: "HC", stats: null, gamesPlayed: null });
    }
  }
  const coachName = snapshot.coachName?.trim() || null;
  if (coachName && userTeam) {
    addPerson({ name: coachName, team: userTeam, role: "coach", position: "HC", stats: null, gamesPlayed: null });
  }

  const peopleByName = new Map<string, KnownPerson[]>();
  const peopleBySurname = new Map<string, KnownPerson[]>();
  for (const p of people) {
    push(peopleByName, norm(p.name), p);
    const sn = surnameOf(p.name);
    if (sn.length > 2) push(peopleBySurname, sn, p);
  }

  // Every real final score this week. Stored in both orders because a writer may frame the
  // game from either sideline ("won 31-17" / "fell 17-31").
  const legalScores = new Set<string>();
  for (const r of delta?.results ?? []) {
    if (r.homeScore == null || r.awayScore == null) continue;
    legalScores.add(`${r.homeScore}-${r.awayScore}`);
    legalScores.add(`${r.awayScore}-${r.homeScore}`);
  }
  let userScoreLine: string | null = null;
  if (g && g.homeScore != null && g.awayScore != null) {
    legalScores.add(`${g.homeScore}-${g.awayScore}`);
    legalScores.add(`${g.awayScore}-${g.homeScore}`);
    userScoreLine = `${g.home} ${g.homeScore}, ${g.away} ${g.awayScore}`;
  }

  return {
    userTeam,
    opponent,
    coachName,
    week: delta?.weekPlayed ?? snapshot.week ?? null,
    teams,
    teamByAlias,
    people,
    peopleByName,
    peopleBySurname,
    legalScores,
    userScoreLine,
    rosterKnown: (input.roster?.length ?? 0) > 0,
    statsKnown: people.some((p) => p.stats != null),
    castNames: (input.cast ?? []).filter((c): c is string => !!c && c.trim().length > 2),
  };
}

// ── Violations ──────────────────────────────────────────────────────────────────

export type ViolationKind =
  | "unknown-person"
  | "misattributed-person"
  | "wrong-score"
  | "wrong-record"
  | "wrong-rank"
  | "phantom-rank"
  /** A season-framed stat line that contradicts the player's real season total. */
  | "wrong-stat"
  /** The number belongs to a DIFFERENT player — "mixed stats", the complaint this whole
   * check exists for, and the one shape that is provable without a box score. */
  | "mixed-stat"
  /** A CUMULATIVE season total written as what a player did in one game — "900+ yards in a
   * single game with 100+ carries", reported from a real save. */
  | "season-stat-as-game";

/** What a repair pass (v2 step 3) should do with this violation. Recorded now, acted on
 * later — step 1 is observe-only, so nothing reads these yet. */
export type RepairAction = "demote-to-role" | "correct-number" | "regenerate-section";

export interface Violation {
  kind: ViolationKind;
  /** hard = a false statement of fact. soft = probably wrong, worth watching before it
   * drives a repair (used to keep the baseline honest about detector confidence). */
  severity: "hard" | "soft";
  /** JSON path into the generated payload, e.g. `posts[3].body`. */
  field: string;
  /** The offending span, verbatim. */
  claim: string;
  /** Character offset of the span within that field's text. */
  offset: number;
  /** What the save actually says. */
  truth: string | null;
  repair: RepairAction;
}

export interface ValidationReport {
  kind: string;
  violations: Violation[];
  /** Prose fields actually scanned — social's 15 posts are 15 units, a recap is 1. */
  units: number;
  charsChecked: number;
  /** Checks that were skipped because the ground truth for them was missing. Keeps the
   * baseline honest: "0 violations" and "nothing was checkable" must not look alike. */
  skipped: string[];
}

// ── Per-kind config ─────────────────────────────────────────────────────────────

export interface KindChecks {
  names: boolean;
  attribution: boolean;
  scores: boolean;
  records: boolean;
  ranks: boolean;
  stats: boolean;
}

export interface KindConfig {
  /** Fields whose values ARE personas invented by this payload — bylines, handles, host
   * names. Collected into the allowlist before any prose is scanned, so a fictional beat
   * writer is never mistaken for a fabricated player. */
  personaFields: string[];
  /** Fields never scanned: ids, enums, urls, and short label fields that carry no claims. */
  skipFields: string[];
  checks: KindChecks;
}

const ALL: KindChecks = {
  names: true, attribution: true, scores: true, records: true, ranks: true, stats: true,
};
const NONE: KindChecks = {
  names: false, attribution: false, scores: false, records: false, ranks: false, stats: false,
};

const BASE_PERSONA_FIELDS = [
  "byline",
  "handle",
  "displayName",
  "author",
  "reporter",
  "host",
  "hosts",
  "analyst",
  "moderator",
  "askedBy",
  "questioner",
  "from",
  "speaker",
  "personas",
];

const BASE_SKIP_FIELDS = [
  "id",
  "type",
  "category",
  "kind",
  "slug",
  "url",
  "link",
  "image",
  "imageUrl",
  "icon",
  "color",
  "tone",
  "mood",
  "sentiment",
  "urgency",
  "stage",
  "status",
  "position",
  "role",
  "tier",
  "severity",
  "grade",
  "timestamp",
  "date",
];

function cfg(checks: Partial<KindChecks> = {}, extra: Partial<KindConfig> = {}): KindConfig {
  return {
    personaFields: [...BASE_PERSONA_FIELDS, ...(extra.personaFields ?? [])],
    skipFields: [...BASE_SKIP_FIELDS, ...(extra.skipFields ?? [])],
    checks: { ...ALL, ...checks },
  };
}

/**
 * Facts are checked on every surface; per-surface config controls only WHAT COUNTS as a
 * checkable claim. Social keeps its unhinged takes but cannot move a running back to
 * another school. A recruit dossier keeps its invented hometown but cannot fake a
 * national rank.
 */
export const KIND_CONFIG: Record<string, KindConfig> = {
  // The seven surfaces on the v2 frozen list.
  // Road to Glory. Same contract as the dynasty surfaces — the ground truth is the team's
  // roster and the user's own player, and his stat line is checked exactly like anyone's.
  // The invented cast (hometown accounts, a former high-school coach, teammates' handles)
  // rides the persona allowlist, same as the dynasty backstory cast.
  "rtg-week": cfg(),
  "rtg-social": cfg({}, { skipFields: ["likes", "reposts"] }),
  // The player wrote the post himself; only the REPLIES are generated.
  "rtg-post": cfg({}, { skipFields: ["likes", "reach", "verdict"] }),
  "rtg-podium": cfg({}, { skipFields: ["poise", "roomDelta", "brandDelta"] }),

  "recap-lead": cfg(),
  "national-desk": cfg(),
  "national-wire": cfg(),
  "press-conference": cfg(),
  shows: cfg(),
  social: cfg({}, { skipFields: ["likes", "reposts"] }),
  rankings: cfg(),

  // Already deterministic — validated anyway, since a locked table can still be
  // contradicted by the prose wrapped around it.
  scouting: cfg(),
  storylines: cfg(),

  // Everything else: validator-only in v2, restructure in v2.1.
  "podium-answer": cfg(),
  "press-conference-grade": cfg({ names: false }),
  "storyline-fallout": cfg(),
  "player-text": cfg(),
  "figure-text": cfg(),
  recruiting: cfg(),
  "recruit-dossier": cfg(),
  "recruit-text": cfg(),
  nil: cfg(),
  "nil-reaction": cfg(),
  "brand-deals": cfg(),
  trophy: cfg(),
  offseason: cfg(),
  "offseason-brief": cfg(),
  carousel: cfg({ scores: false }, { personaFields: ["staffMember", "name", "suitor"] }),

  // The user's own fiction — this surface CREATES the recurring cast, so every name in it
  // is legitimately new.
  "coach-backstory": cfg(NONE),
  // Vision extraction: the names come off the user's footage, not the save, and this output
  // BECOMES ground truth for the recap. Checking it against the roster would invert the
  // direction of trust.
  "highlights-extract": cfg(NONE),
};

export function configFor(kind: string): KindConfig {
  return KIND_CONFIG[kind] ?? cfg();
}

// ── Cue vocabularies ────────────────────────────────────────────────────────────

// A name only matters when the text ASSERTS a role for it. "Marcus Bell" in a byline is a
// persona; "linebacker Marcus Bell" is a claim about the roster.
// NOTE: no single-letter abbreviations (K, P, S). They read as position cues everywhere —
// "K-State" alone made every headline look like a roster claim in the first real run.
const POSITION_CUE =
  /\b(qb|rb|hb|fb|wr|te|ol|ot|og|dl|de|dt|lb|olb|mlb|ilb|cb|db|fs|ss|ls|ath|edge|quarterback|running back|tailback|fullback|(?:wide )?receiver|tight end|offensive lineman|left tackle|right tackle|guard|center|defensive (?:end|tackle|lineman|back)|nose tackle|linebacker|cornerback|safety|kicker|punter|long snapper|pass rusher|returner|player|players|starter|backup|freshman|sophomore|junior|senior|redshirt|walk-on|transfer|signee|commit|recruit)\b/i;

const STAFF_CUE =
  /\b(head coach|coach|coordinator|offensive coordinator|defensive coordinator|oc|dc|assistant|staffer|athletic director|ad)\b/i;

const PLAY_VERB_CUE =
  /\b(threw|throws|passed|completed|rushed|ran for|carried|caught|hauled in|scored|sacked|intercepted|picked off|tackled|kicked|punted|fumbled|blocked|returned|converted|lined up|started at|took over at|committed to|signed with|transferred|entered the portal|leads the team|paces)\b/i;

// Roles the model is SUPPOSED to invent. A name introduced as one of these is texture, not
// a roster claim, no matter what verb sits next to it.
const FICTIONAL_ROLE_CUE =
  /\b(fan|fans|booster|boosters|beat writer|beat reporter|reporter|columnist|host|co-host|analyst|pundit|insider|caller|student|alum|alumnus|alumna|bartender|usher|superfan|poster|redditor|troll|announcer|broadcaster|play-by-play|sideline reporter|talk radio|podcaster|blogger|scout|recruiting analyst|barber|waitress|professor|mayor)\b/i;

// Score claims. Anything hedged to a partial score is not a claim about the final.
// Only a RESULT word makes a pair a claim about the final. "score", "scoreboard" and "lead"
// were in here originally and matched every mid-game moment a writer describes.
const SCORE_CUE =
  /\b(won|win|wins|beat|beats|defeated|topped|downed|edged|routed|rolled|handled|survived|lost|loss|fell|upset|final|victory|defeat|shutout)\b/i;
const PARTIAL_SCORE_CUE =
  /\b(at half|at halftime|at the break|after one|after three|through three|through one|midway|(?:first|second|third|fourth) quarter|quarter ended|entering the (?:second|third|fourth)|early in the|late in the|scoreboard|led \d|trailed \d|up \d|down \d|lead)\b/i;

// A record stated as a record, not a score: "3-0 on the season", "1-0 in conference play".
const RECORD_CONTEXT = /\b(on the season|overall|in conference|in league|conference play|league play|this season|straight wins?)\b/i;

// The model is allowed to reason about what HASN'T happened. "The 14-0 record will change
// to 14-1 or move to 15-0" states no falsehood, and neither does "the moments that separate
// a 3-0 team from a 2-1 one" — both were flagged as wrong records on the first real run.
const HYPOTHETICAL_CUE =
  /\b(will|would|could|might|if|unless|instead of|rather than|separates? a|separated a|imagine|projected|on track to|needs? to|hoping)\b/i;

const RECORD_CUE =
  /\b(record|now|improve[sd]?|improving to|fall(?:s|ing)? to|drop(?:s|ped)? to|move[sd]? to|sit(?:s)? at|stands? at|climbs? to|goes to|are|is)\b/i;

// ── Stat claims ─────────────────────────────────────────────────────────────────
// "Mixed stats" is the complaint recap-lead actually earned, and until this landed nothing
// tested it: a piece that swapped two players' season lines scored clean.
//
// THE CONSTRAINT THAT SHAPES EVERYTHING BELOW: the save carries SEASON TOTALS and the final
// score. It has no box score. So "he ran for 120 tonight" is not checkable — it is invented
// per-game texture the house style licenses — and flagging it would repeat the false-positive
// disaster of the first baseline run. Only two shapes are provable:
//   1. a SEASON-framed line that contradicts that player's real season total, and
//   2. a number that is exactly some OTHER player's season total in the same category —
//      the fingerprint of a swap, whatever tense it is written in.

/** Numbers as a writer states them: "2,600", "487", and small counts spelled out. */
const NUM = "(\\d{1,3}(?:,\\d{3})+|\\d{1,4}|one|two|three|four|five|six|seven|eight|nine|ten)";
const WORD_NUM: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

function parseNum(raw: string): number | null {
  const w = WORD_NUM[raw.toLowerCase()];
  if (w != null) return w;
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

const STAT_PATTERNS: { re: RegExp; cat: StatCategory }[] = [
  { re: new RegExp(`\\b(?:threw|thrown|throws|throwing|passed|passes|passing)\\s+for\\s+${NUM}\\s*(?:yards?|yds?)\\b`, "gi"), cat: "passYds" },
  { re: new RegExp(`\\b${NUM}\\s+(?:passing|pass)\\s+(?:yards?|yds?)\\b`, "gi"), cat: "passYds" },
  { re: new RegExp(`\\b${NUM}\\s+yards?\\s+through the air\\b`, "gi"), cat: "passYds" },
  { re: new RegExp(`\\b(?:threw|thrown|throws|throwing|passed|passes|passing)\\s+for\\s+${NUM}\\s*(?:TDs?|touchdowns?|scores?)\\b`, "gi"), cat: "passTDs" },
  { re: new RegExp(`\\b${NUM}\\s+(?:passing|pass|touchdown)\\s+(?:TDs?|touchdowns?|passes)\\b`, "gi"), cat: "passTDs" },

  { re: new RegExp(`\\b(?:ran|run|runs|running|rushed|rushes|rushing|carried)\\s+for\\s+${NUM}\\s*(?:yards?|yds?)\\b`, "gi"), cat: "rushYds" },
  { re: new RegExp(`\\b${NUM}\\s+(?:rushing|rush|ground)\\s+(?:yards?|yds?)\\b`, "gi"), cat: "rushYds" },
  { re: new RegExp(`\\b${NUM}\\s+(?:carries|carry|attempts|totes)\\b`, "gi"), cat: "rushAtt" },
  { re: new RegExp(`\\bcarr(?:ied|ying|ies)\\s+(?:it|the (?:ball|rock))\\s+${NUM}\\s+times\\b`, "gi"), cat: "rushAtt" },
  { re: new RegExp(`\\b${NUM}\\s+yards?\\s+on the ground\\b`, "gi"), cat: "rushYds" },
  { re: new RegExp(`\\b(?:ran|runs|rushed|rushes)\\s+for\\s+${NUM}\\s*(?:TDs?|touchdowns?|scores?)\\b`, "gi"), cat: "rushTDs" },
  { re: new RegExp(`\\b${NUM}\\s+(?:rushing|rush)\\s+(?:TDs?|touchdowns?)\\b`, "gi"), cat: "rushTDs" },

  { re: new RegExp(`\\b${NUM}\\s+(?:receiving|rec\\.?)\\s+(?:yards?|yds?)\\b`, "gi"), cat: "recYds" },
  { re: new RegExp(`\\b${NUM}\\s+(?:catches|receptions|grabs)\\b`, "gi"), cat: "recCatches" },
  { re: new RegExp(`\\bcaught\\s+${NUM}\\s+(?:passes|balls)\\b`, "gi"), cat: "recCatches" },
  { re: new RegExp(`\\b${NUM}\\s+receiving\\s+(?:TDs?|touchdowns?)\\b`, "gi"), cat: "recTDs" },
  { re: new RegExp(`\\bcaught\\s+${NUM}\\s+(?:TDs?|touchdown passes?)\\b`, "gi"), cat: "recTDs" },

  { re: new RegExp(`\\b${NUM}\\s+(?:total\\s+)?tackles\\b`, "gi"), cat: "tackles" },
  { re: new RegExp(`\\b${NUM}\\s+sacks?\\b`, "gi"), cat: "sacks" },
  { re: new RegExp(`\\b${NUM}\\s+(?:interceptions?|INTs?)\\b`, "gi"), cat: "ints" },
  { re: new RegExp(`\\b${NUM}\\s+field goals?\\b`, "gi"), cat: "fgMade" },
];

const STAT_LABEL: Record<StatCategory, string> = {
  passYds: "passing yards",
  passTDs: "passing TDs",
  rushYds: "rushing yards",
  rushAtt: "carries",
  rushTDs: "rushing TDs",
  recYds: "receiving yards",
  recTDs: "receiving TDs",
  recCatches: "catches",
  tackles: "tackles",
  sacks: "sacks",
  ints: "interceptions",
  fgMade: "field goals made",
};

const YARD_CATS = new Set<StatCategory>(["passYds", "rushYds", "recYds"]);

/** Approximation. "nearly 2,600 yards" asserts a neighbourhood, not a number. */
const APPROX_CUE = /\b(nearly|almost|about|around|roughly|some|over|under|more than|less than|north of|shy of|upwards? of|approximately|~)\s*$/i;

/** The claim is explicitly about the SEASON, which is the only thing the save can settle. */
const SEASON_FRAME_CUE =
  /\b(this season|on the season|this year|on the year|for the season|season total|season-long|through \w+ games?|so far this|to date|leads the team|paces the team)\b/i;

/** The claim is about a PAST season or a career — legitimate now that year-over-year memory
 * feeds archived seasons in, and never checkable against a current-season total. */
const PRIOR_FRAME_CUE =
  /\b(last season|last year|a year ago|two years ago|career|previous season|prior season|in 20\d\d|as a (?:true )?(?:freshman|sophomore|junior)|his first (?:year|season)|back then)\b/i;

/** The claim is about ONE GAME. The save has no box score, so a per-game number can only be
 * caught by the swap fingerprint — never by comparing it to a season total. */
const GAME_FRAME_CUE =
  /\b(tonight|today|saturday|on the night|on the day|in the win|in the loss|this week|in this game|in the game|first half|second half|(?:first|second|third|fourth) quarter|by halftime|after the break)\b/i;

/** Big enough that an exact collision with another player's total is a swap, not a
 * coincidence. Small counting stats collide constantly and must not be flagged. */
const DISTINCT_MIN: Record<StatCategory, number> = {
  passYds: 50, rushYds: 50, recYds: 50,
  rushAtt: 25, recCatches: 8, tackles: 8,
  passTDs: 5, rushTDs: 5, recTDs: 5, sacks: 5, ints: 4, fgMade: 5,
};

function distinctive(cat: StatCategory, value: number): boolean {
  return value >= DISTINCT_MIN[cat];
}

/** Writers round, and rounding is not a contradiction: "2,600 yards" for 2,588 is correct
 * prose. Counting stats have nothing to round, so those must match exactly. */
function closeEnough(cat: StatCategory, claimed: number, actual: number): boolean {
  if (claimed === actual) return true;
  if (!YARD_CATS.has(cat)) return false;
  return Math.abs(claimed - actual) <= Math.max(2, Math.round(actual * 0.02));
}

// Titles and position labels that ride in front of a name. Stripped before the name is
// keyed, or "Starting MLB Marcus Talton" and "Marcus Talton" count as two different people.
const HONORIFIC =
  /^(coach|head coach|hc|qb|rb|hb|fb|wr|te|lb|mlb|olb|ilb|cb|db|dl|ol|de|dt|fs|ss|ls|edge|ath|s|k|p|starting|backup|starter|freshman|sophomore|junior|senior|mr|mrs|ms|dr|no|sen|gov)\.?$/i;

// Words that start sentences or label things, and therefore lead false "First Last" hits.
const NAME_STOPWORDS = new Set(
  [
    "the","a","an","and","but","or","so","then","when","while","after","before","because","if",
    "this","that","these","those","there","here","it","its","he","she","they","we","you","i",
    "his","her","their","our","your","my","not","no","yes","now","last","next","first","second",
    "third","fourth","final","week","saturday","sunday","monday","tuesday","wednesday","thursday",
    "friday","january","february","march","april","may","june","july","august","september",
    "october","november","december","fall","spring","summer","winter","north","south","east",
    "west","state","university","college","stadium","field","bowl","playoff","championship",
    "conference","division","poll","associated","press","top","heisman","big","american",
    "athletic","sun","belt","mountain","pac","sec","acc","cfp","ncaa","espn","gameday","nil",
    "portal","transfer","signing","day","half","quarter","overtime","kickoff","touchdown",
    "field","goal","offense","defense","special","teams",
  ]
);

// ── Payload walk ────────────────────────────────────────────────────────────────

export interface FieldText {
  path: string;
  key: string;
  text: string;
}

/**
 * Collect every prose leaf in a generated payload with its JSON path, and separately the
 * persona names the payload declared. Generic on purpose: 25 kinds return 25 shapes, and
 * hardcoding all of them would guarantee the validator silently misses new fields.
 */
export function collectText(
  payload: unknown,
  config: KindConfig
): { fields: FieldText[]; personas: string[] } {
  const fields: FieldText[] = [];
  const personas: string[] = [];
  const persona = new Set(config.personaFields.map((f) => f.toLowerCase()));
  const skip = new Set(config.skipFields.map((f) => f.toLowerCase()));

  const walk = (value: unknown, path: string, key: string): void => {
    if (typeof value === "string") {
      const k = key.toLowerCase();
      if (persona.has(k)) {
        personas.push(value);
        return;
      }
      if (skip.has(k)) return;
      // A bare handle or hashtag carries no assertion. Only a lone token — a sentence that
      // happens to open with "#4 Tulane" is exactly the claim we are here to check.
      if (/^[@#]\S*$/.test(value.trim())) return;
      if (value.trim().length < 3) return;
      fields.push({ path, key, text: value });
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${path}[${i}]`, key));
      return;
    }
    if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        walk(v, path ? `${path}.${k}` : k, k);
      }
    }
  };

  walk(payload, "", "");
  return { fields, personas };
}

// ── Sentence scoping ────────────────────────────────────────────────────────────

interface Sentence {
  text: string;
  offset: number;
}

function sentencesOf(text: string): Sentence[] {
  const out: Sentence[] = [];
  const re = /[^.!?\n]+[.!?]*\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (!m[0].trim()) continue;
    out.push({ text: m[0], offset: m.index });
  }
  return out.length ? out : [{ text, offset: 0 }];
}

// ── Checks ──────────────────────────────────────────────────────────────────────

const NAME_RE = /\b[A-Z][a-zA-Z'’\-]+(?:\s+(?:[A-Z][a-zA-Z'’.\-]+|de|da|van|von|del|la))+\b/g;

function stripPossessive(s: string): string {
  return s.replace(/['’]s$/i, "").trim();
}

/**
 * "Tulane's Kellen Marsh" arrives as one capitalized run. Split the owner off the front:
 * it is both the reason the name matched and the team attribution being asserted, which is
 * the single most common way a misattribution is written.
 */
function splitPossessive(candidate: string): { owner: string | null; name: string; shift: number } {
  const tokens = candidate.split(/\s+/);
  let last = -1;
  for (let i = 0; i < tokens.length - 1; i++) if (/['’]s$/.test(tokens[i])) last = i;
  if (last < 0) return { owner: null, name: candidate, shift: 0 };
  const owner = stripPossessive(tokens.slice(0, last + 1).join(" "));
  const name = tokens.slice(last + 1).join(" ");
  return { owner, name, shift: Math.max(0, candidate.lastIndexOf(name)) };
}

/**
 * A headline is Title Case, so every capitalized pair in it looks like a person. Real prose
 * is not. Detecting the shape generically beats naming the fields, because a new surface
 * with a `title` or `deckline` would otherwise start producing phantom people.
 */
function isTitleCased(text: string): boolean {
  const words = text.trim().split(/\s+/).filter((w) => /[a-zA-Z]/.test(w));
  if (words.length < 3) return false;
  const upper = words.filter((w) => /^[A-Z]/.test(w)).length;
  return upper / words.length >= 0.6;
}

/** "Michigan defensive end Jaden Arnette" — attribution without an apostrophe. The team
 * only counts when a position word sits between it and the name; otherwise "Arnette gashed
 * Michigan" would read as a claim that he plays there. */
function appositiveTeamBefore(text: string, index: number, truth: GroundTruth): KnownTeam | null {
  const lead = text.slice(Math.max(0, index - 60), index);
  const m = /([A-Z][\w'’\-]*(?:\s+[A-Z][\w'’\-]*)*)\s+([a-z][\w\s/-]{2,30})$/.exec(lead);
  if (!m) return null;
  if (!POSITION_CUE.test(m[2]) && !STAFF_CUE.test(m[2])) return null;
  return truth.teamByAlias.get(norm(m[1])) ?? null;
}

function looksLikeName(candidate: string): boolean {
  const tokens = candidate.split(/\s+/).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 4) return false;
  const meaningful = tokens.filter((t) => !HONORIFIC.test(t));
  if (meaningful.length < 2) return false;
  // Fan posts SHOUT, and a shouted phrase is not a name. Initials ("JT Daniels") are short,
  // so only long all-caps tokens disqualify. The cost is that we cannot check names inside
  // an all-caps rant; that is the right way to be wrong.
  if (meaningful.some((t) => t.length >= 4 && t === t.toUpperCase())) return false;
  // Any stopword token means we grabbed a sentence boundary or a label, not a person.
  return !meaningful.some((t) => NAME_STOPWORDS.has(norm(t)));
}

/** The team a sentence attributes something to, if it names exactly one. */
function teamsInSentence(sentence: string, truth: GroundTruth): KnownTeam[] {
  const found = new Map<string, KnownTeam>();
  for (const t of truth.teams) {
    for (const alias of t.aliases) {
      if (alias.length < 3) continue;
      const re = new RegExp(`\\b${escapeRe(alias)}\\b`, "i");
      if (re.test(sentence)) {
        found.set(t.name, t);
        break;
      }
    }
  }
  return [...found.values()];
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The team named in a possessive right before a name: "Tulane's Jamal Reed". */
function possessiveTeamBefore(text: string, index: number, truth: GroundTruth): KnownTeam | null {
  const lead = text.slice(Math.max(0, index - 40), index);
  const m = /([A-Z][\w'’\-]*(?:\s+[A-Z][\w'’\-]*)*)['’]s\s*$/.exec(lead);
  if (!m) return null;
  return truth.teamByAlias.get(norm(m[1])) ?? null;
}

function checkNames(
  field: FieldText,
  truth: GroundTruth,
  allow: Set<string>,
  checks: KindChecks,
  out: Violation[]
): void {
  if (!checks.names && !checks.attribution) return;
  for (const sentence of sentencesOf(field.text)) {
    const hasRoleCue =
      POSITION_CUE.test(sentence.text) || STAFF_CUE.test(sentence.text) || PLAY_VERB_CUE.test(sentence.text);
    if (!hasRoleCue) continue;
    // Headlines are Title Case end to end; every capitalized pair in one reads as a person.
    if (isTitleCased(sentence.text)) continue;
    const fictional = FICTIONAL_ROLE_CUE.test(sentence.text);

    let m: RegExpExecArray | null;
    NAME_RE.lastIndex = 0;
    while ((m = NAME_RE.exec(sentence.text))) {
      const split = splitPossessive(stripPossessive(m[0]));
      const offset = sentence.offset + m.index + split.shift;
      if (!looksLikeName(split.name)) continue;
      // Drop the title/position words so the person is keyed by name alone.
      const raw = split.name.split(/\s+/).filter((t) => !HONORIFIC.test(t)).join(" ");
      const key = norm(raw);
      if (!key) continue;
      // A team name, the program itself, or a persona this payload introduced.
      if (truth.teamByAlias.has(key) || allow.has(key)) continue;

      const known = truth.peopleByName.get(key);
      if (!known?.length) {
        if (!checks.names || !truth.rosterKnown) continue;
        // The model is allowed — encouraged — to invent fans, hosts and beat writers. Only
        // a name asserted onto a real program's roster or staff is a violation.
        if (fictional) continue;
        out.push({
          kind: "unknown-person",
          severity: "hard",
          field: field.path,
          claim: raw,
          offset,
          truth: null,
          repair: "demote-to-role",
        });
        continue;
      }

      if (!checks.attribution) continue;
      const person = known[0];
      if (!person.team) continue; // recruits belong to no program yet
      // ONLY an explicit attachment counts — a possessive ("Michigan's Arnette") or an
      // appositive ("Michigan defensive end Arnette"). Merely naming another team in the
      // same sentence does not: "Hurley ran for 120 against NC State" is how every game
      // story is written, and treating it as a misattribution buried the real signal under
      // false positives on the first real run.
      const attached =
        (split.owner ? truth.teamByAlias.get(norm(split.owner)) ?? null : null) ??
        possessiveTeamBefore(sentence.text, m.index, truth) ??
        appositiveTeamBefore(sentence.text, m.index, truth);
      if (!attached) continue;
      if (attached.name === person.team) continue;
      out.push({
        kind: "misattributed-person",
        severity: "hard",
        field: field.path,
        claim: `${raw} → ${attached.name}`,
        offset,
        truth: `${person.name} plays for ${person.team}`,
        repair: "demote-to-role",
      });
    }
  }
}

/**
 * Every known person a sentence names, by full name OR bare surname — prose attributes
 * production surname-only ("Leber threw for 2,600") far more often than in full, so a
 * full-name-only scan would leave the stat check blind on the sentences that matter most.
 *
 * A surname shared by two rostered players returns BOTH, which makes the sentence ambiguous
 * and therefore skipped. That is deliberate: guessing whose line it is would manufacture the
 * exact misattribution this file exists to catch.
 */
function peopleInSentence(sentence: string, truth: GroundTruth, allow: Set<string>): KnownPerson[] {
  const found = new Map<string, KnownPerson>();
  const add = (p: KnownPerson) => found.set(`${norm(p.name)}::${p.team ?? ""}`, p);

  NAME_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NAME_RE.exec(sentence))) {
    const split = splitPossessive(stripPossessive(m[0]));
    if (!looksLikeName(split.name)) continue;
    const key = norm(split.name.split(/\s+/).filter((t) => !HONORIFIC.test(t)).join(" "));
    if (!key || allow.has(key) || truth.teamByAlias.has(key)) continue;
    for (const p of truth.peopleByName.get(key) ?? []) add(p);
  }

  const TOKEN_RE = /\b[A-Z][a-zA-Z'’\-]{2,}\b/g;
  let t: RegExpExecArray | null;
  while ((t = TOKEN_RE.exec(sentence))) {
    const key = norm(t[0]);
    if (!key || allow.has(key) || truth.teamByAlias.has(key) || NAME_STOPWORDS.has(key)) continue;
    for (const p of truth.peopleBySurname.get(key) ?? []) add(p);
  }
  return [...found.values()];
}

interface StatClaim {
  cat: StatCategory;
  value: number;
  /** Offset of the whole matched phrase within the sentence. */
  index: number;
  text: string;
}

/** Every (category, number) a sentence binds together. */
export function statClaims(sentence: string): StatClaim[] {
  const out: StatClaim[] = [];
  for (const { re, cat } of STAT_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sentence))) {
      const value = parseNum(m[1]);
      if (value == null || value <= 0) continue;
      // "nearly 2,600 yards" is a neighbourhood, not a claim about a number.
      if (APPROX_CUE.test(sentence.slice(Math.max(0, m.index - 24), m.index + m[0].indexOf(m[1])))) continue;
      out.push({ cat, value, index: m.index, text: m[0].trim() });
    }
  }
  return out;
}

function checkStats(
  field: FieldText,
  truth: GroundTruth,
  allow: Set<string>,
  out: Violation[]
): void {
  if (!truth.statsKnown) return;
  for (const sentence of sentencesOf(field.text)) {
    const s = sentence.text;
    if (HYPOTHETICAL_CUE.test(s)) continue;
    // A past-season or career line is a different number by definition, and since
    // year-over-year memory started feeding archived seasons into the context, one of these
    // is now a CORRECT thing for the model to write.
    if (PRIOR_FRAME_CUE.test(s)) continue;

    const claims = statClaims(s);
    if (!claims.length) continue;
    const subjects = peopleInSentence(s, truth, allow);
    // Exactly one person, or there is no way to know whose line is being stated.
    if (subjects.length !== 1) continue;
    const person = subjects[0];
    if (!person.stats) continue;

    const seasonFramed = SEASON_FRAME_CUE.test(s);
    const gameFramed = GAME_FRAME_CUE.test(s);

    for (const claim of claims) {
      const actual = person.stats[claim.cat];
      if (actual == null) continue;

      if (closeEnough(claim.cat, claim.value, actual)) {
        // The number is RIGHT — as a season total. Written into a sentence about one game,
        // that is the single most-reported error in the app: "900+ yards in a single game
        // with 100+ carries." Needs three games of separation, because through week one a
        // season total and a game line are legitimately the same number.
        if (
          gameFramed &&
          !seasonFramed &&
          distinctive(claim.cat, claim.value) &&
          (person.gamesPlayed ?? 0) >= 3
        ) {
          out.push({
            kind: "season-stat-as-game",
            severity: "hard",
            field: field.path,
            claim: `${person.name}: ${claim.text}`,
            offset: sentence.offset + claim.index,
            truth:
              `${claim.value} is ${person.name}'s SEASON total (${person.gamesPlayed} games), not a game line — ` +
              `his average game is ${Math.round((actual / (person.gamesPlayed || 1)) * 10) / 10} ${STAT_LABEL[claim.cat]}`,
            repair: "correct-number",
          });
        }
        continue;
      }

      // Whose number IS this? An exact hit on another player's season total in the same
      // category is the swap fingerprint, and it holds regardless of tense.
      const owner = distinctive(claim.cat, claim.value)
        ? truth.people.find((p) => p !== person && p.stats?.[claim.cat] === claim.value) ?? null
        : null;

      if (owner) {
        out.push({
          kind: "mixed-stat",
          severity: "hard",
          field: field.path,
          claim: `${person.name}: ${claim.text}`,
          offset: sentence.offset + claim.index,
          truth: `${claim.value} ${STAT_LABEL[claim.cat]} is ${owner.name}'s season total — ${person.name} has ${actual}`,
          repair: "correct-number",
        });
        continue;
      }
      // Otherwise only a SEASON-framed claim is checkable. The save has no box score, so a
      // per-game line is invented texture, not a contradiction.
      if (!seasonFramed || gameFramed) continue;
      out.push({
        kind: "wrong-stat",
        severity: "hard",
        field: field.path,
        claim: `${person.name}: ${claim.text}`,
        offset: sentence.offset + claim.index,
        truth: `${person.name} has ${actual} ${STAT_LABEL[claim.cat]} this season`,
        repair: "correct-number",
      });
    }
  }
}

const PAIR_RE = /\b(\d{1,3})\s*[-–—]\s*(\d{1,3})\b/g;

function checkNumbers(
  field: FieldText,
  truth: GroundTruth,
  checks: KindChecks,
  out: Violation[]
): void {
  for (const sentence of sentencesOf(field.text)) {
    const s = sentence.text;
    // Nothing in a hypothetical sentence is a claim about what happened.
    if (HYPOTHETICAL_CUE.test(s)) continue;
    const scoreish = SCORE_CUE.test(s);
    const recordish = RECORD_CUE.test(s) || RECORD_CONTEXT.test(s);
    const partial = PARTIAL_SCORE_CUE.test(s);

    let m: RegExpExecArray | null;
    PAIR_RE.lastIndex = 0;
    while ((m = PAIR_RE.exec(s))) {
      const pair = `${Number(m[1])}-${Number(m[2])}`;
      const offset = sentence.offset + m.index;
      const a = Number(m[1]);
      const b = Number(m[2]);
      // "a 16-0 run", "a 10-0 stretch" — scoring runs are invented texture the house style
      // explicitly licenses. Checked before anything else: a run also reads as record-shaped.
      if (/^\s*(?:scoring\s+)?(run|stretch|spurt|burst|surge|swing|spree)\b/i.test(s.slice(m.index + m[0].length))) {
        continue;
      }
      const looksRecord = a <= 20 && b <= 20 && (recordish || /^\(/.test(s.slice(Math.max(0, m.index - 1))));

      // A record is checked against the team the sentence names; a score against the set of
      // results that actually happened. When a pair could be either, the record reading wins
      // only if a team in the sentence actually holds it — that keeps "won 14-10" out of the
      // record path.
      if (checks.records && looksRecord) {
        const named = teamsInSentence(s, truth);
        const subjects = named.length
          ? named
          : truth.userTeam
            ? truth.teams.filter((t) => t.name === truth.userTeam)
            : [];
        if (subjects.length === 1) {
          const t = subjects[0];
          if (t.wins === a && t.losses === b) continue;
          if (truth.legalScores.has(pair)) continue; // it was a real score, not a record
          // Conference and division records are real and we don't hold every one of them.
          if (/\b(conference|league|conf\.?|division|road|home|away)\b/i.test(s)) continue;
          out.push({
            kind: "wrong-record",
            severity: "hard",
            field: field.path,
            claim: m[0],
            offset,
            truth: `${t.name} is ${t.wins}-${t.losses}`,
            repair: "correct-number",
          });
          continue;
        }
        // Record-shaped but the sentence names two teams, so we cannot tell whose it is.
        // Falling through to the score check turned "improves to 2-0" into a wrong-score.
        continue;
      }

      if (!checks.scores || !scoreish || partial) continue;
      if (!truth.legalScores.size) continue;
      if (truth.legalScores.has(pair)) continue;
      // A pair that IS somebody's real record is a record, whatever the surrounding verbs.
      // "Three straight wins, 3-0 on the season" tripped the score check because "wins" is
      // a result word.
      if (truth.teams.some((t) => t.wins === a && t.losses === b)) continue;
      if (RECORD_CONTEXT.test(s)) continue;
      // Conference records ("4-1 in league play") and rankings ride the same shape; only
      // flag when the sentence is unambiguously about a result.
      if (looksRecord) continue;
      out.push({
        kind: "wrong-score",
        severity: "hard",
        field: field.path,
        claim: m[0],
        offset,
        truth: truth.userScoreLine,
        repair: "correct-number",
      });
    }
  }
}

const RANK_RE = /(?:#|No\.\s*)(\d{1,2})\b/gi;

function checkRanks(field: FieldText, truth: GroundTruth, out: Violation[]): void {
  let m: RegExpExecArray | null;
  RANK_RE.lastIndex = 0;
  while ((m = RANK_RE.exec(field.text))) {
    const claimed = Number(m[1]);
    if (claimed < 1 || claimed > 25) continue;
    // Only a rank bolted to a team name is a poll claim. "#3 recruit in the country" and
    // "#12" as a jersey are not, and must not be flagged.
    const after = field.text.slice(m.index + m[0].length, m.index + m[0].length + 48);
    const lead = /^\s+([A-Z][\w'’\-]*(?:\s+[A-Z][\w'’\-]*){0,3})/.exec(after);
    if (!lead) continue;
    let team: KnownTeam | undefined;
    const words = lead[1].split(/\s+/);
    for (let n = words.length; n >= 1 && !team; n--) {
      team = truth.teamByAlias.get(norm(words.slice(0, n).join(" ")));
    }
    if (!team) continue;
    if (team.ranks.includes(claimed)) continue;
    out.push({
      kind: team.ranks.length ? "wrong-rank" : "phantom-rank",
      severity: "hard",
      field: field.path,
      claim: `${m[0]} ${lead[1]}`,
      offset: m.index,
      truth: team.ranks.length ? `${team.name} is #${team.ranks.join("/#")}` : `${team.name} is unranked`,
      repair: "correct-number",
    });
  }
}

// ── Entry point ─────────────────────────────────────────────────────────────────

/**
 * Fact-check one generated payload against the save. Observe-only: it reports, it never
 * rewrites. Repair (demote-to-role, correct-the-number, regenerate-the-section) lands in
 * v2 step 3, once the baseline below proves what the real violation rate is.
 */
export function validateGeneration(
  kind: string,
  payload: unknown,
  truth: GroundTruth,
  config: KindConfig = configFor(kind)
): ValidationReport {
  const violations: Violation[] = [];
  const skipped: string[] = [];
  const checks = config.checks;

  if (checks.names && !truth.rosterKnown) skipped.push("names (no roster in the save)");
  if (checks.scores && !truth.legalScores.size) skipped.push("scores (no result this week)");
  if (checks.stats && !truth.statsKnown) skipped.push("stats (no season stat lines in the save)");

  const { fields, personas } = collectText(payload, config);
  // Personas declared anywhere in this payload are allowlisted everywhere in it — the
  // false-positive trap from the design doc: a fictional caller quoted in the body must not
  // read as a fabricated player.
  const allow = new Set<string>();
  for (const p of personas) {
    const clean = stripPossessive(p.replace(/^[@#]/, "").replace(/^(by|with)\s+/i, ""));
    if (clean) allow.add(norm(clean));
  }
  // The recurring cast is invented by the user, so it is never checkable. Real coaches are
  // deliberately NOT allowlisted — they are ground truth, and putting one on the wrong
  // sideline is exactly the kind of contradiction this pass exists to catch.
  for (const c of truth.castNames) allow.add(norm(c));

  let charsChecked = 0;
  for (const field of fields) {
    charsChecked += field.text.length;
    checkNames(field, truth, allow, checks, violations);
    if (checks.scores || checks.records) checkNumbers(field, truth, checks, violations);
    if (checks.ranks) checkRanks(field, truth, violations);
    if (checks.stats) checkStats(field, truth, allow, violations);
  }

  // One wrong fact is one violation, however many times the piece repeats it. A recap that
  // names an invented linebacker in four paragraphs was scoring 4.0 — which reads as four
  // separate hallucinations and skews every surface that repeats a name naturally.
  const seen = new Set<string>();
  const deduped = violations.filter((v) => {
    const key = `${v.kind}::${norm(v.claim)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { kind, violations: deduped, units: fields.length, charsChecked, skipped };
}
