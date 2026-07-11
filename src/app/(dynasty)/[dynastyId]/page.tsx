"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { SectionHeader } from "@/components/ui/section-header";
import { FrontPageSkeleton } from "@/components/ui/front-page-skeleton";
import { ScoreCard } from "@/components/ui/score-card";
import { StatStrip } from "@/components/ui/stat-strip";
import { LeadStory } from "@/components/front-page/lead-story";
import type { RecapContent } from "@/components/front-page/types";
import { useDynasty } from "@/components/dynasty/dynasty-context";
import type { GameResult, TeamInfo } from "@/lib/dynasty/client";

// Resolve the score/opponent view of this week's game from the user team's perspective.
function readUserResult(game: GameResult, userTeam: string) {
  const userIsHome = game.home === userTeam;
  const userScore = userIsHome ? game.homeScore : game.awayScore;
  const oppScore = userIsHome ? game.awayScore : game.homeScore;
  const opponent = userIsHome ? game.away : game.home;
  const opponentRank = userIsHome ? game.rankAway : game.rankHome;
  const result: "W" | "L" =
    (userScore ?? 0) >= (oppScore ?? 0) ? "W" : "L";
  return {
    userIsHome,
    userScore: userScore ?? 0,
    oppScore: oppScore ?? 0,
    opponent,
    opponentRank,
    result,
    week: game.week,
  };
}

function buildStatStrip(
  view: ReturnType<typeof readUserResult>,
  userTeam: TeamInfo | null
): Array<{ label: string; value: string | number }> {
  const margin = Math.abs(view.userScore - view.oppScore);
  const stats: Array<{ label: string; value: string | number }> = [
    { label: "Result", value: view.result },
    { label: "Score", value: `${view.userScore}-${view.oppScore}` },
    { label: "Margin", value: margin },
    { label: "Week", value: view.week ?? "—" },
  ];
  if (userTeam) {
    stats.push({ label: "Record", value: `${userTeam.wins}-${userTeam.losses}` });
  }
  return stats;
}

export default function FrontPage() {
  const { snapshot, delta, generate, settings, loading, error } = useDynasty();

  const [recap, setRecap] = useState<RecapContent | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  const userTeam = snapshot?.userTeam ?? null;
  const userTeamName = userTeam?.name ?? settings.userTeam ?? "Your Program";
  const userResult = delta?.userResult ?? null;

  async function handleGenerate() {
    setGenerating(true);
    setGenError(null);
    try {
      const result = await generate<RecapContent>("recap-lead", {});
      setRecap(result);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  // Loading: reading the save for the first time.
  if (loading && !snapshot) {
    return (
      <div>
        <SectionHeader
          title="FRONT PAGE"
          subtitle="The day's top stories from your dynasty"
        />
        <FrontPageSkeleton />
      </div>
    );
  }

  // Error reading the save — degrade gracefully, keep the masthead.
  if (error && !snapshot) {
    return (
      <div>
        <SectionHeader
          title="FRONT PAGE"
          subtitle="The day's top stories from your dynasty"
        />
        <div className="mt-8 rounded border border-dw-red bg-paper2 px-6 py-10 text-center">
          <p className="font-serif text-ink2">
            The Wire couldn&apos;t read your latest save.
          </p>
          <p className="mt-2 font-sans text-xs uppercase tracking-wide text-dw-red">
            {error}
          </p>
        </div>
      </div>
    );
  }

  const view = userResult ? readUserResult(userResult, userTeamName) : null;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <SectionHeader
          title="FRONT PAGE"
          subtitle="The day's top stories from your dynasty"
        />
        {view && (
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating}
            className={cn(
              "rounded bg-dw-accent px-6 py-2",
              "font-sans text-xs font-semibold uppercase tracking-wider text-white",
              "transition-colors hover:bg-dw-accent2 disabled:opacity-50"
            )}
          >
            {generating
              ? "Filing…"
              : recap
                ? "Regenerate Recap"
                : "Generate Recap"}
          </button>
        )}
      </div>

      {genError && (
        <div className="rounded-sm border border-dw-red bg-paper2 px-4 py-3">
          <p className="font-sans text-sm text-dw-red">{genError}</p>
        </div>
      )}

      {view ? (
        <>
          <div className="space-y-0">
            {/* Emotional result stripe — green for W, crimson for L */}
            <div
              className={cn(
                "h-0.5 w-full rounded-t",
                view.result === "W" ? "bg-dw-green" : "bg-dw-accent"
              )}
            />
            <ScoreCard
              homeTeam={view.userIsHome ? userTeamName : view.opponent}
              awayTeam={view.userIsHome ? view.opponent : userTeamName}
              homeScore={view.userIsHome ? view.userScore : view.oppScore}
              awayScore={view.userIsHome ? view.oppScore : view.userScore}
              homeRank={
                view.userIsHome ? undefined : view.opponentRank ?? undefined
              }
              awayRank={
                view.userIsHome ? view.opponentRank ?? undefined : undefined
              }
              week={`Week ${view.week ?? "—"}`}
              result={view.result}
            />
          </div>

          <StatStrip stats={buildStatStrip(view, userTeam)} />

          {generating && !recap ? (
            <LeadStory recap={null} />
          ) : recap ? (
            <LeadStory recap={recap} />
          ) : (
            <div className="rounded border border-dw-border bg-paper2 px-6 py-10 text-center">
              <p className="font-serif text-ink2">
                {userTeamName} {view.result === "W" ? "took down" : "fell to"}{" "}
                {view.opponent}, {view.userScore}-{view.oppScore}. The lead story
                is waiting to be written.
              </p>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={generating}
                className={cn(
                  "mt-4 rounded bg-dw-accent px-8 py-3",
                  "font-sans text-sm font-semibold uppercase tracking-wider text-white",
                  "transition-colors hover:bg-dw-accent2 disabled:opacity-50"
                )}
              >
                {generating ? "Filing…" : "Generate the Recap"}
              </button>
            </div>
          )}
        </>
      ) : (
        // No new game to cover yet — degrade gracefully with what the save shows.
        <div className="mt-4 rounded border border-dw-border bg-paper2 px-6 py-12 text-center">
          {userTeam ? (
            <>
              <p className="font-headline text-2xl text-ink">
                {userTeam.name}
              </p>
              <p className="mt-1 font-serif text-ink2">
                {userTeam.wins}-{userTeam.losses}
                {userTeam.rankMedia && userTeam.rankMedia <= 25
                  ? ` · AP #${userTeam.rankMedia}`
                  : ""}
              </p>
              <p className="mt-4 font-serif text-sm text-ink3">
                No new game to cover yet. Play your next week, then re-open the
                Wire to file the front page.
              </p>
            </>
          ) : (
            <p className="font-serif text-ink3">
              Reading from your save… once a game is played, the front page fills
              in here.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
