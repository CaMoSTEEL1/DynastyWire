"use client";

// THE WEEK — Road to Glory's front page, and the only generated surface in RTG v1.
//
// The load-bearing case is the week he DIDN'T play: it has to read as a real piece about not
// playing rather than padding, or the mode doesn't work (DESIGN-rtg-mode.md, decision 12).
// So the page leads with his playing time as a stated fact, computed from the games-played
// diff, and never leaves the reader guessing whether he was on the field.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useDynasty } from "@/components/dynasty/dynasty-context";
import { useIssueTab } from "@/components/dynasty/use-issue-tab";
import { SectionHeader } from "@/components/ui/section-header";
import { RtgGate } from "@/components/rtg/rtg-gate";
import { BrandPanel } from "@/components/rtg/brand-panel";
import { useBrand } from "@/components/rtg/use-brand";
import { useCharacter } from "@/components/rtg/use-character";
import { playingTime, seasonRole, weekLine, weekLineText, WEEK_STATE_LABEL } from "@/lib/dynasty/rtg";
import { cn } from "@/lib/utils";

interface WeekPiece {
  headline: string;
  byline: string;
  body: string;
  pullQuote?: string;
  error?: boolean;
}

function TheWeekPageInner() {
  const { snapshot, generate, loading } = useDynasty();
  const { brand, baseline, week: brandWeek } = useBrand();
  const character = useCharacter();

  const [piece, setPiece] = useState<WeekPiece | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cached = useIssueTab<WeekPiece>("rtg-week");
  useEffect(() => {
    if (!piece && cached) setPiece(cached);
  }, [cached, piece]);

  const player = snapshot?.player ?? null;

  // His week, computed — the same numbers the writer was handed.
  const time = useMemo(() => playingTime(player, baseline), [player, baseline]);
  const line = useMemo(() => weekLine(player, baseline, time), [player, baseline, time]);
  const lineText = weekLineText(line);
  // True from the first ingest, no baseline required — this is what stops a starter being
  // shown as a man who didn't play.
  const role = useMemo(() => seasonRole(player), [player]);

  const run = useCallback(async () => {
    setGenerating(true);
    setError(null);
    try {
      const data = await generate<WeekPiece>("rtg-week", { baselinePlayer: baseline, character });
      if (data?.error || !data?.body) setError("Couldn't file this week's story.");
      else setPiece(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't file this week's story.");
    } finally {
      setGenerating(false);
    }
  }, [generate, baseline, character]);

  if (loading) return <p className="p-6 font-serif text-ink3">Reading the save…</p>;
  if (!player) {
    return (
      <div className="p-6">
        <SectionHeader title="The Week" subtitle="Road to Glory" />
        <p className="font-serif text-ink2">
          This save doesn&apos;t have a Road to Glory player in it. Open an RTG save to use this
          screen.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-6">
      <SectionHeader
        title="The Week"
        subtitle={`${player.classYear ?? ""} ${player.position ?? ""} · ${snapshot?.userTeam?.name ?? ""}`.trim()}
      />

      <div className="grid gap-6 md:grid-cols-[1fr_16rem]">
        <div className="min-w-0">
          {/* His playing time, stated before anything else. This is the fact the whole mode
              turns on and it must never be something the reader has to infer from prose. */}
          <div
            className={cn(
              "rounded border-l-[3px] bg-paper2 px-4 py-3",
              time.state === "did-not-play"
                ? "border-l-ink3 border border-dw-border"
                : "border-l-dw-accent2 border border-paper4"
            )}
          >
            <p className="font-sans text-[10px] uppercase tracking-widest text-ink3">
              {role.role === "starter" ? "The starter" : role.role === "splitting-time" ? "Splitting time" : role.role === "rotation" ? "In the rotation" : "Yet to play"}
            </p>
            <p className="mt-1 font-headline text-xl uppercase tracking-wide text-ink">
              {player.name} — {role.gamesStarted} start{role.gamesStarted === 1 ? "" : "s"} in{" "}
              {role.gamesPlayed} game{role.gamesPlayed === 1 ? "" : "s"}
            </p>
            {time.hasBaseline && (
              <p className="mt-1 font-serif text-[15px] text-ink2">
                This week he {WEEK_STATE_LABEL[time.state]}.
              </p>
            )}
            {lineText && <p className="mt-1 font-serif text-[15px] text-ink2">{lineText}</p>}
            {!time.hasBaseline && (
              <p className="mt-1 font-sans text-[11px] text-ink3">
                First reading of this save — from next week the app can tell you what changed.
              </p>
            )}
          </div>

          {piece ? (
            <article className="mt-6">
              <h1 className="font-headline text-3xl leading-tight text-ink sm:text-4xl">
                {piece.headline}
              </h1>
              <p className="mt-2 font-sans text-[11px] uppercase tracking-wider text-ink3">
                By {piece.byline}
              </p>
              {piece.pullQuote && (
                <p className="my-5 border-l-2 border-dw-crimson pl-4 font-headline text-lg italic leading-snug text-dw-accent2">
                  {piece.pullQuote}
                </p>
              )}
              <div className="mt-4 space-y-4 font-serif text-[17px] leading-relaxed text-ink2">
                {piece.body.split("\n\n").map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </div>
            </article>
          ) : (
            <div className="mt-6 rounded border border-dw-border bg-paper2 px-6 py-10 text-center">
              <p className="font-serif text-ink2">
                {time.state === "did-not-play"
                  ? "He didn't play this week. There's still a story in that."
                  : "This week hasn't been written yet."}
              </p>
              {error && <p className="mt-3 font-serif text-sm text-dw-red">{error}</p>}
              <button
                type="button"
                onClick={() => void run()}
                disabled={generating}
                className="mt-5 rounded border border-dw-crimson bg-dw-crimson px-6 py-2.5 font-sans text-sm uppercase tracking-wider text-paper hover:opacity-90 disabled:opacity-50"
              >
                {generating ? "Filing…" : "Write this week"}
              </button>
            </div>
          )}
        </div>

        <aside className="space-y-4">
          <BrandPanel state={brand} week={brandWeek} />
          {player.prospectStars && (
            <div className="rounded border border-dw-border bg-paper2 p-4">
              <p className="font-sans text-[10px] uppercase tracking-[0.3em] text-ink3">
                Out of high school
              </p>
              <p className="mt-1 font-headline text-xl text-ink">
                {player.prospectStars.replace(/_/g, " ").toLowerCase()}
              </p>
              {player.homeState && (
                <p className="mt-1 font-serif text-sm text-ink2">from {player.homeState}</p>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

// Every RTG surface is wrapped: the character is mandatory, and whichever page the user opens
// first is where they meet him. See DESIGN-rtg-mode.md decision 10.
export default function TheWeekPage() {
  return (
    <RtgGate>
      <TheWeekPageInner />
    </RtgGate>
  );
}
