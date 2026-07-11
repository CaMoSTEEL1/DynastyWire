"use client";

import { useState } from "react";
import { SectionHeader } from "@/components/ui/section-header";
import { DynastyRetrospective } from "@/components/trophy/dynasty-retrospective";
import { useDynasty } from "@/components/dynasty/dynasty-context";
import type { DynastyRetrospective as DynastyRetrospectiveType } from "@/lib/trophy/types";

function StatBox({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded border border-dw-border bg-paper2 px-4 py-3 text-center">
      <p className="font-sans text-[10px] uppercase tracking-widest text-ink3">{label}</p>
      <p className="mt-1 font-headline text-2xl text-ink">{value}</p>
      {sub && <p className="mt-0.5 font-sans text-xs text-ink3">{sub}</p>}
    </div>
  );
}

export default function TrophyRoomPage() {
  const { snapshot, loading, error, generate } = useDynasty();

  const [retrospective, setRetrospective] = useState<DynastyRetrospectiveType | null>(null);
  const [generating, setGenerating] = useState(false);
  const [retroError, setRetroError] = useState<string | null>(null);

  const team = snapshot?.userTeam ?? null;
  const wins = team?.wins ?? 0;
  const losses = team?.losses ?? 0;
  const gamesPlayed = wins + losses;
  const winPct =
    gamesPlayed > 0 ? `${Math.round((wins / gamesPlayed) * 1000) / 10}%` : "—";

  const handleGenerate = async () => {
    setGenerating(true);
    setRetroError(null);
    try {
      const data = await generate<DynastyRetrospectiveType>("trophy", {});
      setRetrospective(data);
    } catch (e) {
      setRetroError(
        e instanceof Error ? e.message : "Failed to generate retrospective. Please try again."
      );
    } finally {
      setGenerating(false);
    }
  };

  // ── Loading ────────────────────────────────────────────────────────────
  if (loading && !snapshot) {
    return (
      <div>
        <SectionHeader title="TROPHY ROOM" subtitle="The legacy you're building" />
        <div className="mt-8 space-y-4">
          <div className="h-24 animate-pulse rounded border border-dw-border bg-paper2" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded border border-dw-border bg-paper2" />
            ))}
          </div>
          <div className="h-64 animate-pulse rounded border border-dw-border bg-paper2" />
        </div>
      </div>
    );
  }

  // ── Empty / no save ────────────────────────────────────────────────────
  if (!team) {
    return (
      <div>
        <SectionHeader title="TROPHY ROOM" subtitle="The legacy you're building" />
        <div className="mt-8 rounded border border-dw-border bg-paper2 px-6 py-12 text-center">
          <p className="font-headline text-xl text-ink">
            Every dynasty starts with a blank trophy case.
          </p>
          <div className="mx-auto mt-3 h-px w-16 bg-dw-accent" />
          <p className="mt-4 font-serif text-sm leading-relaxed text-ink2">
            {error
              ? `We couldn't read your save. ${error}`
              : "Play a week and DynastyWire will start building the story of your program — records, retrospectives, and the legacy you leave behind."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <SectionHeader title="TROPHY ROOM" subtitle="The legacy you're building" />

      {/* ── This Season (from the save) ─────────────────────────────────── */}
      <div>
        <h3 className="mb-3 font-headline text-xs uppercase tracking-widest text-ink3">
          {team.name} — This Season
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatBox label="Record" value={`${wins}-${losses}`} />
          <StatBox label="Win Rate" value={winPct} sub={`${gamesPlayed} played`} />
          <StatBox label="Media Rank" value={team.rankMedia ? `#${team.rankMedia}` : "NR"} />
          <StatBox
            label="Prestige"
            value={team.prestige != null ? `${team.prestige}/10` : "—"}
          />
        </div>
      </div>

      {/* ── Season Retrospective (generated on demand) ──────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-headline text-sm uppercase tracking-wider text-ink">
            Season Retrospective
          </h3>
          {!retrospective && !generating && (
            <button
              onClick={handleGenerate}
              className="rounded border border-dw-accent bg-dw-accent/10 px-4 py-1.5 font-sans text-xs uppercase tracking-wider text-dw-accent transition-colors hover:bg-dw-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Generate Retrospective
            </button>
          )}
        </div>

        {generating && (
          <div className="flex items-center justify-center rounded border border-dw-border bg-paper2 px-6 py-12">
            <div className="text-center">
              <div className="mx-auto mb-3 h-2 w-2 animate-pulse rounded-full bg-dw-accent" />
              <p className="font-serif text-sm italic text-ink3">
                Our writers are composing your season&apos;s story…
              </p>
            </div>
          </div>
        )}

        {retroError && !generating && (
          <div className="rounded border border-dw-red/40 bg-dw-red/5 px-4 py-3">
            <p className="font-sans text-sm text-dw-red">{retroError}</p>
            <button
              onClick={handleGenerate}
              className="mt-2 font-sans text-xs uppercase tracking-wider text-dw-accent hover:underline"
            >
              Try again
            </button>
          </div>
        )}

        {retrospective && <DynastyRetrospective retrospective={retrospective} />}

        {!retrospective && !generating && !retroError && (
          <div className="rounded border border-dashed border-dw-border bg-paper2/60 px-6 py-8 text-center">
            <p className="font-serif text-sm leading-relaxed text-ink2">
              Generate a longform retrospective on your season so far — grounded in your
              real record, ranking, and results.
            </p>
          </div>
        )}
      </div>

      {/* Divider */}
      <div className="h-px w-full bg-dw-border" />

      {/* ── Coming Soon (multi-season history not yet mapped) ───────────── */}
      <div>
        <h3 className="mb-3 font-headline text-sm uppercase tracking-wider text-ink">
          All-Time Records &amp; Season Archives
        </h3>
        <div className="rounded border border-dashed border-dw-border bg-paper2/60 px-6 py-10 text-center">
          <p className="font-headline text-lg text-ink">Reading from your save…</p>
          <div className="mx-auto mt-3 h-px w-16 bg-dw-accent" />
          <p className="mt-4 font-serif text-sm leading-relaxed text-ink2">
            Legacy scores, national and conference championships, award cases, and
            season-by-season archives need multi-season history that isn&apos;t mapped
            from the dynasty file yet. As DynastyWire ingests more of your save, the full
            trophy case will fill in here.
          </p>
          <p className="mt-4 font-sans text-xs uppercase tracking-wider text-ink3">
            Coming soon
          </p>
        </div>
      </div>
    </div>
  );
}
