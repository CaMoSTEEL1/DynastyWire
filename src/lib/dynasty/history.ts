// Year-over-year memory — Phase B of the Season Archive design.
//
// The most-requested feature was memory, and it was unsafe to build until now for one
// reason: asked to remember, a model confabulates. It will happily invent last year's
// record, a revenge game that never happened, and a breakout season for a player who was a
// freshman walk-on. Under the deterministic core that stops being a hard problem — the past
// is just another locked table, computed here from the Season Archive and handed over as
// fixed fact, exactly like suspensions and the scouting report.
//
// So: code decides what happened in prior seasons. The model decides what it MEANS — the
// callback, the revenge framing, the "second straight year" lede, the presser question that
// starts "a year ago you sat here at 3-3."
//
// Pure functions over archived records. No store, no network, no React.

import type { CoachInfo, RosterPlayer } from "./client";
import type { SeasonPlayerLine, SeasonRecord } from "./archive";

function norm(s: string): string {
  return s.replace(/['’.]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Everything archived STRICTLY BEFORE the season being played, oldest first. The current
 * season is checkpointed continuously into the same store, so including it would feed the
 * model this week's own results back as "history". */
export function priorSeasons(archive: SeasonRecord[], currentYear: number | null): SeasonRecord[] {
  return archive
    .filter((s) => currentYear == null || s.year < currentYear)
    .slice()
    .sort((a, b) => a.year - b.year);
}

// ── The season ledger ───────────────────────────────────────────────────────────

const RESULT_LABEL: Record<NonNullable<SeasonRecord["result"]>, string> = {
  "national-champ": "WON THE NATIONAL TITLE",
  "made-postseason": "reached the postseason",
  regular: "no postseason",
};

export function seasonLine(s: SeasonRecord): string {
  const bits = [`${s.year}: ${s.wins}-${s.losses}`];
  if (s.confWins != null) bits.push(`(${s.confWins}-${s.confLosses ?? 0} conf)`);
  bits.push(s.finalRankMedia && s.finalRankMedia <= 25 ? `finished #${s.finalRankMedia}` : "finished unranked");
  if (s.result) bits.push(RESULT_LABEL[s.result]);
  if (s.champion && s.champion !== s.team) bits.push(`national champion: ${s.champion}`);
  return bits.join(" · ");
}

/** The shape of the run, stated once so the model doesn't have to derive it (and get it
 * wrong) from a list of records. */
export function programArc(prior: SeasonRecord[], current: { wins: number; losses: number } | null): string | null {
  if (!prior.length) return null;
  const last = prior[prior.length - 1];
  const bits: string[] = [];
  let winning = 0;
  for (let i = prior.length - 1; i >= 0; i--) {
    if (prior[i].wins > prior[i].losses) winning++;
    else break;
  }
  if (winning >= 2) bits.push(`${winning} straight winning seasons before this one`);
  const titles = prior.filter((s) => s.result === "national-champ").map((s) => s.year);
  if (titles.length) bits.push(`national title${titles.length > 1 ? "s" : ""} in ${titles.join(", ")}`);
  if (current) {
    const better = current.wins > last.wins;
    const worse = current.wins + current.losses >= last.wins + last.losses && current.wins < last.wins;
    if (better) bits.push(`already past last year's ${last.wins}-${last.losses} win total`);
    else if (worse) bits.push(`behind last year's ${last.wins}-${last.losses} pace`);
  }
  return bits.length ? bits.join("; ") : null;
}

// ── History with this week's opponent ───────────────────────────────────────────

export interface Meeting {
  year: number;
  week: number | null;
  us: number;
  them: number;
  won: boolean;
}

export interface OpponentHistory {
  opponent: string;
  meetings: Meeting[];
  wins: number;
  losses: number;
  /** Repeat matchups are how a rivalry is detectable — the save doesn't flag them. */
  rivalry: boolean;
  lastMeeting: Meeting | null;
  /** Lost the last one. The single fact a revenge-game lede is allowed to rest on. */
  revenge: boolean;
}

export function opponentHistory(
  prior: SeasonRecord[],
  opponent: string | null
): OpponentHistory | null {
  if (!opponent) return null;
  const key = norm(opponent);
  const meetings: Meeting[] = [];
  for (const s of prior) {
    for (const g of s.games) {
      if (norm(g.opponent) !== key) continue;
      meetings.push({ year: s.year, week: g.week, us: g.us, them: g.them, won: g.won });
    }
  }
  if (!meetings.length) return null;
  meetings.sort((a, b) => a.year - b.year || (a.week ?? 0) - (b.week ?? 0));
  const last = meetings[meetings.length - 1];
  return {
    opponent,
    meetings,
    wins: meetings.filter((m) => m.won).length,
    losses: meetings.filter((m) => !m.won).length,
    rivalry: meetings.length >= 2,
    lastMeeting: last,
    revenge: !last.won,
  };
}

// ── Returning players ───────────────────────────────────────────────────────────

export interface ReturningPlayer {
  name: string;
  position: string | null;
  /** The most recent archived season this player has a line for. */
  year: number;
  line: string;
}

/** Rough production weight, only ever used to decide who is worth the tokens. */
function weight(l: SeasonPlayerLine): number {
  return (
    l.passYds + l.rushYds + l.recYds + l.tackles * 12 + l.sacks * 60 + l.ints * 60 + l.fgMade * 25
  );
}

/**
 * Players on the CURRENT roster who also appear in an archived season, with what they did
 * then. This is the growth arc — "2,600 yards as a sophomore, and now he's the reason the
 * program is ranked" — and it is the half of memory the save cannot supply on its own once
 * a player's prior-year rows roll over.
 */
export function returningPlayers(
  prior: SeasonRecord[],
  roster: RosterPlayer[],
  limit = 8
): ReturningPlayer[] {
  const onRoster = new Map(roster.map((p) => [norm(p.name), p]));
  const best = new Map<string, { rec: SeasonRecord; line: SeasonPlayerLine }>();
  for (const s of prior) {
    for (const l of s.roster) {
      const key = norm(l.name);
      if (!onRoster.has(key)) continue;
      if (!l.summary) continue;
      const held = best.get(key);
      // Most recent season wins; that is the comparison a writer actually makes.
      if (!held || s.year > held.rec.year) best.set(key, { rec: s, line: l });
    }
  }
  return [...best.values()]
    .sort((a, b) => weight(b.line) - weight(a.line))
    .slice(0, limit)
    .map(({ rec, line }) => ({
      name: line.name,
      position: line.position ?? onRoster.get(norm(line.name))?.position ?? null,
      year: rec.year,
      line: line.summary,
    }));
}

// ── The coach's résumé ──────────────────────────────────────────────────────────
// Everyone in this universe should know who they are talking to. A beat writer who has
// covered a two-time national champion writes a different sentence than one covering a
// first-year hire, and until this block existed the media had NO idea which it was — the
// context named the coach and stopped there, so tenure, titles and career record were left
// to the model, which is to say invented.
//
// All of it is real: `Coach.CareerStats` -> `CareerCoachStats` in the save.

/** The save's status enum, in words a writer uses. */
const SEAT_LABEL: Record<string, string> = {
  safe: "SAFE — nobody in the building is questioning the job",
  safefornow: "SAFE FOR NOW — no heat yet, but the leash is not unlimited",
  low: "SHAKY — the seat is warming and people have noticed",
  hotseat: "ON THE HOT SEAT — the job is genuinely in danger",
};

/**
 * The coach's standing, stated only when the save actually knows it.
 *
 * The old parse read `SeasonStartJobSecurityStatus`, which is stale and reads the sentinel
 * "Invalid" for part of the league — so a 14-0 coach with 100% security arrived at the
 * generators as "unknown", and unknown is where hot-seat drama gets invented. Now it is
 * either a real status or nothing at all.
 */
export function jobSecurityLine(coach: CoachInfo | null | undefined): string {
  const raw = coach?.jobSecurity?.trim().toLowerCase() ?? "";
  const pct = coach?.jobSecurityPct;
  const label = SEAT_LABEL[raw.replace(/[\s_-]/g, "")] ?? null;
  if (label) return `${label}${typeof pct === "number" ? ` (${pct}% job security)` : ""}`;
  if (typeof pct === "number") {
    return pct >= 75
      ? `SAFE (${pct}% job security)`
      : pct >= 50
        ? `SAFE FOR NOW (${pct}% job security)`
        : pct >= 25
          ? `SHAKY (${pct}% job security)`
          : `ON THE HOT SEAT (${pct}% job security)`;
  }
  // Deliberately not "unknown": the save simply hasn't told us, and inviting the model to
  // fill that in is the whole bug.
  return "NOT STATED IN THE SAVE — do NOT speculate about his job being in danger, and do not write hot-seat coverage";
}

/** How a writer would say it: "in his fourth year at the school", "in his first season". */
function ordinalYear(n: number): string {
  const words = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
  return words[n] ?? `${n}th`;
}

export function coachResumeBlock(coach: CoachInfo | null | undefined, school: string): string | null {
  if (!coach) return null;
  const c = coach.career ?? null;
  const name = coach.coachName?.trim() || null;
  // Nothing but a name is not a résumé, and a header with no facts under it is an invitation
  // to fill one in.
  if (!c && coach.seasonsWithTeam == null && coach.yearsCoaching == null) return null;

  const lines: string[] = [];

  // Tenure. SeasonsWithTeam counts COMPLETED seasons, so 0 means "this is year one here" —
  // which is a fact, not a gap, and the difference matters to every question about it.
  const atSchool = coach.seasonsWithTeam;
  if (atSchool != null) {
    lines.push(
      atSchool <= 0
        ? `This is his FIRST season at ${school}. He did not build this program and has no history here — nobody can reminisce with him about a previous year at this school.`
        : `He is in his ${ordinalYear(atSchool + 1)} season at ${school} (${atSchool} completed).`
    );
  }
  if (coach.yearsCoaching != null && coach.yearsCoaching > 0) {
    lines.push(`Seasons as a coach anywhere: ${coach.yearsCoaching}.`);
  }

  if (c) {
    const rec = (w: number | null, l: number | null) => `${w ?? 0}-${l ?? 0}`;
    lines.push(`CAREER RECORD (everywhere he has coached): ${rec(c.wins, c.losses)}.`);
    // Kept separate on purpose: a coach hired away from another school has a career record
    // that says nothing about what he has done HERE, and conflating them is the easiest
    // wrong sentence in the whole feature.
    lines.push(`RECORD AT ${school.toUpperCase()}: ${rec(c.winsAtSchool, c.lossesAtSchool)}.`);

    const titles = c.natTitles ?? 0;
    lines.push(
      titles > 0
        ? `NATIONAL TITLES: ${titles}. He is a ${titles === 1 ? "national champion" : `${titles}-time national champion`}` +
          (c.recentTitleYear != null && c.recentTitleYear > 0 ? `, most recently in ${c.recentTitleYear}` : "") +
          ". Treat that as established fact the whole sport knows."
        : "NATIONAL TITLES: NONE. He has never won one — never call him a champion, a title-winner, or reference a ring he does not have."
    );
    if (c.natTitleLosses) lines.push(`He has LOST the national title game ${c.natTitleLosses} time(s).`);

    const conf = c.confTitles ?? 0;
    lines.push(
      conf > 0
        ? `CONFERENCE TITLES: ${conf}${c.confTitleLosses ? ` (lost ${c.confTitleLosses} title game(s))` : ""}.`
        : "CONFERENCE TITLES: none yet."
    );
    if ((c.playoffWins ?? 0) || (c.playoffLosses ?? 0)) {
      lines.push(`Playoff record: ${rec(c.playoffWins, c.playoffLosses)}.`);
    }
    if ((c.bowlWins ?? 0) || (c.bowlLosses ?? 0)) {
      lines.push(`Bowl record: ${rec(c.bowlWins, c.bowlLosses)}.`);
    }
    if ((c.top25Wins ?? 0) || (c.top25Losses ?? 0)) {
      lines.push(`Against ranked teams: ${rec(c.top25Wins, c.top25Losses)}.`);
    }
    if ((c.rivalWins ?? 0) || (c.rivalLosses ?? 0)) {
      lines.push(`In rivalry games: ${rec(c.rivalWins, c.rivalLosses)}.`);
    }
    if (c.timesFired) lines.push(`He has been FIRED ${c.timesFired} time(s) in his career.`);
    if (c.top5Classes) lines.push(`Top-5 recruiting classes signed: ${c.top5Classes}.`);
    if (c.firstRoundPicks || c.draftPicks) {
      lines.push(`Players he has sent to the draft: ${c.draftPicks ?? 0} (${c.firstRoundPicks ?? 0} first-round).`);
    }
  }

  // The room absolutely knows whether the man at the podium is safe, and asks accordingly.
  lines.push(`JOB SECURITY: ${jobSecurityLine(coach)}.`);
  if (coach.prestige) {
    lines.push(`The sport's read on him: prestige grade ${coach.prestige}${coach.prestigeScore != null ? ` (${coach.prestigeScore})` : ""}.`);
  }
  if (coach.contractYearsRemaining != null && coach.contractYearsRemaining > 0) {
    lines.push(
      `Contract: ${coach.contractYearsRemaining} year(s) remaining` +
        (coach.contractExpectation ? `, and the job expectation on him is "${coach.contractExpectation}"` : "") +
        "."
    );
  }
  if (coach.almaMater) lines.push(`Alma mater: ${coach.almaMater}.`);
  if (coach.homeState) lines.push(`He is from ${coach.homeState}.`);

  if (!lines.length) return null;

  return [
    `=== ${name ?? "THE HEAD COACH"}'S RÉSUMÉ (from the save — every number below is real) ===`,
    "  Everyone covering this program knows these facts and writes as if they do. NEVER invent",
    "  a title, a career record, a tenure length, or a past job for him, and never contradict a",
    "  number here. If something about his past is not listed, it is UNKNOWN — write around it.",
    ...lines.map((l) => `  ${l}`),
  ].join("\n");
}

// ── The block ───────────────────────────────────────────────────────────────────

export interface HistoryInput {
  archive: SeasonRecord[];
  currentYear: number | null;
  /** This week's opponent, for the series history. */
  opponent?: string | null;
  roster?: RosterPlayer[];
  /** The current season's record so far, for the arc line. */
  current?: { wins: number; losses: number } | null;
  maxReturning?: number;
  maxStorylines?: number;
}

/**
 * The PRIOR SEASONS block. Null in year one — a program with no archived season has no
 * history, and an empty header would invite the model to fill it in.
 */
export function priorSeasonsBlock(input: HistoryInput): string | null {
  const prior = priorSeasons(input.archive, input.currentYear);
  // NO ARCHIVE IS NOT NO INSTRUCTION. This used to return null, on the theory that an empty
  // header invites the model to fill it in — but saying NOTHING about the past was worse.
  // Reported from a real save: with no archived seasons the media asserted the program had
  // missed the playoff last year, and when the coach corrected it in his own words the piece
  // treated him as the one making things up. Silence is where invention lives; this states
  // the ignorance out loud, and tells it who to believe.
  if (!prior.length) {
    return [
      "=== PRIOR SEASONS: NO RECORD ===",
      "  This app has NOT seen any season before the current one, so the program's past is",
      "  genuinely UNKNOWN to you. That is not the same as the program having no past.",
      "  - NEVER state what happened in a previous season: no past record, no bowl, no playoff",
      "    appearance or absence, no 'first time since', no 'second straight year', no droughts,",
      "    no streaks, and no claim that something has or has not happened before.",
      "  - Write about THIS season only. A piece that needs history simply does not mention it.",
      "  - IF THE COACH OR ANYONE ELSE REFERS TO A PAST SEASON, THEY ARE RIGHT AND YOU DEFER.",
      "    They lived it and you have no record to check it against. Never contradict them,",
      "    never imply they are misremembering, and never treat their account as a claim to be",
      "    corrected — take it as fact and write around it.",
    ].join("\n");
  }

  const parts: string[] = [
    "=== PRIOR SEASONS (archived — this is the program's REAL history) ===",
    "  Every line below is a fixed, recorded fact. NEVER invent a past record, score, ranking,",
    "  award or stat line, and never date the past to a real-world season. Anything about a",
    "  previous year that is NOT listed here is UNKNOWN — write around it rather than filling",
    "  it in. Callbacks, comparisons and 'second straight year' framing are encouraged, as long",
    "  as they rest on these numbers.",
    "",
    "  SEASON BY SEASON",
    ...prior.map((s) => `    ${seasonLine(s)}`),
  ];

  const arc = programArc(prior, input.current ?? null);
  if (arc) parts.push(`    ARC: ${arc}`);

  const hist = opponentHistory(prior, input.opponent ?? null);
  if (hist) {
    parts.push("", `  HISTORY WITH ${hist.opponent.toUpperCase()} (this week's opponent)`);
    for (const m of hist.meetings) {
      parts.push(
        `    ${m.year}${m.week != null ? ` (Week ${m.week})` : ""}: ` +
          `${m.won ? "WON" : "LOST"} ${m.us}-${m.them}`
      );
    }
    parts.push(`    Series in these archived years: ${hist.wins}-${hist.losses}.`);
    if (hist.rivalry) {
      parts.push(
        `    They have met ${hist.meetings.length} times in the archive — treat this as a` +
          " recurring, familiar matchup with history, not a first meeting."
      );
    }
    if (hist.revenge && hist.lastMeeting) {
      parts.push(
        `    REVENGE ANGLE IS EARNED: ${hist.opponent} won the last meeting ` +
          `${hist.lastMeeting.them}-${hist.lastMeeting.us} in ${hist.lastMeeting.year}.`
      );
    } else if (hist.lastMeeting) {
      parts.push(
        `    NOTE: the program WON the last meeting (${hist.lastMeeting.us}-${hist.lastMeeting.them}, ` +
          `${hist.lastMeeting.year}) — do NOT write this as a revenge game.`
      );
    }
  }

  const returning = returningPlayers(prior, input.roster ?? [], input.maxReturning ?? 8);
  if (returning.length) {
    parts.push("", "  RETURNING PLAYERS — what they did in a PREVIOUS season (not this one)");
    for (const r of returning) {
      parts.push(`    ${r.position ? `${r.position} ` : ""}${r.name} — ${r.year}: ${r.line}`);
    }
  }

  const storylines = prior
    .flatMap((s) => s.ledger.map((e) => ({ ...e, year: s.year })))
    .slice(-(input.maxStorylines ?? 6));
  if (storylines.length) {
    parts.push("", "  CARRIED STORYLINES — decisions this coach already made, and how they landed");
    for (const e of storylines) {
      parts.push(`    ${e.year} Week ${e.week} — ${e.headline}: ${e.decision} → ${e.outcome}`);
    }
  }

  return parts.join("\n");
}
