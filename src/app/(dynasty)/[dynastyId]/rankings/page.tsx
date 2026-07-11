"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { SectionHeader } from "@/components/ui/section-header";
import { RankingsBox } from "@/components/ui/rankings-box";
import { useDynasty } from "@/components/dynasty/dynasty-context";
import type { RankingsTakeContent } from "@/components/front-page/types";

export default function RankingsPage() {
  const { snapshot, generate, settings, loading } = useDynasty();

  const [take, setTake] = useState<RankingsTakeContent | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  const userTeamName = snapshot?.userTeam?.name ?? settings.userTeam ?? null;

  // AP Top 25 from the parsed save: filter to ranked teams, sort ascending.
  const rankings = useMemo(() => {
    if (!snapshot?.teams) return [];
    return Object.values(snapshot.teams)
      .filter((t) => t.rankMedia != null && t.rankMedia >= 1 && t.rankMedia <= 25)
      .sort((a, b) => (a.rankMedia as number) - (b.rankMedia as number))
      .map((t) => ({
        rank: t.rankMedia as number,
        team: t.name,
        record: `${t.wins}-${t.losses}`,
        isUser: userTeamName != null && t.name === userTeamName,
      }));
  }, [snapshot, userTeamName]);

  async function handleGenerate() {
    setGenerating(true);
    setGenError(null);
    try {
      const result = await generate<RankingsTakeContent>("rankings", {});
      setTake(result);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  // Loading the save for the first time.
  if (loading && !snapshot) {
    return (
      <div>
        <SectionHeader
          title="RANKINGS"
          subtitle="Where you stand in the national conversation"
          variant="rankings"
        />
        <div className="mt-8 space-y-2">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="skeleton-pulse h-4 w-5 rounded-sm" />
              <div className="skeleton-pulse h-4 flex-1 rounded-sm" />
              <div className="skeleton-pulse h-3 w-10 rounded-sm" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // No poll data yet — degrade gracefully.
  if (rankings.length === 0) {
    return (
      <div>
        <SectionHeader
          title="RANKINGS"
          subtitle="Where you stand in the national conversation"
          variant="rankings"
        />
        <div className="mt-8 rounded border border-dw-border bg-paper2 px-6 py-12 text-center">
          <p className="font-serif text-ink2">
            The polls haven&apos;t dropped yet. Play a few games and see where the
            committee places you — and what the analysts think about it.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <SectionHeader
        title="RANKINGS"
        subtitle="Where you stand in the national conversation"
        variant="rankings"
      />

      <div className="mt-6 grid grid-cols-1 gap-8 md:grid-cols-3">
        {/* AP Top 25 board */}
        <div className="md:col-span-1">
          <RankingsBox
            rankings={rankings.map(({ rank, team, record }) => ({
              rank,
              team,
              record,
            }))}
          />
        </div>

        {/* Analyst take */}
        <div className="md:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-headline text-lg uppercase tracking-wider text-ink">
              The Committee Room
            </h3>
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
                ? "Breaking it down…"
                : take
                  ? "Regenerate Take"
                  : "Get the Analyst Take"}
            </button>
          </div>

          <div className="h-px w-full bg-dw-border" />

          {genError && (
            <div className="rounded-sm border border-dw-red bg-paper2 px-4 py-3">
              <p className="font-sans text-sm text-dw-red">{genError}</p>
            </div>
          )}

          {generating && !take ? (
            <div className="space-y-3">
              <div className="skeleton-pulse h-6 w-3/4 rounded-sm" />
              <div className="skeleton-pulse h-4 w-1/3 rounded-sm" />
              <div className="space-y-2">
                <div className="skeleton-pulse h-4 w-full rounded-sm" />
                <div className="skeleton-pulse h-4 w-11/12 rounded-sm" />
                <div className="skeleton-pulse h-4 w-4/5 rounded-sm" />
              </div>
            </div>
          ) : take ? (
            <article className="space-y-3">
              <h4 className="font-headline text-2xl font-bold leading-tight text-ink">
                {take.headline}
              </h4>
              {take.movement && (
                <p className="font-headline text-sm font-semibold uppercase tracking-wide text-dw-accent">
                  {take.movement}
                </p>
              )}
              {take.body && (
                <p className="font-serif text-base leading-relaxed text-ink2">
                  {take.body}
                </p>
              )}
            </article>
          ) : (
            <p className="font-serif text-ink3">
              The board is set. Get a studio analyst&apos;s read on the playoff
              picture and where{" "}
              {userTeamName ? userTeamName : "your program"} sits in it.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
