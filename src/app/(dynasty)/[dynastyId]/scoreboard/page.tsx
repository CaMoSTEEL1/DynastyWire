"use client";

// THE SLATE — the whole league's week at a glance, the thing CFB itself makes you dig for.
// Every game, every week, with ranked matchups and upsets called out, browsable back through
// the season. Pure save data: no API calls, no cost, nothing generated.

import { useMemo, useState } from "react";
import { useDynasty } from "@/components/dynasty/dynasty-context";
import { SectionHeader } from "@/components/ui/section-header";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TeamInfo } from "@/lib/dynasty/client";

interface SlateGame {
  homeRow: number | null;
  awayRow: number | null;
  home: TeamInfo | null;
  away: TeamInfo | null;
  homeScore: number;
  awayScore: number;
  played: boolean;
  userInvolved: boolean;
  /** Both teams ranked — the marquee window. */
  ranked: boolean;
  /** An unranked team beat a ranked one, or a much worse seed won. */
  upset: boolean;
  /** Sort weight: user first, then ranked, then upsets, then the rest. */
  weight: number;
}

function rankOf(t: TeamInfo | null): number | null {
  return t?.rankMedia && t.rankMedia <= 25 ? t.rankMedia : null;
}

export default function ScoreboardPage() {
  const { snapshot, loading, needsOnboarding, week: currentWeek } = useDynasty();
  const [viewWeek, setViewWeek] = useState<number | null>(null);

  // Memoized so the `?? {}` / `?? []` fallbacks don't mint a new object every render and
  // invalidate every memo below them.
  const teams = useMemo(() => snapshot?.teams ?? {}, [snapshot]);
  const games = useMemo(() => snapshot?.games ?? [], [snapshot]);
  const userRow = snapshot?.userTeamRow ?? null;

  // Only the current season's rows — the save keeps prior years too.
  const maxYear = useMemo(
    () => games.reduce((m, g) => (g.year != null && g.year > m ? g.year : m), -1),
    [games]
  );

  // Weeks that actually have games, so the pager skips empty ones.
  const weeks = useMemo(() => {
    const s = new Set<number>();
    for (const g of games) {
      if (maxYear >= 0 && g.year != null && g.year !== maxYear) continue;
      if (g.week != null) s.add(g.week);
    }
    return [...s].sort((a, b) => a - b);
  }, [games, maxYear]);

  const activeWeek = viewWeek ?? (weeks.includes(currentWeek) ? currentWeek : weeks[weeks.length - 1] ?? 0);

  const slate: SlateGame[] = useMemo(() => {
    const out: SlateGame[] = [];
    for (const g of games) {
      if (maxYear >= 0 && g.year != null && g.year !== maxYear) continue;
      if (g.week !== activeWeek) continue;
      const home = g.homeRow != null ? teams[String(g.homeRow)] ?? null : null;
      const away = g.awayRow != null ? teams[String(g.awayRow)] ?? null : null;
      if (!home || !away) continue;
      const hr = rankOf(home);
      const ar = rankOf(away);
      const homeScore = g.homeScore ?? 0;
      const awayScore = g.awayScore ?? 0;
      const played = !!g.played;
      const userInvolved = userRow != null && (g.homeRow === userRow || g.awayRow === userRow);
      const ranked = hr != null && ar != null;
      // Upset = the loser was ranked and the winner wasn't, or the winner was ranked
      // meaningfully lower (bigger number) than the loser.
      let upset = false;
      if (played && homeScore !== awayScore) {
        const homeWon = homeScore > awayScore;
        const winnerRank = homeWon ? hr : ar;
        const loserRank = homeWon ? ar : hr;
        if (loserRank != null && (winnerRank == null || winnerRank - loserRank >= 8)) upset = true;
      }
      out.push({
        homeRow: g.homeRow, awayRow: g.awayRow, home, away,
        homeScore, awayScore, played, userInvolved, ranked, upset,
        weight: (userInvolved ? 1000 : 0) + (ranked ? 500 : 0) + (upset ? 250 : 0) +
          (hr != null ? 100 - hr : 0) + (ar != null ? 100 - ar : 0),
      });
    }
    return out.sort((a, b) => b.weight - a.weight);
  }, [games, teams, activeWeek, maxYear, userRow]);

  const idx = weeks.indexOf(activeWeek);
  const canPrev = idx > 0;
  const canNext = idx >= 0 && idx < weeks.length - 1;

  if (needsOnboarding) {
    return (
      <div>
        <SectionHeader title="THE SLATE" subtitle="The whole league, week by week" variant="rankings" />
        <div className="mt-6 rounded border border-dw-border bg-paper2 px-6 py-12 text-center font-serif text-ink2">
          Point Dynasty Wire at your save to see the league&apos;s slate.
        </div>
      </div>
    );
  }

  const played = slate.filter((g) => g.played);
  const upcoming = slate.filter((g) => !g.played);

  const Row = ({ g }: { g: SlateGame }) => {
    const hr = rankOf(g.home);
    const ar = rankOf(g.away);
    const homeWon = g.played && g.homeScore > g.awayScore;
    const awayWon = g.played && g.awayScore > g.homeScore;
    const Side = ({ t, rank, score, won }: { t: TeamInfo | null; rank: number | null; score: number; won: boolean }) => (
      <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
        <span className={cn("min-w-0 truncate font-serif text-sm", won ? "text-ink" : "text-ink3")}>
          {rank != null && <span className="mr-1 font-sans text-[10px] text-dw-accent2">#{rank}</span>}
          {t?.name ?? "—"}
          <span className="ml-1.5 font-sans text-[10px] text-ink3">
            ({t?.wins ?? 0}-{t?.losses ?? 0})
          </span>
        </span>
        {g.played && (
          <span className={cn("shrink-0 font-headline text-base", won ? "text-ink" : "text-ink3")}>{score}</span>
        )}
      </div>
    );
    return (
      <div
        className={cn(
          "rounded border px-4 py-3",
          g.userInvolved ? "border-dw-accent2/50 bg-dw-accent2/5" : "border-dw-border bg-paper2"
        )}
      >
        <div className="mb-1.5 flex items-center gap-2">
          {g.userInvolved && (
            <span className="rounded border border-dw-accent2/60 px-1.5 py-0.5 font-sans text-[9px] uppercase tracking-wider text-dw-accent2">
              Your game
            </span>
          )}
          {g.ranked && (
            <span className="rounded border border-dw-yellow/50 px-1.5 py-0.5 font-sans text-[9px] uppercase tracking-wider text-dw-yellow">
              Ranked matchup
            </span>
          )}
          {g.upset && (
            <span className="rounded border border-dw-red/50 px-1.5 py-0.5 font-sans text-[9px] uppercase tracking-wider text-dw-red">
              Upset
            </span>
          )}
          {!g.played && (
            <span className="font-sans text-[9px] uppercase tracking-wider text-ink3">Not played</span>
          )}
        </div>
        <div className="space-y-1">
          <Side t={g.away} rank={ar} score={g.awayScore} won={awayWon} />
          <Side t={g.home} rank={hr} score={g.homeScore} won={homeWon} />
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <SectionHeader title="THE SLATE" subtitle="The whole league, week by week" variant="rankings" />

      {/* Week pager */}
      <div className="flex items-center justify-between rounded border border-dw-border bg-paper2 px-4 py-3">
        <button
          type="button"
          disabled={!canPrev}
          onClick={() => setViewWeek(weeks[idx - 1])}
          className="inline-flex items-center gap-1 font-sans text-[10px] uppercase tracking-wider text-ink3 hover:text-ink disabled:opacity-30"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> Prev
        </button>
        <div className="text-center">
          <p className="font-headline text-lg uppercase tracking-wide text-ink">Week {activeWeek}</p>
          <p className="font-sans text-[10px] uppercase tracking-wider text-ink3">
            {played.length} final{upcoming.length > 0 ? ` · ${upcoming.length} upcoming` : ""}
            {activeWeek === currentWeek ? " · current" : ""}
          </p>
        </div>
        <button
          type="button"
          disabled={!canNext}
          onClick={() => setViewWeek(weeks[idx + 1])}
          className="inline-flex items-center gap-1 font-sans text-[10px] uppercase tracking-wider text-ink3 hover:text-ink disabled:opacity-30"
        >
          Next <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>

      {loading && slate.length === 0 && (
        <p className="py-10 text-center font-serif italic text-ink3">Reading your save…</p>
      )}

      {!loading && slate.length === 0 && (
        <div className="rounded border border-dw-border bg-paper2 px-6 py-10 text-center font-serif text-ink2">
          No games on the board for Week {activeWeek}.
        </div>
      )}

      {played.length > 0 && (
        <div>
          <h3 className="mb-3 font-headline text-xs uppercase tracking-widest text-ink3">Finals</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {played.map((g, i) => <Row key={`f${i}`} g={g} />)}
          </div>
        </div>
      )}

      {upcoming.length > 0 && (
        <div>
          <h3 className="mb-3 font-headline text-xs uppercase tracking-widest text-ink3">Upcoming</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {upcoming.map((g, i) => <Row key={`u${i}`} g={g} />)}
          </div>
        </div>
      )}

      <p className="font-serif text-[11px] italic text-ink3">
        Read straight from your save — no AI, no credits. Your game, ranked matchups, and upsets
        float to the top.
      </p>
    </div>
  );
}
