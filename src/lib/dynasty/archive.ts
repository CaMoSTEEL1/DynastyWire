// Season Archive — DynastyWire's durable, multi-year memory. The CFB save reliably keeps
// only the CURRENT season's full picture (departed players vanish, prior-year game rows get
// overwritten), so we snapshot a compact record of each season we see. This one store powers
// three things: the Trophy Room stats export (this file / Phase A), year-over-year media
// memory (Phase B), and rivalry history (Phase B/C).
//
// Writes are a continuous UPSERT keyed by year — every ingest refreshes the current season's
// record in place, so by the time a new season starts, last year's final record is already
// saved. Pure helpers + a LazyStore; no React.

import { LazyStore } from "@tauri-apps/plugin-store";
import type { DynastySnapshot, RosterPlayer, RosterStats } from "./client";
import type { LedgerEntry } from "./saga";

const store = new LazyStore("dynastywire.archive.json");

export interface SeasonPlayerLine {
  name: string;
  position: string | null;
  classYear: string | null;
  overall: number | null;
  // Broken-out numbers for a clean spreadsheet export (0 when N/A).
  gamesPlayed: number;
  gamesStarted: number;
  passYds: number; passTDs: number; passInts: number;
  rushYds: number; rushTDs: number;
  recYds: number; recTDs: number; recCatches: number;
  tackles: number; tfl: number; sacks: number; ints: number;
  fgMade: number; fgAtt: number;
  /** A short human summary for UI display. */
  summary: string;
}

export interface SeasonGame {
  week: number | null;
  opponent: string;
  us: number;
  them: number;
  won: boolean;
  /** Set in a later phase once cross-season history is available. */
  rivalry?: boolean;
}

export interface SeasonLeader {
  category: string;
  player: string;
  position: string | null;
  stat: string;
}

export interface SeasonRecord {
  dynastyId: string;
  year: number;
  team: string;
  coachName: string | null;
  wins: number;
  losses: number;
  confWins: number | null;
  confLosses: number | null;
  finalRankMedia: number | null;
  finalRankCFP: number | null;
  prestige: number | null;
  /** Best-effort season outcome from the schedule/calendar. */
  result: "national-champ" | "made-postseason" | "regular" | null;
  /** Who won the national title that year (winner of the last postseason game), if known. */
  champion: string | null;
  leaders: SeasonLeader[];
  roster: SeasonPlayerLine[];
  games: SeasonGame[];
  ledger: { headline: string; decision: string; outcome: string; week: number }[];
  archivedAt: number;
}

interface ArchiveStore {
  [dynastyId: string]: SeasonRecord[];
}

const num = (v: number | null | undefined): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

// Flatten a player's season stats into numeric columns, tolerant of the offense/defense/
// kicking sub-objects OR the flattened top-level fields the parser sometimes uses.
function statCols(s: RosterStats | null | undefined) {
  const o = s?.offense ?? s ?? null;
  const d = s?.defense ?? s ?? null;
  // fg* live only on the kicking side-object, never at the RosterStats top level.
  const k = s?.kicking ?? null;
  return {
    gamesPlayed: num(s?.gamesPlayed),
    gamesStarted: num(s?.gamesStarted),
    passYds: num(o?.passYds), passTDs: num(o?.passTDs), passInts: num(o?.passInts),
    rushYds: num(o?.rushYds), rushTDs: num(o?.rushTDs),
    recYds: num(o?.recYds), recTDs: num(o?.recTDs), recCatches: num(o?.recCatches),
    tackles: num(d?.tackles), tfl: num(d?.tfl), sacks: num(d?.sacks), ints: num(d?.ints),
    fgMade: num(k?.fgMade), fgAtt: num(k?.fgAtt),
  };
}

// A compact human-readable line for the UI (mirrors the media-context style, briefer).
function summarize(c: ReturnType<typeof statCols>): string {
  const bits: string[] = [];
  if (c.passYds || c.passTDs) bits.push(`${c.passYds} pass yds, ${c.passTDs} TD${c.passInts ? `, ${c.passInts} INT` : ""}`);
  if (c.rushYds || c.rushTDs) bits.push(`${c.rushYds} rush yds, ${c.rushTDs} TD`);
  if (c.recYds || c.recTDs) bits.push(`${c.recCatches} rec, ${c.recYds} yds, ${c.recTDs} TD`);
  if (c.tackles || c.sacks || c.ints) bits.push(`${c.tackles} tkl${c.sacks ? `, ${c.sacks} sk` : ""}${c.ints ? `, ${c.ints} INT` : ""}`);
  if (c.fgAtt) bits.push(`${c.fgMade}/${c.fgAtt} FG`);
  return bits.join("; ");
}

function playerLine(p: RosterPlayer): SeasonPlayerLine {
  const c = statCols(p.stats);
  return {
    name: p.name,
    position: p.position ?? null,
    classYear: p.year ?? null,
    overall: p.overall ?? null,
    ...c,
    summary: summarize(c),
  };
}

// Statistical leaders for the season, from the archived roster lines.
function computeLeaders(lines: SeasonPlayerLine[]): SeasonLeader[] {
  const top = (
    category: string,
    pick: (l: SeasonPlayerLine) => number,
    fmt: (l: SeasonPlayerLine) => string
  ): SeasonLeader | null => {
    let best: SeasonPlayerLine | null = null;
    for (const l of lines) if (pick(l) > 0 && (!best || pick(l) > pick(best))) best = l;
    return best ? { category, player: best.name, position: best.position, stat: fmt(best) } : null;
  };
  return [
    top("Passing", (l) => l.passYds, (l) => `${l.passYds} yds, ${l.passTDs} TD`),
    top("Rushing", (l) => l.rushYds, (l) => `${l.rushYds} yds, ${l.rushTDs} TD`),
    top("Receiving", (l) => l.recYds, (l) => `${l.recCatches} rec, ${l.recYds} yds, ${l.recTDs} TD`),
    top("Tackles", (l) => l.tackles, (l) => `${l.tackles} tackles`),
    top("Sacks", (l) => l.sacks, (l) => `${l.sacks} sacks`),
    top("Interceptions", (l) => l.ints, (l) => `${l.ints} INT`),
  ].filter((x): x is SeasonLeader => x != null);
}

/**
 * Build the current season's record from the live snapshot + roster + saga ledger.
 * Returns null until the season has actually started (no games played yet, nothing to keep).
 */
export function buildSeasonRecord(
  snapshot: DynastySnapshot,
  roster: RosterPlayer[],
  ledger: LedgerEntry[],
  dynastyId: string
): SeasonRecord | null {
  const u = snapshot.userTeam;
  const year = snapshot.year ?? snapshot.dynastyYear ?? null;
  if (!u || year == null) return null;
  const gamesPlayed = (u.wins ?? 0) + (u.losses ?? 0);
  if (gamesPlayed === 0) return null; // nothing to archive yet

  const lines = roster.map(playerLine);

  // User's games this year, with opponent names resolved through the teams map.
  const row = snapshot.userTeamRow;
  const teams = snapshot.teams ?? {};
  const games: SeasonGame[] = (snapshot.games ?? [])
    .filter((g) => g.played && (g.year == null || g.year === year) && (g.homeRow === row || g.awayRow === row))
    .map((g) => {
      const userIsHome = g.homeRow === row;
      const oppRow = userIsHome ? g.awayRow : g.homeRow;
      const opp = oppRow != null ? teams[String(oppRow)]?.name ?? "Unknown" : "Unknown";
      const us = num(userIsHome ? g.homeScore : g.awayScore);
      const them = num(userIsHome ? g.awayScore : g.homeScore);
      return { week: g.week, opponent: opp, us, them, won: us > them };
    })
    .sort((a, b) => (a.week ?? 0) - (b.week ?? 0));

  // National champion (best-effort): winner of the highest-week played game leaguewide.
  const champion = (() => {
    const played = (snapshot.games ?? []).filter((g) => g.played && (g.year == null || g.year === year) && g.week != null);
    if (!played.length) return null;
    const last = played.reduce((a, b) => ((b.week ?? 0) > (a.week ?? 0) ? b : a));
    const winnerRow = num(last.homeScore) >= num(last.awayScore) ? last.homeRow : last.awayRow;
    return winnerRow != null ? teams[String(winnerRow)]?.name ?? null : null;
  })();

  // Best-effort result: did the user reach/win the postseason?
  const regEnd = snapshot.calendar?.regularSeasonLastWeek ?? 15;
  const userPost = games.filter((g) => (g.week ?? 0) > regEnd);
  const result: SeasonRecord["result"] =
    champion != null && champion === u.name
      ? "national-champ"
      : userPost.length > 0
        ? "made-postseason"
        : "regular";

  return {
    dynastyId,
    year,
    team: u.name,
    coachName: snapshot.coachName ?? null,
    wins: u.wins ?? 0,
    losses: u.losses ?? 0,
    confWins: u.confWins ?? null,
    confLosses: u.confLosses ?? null,
    finalRankMedia: u.rankMedia ?? null,
    finalRankCFP: u.rankCFP ?? null,
    prestige: u.prestige ?? null,
    result,
    champion,
    leaders: computeLeaders(lines),
    roster: lines,
    games,
    ledger: ledger
      .filter((e) => e.year === year)
      .map((e) => ({ headline: e.headline, decision: e.decision, outcome: e.outcome, week: e.week })),
    archivedAt: Date.now(),
  };
}

export async function loadArchive(dynastyId: string): Promise<SeasonRecord[]> {
  const all = (await store.get<ArchiveStore>("dynasties")) ?? {};
  return (all[dynastyId] ?? []).slice().sort((a, b) => a.year - b.year);
}

/** Insert or replace the record for its year (idempotent continuous checkpoint). */
export async function upsertSeason(record: SeasonRecord): Promise<void> {
  const all = (await store.get<ArchiveStore>("dynasties")) ?? {};
  const list = all[record.dynastyId] ?? [];
  const i = list.findIndex((r) => r.year === record.year);
  if (i >= 0) list[i] = record;
  else list.push(record);
  all[record.dynastyId] = list;
  await store.set("dynasties", all);
  await store.save();
}

export async function clearArchive(dynastyId: string): Promise<void> {
  const all = (await store.get<ArchiveStore>("dynasties")) ?? {};
  delete all[dynastyId];
  await store.set("dynasties", all);
  await store.save();
}

// ── Export ────────────────────────────────────────────────────────────────────

const csvCell = (v: unknown): string => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** One row per (season, player) — the spreadsheet-friendly record of everyone's numbers. */
export function toStatsCsv(records: SeasonRecord[]): string {
  const header = [
    "Year", "Team", "Record", "Player", "Pos", "Class", "OVR",
    "GP", "GS", "PassYds", "PassTD", "INT", "RushYds", "RushTD",
    "Rec", "RecYds", "RecTD", "Tackles", "TFL", "Sacks", "DefINT", "FGM", "FGA",
  ];
  const rows: string[] = [header.map(csvCell).join(",")];
  for (const s of records) {
    const rec = `${s.wins}-${s.losses}`;
    for (const p of s.roster) {
      rows.push([
        s.year, s.team, rec, p.name, p.position ?? "", p.classYear ?? "", p.overall ?? "",
        p.gamesPlayed, p.gamesStarted, p.passYds, p.passTDs, p.passInts, p.rushYds, p.rushTDs,
        p.recCatches, p.recYds, p.recTDs, p.tackles, p.tfl, p.sacks, p.ints, p.fgMade, p.fgAtt,
      ].map(csvCell).join(","));
    }
  }
  return rows.join("\n");
}

/** Full archive as pretty JSON — seasons, rosters, games, leaders, and the ledger. */
export function toArchiveJson(records: SeasonRecord[]): string {
  return JSON.stringify(records, null, 2);
}

/**
 * Trigger a file download from the webview. WebView2 (the Windows runtime this ships on)
 * honors a programmatic anchor download of a blob URL, so no fs plugin / Rust command is
 * needed. Falls back silently if the environment blocks it.
 */
export function downloadTextFile(filename: string, mime: string, contents: string): void {
  try {
    const blob = new Blob([contents], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    /* download blocked — nothing else we can do without the fs plugin */
  }
}
