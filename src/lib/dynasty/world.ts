// The league's own life — four things the app had never read, all of them free.
//
// Everything here is PARSED, never generated: the game writes its own news feed, keeps a record
// book, and runs a coaching carousel, and until now DynastyWire ignored all of it and decided
// for itself what mattered. That was both more expensive and less true.
//
// The strongest of the four is the game's own headlines. It has already decided what was
// newsworthy league-wide — school records falling, milestone watches, marquee matchups — so a
// wire built on them cannot be wrong about what happened. Handing the model real events to
// write around is the same move as every other deterministic-core port.

import type { CoachMove, ConferenceTitle, LeagueAward, WorldData, WorldHeadline } from "./client";
import type { SeasonRecord } from "./archive";

/** The save's award enums, in the words a broadcast uses. */
const AWARD_LABEL: Record<string, string> = {
  BEST_HC: "Coach of the Year",
  BEST_AC: "Assistant Coach of the Year",
  BEST_POTY: "Player of the Year",
  BEST_FRESHMAN_POTY: "Freshman of the Year",
  MOST_VERSATILE: "Most Versatile Player",
  BEST_OPOTY: "Offensive Player of the Year",
  BEST_DPOTY: "Defensive Player of the Year",
};

export function awardLabel(award: string | null | undefined): string {
  if (!award) return "an award";
  return AWARD_LABEL[award] ?? award.replace(/_/g, " ").toLowerCase();
}

// ── The game's own headlines ────────────────────────────────────────────────────

export interface HeadlineOpts {
  /** Only headlines from this week onward, when the save dates them. */
  week?: number | null;
  /** Always keep anything about these programs, whatever the priority. */
  focusTeams?: (string | null | undefined)[];
  limit?: number;
}

/**
 * The headlines worth putting in front of a writer: this week's, the user's own programs, and
 * then the highest-priority remainder. The game's own `Priority` does the ranking — it already
 * knows a school record falling outranks a routine result.
 */
export function relevantHeadlines(world: WorldData | null | undefined, opts: HeadlineOpts = {}): WorldHeadline[] {
  const all = (world?.headlines ?? []).filter((h) => h.headline || h.summary);
  if (!all.length) return [];
  const focus = new Set(
    (opts.focusTeams ?? []).filter((t): t is string => !!t).map((t) => t.toLowerCase())
  );
  const limit = opts.limit ?? 12;

  const thisWeek = opts.week ?? null;
  const score = (h: WorldHeadline): number => {
    let s = h.priority ?? 0;
    if (h.team && focus.has(h.team.toLowerCase())) s += 1000;
    if (thisWeek != null && h.week === thisWeek) s += 500;
    if (h.topStory) s += 100;
    if (h.breaking) s += 100;
    return s;
  };
  return [...all].sort((a, b) => score(b) - score(a)).slice(0, limit);
}

export function headlineBlock(headlines: WorldHeadline[]): string | null {
  if (!headlines.length) return null;
  return [
    "=== THE LEAGUE'S OWN WIRE (headlines the GAME generated — every one of these really happened) ===",
    "  These are REAL events, already judged newsworthy by the league. Build coverage on them.",
    "  Never contradict one, and never invent a school record, a milestone or a streak of your",
    "  own — if a record fell, it is in this list.",
    ...headlines.map((h) => {
      const where = h.team ? `${h.team} — ` : "";
      const when = h.week != null ? `[Wk ${h.week}] ` : "";
      const head = h.headline ? `"${h.headline}": ` : "";
      return `  ${when}${where}${head}${h.summary ?? ""}`.trimEnd();
    }),
  ].join("\n");
}

// ── The record book ─────────────────────────────────────────────────────────────

export interface RecordBook {
  /** Awards won by people at the user's program. */
  ours: LeagueAward[];
  /** The rest of the league's award winners. */
  league: LeagueAward[];
  /** Conference titles the user's program has won. */
  ourTitles: ConferenceTitle[];
  recentTitles: ConferenceTitle[];
}

export function recordBook(world: WorldData | null | undefined, school: string | null): RecordBook {
  const awards = world?.awards ?? [];
  const titles = world?.confChampions ?? [];
  const mine = (s: string | null | undefined) => !!school && !!s && s.toLowerCase() === school.toLowerCase();
  return {
    ours: awards.filter((a) => mine(a.school)),
    league: awards.filter((a) => !mine(a.school)).slice(0, 10),
    ourTitles: titles.filter((t) => mine(t.winner)),
    recentTitles: titles.slice(-6),
  };
}

export function recordBookBlock(book: RecordBook, school: string | null): string | null {
  const lines: string[] = [];
  if (book.ourTitles.length && school) {
    lines.push(
      `  ${school} has won ${book.ourTitles.length} conference title${book.ourTitles.length === 1 ? "" : "s"} in the record book` +
        `: ${book.ourTitles.map((t) => `${t.conference} (beat ${t.loser} ${t.winnerScore}-${t.loserScore})`).join("; ")}.`
    );
  }
  if (book.ours.length) {
    lines.push(
      `  Award winners at ${school ?? "the program"}: ` +
        book.ours.map((a) => `${a.name} (${a.position ?? "—"}) — ${awardLabel(a.award)}`).join("; ") + "."
    );
  }
  if (book.league.length) {
    lines.push(
      "  Recent award winners elsewhere: " +
        book.league.slice(0, 5).map((a) => `${a.name}, ${a.school} — ${awardLabel(a.award)}`).join("; ") + "."
    );
  }
  if (!lines.length) return null;
  return [
    "=== THE RECORD BOOK (real, from the save) ===",
    // The save's history tables carry no year column, so a story that dates one of these is
    // making the date up.
    "  NOTE: these carry NO year. Reference them as history — never attach a season to one.",
    ...lines,
  ].join("\n");
}

// ── The carousel, and the man who had your job ──────────────────────────────────

/** Head-coach moves only, newest first. Coordinator churn is noise at this altitude. */
export function headCoachMoves(world: WorldData | null | undefined, limit = 8): CoachMove[] {
  return (world?.carousel ?? [])
    .filter((m) => m.toRole === "HeadCoach" || m.fromRole === "HeadCoach")
    .filter((m) => m.coach && (m.from || m.to))
    .slice(0, limit);
}

/**
 * The coach who LEFT the user's program — the man whose job this is now. Free drama, and true:
 * the carousel records where he went and what he was.
 */
export function predecessor(world: WorldData | null | undefined, school: string | null): CoachMove | null {
  if (!school) return null;
  const key = school.toLowerCase();
  return (
    (world?.carousel ?? []).find(
      (m) => m.fromRole === "HeadCoach" && m.from && m.from.toLowerCase() === key
    ) ?? null
  );
}

export function carouselBlock(moves: CoachMove[], prev: CoachMove | null, school: string | null): string | null {
  const lines: string[] = [];
  if (prev) {
    lines.push(
      `  THE MAN WHO HAD THIS JOB: ${prev.coach} left ${school ?? "the program"}` +
        (prev.to ? ` for ${prev.to}` : "") +
        ". The comparison is fair game and the fanbase remembers him."
    );
  }
  for (const m of moves) {
    if (prev && m === prev) continue;
    lines.push(
      `  ${m.coach}: ${m.from ?? "—"} → ${m.to ?? "—"}` +
        (m.contractYears ? ` (${m.contractYears}-year deal)` : "")
    );
  }
  if (!lines.length) return null;
  return [
    "=== THE COACHING CAROUSEL (real moves from the save) ===",
    "  Other programs are hiring and firing. These moves happened — use them, never invent one.",
    ...lines,
  ].join("\n");
}

// ── Anniversaries ───────────────────────────────────────────────────────────────

/**
 * "One year ago this week." Straight out of the Season Archive, so it is free and it is the
 * thing that makes a long dynasty feel long.
 */
export function anniversaries(
  archive: SeasonRecord[] | undefined,
  currentYear: number | null,
  week: number | null
): string[] {
  if (!archive?.length || currentYear == null || week == null) return [];
  const out: string[] = [];
  for (const season of archive) {
    if (season.year >= currentYear) continue;
    const ago = currentYear - season.year;
    const game = season.games.find((g) => g.week === week);
    if (!game) continue;
    out.push(
      `${ago} year${ago === 1 ? "" : "s"} ago this week: ${game.won ? "beat" : "lost to"} ` +
        `${game.opponent} ${game.us}-${game.them} (finished ${season.wins}-${season.losses}).`
    );
  }
  return out;
}

export function anniversaryBlock(lines: string[]): string | null {
  if (!lines.length) return null;
  return [
    "=== THIS WEEK IN PROGRAM HISTORY (from the archive — real) ===",
    ...lines.map((l) => `  ${l}`),
  ].join("\n");
}

// ── The whole thing ─────────────────────────────────────────────────────────────

export interface WorldBlockInput {
  world: WorldData | null | undefined;
  school: string | null;
  opponent?: string | null;
  week?: number | null;
  archive?: SeasonRecord[];
  currentYear?: number | null;
}

/** Every league-life block that has something to say, joined. Null when none do. */
export function worldBlock(input: WorldBlockInput): string | null {
  const heads = relevantHeadlines(input.world, {
    week: input.week,
    focusTeams: [input.school, input.opponent],
  });
  const book = recordBook(input.world, input.school);
  const prev = predecessor(input.world, input.school);
  const parts = [
    headlineBlock(heads),
    recordBookBlock(book, input.school),
    carouselBlock(headCoachMoves(input.world), prev, input.school),
    anniversaryBlock(anniversaries(input.archive, input.currentYear ?? null, input.week ?? null)),
  ].filter((p): p is string => !!p);
  return parts.length ? parts.join("\n\n") : null;
}
