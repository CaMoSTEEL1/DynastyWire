"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { SectionHeader } from "@/components/ui/section-header";
import { useDynasty } from "@/components/dynasty/dynasty-context";
import { TREND_CONFIG } from "@/lib/recruiting/types";

interface RecruitingBeat {
  title: string;
  text: string;
}

interface RecruitingColumn {
  headline: string;
  subhead: string;
  trend: string;
  trendReason: string;
  beats: RecruitingBeat[];
}

function TrendBadge({ trend }: { trend: string }) {
  const config = TREND_CONFIG[trend] ?? TREND_CONFIG.stable;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded border px-2.5 py-1 font-sans text-xs uppercase tracking-wider",
        config.color,
        "border-current"
      )}
      title={config.label}
    >
      <span className="text-sm leading-none">{config.icon}</span>
      <span>{config.label}</span>
    </span>
  );
}

export default function RecruitingPage() {
  const { snapshot, loading, error, generate, settings, currentSavePath } =
    useDynasty();

  const [column, setColumn] = useState<RecruitingColumn | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  const canGenerate = Boolean(currentSavePath && settings.anthropicKey);

  async function handleGenerate() {
    if (generating) return;
    setGenerating(true);
    setGenError(null);
    try {
      const result = await generate<RecruitingColumn>("recruiting", {});
      setColumn(result);
    } catch (err) {
      setGenError(
        err instanceof Error ? err.message : "Failed to generate recruiting column."
      );
    } finally {
      setGenerating(false);
    }
  }

  if (loading) {
    return (
      <div>
        <SectionHeader
          title="RECRUITING"
          subtitle="Building the next generation"
          variant="recruiting"
        />
        <div className="mt-8 rounded border border-dw-border bg-paper2 px-6 py-12 text-center">
          <p className="font-serif italic text-ink3">
            Reading your save&hellip;
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <SectionHeader
          title="RECRUITING"
          subtitle="Building the next generation"
          variant="recruiting"
        />
        <div className="mt-8 rounded border border-dw-red/30 bg-dw-red/10 px-6 py-12 text-center">
          <p className="font-serif text-dw-red">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <SectionHeader
        title="RECRUITING"
        subtitle="Building the next generation"
        variant="recruiting"
      />

      <div className="mt-6 space-y-6">
        {/* Board placeholder — the individual recruit board is not yet
            extracted from the save. Clearly labeled, no fabricated data. */}
        <div className="rounded border border-dashed border-dw-border bg-paper2 px-6 py-10 text-center">
          <p className="font-headline text-sm uppercase tracking-widest text-dw-accent">
            Recruiting Board Coming Soon
          </p>
          <p className="mx-auto mt-3 max-w-md font-serif text-sm leading-relaxed text-ink2">
            Individual recruits, star ratings, and commitments will appear here
            once the recruiting board is read directly from your dynasty save.
            {snapshot?.userTeam
              ? ` Tracking ${snapshot.userTeam.name} at Week ${snapshot.week ?? "—"}.`
              : " Reading from your save."}
          </p>
        </div>

        {/* Recruiting-trail storyline column (generated on demand) */}
        <div className="rounded border border-dw-border bg-paper">
          <div className="flex items-center justify-between gap-4 border-b border-dw-border bg-paper2 px-4 py-3">
            <h3 className="font-headline text-sm uppercase tracking-wider text-ink2">
              On The Trail
            </h3>
            {column && <TrendBadge trend={column.trend} />}
          </div>

          <div className="px-5 py-5">
            {!column ? (
              <div className="py-6 text-center">
                <p className="font-serif text-sm text-ink2">
                  Generate an insider read on where your program stands on the
                  recruiting trail — grounded in this week&apos;s results.
                </p>

                {genError && (
                  <p className="mt-3 font-sans text-sm text-dw-red">{genError}</p>
                )}

                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={generating || !canGenerate}
                  className={cn(
                    "mt-6 inline-flex items-center gap-2 rounded border border-dw-accent bg-dw-accent/10 px-5 py-2.5",
                    "font-headline text-sm uppercase tracking-wider text-dw-accent",
                    "transition-colors hover:bg-dw-accent/20",
                    "disabled:cursor-not-allowed disabled:opacity-50"
                  )}
                >
                  {generating ? "Working the phones…" : "Generate Trail Report"}
                </button>

                {!canGenerate && (
                  <p className="mt-3 font-sans text-xs text-ink3">
                    Add your save and API key in settings to generate.
                  </p>
                )}
              </div>
            ) : (
              <div>
                <h4 className="font-headline text-xl leading-tight text-ink">
                  {column.headline}
                </h4>
                <p className="mt-1 font-serif italic text-sm text-ink3">
                  {column.subhead}
                </p>

                {column.trendReason && (
                  <p className="mt-3 font-serif text-sm text-ink2">
                    {column.trendReason}
                  </p>
                )}

                <div className="my-5 flex items-center gap-3 text-dw-accent/60">
                  <span className="h-px flex-1 bg-dw-border" />
                  <span className="text-xs">&#9670;</span>
                  <span className="h-px flex-1 bg-dw-border" />
                </div>

                <div className="space-y-4">
                  {column.beats.map((beat, i) => (
                    <div key={i} className="border-l-2 border-dw-border pl-4">
                      <h5 className="font-headline text-xs uppercase tracking-wider text-ink3">
                        {beat.title}
                      </h5>
                      <p className="mt-1 font-serif text-sm leading-relaxed text-ink2">
                        {beat.text}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="mt-6 border-t border-dw-border pt-4">
                  <button
                    type="button"
                    onClick={handleGenerate}
                    disabled={generating}
                    className={cn(
                      "inline-flex items-center gap-2 rounded border border-dw-border bg-paper2 px-4 py-2",
                      "font-sans text-xs text-ink3",
                      "transition-colors hover:border-dw-accent hover:text-dw-accent",
                      "disabled:cursor-not-allowed disabled:opacity-50"
                    )}
                  >
                    {generating ? "Regenerating…" : "Regenerate"}
                  </button>
                  {genError && (
                    <p className="mt-2 font-sans text-xs text-dw-red">{genError}</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
